import { Suspense, type ReactNode } from "react";
import { Shell } from "@/components/workspace/shell";
import { WorkspaceProvider } from "@/components/workspace/workspace";

async function Resolved({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  return (
    <WorkspaceProvider id={id}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}

export default function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-neutral-500">Loading your workspace…</p>}>
      <Resolved params={params}>{children}</Resolved>
    </Suspense>
  );
}
