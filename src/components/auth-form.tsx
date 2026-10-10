"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME, APP_TAGLINE, LogoMark } from "@/components/brand";
import { safeNext } from "@/lib/auth/next";

export default function AuthForm({ mode, notice }: { mode: "login" | "signup"; notice?: string }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
      router.refresh();
    } catch {
      setErr("We couldn't reach the server. Check that it is running and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3"><LogoMark size={36} /><div><p className="text-lg font-bold leading-tight">{APP_NAME}</p><p className="text-xs text-ink2">{APP_TAGLINE}</p></div></div>
        <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-5 shadow-sm" aria-labelledby="auth-title">
          <h1 id="auth-title" className="text-xl font-bold">{signup ? "Create your account" : "Sign in"}</h1>
          <p className="mt-0.5 text-sm text-ink2">{signup ? "An email and a password is all you need. Your projects stay private to your account." : "Welcome back. Your projects are waiting."}</p>

          {notice && <p role="status" className="mt-3 rounded-lg border border-[#b7e0b7] bg-[#e8f7e8] px-3 py-2 text-sm text-good">{notice}</p>}

          <label className="mt-4 block text-sm font-semibold" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2" />

          <label className="mt-3 block text-sm font-semibold" htmlFor="password">Password</label>
          <div className="relative mt-1">
            <input id="password" type={show ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 pr-16" />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs font-semibold text-brand-deep hover:bg-[#eaf2fc]" aria-pressed={show}>{show ? "Hide" : "Show"}</button>
          </div>
          {signup && <p className="mt-1 text-xs text-muted">At least 8 characters.</p>}
          {!signup && <p className="mt-1 text-right text-xs"><Link className="font-semibold text-brand-deep underline" href="/forgot-password">Forgot password?</Link></p>}

          {err && <p role="alert" className="mt-3 rounded-lg border border-[#f0b9b9] bg-[#fdeaea] px-3 py-2 text-sm text-crit">{err}</p>}

          <button type="submit" disabled={busy || !email || !password} className="mt-4 w-full rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-deep disabled:opacity-50">
            {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
          </button>
          <p className="mt-4 text-center text-sm text-ink2">
            {signup ? "Already have an account? " : "New here? "}
            <Link className="font-semibold text-brand-deep underline" href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link>
          </p>
        </form>
        {signup && <p className="mt-3 text-center text-xs text-muted">We don&apos;t check that your email address is real, so use one you can receive mail at if you want to be able to reset your password.</p>}
      </div>
    </main>
  );
}
