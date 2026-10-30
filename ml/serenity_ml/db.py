"""Database access. Every query is filtered by tenant id; nothing is read across businesses."""

from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd
import psycopg

# Prisma-only URL parameters that libpq does not understand.
_PRISMA_PARAMS = {"schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size"}


def connection_url(url: str | None = None) -> str:
    raw = url or os.environ.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("DATABASE_URL is not set")
    parts = urlsplit(raw)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in _PRISMA_PARAMS]
    return urlunsplit(parts._replace(query=urlencode(query)))


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(connection_url(url))


def scope_to_tenant(conn: psycopg.Connection, tenant_id: str) -> None:
    """Declare the business for this session. Row-level security (when the role is not a superuser)
    then hides every other business's rows and refuses writes to them, even if a query forgets
    its tenant filter."""
    with conn.cursor() as cur:
        cur.execute("SELECT set_config('app.tenant_required', 'on', false), set_config('app.tenant_id', %s, false)", (tenant_id,))


def _frame(conn: psycopg.Connection, sql: str, params: tuple) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [c.name for c in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=columns)


def load_invoices(conn: psycopg.Connection, tenant_id: str) -> pd.DataFrame:
    """Active sales invoices net of nothing: id, party, date, taxable value, anonymous flag."""
    df = _frame(
        conn,
        """
        SELECT v."id" AS voucher_id, v."partyId" AS party_id, v."date" AS date,
               v."taxableAmount"::float AS value, p."anonymousBuyers" AS anonymous, COALESCE(v."channel", 'direct') AS channel
        FROM "Voucher" v JOIN "Party" p ON p."tenantId" = v."tenantId" AND p."id" = v."partyId"
        WHERE v."tenantId" = %s AND v."status" = 'active' AND v."type" = 'sales_invoice'
        """,
        (tenant_id,),
    )
    df["date"] = pd.to_datetime(df["date"])
    return df


def load_lines(conn: psycopg.Connection, tenant_id: str) -> pd.DataFrame:
    """Sales invoice lines (units) minus nothing: returns are handled separately by the ledger."""
    df = _frame(
        conn,
        """
        SELECT l."voucherId" AS voucher_id, l."itemId" AS item_id, v."date" AS date, l."qty"::float AS qty
        FROM "VoucherLine" l JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
        WHERE l."tenantId" = %s AND v."status" = 'active' AND v."type" = 'sales_invoice'
        """,
        (tenant_id,),
    )
    df["date"] = pd.to_datetime(df["date"])
    return df
