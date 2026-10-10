import type { ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  good: "bg-[#dcf5dc] text-good",
  warn: "bg-[#fdf0cf] text-warnink",
  bad: "bg-[#fbe0e0] text-crit",
  info: "bg-[#dbe9fa] text-brand-deep",
  neutral: "bg-[#ecebe6] text-ink2",
} as const;
export type Tone = keyof typeof TONES;
const ICON: Record<Tone, string> = { good: "✓", warn: "!", bad: "▲", info: "i", neutral: "•" };

/** Status chip: colour never carries meaning alone, so it always has an icon and a label. */
export function Pill({ tone = "neutral", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      {icon && <span aria-hidden="true" className="text-[9px]">{ICON[tone]}</span>}
      {children}
    </span>
  );
}

export function Delta({ value, goodWhen, suffix = "", digits = 1 }: { value: number | null; goodWhen: "up" | "down"; suffix?: string; digits?: number }) {
  if (value == null || Math.abs(value) < 0.05) return <span className="text-xs text-muted">no change</span>;
  const good = (value > 0) === (goodWhen === "up");
  return (
    <span className={`text-xs font-semibold ${good ? "text-good" : "text-crit"}`}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(digits)}{suffix}
    </span>
  );
}

export function Headline({ label = "Headline finding", title, sub, right }: { label?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#c9dcf5] bg-gradient-to-r from-[#eaf2fc] to-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-brand-deep">{label}</p>
        <p className="mt-0.5 text-lg font-bold leading-snug text-ink">{title}</p>
        {sub && <p className="mt-1 text-sm text-ink2">{sub}</p>}
      </div>
      {right && <div className="flex flex-col items-end gap-1">{right}</div>}
    </div>
  );
}

export function Button({ children, onClick, href, variant = "primary", disabled, type = "button", className = "" }: {
  children: ReactNode; onClick?: () => void; href?: string; variant?: "primary" | "ghost"; disabled?: boolean; type?: "button" | "submit"; className?: string;
}) {
  const cls = `inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
    variant === "primary" ? "bg-brand text-white hover:bg-brand-deep" : "border border-line bg-surface text-ink hover:bg-[#f0efec]"
  } ${className}`;
  if (href) return <a href={href} className={cls}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls}>{children}</button>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-axis bg-surface p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink2">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Note({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone === "warn" ? "border-[#f5dd9a] bg-[#fff8e4] text-warnink" : "border-[#c9dcf5] bg-[#eef5fd] text-brand-deep"}`}>
      {children}
    </p>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {sub && <p className="text-sm text-ink2">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
