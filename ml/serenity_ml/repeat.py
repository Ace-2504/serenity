"""Repeat purchase: will a named customer buy again within the next H days?

Leakage rules, enforced by construction and by tests:
  * features at a cutoff use only invoices dated on or before the cutoff;
  * a training example at cutoff t is used to evaluate a fold at cutoff c only if t + H <= c
    (its label window has closed before the fold starts).

The model (logistic regression on log-scaled RFM-style features) is compared with three
baselines on held-out time windows. It ships only if it beats the best baseline clearly;
otherwise the best baseline ships, calibrated, and the report says so.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

HORIZON_DAYS = 60
FOLDS = 3
TRAIN_CUTOFFS = 12  # monthly training cutoffs before each fold
MIN_AUC_GAIN = 0.01

FEATURES = ["log_recency", "log_freq_365", "log_freq_90", "log_monetary_365", "log_tenure", "overdue_ratio", "same_window_last_year", "trend_90"]
# Plain-language description of each feature when it is high / low for a customer.
FEATURE_LABELS = {
    "log_recency": ("has not bought for a while", "bought recently"),
    "log_freq_365": ("orders often", "orders rarely"),
    "log_freq_90": ("ordered in the last 90 days", "few orders in the last 90 days"),
    "log_monetary_365": ("spends a lot", "spends little"),
    "log_tenure": ("long-standing customer", "new customer"),
    "overdue_ratio": ("past their usual reorder gap", "within their usual reorder gap"),
    "same_window_last_year": ("bought in this season last year", "did not buy in this season last year"),
    "trend_90": ("ordering more lately", "ordering less lately"),
}
BASELINES = ["recency", "rfm", "last_year_same_window"]


def features(invoices: pd.DataFrame, cutoff: pd.Timestamp, horizon: int = HORIZON_DAYS) -> pd.DataFrame:
    """One row per named customer with an invoice on or before the cutoff. Uses no later data."""
    past = invoices[(invoices["date"] <= cutoff) & (~invoices["anonymous"])]
    if past.empty:
        return pd.DataFrame(columns=["party_id", *FEATURES, "recency_days", "freq_365", "monetary_365"]).set_index("party_id")
    g = past.groupby("party_id")
    last = g["date"].max()
    first = g["date"].min()
    count = g["voucher_id"].count()
    in_window = lambda lo, hi: past[(past["date"] > cutoff - pd.Timedelta(days=lo)) & (past["date"] <= cutoff - pd.Timedelta(days=hi))].groupby("party_id")
    freq_365 = in_window(365, 0)["voucher_id"].count()
    freq_90 = in_window(90, 0)["voucher_id"].count()
    freq_prev_90 = in_window(180, 90)["voucher_id"].count()
    monetary_365 = in_window(365, 0)["value"].sum()
    same_window = past[(past["date"] > cutoff - pd.Timedelta(days=365)) & (past["date"] <= cutoff - pd.Timedelta(days=365 - horizon))].groupby("party_id")["voucher_id"].count()

    df = pd.DataFrame(index=last.index)
    df["recency_days"] = (cutoff - last).dt.days.astype(float)
    tenure = (cutoff - first).dt.days.astype(float)
    df["freq_365"] = freq_365.reindex(df.index).fillna(0.0)
    df["monetary_365"] = monetary_365.reindex(df.index).fillna(0.0)
    mean_gap = np.where(count > 1, (last - first).dt.days / np.maximum(count - 1, 1), np.nan)
    df["log_recency"] = np.log1p(df["recency_days"])
    df["log_freq_365"] = np.log1p(df["freq_365"])
    df["log_freq_90"] = np.log1p(freq_90.reindex(df.index).fillna(0.0))
    df["log_monetary_365"] = np.log1p(df["monetary_365"].clip(lower=0))
    df["log_tenure"] = np.log1p(tenure)
    df["overdue_ratio"] = np.clip(df["recency_days"] / np.where(np.isnan(mean_gap), np.maximum(tenure, 30.0), np.maximum(mean_gap, 1.0)), 0, 20)
    df["same_window_last_year"] = np.log1p(same_window.reindex(df.index).fillna(0.0))
    df["trend_90"] = df["log_freq_90"] - np.log1p(freq_prev_90.reindex(df.index).fillna(0.0))
    return df


def labels(invoices: pd.DataFrame, cutoff: pd.Timestamp, horizon: int = HORIZON_DAYS) -> pd.Series:
    """1 if the customer has an invoice in (cutoff, cutoff + horizon]."""
    future = invoices[(invoices["date"] > cutoff) & (invoices["date"] <= cutoff + pd.Timedelta(days=horizon))]
    return pd.Series(1, index=future["party_id"].unique(), dtype=int)


def baseline_scores(f: pd.DataFrame) -> dict[str, np.ndarray]:
    def quintile(s: pd.Series, ascending: bool) -> np.ndarray:
        ranks = s.rank(method="average", ascending=ascending, pct=True)
        return np.ceil(ranks * 5).to_numpy()

    return {
        "recency": -f["recency_days"].to_numpy(),
        "rfm": quintile(f["recency_days"], ascending=False) + quintile(f["freq_365"], True) + quintile(f["monetary_365"], True),
        "last_year_same_window": f["same_window_last_year"].to_numpy() + 1e-3 * -f["recency_days"].to_numpy() / 365,
    }


def train_cutoffs(fold_cutoff: pd.Timestamp, horizon: int = HORIZON_DAYS) -> list[pd.Timestamp]:
    """Training cutoffs for a fold: monthly, each early enough that its label window closes by the fold."""
    return [fold_cutoff - pd.Timedelta(days=horizon + 30 * m) for m in range(TRAIN_CUTOFFS)]


def choose(folds: list[dict]) -> tuple[str, str, int]:
    """(shipped, best baseline, folds the model won). The model must beat the best baseline's mean
    AUC by MIN_AUC_GAIN and win a majority of folds; otherwise the best baseline ships."""
    mean = {name: float(np.mean([f[name]["auc"] for f in folds])) for name in ["model", *BASELINES]}
    best = max(BASELINES, key=lambda b: mean[b])
    wins = sum(f["model"]["auc"] > f[best]["auc"] for f in folds)
    ok = mean["model"] - mean[best] >= MIN_AUC_GAIN and wins > len(folds) / 2
    return ("model" if ok else best), best, int(wins)


def examples(invoices: pd.DataFrame, cutoffs: list[pd.Timestamp]) -> pd.DataFrame:
    frames = []
    for c in cutoffs:
        f = features(invoices, c)
        if f.empty:
            continue
        y = labels(invoices, c)
        f = f.assign(label=f.index.isin(y.index).astype(int), cutoff=c)
        frames.append(f)
    return pd.concat(frames) if frames else pd.DataFrame()


def _fit(train: pd.DataFrame):
    scaler = StandardScaler().fit(train[FEATURES])
    model = LogisticRegression(max_iter=1000, C=1.0).fit(scaler.transform(train[FEATURES]), train["label"])
    return scaler, model


def _calibrator(scores: np.ndarray, y: np.ndarray) -> IsotonicRegression:
    """Maps a baseline score to a probability without ever reversing its order (isotonic, increasing)."""
    return IsotonicRegression(increasing=True, out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(scores, y)


def _metrics(y: np.ndarray, p: np.ndarray, rank: np.ndarray | None = None) -> dict[str, float]:
    """Ranking metrics use `rank` (the raw score) when given; calibration metrics use the probability p."""
    base = float(y.mean())
    r = p if rank is None else rank
    top = np.argsort(-r, kind="stable")[: max(1, len(r) // 10)]
    return {
        "auc": float(roc_auc_score(y, r)),
        "average_precision": float(average_precision_score(y, r)),
        "brier": float(brier_score_loss(y, p)),
        "top_decile_lift": float(y[top].mean() / base) if base > 0 else float("nan"),
        "base_rate": base,
        "n": int(len(y)),
    }


@dataclass
class RepeatResult:
    shipped: str
    folds: list[dict]
    summary: dict
    predictions: pd.DataFrame = field(repr=False)
    cutoff: pd.Timestamp | None = None


def backtest_and_predict(invoices: pd.DataFrame, as_of: pd.Timestamp | None = None, horizon: int = HORIZON_DAYS) -> RepeatResult:
    end = as_of or invoices["date"].max()
    fold_cutoffs = [end - pd.Timedelta(days=horizon * (k + 1)) for k in range(FOLDS)][::-1]
    folds = []
    for c in fold_cutoffs:
        train = examples(invoices, train_cutoffs(c, horizon))
        test = examples(invoices, [c])
        if train.empty or test.empty or train["label"].nunique() < 2 or test["label"].nunique() < 2:
            continue
        scaler, model = _fit(train)
        y = test["label"].to_numpy()
        result = {"cutoff": c.date().isoformat(), "train_examples": int(len(train)), "model": _metrics(y, model.predict_proba(scaler.transform(test[FEATURES]))[:, 1])}
        train_base, test_base = baseline_scores(train), baseline_scores(test)
        for name in BASELINES:
            cal = _calibrator(train_base[name], train["label"].to_numpy())
            result[name] = _metrics(y, cal.predict(test_base[name]), rank=test_base[name])
        folds.append(result)

    if not folds:
        return RepeatResult("none", [], {"reason": "Not enough history: need customers with purchases on both sides of several cutoffs"}, pd.DataFrame())

    mean = {name: float(np.mean([f[name]["auc"] for f in folds])) for name in ["model", *BASELINES]}
    shipped, best_baseline, wins = choose(folds)
    ships_model = shipped == "model"
    summary = {
        "mean_auc": mean,
        "best_baseline": best_baseline,
        "model_wins_folds": int(wins),
        "folds": len(folds),
        "rule": f"Ship the model only if its mean AUC beats the best baseline by >= {MIN_AUC_GAIN} and it wins most folds",
        "horizon_days": horizon,
    }

    # Final fit on every example whose outcome is already known, then score everyone at the end date.
    final_train = examples(invoices, train_cutoffs(end, horizon))
    current = features(invoices, end)
    if current.empty or final_train.empty:
        return RepeatResult(shipped, folds, summary, pd.DataFrame(), end)
    if ships_model:
        scaler, model = _fit(final_train)
        z = scaler.transform(current[FEATURES])
        scores = model.predict_proba(z)[:, 1]
        contributions = z * model.coef_[0]
        factors = [_top_factors(zrow, crow) for zrow, crow in zip(z, contributions)]
    else:
        cal = _calibrator(baseline_scores(final_train)[shipped], final_train["label"].to_numpy())
        scores = cal.predict(baseline_scores(current)[shipped])
        factors = [[{"factor": shipped, "direction": "baseline", "label": _baseline_label(shipped, r)}] for _, r in current.iterrows()]
    predictions = pd.DataFrame({"party_id": current.index, "score": scores, "factors": factors})
    return RepeatResult(shipped, folds, summary, predictions, end)


def _top_factors(z: np.ndarray, contribution: np.ndarray, k: int = 3) -> list[dict]:
    """The k features that moved this customer's score most: what they are like, and which way it pushed."""
    order = np.argsort(-np.abs(contribution))[:k]
    out = []
    for i in order:
        high, low = FEATURE_LABELS[FEATURES[i]]
        out.append({"factor": FEATURES[i], "direction": "raises" if contribution[i] > 0 else "lowers", "label": high if z[i] > 0 else low, "weight": round(float(contribution[i]), 3)})
    return out


def _baseline_label(name: str, row: pd.Series) -> str:
    if name == "recency":
        return f"last bought {int(row['recency_days'])} days ago"
    if name == "rfm":
        return f"{int(row['freq_365'])} orders in the last year"
    return "bought in this season last year" if row["same_window_last_year"] > 0 else "did not buy in this season last year"
