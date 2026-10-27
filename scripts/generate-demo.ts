/**
 * Writes a synthetic demo dataset in the import-template format.
 *   npm run demo:generate -- --seed 42 --out demo-data/stationery
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateDemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";

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
const write = (file: string, content: string | Buffer) => writeFileSync(path.join(outDir, file), content);

for (const file of datasetToFiles(data)) {
  write(file.name, file.content);
}
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
