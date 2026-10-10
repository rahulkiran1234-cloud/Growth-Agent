"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { APP_NAME, APP_TAGLINE, LogoMark } from "@/components/brand";

function Layout({ title, sub, children, footer }: { title: string; sub: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3"><LogoMark size={36} /><div><p className="text-lg font-bold leading-tight">{APP_NAME}</p><p className="text-xs text-ink2">{APP_TAGLINE}</p></div></div>
        <section className="rounded-xl border border-line bg-surface p-5 shadow-sm" aria-labelledby="auth-title">
          <h1 id="auth-title" className="text-xl font-bold">{title}</h1>
          <p className="mt-0.5 text-sm text-ink2">{sub}</p>
          {children}
        </section>
        {footer && <p className="mt-4 text-center text-sm text-ink2">{footer}</p>}
      </div>
    </main>
  );
}

const input = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2";
const primary = "mt-4 w-full rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-deep disabled:opacity-50";
const Err = ({ children }: { children: ReactNode }) => <p role="alert" className="mt-3 rounded-lg border border-[#f0b9b9] bg-[#fdeaea] px-3 py-2 text-sm text-crit">{children}</p>;
const Ok = ({ children }: { children: ReactNode }) => <p role="status" className="mt-3 rounded-lg border border-[#b7e0b7] bg-[#e8f7e8] px-3 py-2 text-sm text-good">{children}</p>;

async function post(url: string, body: unknown): Promise<{ ok: boolean; j: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, j: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, j: { error: "We couldn't reach the server. Check that it is running and try again." } };
  }
}

/** Password field with a show/hide toggle. */
function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label className="mt-3 block text-sm font-semibold" htmlFor={id}>{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} required value={value} onChange={(e) => onChange(e.target.value)} className={`${input} pr-16`} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs font-semibold text-brand-deep hover:bg-[#eaf2fc]">{show ? "Hide" : "Show"}</button>
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<null | { to: string; delivery: string }>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { ok, j } = await post("/api/auth/forgot", { email });
    setBusy(false);
    if (!ok) return setErr(String(j.error ?? "Something went wrong. Please try again."));
    setSent({ to: email.trim(), delivery: String(j.delivery ?? "email") });
  }

  return (
    <Layout title="Forgot your password?" sub="Enter your account email and we'll send you a link to choose a new one." footer={<Link className="font-semibold text-brand-deep underline" href="/login">Back to sign in</Link>}>
      {sent ? (
        <>
          <Ok>If an account exists for <b>{sent.to}</b>, a reset link is on its way. It works once and expires in 1 hour.</Ok>
          {sent.delivery === "console" && <p className="mt-3 rounded-lg border border-[#f5dd9a] bg-[#fff8e4] px-3 py-2 text-xs text-warnink">Email isn&apos;t set up on this server yet, so the link was printed in the server terminal (the window running <code>npm run dev</code>) instead of being emailed.</p>}
          <button type="button" onClick={() => setSent(null)} className="mt-4 text-sm font-semibold text-brand-deep underline">Use a different email</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="mt-4 block text-sm font-semibold" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          {err && <Err>{err}</Err>}
          <button type="submit" disabled={busy || !email} className={primary}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
    </Layout>
  );
}

export function ResetForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!token) {
    return (
      <Layout title="Reset link is missing" sub="Open the link from your email again, or request a new one." footer={<Link className="font-semibold text-brand-deep underline" href="/login">Back to sign in</Link>}>
        <Link href="/forgot-password" className={`${primary} block text-center`}>Request a new link</Link>
      </Layout>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setErr("The two passwords don't match.");
    setBusy(true); setErr("");
    const { ok, j } = await post("/api/auth/reset", { token, password });
    if (!ok) { setBusy(false); return setErr(String(j.error ?? "Could not reset the password.")); }
    router.replace("/login?reset=1");
  }

  return (
    <Layout title="Choose a new password" sub="Pick something at least 8 characters long. You'll be signed out on every device." footer={<Link className="font-semibold text-brand-deep underline" href="/login">Back to sign in</Link>}>
      <form onSubmit={submit}>
        <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
        <PasswordField id="again" label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
        {err && <Err>{err} {/expired|invalid|used/.test(err) && <Link className="font-semibold underline" href="/forgot-password">Request a new link</Link>}</Err>}
        <button type="submit" disabled={busy || !password || !again} className={primary}>{busy ? "Saving…" : "Set new password"}</button>
      </form>
    </Layout>
  );
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (password !== again) return setErr("The two new passwords don't match.");
    setBusy(true); setErr("");
    const { ok, j } = await post("/api/auth/change-password", { current, password });
    setBusy(false);
    if (!ok) return setErr(String(j.error ?? "Could not change the password."));
    setCurrent(""); setPassword(""); setAgain(""); setDone(true);
  }

  return (
    <Layout title="Change password" sub="Enter your current password, then a new one. Your other devices will be signed out." footer={<Link className="font-semibold text-brand-deep underline" href="/">Back to your projects</Link>}>
      <form onSubmit={submit}>
        <PasswordField id="current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
        <PasswordField id="again" label="Type the new password again" value={again} onChange={setAgain} autoComplete="new-password" />
        {err && <Err>{err}</Err>}
        {done && <Ok>Password changed. Other devices have been signed out.</Ok>}
        <button type="submit" disabled={busy || !current || !password || !again} className={primary}>{busy ? "Saving…" : "Change password"}</button>
      </form>
    </Layout>
  );
}
