/**
 * Writes a synthetic demo dataset in the import-template format.
 *   npm run demo:generate -- --seed 42 --out demo-data/stationery
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toCsv } from "@/server/demo/csv";
import { generateDemoDataset } from "@/server/demo/engine";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import {
  CHANNEL_CHARGE_COLUMNS,
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  OUTSTANDING_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS
} from "@/server/ingest/template";

const PROFILES = { stationery: stationeryDemoProfile };

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const profileId = arg("profile", "stationery") as keyof typeof PROFILES;
const profile = PROFILES[profileId];
if (!profile) {
  throw new Error(`Unknown profile "${profileId}". Available: ${Object.keys(PROFILES).join(", ")}`);
}
const seed = Number(arg("seed", "42"));
if (!Number.isInteger(seed)) {
  throw new Error("--seed must be an integer");
}
const outDir = path.resolve(arg("out", path.join("demo-data", profileId)));

const data = generateDemoDataset(profile, seed);
mkdirSync(outDir, { recursive: true });
const write = (file: string, content: string) => writeFileSync(path.join(outDir, file), content);

write(TEMPLATE_FILES.items, toCsv(ITEM_COLUMNS, data.items));
write(TEMPLATE_FILES.parties, toCsv(PARTY_COLUMNS, data.parties));
write(TEMPLATE_FILES.vouchers, toCsv(VOUCHER_COLUMNS, data.vouchers));
write(TEMPLATE_FILES.settlements, toCsv(SETTLEMENT_COLUMNS, data.settlements));
write(TEMPLATE_FILES.stockSummary, toCsv(STOCK_SUMMARY_COLUMNS, data.stockSummary));
write(TEMPLATE_FILES.outstanding, toCsv(OUTSTANDING_COLUMNS, data.outstanding));
write(TEMPLATE_FILES.channelCharges, toCsv(CHANNEL_CHARGE_COLUMNS, data.channelCharges));
write(TEMPLATE_FILES.controlTotals, toCsv(CONTROL_TOTAL_COLUMNS, data.controlTotals));
write("ground_truth.json", `${JSON.stringify({ meta: data.meta, ...data.groundTruth }, null, 2)}\n`);
write(
  "README.txt",
  [
    data.meta.notice,
    "",
    `Company: ${data.meta.company}`,
    `Period: ${data.meta.periodFrom} to ${data.meta.periodTo}`,
    `Generator ${data.meta.generatorVersion}, profile "${profileId}", seed ${seed}. Re-running with the same seed reproduces these files exactly.`,
    "",
    "ground_truth.json lists the problems deliberately planted in this data and totals the analytics must reproduce."
  ].join("\n") + "\n"
);

console.log(`Wrote ${data.vouchers.length} voucher rows for ${data.meta.company} (seed ${seed}) to ${outDir}`);
