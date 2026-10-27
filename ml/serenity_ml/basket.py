"""Items bought together: association rules over invoices (a deterministic statistic, not a model).

For each ordered pair (A, B) of items on the same invoice:
  support    = invoices with both / all multi-item invoices considered
  confidence = invoices with both / invoices with A
  lift       = confidence / share of invoices with B
Only pairs seen together on at least MIN_TOGETHER invoices are kept, to avoid chance pairs.
"""

from __future__ import annotations

from collections import Counter
from itertools import combinations

import pandas as pd

MIN_TOGETHER = 5
TOP_PER_ITEM = 10


def pairs(lines: pd.DataFrame, since: pd.Timestamp | None = None) -> pd.DataFrame:
    df = lines if since is None else lines[lines["date"] >= since]
    baskets = df.groupby("voucher_id")["item_id"].apply(lambda s: sorted(set(s)))
    n = len(baskets)
    if n == 0:
        return pd.DataFrame(columns=["item_id", "partner_item_id", "together", "support", "confidence", "lift"])
    item_count: Counter[str] = Counter()
    pair_count: Counter[tuple[str, str]] = Counter()
    for items in baskets:
        item_count.update(items)
        if len(items) > 1:
            pair_count.update(combinations(items, 2))
    rows = []
    for (a, b), together in pair_count.items():
        if together < MIN_TOGETHER:
            continue
        for x, y in ((a, b), (b, a)):
            confidence = together / item_count[x]
            rows.append({"item_id": x, "partner_item_id": y, "together": together, "support": together / n, "confidence": confidence, "lift": confidence / (item_count[y] / n)})
    out = pd.DataFrame(rows)
    if out.empty:
        return pd.DataFrame(columns=["item_id", "partner_item_id", "together", "support", "confidence", "lift"])
    out = out.sort_values(["item_id", "lift", "together"], ascending=[True, False, False])
    return out.groupby("item_id").head(TOP_PER_ITEM).reset_index(drop=True)
