import { Suspense } from "react";
import ProjectView from "./view";

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView id={id} />;
}

export default function DataPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <Resolved params={params} />
    </Suspense>
  );
}
