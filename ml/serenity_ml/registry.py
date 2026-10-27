"""Writes model versions and their outputs. One transaction per run; earlier versions are superseded, not deleted."""

from __future__ import annotations

import hashlib
import json
import uuid

import pandas as pd
import psycopg

from serenity_ml import CODE_VERSION


def data_hash(*frames: pd.DataFrame) -> str:
    h = hashlib.sha256()
    for f in frames:
        h.update(pd.util.hash_pandas_object(f.reset_index(drop=True), index=False).values.tobytes())
    return h.hexdigest()


def _version(cur: psycopg.Cursor, tenant_id: str, model: str, cutoff, dhash: str, features: list[str], metrics: dict, shipped: str, notes: str) -> str:
    cur.execute('UPDATE "ModelVersion" SET "status" = %s WHERE "tenantId" = %s AND "model" = %s AND "status" = %s', ("superseded", tenant_id, model, "active"))
    vid = str(uuid.uuid4())
    cur.execute(
        'INSERT INTO "ModelVersion" ("id", "tenantId", "model", "codeVersion", "dataCutoff", "dataHash", "featureList", "metrics", "shipped", "status", "notes") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active', %s)",
        (vid, tenant_id, model, CODE_VERSION, cutoff, dhash, json.dumps(features), json.dumps(metrics, default=str), shipped, notes),
    )
    return vid


def save(conn: psycopg.Connection, tenant_id: str, dhash: str, repeat, forecast, basket: pd.DataFrame, cutoff) -> dict:
    from serenity_ml.repeat import FEATURES

    written = {}
    with conn.transaction(), conn.cursor() as cur:
        if repeat.shipped != "none":
            vid = _version(cur, tenant_id, "repeat_purchase", repeat.cutoff.date(), dhash, FEATURES, {"folds": repeat.folds, "summary": repeat.summary}, repeat.shipped, "Probability of an order in the next 60 days")
            rows = [(str(uuid.uuid4()), tenant_id, vid, "party", r.party_id, repeat.cutoff.date(), repeat.summary["horizon_days"], float(r.score), repeat.shipped, json.dumps(r.factors)) for r in repeat.predictions.itertuples()]
            cur.executemany(
                'INSERT INTO "Prediction" ("id", "tenantId", "modelVersionId", "entityType", "entityId", "asOf", "horizonDays", "score", "method", "factors") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                rows,
            )
            written["repeat_purchase"] = {"version": vid, "shipped": repeat.shipped, "predictions": len(rows)}
        if forecast.shipped != "none":
            vid = _version(cur, tenant_id, "demand_forecast", cutoff, dhash, [], forecast.summary, forecast.shipped, "Units per week, next 8 weeks")
            rows = [(str(uuid.uuid4()), tenant_id, vid, r.item_id, r.week_start, float(r.qty), r.method) for r in forecast.points.itertuples()]
            cur.executemany('INSERT INTO "ForecastPoint" ("id", "tenantId", "modelVersionId", "itemId", "weekStart", "qty", "method") VALUES (%s, %s, %s, %s, %s, %s, %s)', rows)
            written["demand_forecast"] = {"version": vid, "shipped": forecast.shipped, "points": len(rows)}
        vid = _version(cur, tenant_id, "basket_pairs", cutoff, dhash, [], {"pairs": int(len(basket))}, "statistic", "Items bought together on the same invoice, last 12 months")
        rows = [(str(uuid.uuid4()), tenant_id, vid, r.item_id, r.partner_item_id, int(r.together), float(r.support), float(r.confidence), float(r.lift)) for r in basket.itertuples()]
        cur.executemany(
            'INSERT INTO "BasketPair" ("id", "tenantId", "modelVersionId", "itemId", "partnerItemId", "together", "support", "confidence", "lift") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
            rows,
        )
        written["basket_pairs"] = {"version": vid, "pairs": len(rows)}
        # Outputs of superseded versions are no longer shown; keep the version rows (and metrics) for history.
        for table in ("Prediction", "ForecastPoint", "BasketPair"):
            cur.execute(
                f'DELETE FROM "{table}" t USING "ModelVersion" m WHERE t."tenantId" = %s AND m."tenantId" = t."tenantId" AND m."id" = t."modelVersionId" AND m."status" = %s',
                (tenant_id, "superseded"),
            )
    return written
