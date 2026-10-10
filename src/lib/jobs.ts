import { signJob, type Job } from "./jobs-sign";
import { onNetlify } from "./ingest/store";

export type { Job };

/** Base address of this site, for calling our own background function. Netlify sets URL; APP_URL is the fallback. */
export function siteUrl(): string | null {
  const u = process.env.URL || process.env.APP_URL || "";
  return /^https?:\/\//.test(u) ? u.replace(/\/+$/, "") : null;
}

/** Runs a job in this process (a laptop or any always-on server). The caller does not wait for it unless it asks to. */
async function runHere(job: Job, wait: boolean) {
  if (job.kind === "analysis") {
    const { startAnalysis } = await import("./agent/run");
    startAnalysis(job.analysisId, job.projectId);
  } else if (job.kind === "tag") {
    const { startTaggingJob } = await import("./ingest/process");
    startTaggingJob(job.projectId, job.uploadId);
  } else {
    const { processDocUpload } = await import("./ingest/process");
    const p = processDocUpload(job.uploadId, job.competitor, job.docDate);
    if (wait) await p; else void p;
  }
}

/**
 * Starts a long job. On Netlify it is handed to the background function (up to 15 minutes, answers 202 at once);
 * everywhere else it runs in this process. Returns "queued" when the work finishes later, "inline" when it ran here.
 */
export async function dispatch(job: Job, opts: { waitIfLocal?: boolean } = {}): Promise<"queued" | "inline"> {
  if (!onNetlify()) {
    await runHere(job, !!opts.waitIfLocal);
    return opts.waitIfLocal ? "inline" : "queued";
  }
  const base = siteUrl();
  if (!base) throw new Error("The site address is not known (set APP_URL), so the background job could not be started.");
  const { body, header } = signJob(job);
  const res = await fetch(`${base}/.netlify/functions/job-background`, { method: "POST", headers: { "content-type": "application/json", "x-job-signature": header }, body });
  if (res.status !== 202 && !res.ok) throw new Error(`The background job could not be started (HTTP ${res.status}).`);
  return "queued";
}
