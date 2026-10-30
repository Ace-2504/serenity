"""Weekly demand forecasts for intermittent item demand.

Methods: naive, seasonal naive (52 weeks), 8-week moving average, simple exponential smoothing
(ETS(A,N,N)), Croston and SBA (Syntetos-Boylan approximation). Evaluated by rolling origin on
the last ORIGINS x HORIZON weeks and scored with MASE (scaled by the in-sample naive error).
The best method ships only if it beats the seasonal-naive baseline by MIN_GAIN; otherwise
seasonal naive ships. Forecasts use only weeks before the forecast origin.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

HORIZON = 4
ORIGINS = 3
SEASON = 52
FORECAST_WEEKS = 8
MIN_GAIN = 0.02
BASELINE = "seasonal_naive"


def weekly_series(lines: pd.DataFrame, end: pd.Timestamp) -> tuple[pd.DatetimeIndex, dict[str, np.ndarray]]:
    """Units sold per item per week (weeks start Monday), up to the last full week before end."""
    week = lambda d: d - pd.to_timedelta(d.dt.weekday, unit="D")
    last_week = end - pd.Timedelta(days=end.weekday()) - pd.Timedelta(days=7 if end.weekday() != 6 else 0)
    df = lines[lines["date"] <= end].assign(week=lambda x: week(x["date"]))
    weeks = pd.date_range(df["week"].min(), last_week, freq="7D")
    pivot = df[df["week"] <= last_week].pivot_table(index="week", columns="item_id", values="qty", aggfunc="sum").reindex(weeks).fillna(0.0)
    return weeks, {item: pivot[item].to_numpy() for item in pivot.columns}


def naive(y: np.ndarray, h: int) -> np.ndarray:
    return np.full(h, y[-1] if len(y) else 0.0)


def seasonal_naive(y: np.ndarray, h: int) -> np.ndarray:
    if len(y) < SEASON:
        return naive(y, h)
    return np.array([y[len(y) - SEASON + (j % SEASON)] for j in range(h)])


def moving_average(y: np.ndarray, h: int, window: int = 8) -> np.ndarray:
    return np.full(h, y[-window:].mean() if len(y) else 0.0)


def ses(y: np.ndarray, h: int, alpha: float = 0.2) -> np.ndarray:
    level = y[0] if len(y) else 0.0
    for v in y[1:]:
        level = alpha * v + (1 - alpha) * level
    return np.full(h, level)


def croston(y: np.ndarray, h: int, alpha: float = 0.1, sba: bool = False) -> np.ndarray:
    nonzero = np.flatnonzero(y)
    if len(nonzero) == 0:
        return np.zeros(h)
    size = y[nonzero[0]]
    interval = float(nonzero[0] + 1)
    last = nonzero[0]
    for i in nonzero[1:]:
        size = alpha * y[i] + (1 - alpha) * size
        interval = alpha * (i - last) + (1 - alpha) * interval
        last = i
    rate = size / interval
    return np.full(h, rate * (1 - alpha / 2) if sba else rate)


METHODS = {
    "naive": naive,
    "seasonal_naive": seasonal_naive,
    "moving_average_8": moving_average,
    "ses": ses,
    "croston": croston,
    "sba": lambda y, h: croston(y, h, sba=True),
}


def mase_scale(train: np.ndarray) -> float:
    return float(np.mean(np.abs(np.diff(train)))) if len(train) > 1 else 0.0


@dataclass
class ForecastResult:
    shipped: str
    summary: dict
    points: pd.DataFrame = field(repr=False)


def backtest_and_forecast(lines: pd.DataFrame, end: pd.Timestamp | None = None, active_weeks: int = 52) -> ForecastResult:
    end = end or lines["date"].max()
    weeks, series = weekly_series(lines, end)
    n = len(weeks)
    if n < ORIGINS * HORIZON + 8:
        return ForecastResult("none", {"reason": f"Need at least {ORIGINS * HORIZON + 8} weeks of sales; have {n}"}, pd.DataFrame())
    origins = [n - (ORIGINS - k) * HORIZON for k in range(ORIGINS)]
    scores: dict[str, list[float]] = {m: [] for m in METHODS}
    evaluated = 0
    for y in series.values():
        scale = mase_scale(y[: origins[0]])
        if scale == 0:
            continue  # flat or empty history: MASE undefined
        evaluated += 1
        for name, f in METHODS.items():
            errors = [np.abs(f(y[:o], HORIZON) - y[o : o + HORIZON]) for o in origins]
            scores[name].append(float(np.mean(np.concatenate(errors)) / scale))
    if evaluated == 0:
        return ForecastResult("none", {"reason": "No item has enough varying history to evaluate"}, pd.DataFrame())

    table = {m: {"mean_mase": float(np.mean(v)), "median_mase": float(np.median(v))} for m, v in scores.items()}
    best = min(METHODS, key=lambda m: table[m]["mean_mase"])
    gain = 1 - table[best]["mean_mase"] / table[BASELINE]["mean_mase"]
    shipped = best if best != BASELINE and gain >= MIN_GAIN else BASELINE
    summary = {
        "methods": table,
        "best": best,
        "baseline": BASELINE,
        "gain_over_baseline": gain,
        "items_evaluated": evaluated,
        "weeks": n,
        "rule": f"Ship the best method only if its mean MASE is at least {MIN_GAIN:.0%} below seasonal naive",
        "backtest": f"{ORIGINS} rolling origins x {HORIZON}-week horizon",
    }

    # The week containing the cutoff is partly in the past: forecasts start with the next full week.
    start = end.normalize() + pd.Timedelta(days=7 - end.weekday())
    future = pd.date_range(start, periods=FORECAST_WEEKS, freq="7D")
    rows = []
    for item, y in series.items():
        if y[-active_weeks:].sum() <= 0:
            continue  # not sold in the last year: no forecast
        f = METHODS[shipped](y, FORECAST_WEEKS)
        rows.extend({"item_id": item, "week_start": w.date(), "qty": float(max(q, 0.0)), "method": shipped} for w, q in zip(future, f))
    return ForecastResult(shipped, summary, pd.DataFrame(rows))
