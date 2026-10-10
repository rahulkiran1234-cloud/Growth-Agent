"use client";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50">
      Print / save as PDF
    </button>
  );
}
