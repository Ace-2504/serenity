import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Runs the Python ML worker (ml/serenity_ml) for one business. The child process gets only the
 * database URL and a minimal PATH, never the app's other secrets. Its last stdout line is a
 * JSON summary; data values are never printed.
 */

const ML_DIR = path.join(process.cwd(), "ml");
const TIMEOUT_MS = 10 * 60_000;

export class MlUnavailableError extends Error {}

export function mlPython(): string {
  const configured = process.env.ML_PYTHON;
  const candidate = configured || path.join(ML_DIR, ".venv", "bin", "python");
  if (!existsSync(candidate)) {
    throw new MlUnavailableError(`The ML worker is not installed (no Python at ${configured ? "ML_PYTHON" : "ml/.venv"}). See docs/platform/progress.md, M8.`);
  }
  return candidate;
}

export type MlSummary = Record<string, unknown> & { status: string };

export function runMlWorker(tenantId: string, asOf?: string): Promise<MlSummary> {
  const python = mlPython();
  const args = ["-m", "serenity_ml", "run", "--tenant", tenantId, ...(asOf ? ["--as-of", asOf] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: ML_DIR,
      env: { DATABASE_URL: process.env.DATABASE_URL ?? "", PATH: "/usr/local/bin:/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = out.trim().split("\n").pop() ?? "";
      let summary: MlSummary | null = null;
      try {
        summary = JSON.parse(last) as MlSummary;
      } catch {
        summary = null;
      }
      if (code === 0 && summary) resolve(summary);
      else reject(new Error(summary?.status === "error" ? `ML worker failed: ${String(summary.message)}` : `ML worker exited with code ${code}: ${err.split("\n").filter(Boolean).pop() ?? "no output"}`));
    });
  });
}
