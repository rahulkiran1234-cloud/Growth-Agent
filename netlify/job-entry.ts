// Netlify background function (bundled by scripts/build-functions.mjs into netlify/functions/job-background.mjs).
// Background functions answer 202 straight away and may keep running for up to 15 minutes, which is what the AI
// analysis (about 4 minutes), review tagging and document indexing need.
import { verifyJob } from "../src/lib/jobs-sign";
import { runJob } from "../src/lib/ingest/process";

const handler = async (req: Request): Promise<Response> => {
  const body = await req.text();
  const job = verifyJob(body, req.headers.get("x-job-signature"));
  if (!job) {
    console.error("job-background: rejected a request with a missing, wrong or expired signature");
    return new Response("Forbidden", { status: 403 });
  }
  try {
    await runJob(job);
  } catch (e) {
    console.error(`job-background: ${job.kind} job failed:`, (e as Error).message);
  }
  return new Response("ok");
};

export default handler;
