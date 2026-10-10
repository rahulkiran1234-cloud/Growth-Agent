import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { findBrowser } from "@/lib/pdf";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { limited } from "@/lib/rate-limit";
import { guardAnalysis } from "@/lib/auth/access";
import { makePdfToken } from "@/lib/auth/pdf-token";

const run = promisify(execFile);

// Renders the report page with a headless Edge/Chrome and returns the PDF.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "pdf", 6); // each request starts a headless browser
  if (blocked) return blocked;

  const browser = findBrowser();
  if (!browser) {
    return Response.json({ error: "No Edge or Chrome found for PDF export. Use the Print button and choose 'Save as PDF', or set PDF_BROWSER_PATH." }, { status: 501 });
  }

  // Always render our own page on localhost (never a host taken from the request).
  const port = new URL(req.url).port || "3000";
  const url = `http://localhost:${port}/analysis/${id}/report?pdf=${makePdfToken(id)}`;
  const dir = await mkdtemp(path.join(tmpdir(), "report-"));
  const out = path.join(dir, "report.pdf");
  try {
    await run(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=10000", `--user-data-dir=${path.join(dir, "profile")}`, `--print-to-pdf=${out}`, url], { timeout: 60_000 }).catch(() => undefined);
    // The browser can exit just before the file is flushed: wait briefly for it.
    for (let i = 0; i < 30 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 500));
    if (!existsSync(out)) return Response.json({ error: "The PDF could not be generated. Try the Print button instead." }, { status: 500 });
    const pdf = await readFile(out);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="growth-report-${id.slice(0, 8)}.pdf"` },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
