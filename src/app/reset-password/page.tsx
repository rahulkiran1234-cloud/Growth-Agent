import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetForm } from "@/components/auth-extra";

// The link carries a secret token: never send it onward in a Referer header.
export const metadata: Metadata = { title: "Reset password · Growth Agent", referrer: "no-referrer" };

async function Resolved({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetForm token={typeof token === "string" && token ? token : null} />;
}

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-neutral-500">Loading…</p>}>
      <Resolved searchParams={searchParams} />
    </Suspense>
  );
}
