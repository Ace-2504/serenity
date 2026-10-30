"""python -m serenity_ml run --tenant <id> [--as-of YYYY-MM-DD]

Prints one JSON line with what was trained, how it compared with the baselines, and what shipped.
"""

from __future__ import annotations

import argparse
import json
import sys

import pandas as pd

from serenity_ml import CODE_VERSION, basket, db, forecast, registry, repeat


def run(tenant_id: str, as_of: str | None = None, url: str | None = None) -> dict:
    with db.connect(url) as conn:
        db.scope_to_tenant(conn, tenant_id)
        invoices = db.load_invoices(conn, tenant_id)
        lines = db.load_lines(conn, tenant_id)
        if invoices.empty:
            return {"tenant": tenant_id, "status": "no_data"}
        end = pd.Timestamp(as_of) if as_of else invoices["date"].max()
        invoices = invoices[invoices["date"] <= end]
        lines = lines[lines["date"] <= end]
        rep = repeat.backtest_and_predict(invoices, end)
        fc = forecast.backtest_and_forecast(lines, end)
        bp = basket.pairs(lines, since=end - pd.Timedelta(days=365))
        written = registry.save(conn, tenant_id, registry.data_hash(invoices, lines), rep, fc, bp, end.date())
    return {
        "tenant": tenant_id,
        "status": "ok",
        "code_version": CODE_VERSION,
        "as_of": end.date().isoformat(),
        "repeat_purchase": {"shipped": rep.shipped, **rep.summary},
        "demand_forecast": {"shipped": fc.shipped, **fc.summary},
        "basket_pairs": {"pairs": int(len(bp))},
        "written": written,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="serenity_ml")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="train, evaluate against baselines, and write predictions")
    r.add_argument("--tenant", required=True)
    r.add_argument("--as-of")
    args = parser.parse_args(argv)
    try:
        result = run(args.tenant, args.as_of)
    except Exception as error:  # report failures as JSON for the job runner, without data values
        print(json.dumps({"status": "error", "error": type(error).__name__, "message": str(error)[:500]}))
        return 1
    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
