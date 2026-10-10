"use client";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useWorkspace } from "@/components/workspace/workspace";

export const C = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", s5: "#e87ba4", grid: "#e1e0d9", axis: "#c3c2b7", muted: "#898781", ink: "#0b0b0b", ink2: "#52514e", good: "#0ca30c", crit: "#d03b3b", serious: "#ec835a", warn: "#fab219" };

/** Card with a title, an "Ask about this" button and a "View data" table: tooltips enhance, the table keeps every value reachable. */
export function ChartCard({ title, sub, focus, table, children, className = "", height }: {
  title: string; sub?: ReactNode; focus?: string; table?: { cols: string[]; rows: (string | number)[][] }; children: ReactNode; className?: string; height?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  const { chat } = useWorkspace();
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${className}`} aria-label={title}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        <div className="no-print flex gap-1.5">
          {table && <button type="button" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink2 hover:bg-[#f0efec]">{showTable ? "Chart" : "View data"}</button>}
          {focus && <button type="button" onClick={() => chat.ask(`Explain this chart: ${focus}. What stands out and what should I do about it?`, focus)} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-brand-deep hover:bg-[#eaf2fc]">Ask about this</button>}
        </div>
      </div>
      {showTable && table ? (
        <div className="overflow-auto" style={{ maxHeight: height ?? 260 }}>
          <table className="w-full text-left text-xs tnum">
            <thead><tr className="border-b border-line text-muted">{table.cols.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-line/60">{r.map((v, j) => <td key={j} className="py-1 pr-3">{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

type TipRow = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };
/** Values lead, labels follow; rows are keyed with a short stroke of the series colour. */
function Tip({ active, payload, label, fmt }: { active?: boolean; payload?: TipRow[]; label?: string; fmt: (key: string, v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-ink2">{label}</p>
      {payload.filter((p) => p.value != null).map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 tnum">
          <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: p.color }} />
          <b className="text-ink">{fmt(String(p.dataKey), Number(p.value))}</b>
          <span className="text-muted">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

export type Series = { key: string; name: string; color: string };
const axisProps = { tickLine: false, axisLine: { stroke: C.axis } } as const;

export function LineTrend({ data, series, height = 220, yFmt = (v: number) => String(v), valueFmt, domain, events }: {
  data: Record<string, string | number | null>[]; series: Series[]; height?: number; yFmt?: (v: number) => string; valueFmt?: (key: string, v: number) => string; domain?: [number | "auto" | ((v: number) => number), number | "auto" | ((v: number) => number)]; events?: { x: string; label: string }[];
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.name).join(", ")} by month`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis tickFormatter={yFmt} width={48} tickLine={false} axisLine={false} domain={domain ?? ["auto", "auto"]} />
          <Tooltip cursor={{ stroke: C.ink2, strokeDasharray: "3 3" }} content={<Tip fmt={valueFmt ?? ((_, v) => yFmt(v))} />} />
          {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />}
          {events?.map((e) => <ReferenceLine key={e.x} x={e.x} stroke={C.ink2} strokeDasharray="4 3" label={{ value: e.label, position: "insideTopRight", fontSize: 10, fill: C.ink2 }} />)}
          {series.map((s) => <Line isAnimationActive={false} key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3, fill: "#fcfcfb", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsTrend({ data, dataKey, name, color = C.s1, height = 200, yFmt = (v: number) => String(v), valueFmt, highlight = [], syncId }: {
  data: Record<string, string | number | null>[]; dataKey: string; name: string; color?: string; height?: number; yFmt?: (v: number) => string; valueFmt?: (v: number) => string; highlight?: number[]; syncId?: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${name} by month`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }} syncId={syncId}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis tickFormatter={yFmt} width={48} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.05)" }} content={<Tip fmt={(_, v) => (valueFmt ?? yFmt)(v)} />} />
          <Bar isAnimationActive={false} dataKey={dataKey} name={name} radius={[4, 4, 0, 0]} maxBarSize={44}>
            {data.map((_, i) => <Cell key={i} fill={highlight.includes(i) ? C.serious : color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Price and units on one shared time axis as two aligned panels (never a dual-axis chart). */
export function PriceUnits({ data, eventMonth, height = 120 }: { data: { label: string; month: string; price: number | null; units: number }[]; eventMonth?: string | null; height?: number }) {
  const idx = eventMonth ? data.findIndex((d) => d.month === eventMonth) : -1;
  const ev = idx >= 0 ? data[idx].label : null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-ink2">Average price</p>
      <div style={{ height }} role="img" aria-label="Average price by month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="pu" margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} hide />
            <YAxis tickFormatter={(v: number) => Math.round(v).toLocaleString("en-US")} width={52} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip cursor={{ stroke: C.ink2, strokeDasharray: "3 3" }} content={<Tip fmt={(_, v) => Math.round(v).toLocaleString("en-US")} />} />
            {ev && <ReferenceLine x={ev} stroke={C.ink2} strokeDasharray="4 3" label={{ value: "Price change", position: "insideTopRight", fontSize: 10, fill: C.ink2 }} />}
            <Line isAnimationActive={false} type="linear" dataKey="price" name="Avg price" stroke={C.s2} strokeWidth={2} dot={{ r: 3, fill: "#fcfcfb", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] font-semibold text-ink2">Units sold</p>
      <div style={{ height }} role="img" aria-label="Units sold by month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} syncId="pu" margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis width={52} tickLine={false} axisLine={false} tickFormatter={(v: number) => Math.round(v).toLocaleString("en-US")} />
            <Tooltip cursor={{ fill: "rgba(11,11,11,0.05)" }} content={<Tip fmt={(_, v) => Math.round(v).toLocaleString("en-US")} />} />
            {ev && <ReferenceLine x={ev} stroke={C.ink2} strokeDasharray="4 3" />}
            <Bar isAnimationActive={false} dataKey="units" name="Units" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={44}>
              {data.map((_, i) => <Cell key={i} fill={idx >= 0 && i >= idx ? C.s1 : "#86b6ef"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; payload?: { label: string; kind: "total" | "delta"; up: number; down: number }; dataKey?: string | number | ((o: unknown) => unknown) };
/** One bar of the waterfall, with its value printed above it. Zero-height segments draw nothing. */
function WfBar({ x = 0, y = 0, width = 0, height = 0, payload, dataKey }: BarShapeProps) {
  if (!payload || !(height > 0)) return null;
  const isUp = dataKey === "up";
  const fill = isUp ? (payload.kind === "total" ? "#14181f" : C.s3) : C.serious;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={fill} />
      <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.ink}>{payload.label}</text>
    </g>
  );
}

/** Reviews per month split into good (4-5 star) and bad (1-3 star), stacked so the total is the volume. */
export function StackedBars({ data, height = 200 }: { data: { label: string; positive: number; negative: number }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Good and bad reviews per month, stacked">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis width={40} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.05)" }} content={<Tip fmt={(_, v) => `${Math.round(v)} reviews`} />} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
          <Bar isAnimationActive={false} dataKey="positive" name="4–5★" stackId="r" fill={C.s1} maxBarSize={44} />
          <Bar isAnimationActive={false} dataKey="negative" name="1–3★" stackId="r" fill={C.s2} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Waterfall({ steps, height = 200, fmt }: { steps: { name: string; value: number; kind: "total" | "delta" }[]; height?: number; fmt: (v: number) => string }) {
  const ends: number[] = [];
  steps.forEach((s, i) => ends.push(s.kind === "total" ? s.value : (ends[i - 1] ?? 0) + s.value));
  const rows = steps.map((s, i) => {
    if (s.kind === "total") return { name: s.name, base: 0, up: s.value, down: 0, label: fmt(s.value), kind: "total" as const, raw: s.value };
    const start = ends[i - 1] ?? 0, end = ends[i];
    return { name: s.name, base: Math.min(start, end), up: s.value > 0 ? s.value : 0, down: s.value < 0 ? -s.value : 0, label: `${s.value > 0 ? "+" : "−"}${fmt(Math.abs(s.value))}`, kind: "delta" as const, raw: s.value };
  });
  const min = Math.min(...rows.map((r) => r.base)) * 0.8;
  return (
    <div style={{ height }} role="img" aria-label={`Revenue bridge: ${rows.map((r) => `${r.name} ${r.label}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="name" {...axisProps} />
          <YAxis hide domain={[Math.max(0, Math.floor(min)), "auto"]} />
          <Tooltip cursor={false} content={({ active, payload }) => active && payload?.length ? <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md"><b>{(payload[0].payload as { label: string }).label}</b> <span className="text-muted">{(payload[0].payload as { name: string }).name}</span></div> : null} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="up" stackId="w" isAnimationActive={false} shape={(p: BarShapeProps) => <WfBar {...p} />} />
          <Bar dataKey="down" stackId="w" isAnimationActive={false} shape={(p: BarShapeProps) => <WfBar {...p} />} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars. The value is always printed, so nothing depends on hover. */
export function HBars({ items, max, fmt = (v: number) => `${v}%`, onPick, active }: { items: { name: string; value: number; color?: string; hint?: string }[]; max?: number; fmt?: (v: number) => string; onPick?: (name: string) => void; active?: string | null }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((it) => {
        const row = (
          <>
            <span className="w-32 shrink-0 truncate text-xs text-ink2" title={it.name}>{it.name}</span>
            <span className="h-2.5 flex-1 rounded-full bg-[#ecebe6]"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (it.value / m) * 100)}%`, background: it.color ?? C.s1 }} /></span>
            <b className="w-12 shrink-0 text-right text-xs tnum">{fmt(it.value)}</b>
          </>
        );
        return (
          <li key={it.name} title={it.hint}>
            {onPick ? <button type="button" onClick={() => onPick(it.name)} aria-pressed={active === it.name} className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#f0efec] ${active === it.name ? "bg-[#eaf2fc]" : ""}`}>{row}</button> : <div className="flex items-center gap-2 px-1 py-0.5">{row}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function Sparkline({ values, color = C.s1, w = 84, h = 28 }: { values: (number | null)[]; color?: string; w?: number; h?: number }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = values.map((x, i) => (x == null ? null : [2 + (i * (w - 6)) / (values.length - 1), h - 3 - ((x - lo) / span) * (h - 6)] as const)).filter((p): p is readonly [number, number] => p != null);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} stroke="#fcfcfb" strokeWidth="1.5" />
    </svg>
  );
}

/** Returns vs complaints by product. Each point has a generous hit area via the tooltip. */
export function ProductScatter({ points, xLabel, yLabel }: { points: { sku: string; x: number; y: number; z: number }[]; xLabel: string; yLabel: string }) {
  return (
    <div style={{ height: 260 }} role="img" aria-label={`Scatter of ${yLabel} against ${xLabel} by product`}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 16, bottom: 22, left: 4 }}>
          <CartesianGrid stroke={C.grid} />
          <XAxis type="number" dataKey="x" name={xLabel} unit="%" {...axisProps} label={{ value: xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: C.muted }} />
          <YAxis type="number" dataKey="y" name={yLabel} unit="%" width={48} tickLine={false} axisLine={false} label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: C.muted }} />
          <ZAxis type="number" dataKey="z" range={[60, 360]} name="Revenue" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { sku: string; x: number; y: number; z: number };
            return <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md"><p className="font-semibold">{p.sku}</p><p className="tnum">{yLabel}: <b>{p.y}%</b></p><p className="tnum">{xLabel}: <b>{p.x}%</b></p></div>;
          }} />
          <Scatter isAnimationActive={false} data={points} fill={C.s1} fillOpacity={0.7} stroke="#fcfcfb" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
