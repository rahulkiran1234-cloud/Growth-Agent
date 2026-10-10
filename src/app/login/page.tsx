import { Suspense } from "react";
import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in · Growth Agent" };

async function Resolved({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return <AuthForm mode="login" notice={reset === "1" ? "Password updated. Sign in with your new password." : undefined} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  return (
    <Suspense fallback={<AuthForm mode="login" />}>
      <Resolved searchParams={searchParams} />
    </Suspense>
  );
}
