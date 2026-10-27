"""Unit tests for the ML worker: leakage, decision rules and hand-computed method values."""

import numpy as np
import pandas as pd
import pytest

from serenity_ml import basket, db, forecast, repeat


def synthetic_invoices(seed: int = 7, customers: int = 120, days: int = 720) -> pd.DataFrame:
    """Customers buying on their own regular cycle, some of whom stop: real signal for the model."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2024-10-01")
    rows = []
    for c in range(customers):
        gap = int(rng.integers(10, 90))
        stop = int(rng.integers(200, days + 200))  # some stop before the end
        day = int(rng.integers(0, gap))
        while day < min(days, stop):
            rows.append({"voucher_id": f"v{c}-{day}", "party_id": f"p{c}", "date": start + pd.Timedelta(days=day), "value": float(rng.integers(500, 5000)), "anonymous": False, "channel": "direct"})
            day += max(1, int(rng.normal(gap, gap * 0.2)))
    rows.append({"voucher_id": "counter", "party_id": "cash", "date": start + pd.Timedelta(days=5), "value": 100.0, "anonymous": True, "channel": "counter"})
    return pd.DataFrame(rows)


class TestRepeatPurchaseLeakage:
    def test_features_ignore_everything_after_the_cutoff(self):
        inv = synthetic_invoices()
        cutoff = pd.Timestamp("2025-09-01")
        full = repeat.features(inv, cutoff)
        truncated = repeat.features(inv[inv["date"] <= cutoff], cutoff)
        pd.testing.assert_frame_equal(full, truncated)
        # Rewriting the future does not move today's features.
        future = inv["date"] > cutoff
        altered = inv.copy()
        altered.loc[future, "value"] *= 100
        altered.loc[future, "date"] += pd.Timedelta(days=3)
        pd.testing.assert_frame_equal(full, repeat.features(altered, cutoff))

    def test_training_label_windows_close_before_the_fold(self):
        fold = pd.Timestamp("2026-05-01")
        for t in repeat.train_cutoffs(fold):
            assert t + pd.Timedelta(days=repeat.HORIZON_DAYS) <= fold

    def test_anonymous_buyers_are_never_scored(self):
        f = repeat.features(synthetic_invoices(), pd.Timestamp("2026-01-01"))
        assert "cash" not in f.index

    def test_labels_cover_exactly_the_horizon(self):
        inv = pd.DataFrame({"voucher_id": ["a", "b", "c"], "party_id": ["x", "y", "z"], "date": pd.to_datetime(["2025-01-01", "2025-03-02", "2025-03-03"]), "value": 1.0, "anonymous": False})
        y = repeat.labels(inv, pd.Timestamp("2025-01-01"), horizon=60)
        assert set(y.index) == {"y"}  # day 60 is in, day 61 is out, the cutoff day itself is out


class TestShipDecision:
    @staticmethod
    def folds(model, best):
        return [{"model": {"auc": m}, "recency": {"auc": 0.5}, "rfm": {"auc": b}, "last_year_same_window": {"auc": 0.4}} for m, b in zip(model, best)]

    def test_baseline_ships_when_the_model_gain_is_too_small(self):
        assert repeat.choose(self.folds([0.806, 0.81, 0.80], [0.80, 0.80, 0.80]))[0] == "rfm"

    def test_baseline_ships_when_the_model_wins_only_on_average(self):
        assert repeat.choose(self.folds([0.95, 0.79, 0.79], [0.80, 0.80, 0.80]))[0] == "rfm"

    def test_model_ships_when_it_clearly_wins(self):
        assert repeat.choose(self.folds([0.85, 0.84, 0.83], [0.80, 0.80, 0.80])) == ("model", "rfm", 3)


class TestRepeatPurchaseEndToEnd:
    def test_backtest_reports_model_and_every_baseline_on_each_fold(self):
        result = repeat.backtest_and_predict(synthetic_invoices())
        assert len(result.folds) == repeat.FOLDS
        for fold in result.folds:
            for name in ["model", *repeat.BASELINES]:
                assert 0.5 < fold[name]["auc"] <= 1.0
                assert 0 <= fold[name]["brier"] <= 1
        assert result.shipped in ["model", *repeat.BASELINES]
        assert result.predictions["score"].between(0, 1).all()
        assert len(result.predictions) == synthetic_invoices()["party_id"].nunique() - 1

    def test_factors_explain_model_scores(self):
        result = repeat.backtest_and_predict(synthetic_invoices())
        for factors in result.predictions["factors"]:
            assert 1 <= len(factors) <= 3
            assert all(f["label"] for f in factors)


class TestForecastMethods:
    def test_croston_and_sba_by_hand(self):
        y = np.array([0, 0, 3, 0, 0, 0, 6, 0], dtype=float)
        # sizes: 3 -> 0.1*6 + 0.9*3 = 3.3; intervals: 3 -> 0.1*4 + 0.9*3 = 3.1
        assert forecast.croston(y, 2) == pytest.approx([3.3 / 3.1] * 2)
        assert forecast.croston(y, 1, sba=True) == pytest.approx([3.3 / 3.1 * 0.95])

    def test_seasonal_naive_repeats_last_year(self):
        y = np.arange(60, dtype=float)
        assert forecast.seasonal_naive(y, 3).tolist() == [8.0, 9.0, 10.0]
        assert forecast.seasonal_naive(np.array([1.0, 2.0]), 2).tolist() == [2.0, 2.0]  # short history: naive

    def test_mase_scale_is_mean_absolute_naive_error(self):
        assert forecast.mase_scale(np.array([0, 2, 2, 5], dtype=float)) == pytest.approx((2 + 0 + 3) / 3)

    def test_weekly_series_stops_at_the_last_full_week(self):
        lines = pd.DataFrame({"voucher_id": ["a", "b"], "item_id": ["i", "i"], "date": pd.to_datetime(["2025-01-06", "2025-01-15"]), "qty": [2.0, 5.0]})
        weeks, series = forecast.weekly_series(lines, pd.Timestamp("2025-01-15"))  # a Wednesday: its week is incomplete
        assert list(weeks) == [pd.Timestamp("2025-01-06")]
        assert series["i"].tolist() == [2.0]

    def test_baseline_ships_unless_a_method_clearly_beats_it(self):
        rng = np.random.default_rng(3)
        rows = [{"voucher_id": f"{i}-{d}", "item_id": f"i{i}", "date": pd.Timestamp("2024-01-01") + pd.Timedelta(days=int(d)), "qty": float(rng.poisson(3))} for i in range(20) for d in rng.choice(700, 120, replace=False)]
        result = forecast.backtest_and_forecast(pd.DataFrame(rows))
        best, baseline = result.summary["best"], forecast.BASELINE
        gain = 1 - result.summary["methods"][best]["mean_mase"] / result.summary["methods"][baseline]["mean_mase"]
        assert result.shipped == (best if gain >= forecast.MIN_GAIN else baseline)
        assert (result.points["qty"] >= 0).all()
        end = pd.DataFrame(rows)["date"].max()
        assert (pd.to_datetime(result.points["week_start"]) > end).all()
        assert (pd.to_datetime(result.points["week_start"]).dt.weekday == 0).all()
        assert set(result.points["method"]) == {result.shipped}


class TestBasket:
    def test_lift_by_hand(self):
        rows = []
        # 10 invoices: A+B on 6, A alone on 2, C alone on 2.
        for n in range(6):
            rows += [{"voucher_id": f"ab{n}", "item_id": "A"}, {"voucher_id": f"ab{n}", "item_id": "B"}]
        rows += [{"voucher_id": f"a{n}", "item_id": "A"} for n in range(2)] + [{"voucher_id": f"c{n}", "item_id": "C"} for n in range(2)]
        lines = pd.DataFrame(rows).assign(date=pd.Timestamp("2025-01-01"), qty=1.0)
        out = basket.pairs(lines).set_index(["item_id", "partner_item_id"])
        # confidence(A->B) = 6/8; share of invoices with B = 6/10 -> lift 1.25
        assert out.loc[("A", "B"), "confidence"] == pytest.approx(0.75)
        assert out.loc[("A", "B"), "lift"] == pytest.approx(1.25)
        assert out.loc[("B", "A"), "lift"] == pytest.approx(1.25)
        assert out.loc[("A", "B"), "support"] == pytest.approx(0.6)


def test_prisma_parameters_are_removed_from_the_connection_url():
    assert db.connection_url("postgresql://u:p@h:5432/d?schema=public&sslmode=require") == "postgresql://u:p@h:5432/d?sslmode=require"
