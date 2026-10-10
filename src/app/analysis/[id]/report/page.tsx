import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ownsAnalysis } from "@/lib/auth/access";
import { verifyPdfToken } from "@/lib/auth/pdf-token";
import ReportView from "./report-view";

type Params = Promise<{ id: string }>;
type Search = Promise<{ pdf?: string }>;

async function Resolved({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const { pdf } = await searchParams;
  // The signed-in owner, or the PDF export's short-lived link for this one report. Anyone else sees "not found".
  if (!verifyPdfToken(id, pdf) && !(await ownsAnalysis(id))) notFound();
  return <ReportView id={id} />;
}

export default function ReportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<p className="p-8 text-neutral-500">Preparing your report…</p>}>
      <Resolved params={params} searchParams={searchParams} />
    </Suspense>
  );
}
