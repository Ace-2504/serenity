"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { JobView } from "@/components/bi/jobs";

/** Shows a running background job and refreshes the page when it finishes. */
export function JobBanner({ jobId, initial }: { jobId: string; initial: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/bi/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (!alive || !response?.ok) return;
      const job = (await response.json()) as JobView;
      if (job.status === "done") {
        clearInterval(timer);
        router.refresh();
      } else if (job.status === "failed") {
        clearInterval(timer);
        setFailed(job.error ?? "The job failed.");
      } else setText(job.status === "queued" ? "Waiting to start" : (job.progress ?? "Working"));
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [jobId, router]);

  return (
    <div role="status" aria-live="polite" className={`mb-4 rounded-xl2 border px-4 py-3 text-sm ${failed ? "border-terracotta text-terracotta" : "border-forest bg-forest/5"}`}>
      {failed ? `Background job failed: ${failed}` : `Working in the background: ${text}…  This page updates when it finishes.`}
    </div>
  );
}
