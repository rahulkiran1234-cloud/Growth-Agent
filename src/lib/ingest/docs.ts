import { extractText, getDocumentProxy } from "unpdf";
import { readTable } from "./table";
import { chunkText } from "./chunk";

export type ParsedChunk = { content: string; page: number | null };
export type ParsedDoc = { docType: "pdf" | "csv" | "text"; chunks: ParsedChunk[]; docDate: string | null };

const DATE_RE = /(?:date|as of|updated|published)[:\s]+(\d{4}-\d{2}-\d{2})/i;

function chunkPages(pages: { page: number | null; text: string }[]): ParsedChunk[] {
  return pages.flatMap(({ page, text }) => chunkText(text).map((content) => ({ content, page })));
}

export async function parseDocument(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t.trim() })).filter((p) => p.text);
    const total = pages.reduce((s, p) => s + p.text.length, 0);
    if (total < 50) throw new Error("No readable text in this PDF (it may be scanned). OCR isn't supported in the MVP.");
    return { docType: "pdf", chunks: chunkPages(pages), docDate: DATE_RE.exec(pages[0].text.slice(0, 2000))?.[1] ?? null };
  }

  if (ext === "csv" || ext === "xlsx") {
    const { headers, rows } = await readTable(buf, filename);
    // Group rows so a chunk holds several comparable rows (e.g. a price list) with their headers.
    const lines = rows.map((r) => headers.map((h, i) => `${h}: ${r[i] ?? ""}`).join("; "));
    const pages: { page: number | null; text: string }[] = [];
    for (let i = 0; i < lines.length; i += 8) pages.push({ page: null, text: lines.slice(i, i + 8).join("\n") });
    return { docType: "csv", chunks: chunkPages(pages), docDate: null };
  }

  if (ext === "txt" || ext === "md") {
    const text = buf.toString("utf8");
    if (text.trim().length < 50) throw new Error("The text file is too short to be useful.");
    const parts = text.split(/^PAGE\s+(\d+)\b.*$/gim); // [pre, "1", body1, "2", body2 ...]
    const pages: { page: number | null; text: string }[] = [];
    if (parts.length > 1) {
      if (parts[0].trim()) pages.push({ page: null, text: parts[0] });
      for (let i = 1; i < parts.length; i += 2) pages.push({ page: +parts[i], text: parts[i + 1] ?? "" });
    } else pages.push({ page: null, text });
    return { docType: "text", chunks: chunkPages(pages.filter((p) => p.text.trim())), docDate: DATE_RE.exec(text.slice(0, 2000))?.[1] ?? null };
  }

  throw new Error("Unsupported file type. Use PDF, CSV, XLSX, TXT or MD.");
}
