import { toCsv } from "@/server/demo/csv";
import type { DemoDataset } from "@/server/demo/engine";
import type { UploadedFile } from "@/server/ingest/parse";
import {
  BATCH_COLUMNS,
  CHANNEL_CHARGE_COLUMNS,
  CONTROL_TOTAL_COLUMNS,
  CUSTOMER_ORDER_COLUMNS,
  ITEM_COLUMNS,
  OUTSTANDING_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS
} from "@/server/ingest/template";

/** The demo dataset as the template file bundle a user would upload. */
export function datasetToFiles(data: DemoDataset): UploadedFile[] {
  const file = (name: string, text: string): UploadedFile => ({ name, content: Buffer.from(text) });
  return [
    file(TEMPLATE_FILES.items, toCsv(ITEM_COLUMNS, data.items)),
    file(TEMPLATE_FILES.parties, toCsv(PARTY_COLUMNS, data.parties)),
    file(TEMPLATE_FILES.vouchers, toCsv(VOUCHER_COLUMNS, data.vouchers)),
    file(TEMPLATE_FILES.settlements, toCsv(SETTLEMENT_COLUMNS, data.settlements)),
    file(TEMPLATE_FILES.stockSummary, toCsv(STOCK_SUMMARY_COLUMNS, data.stockSummary)),
    file(TEMPLATE_FILES.outstanding, toCsv(OUTSTANDING_COLUMNS, data.outstanding)),
    file(TEMPLATE_FILES.channelCharges, toCsv(CHANNEL_CHARGE_COLUMNS, data.channelCharges)),
    ...(data.customerOrders.length > 0 ? [file(TEMPLATE_FILES.customerOrders, toCsv(CUSTOMER_ORDER_COLUMNS, data.customerOrders))] : []),
    ...(data.batches.length > 0 ? [file(TEMPLATE_FILES.batches, toCsv(BATCH_COLUMNS, data.batches))] : []),
    file(TEMPLATE_FILES.controlTotals, toCsv(CONTROL_TOTAL_COLUMNS, data.controlTotals))
  ];
}
