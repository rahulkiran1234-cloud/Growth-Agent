import { Suspense } from "react";
import AnalysisView from "./view";

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisView id={id} />;
}

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-8 text-neutral-500">Loading…</p>}>
      <Resolved params={params} />
    </Suspense>
  );
}
