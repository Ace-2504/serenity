import { describe, expect, it } from "vitest";
import { IssueLog } from "@/server/ingest/issues";
import { parseBundle } from "@/server/ingest/parse";
import { CHANNEL_CHARGE_COLUMNS, CONTROL_TOTAL_COLUMNS, CUSTOMER_ORDER_COLUMNS, ITEM_COLUMNS, OUTSTANDING_COLUMNS, PARTY_COLUMNS, SETTLEMENT_COLUMNS, STOCK_SUMMARY_COLUMNS, TEMPLATE_FILES, VOUCHER_COLUMNS } from "@/server/ingest/template";
import { TEMPLATE_DOCS, TEMPLATE_EXAMPLES } from "@/server/ingest/template-docs";
import { emptyKnown, validateBundle } from "@/server/ingest/validate";

const COLUMNS: Record<string, readonly string[]> = {
  [TEMPLATE_FILES.items]: ITEM_COLUMNS,
  [TEMPLATE_FILES.parties]: PARTY_COLUMNS,
  [TEMPLATE_FILES.vouchers]: VOUCHER_COLUMNS,
  [TEMPLATE_FILES.settlements]: SETTLEMENT_COLUMNS,
  [TEMPLATE_FILES.stockSummary]: STOCK_SUMMARY_COLUMNS,
  [TEMPLATE_FILES.outstanding]: OUTSTANDING_COLUMNS,
  [TEMPLATE_FILES.channelCharges]: CHANNEL_CHARGE_COLUMNS,
  [TEMPLATE_FILES.customerOrders]: CUSTOMER_ORDER_COLUMNS,
  [TEMPLATE_FILES.controlTotals]: CONTROL_TOTAL_COLUMNS
};

describe("template documentation", () => {
  it("documents every column of every template file, in order", () => {
    expect(TEMPLATE_DOCS.map((d) => d.file).sort()).toEqual(Object.values(TEMPLATE_FILES).sort());
    for (const doc of TEMPLATE_DOCS) {
      expect(doc.columns.map((c) => c.column), doc.file).toEqual([...COLUMNS[doc.file]]);
    }
  });

  it("ships example files that import cleanly", () => {
    const log = new IssueLog();
    const files = Object.entries(TEMPLATE_EXAMPLES).map(([name, text]) => ({ name, content: Buffer.from(text) }));
    const bundle = parseBundle(files, log);
    const reconciliation = validateBundle(bundle, emptyKnown(), log);
    expect(log.issues).toEqual([]);
    expect(reconciliation.every((r) => r.ok)).toBe(true);
  });
});
