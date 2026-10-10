// ~600 tokens ≈ 2,400 chars. Overlap ≈ 12%.
export function chunkText(text: string, maxChars = 2400, overlap = 300): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";

  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
  };

  for (const p of paras) {
    // A single paragraph longer than the limit is hard-split.
    const pieces = p.length > maxChars ? p.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g"))! : [p];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > maxChars) {
        push();
        cur = cur.slice(-overlap).replace(/^\S*\s/, ""); // carry a tail, starting at a word boundary
      }
      cur += (cur ? "\n\n" : "") + piece;
    }
  }
  push();
  return chunks;
}
