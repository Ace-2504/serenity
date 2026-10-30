"use client";

export type JobView = { id: string; status: "queued" | "running" | "done" | "failed"; progress: string | null; error: string | null; result: unknown };

/**
 * Posts to an endpoint; if it answers 202 with a jobId, polls the job until it finishes,
 * reporting progress. Returns the error message to show, or null on success.
 */
export async function postAndWait(url: string, body: unknown, onProgress: (text: string) => void): Promise<string | null> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return result.message ?? "Something went wrong.";
  if (response.status !== 202 || !result.jobId) return null;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const poll = await fetch(`/api/bi/jobs/${result.jobId}`, { cache: "no-store" });
    if (!poll.ok) return "Lost track of the background job; refresh the page to see its status.";
    const job = (await poll.json()) as JobView;
    if (job.status === "done") return null;
    if (job.status === "failed") return job.error ?? "The job failed.";
    onProgress(job.status === "queued" ? "Waiting to start…" : `${job.progress ?? "Working"}…`);
  }
}
