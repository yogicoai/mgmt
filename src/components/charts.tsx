"use client";

import { MONTHS, money } from "@/lib/budget";
import { useUi } from "./ui";

// 막대 차트 — 얇은 막대·데이터 끝 4px 라운드(기준선 쪽은 각지게)·옅은 눈금·마우스 올리면 금액
const W = 1200;
const H = 250;
const PAD = { left: 64, right: 12, top: 14, bottom: 32 };

function niceStep(max: number) {
  if (max <= 0) return 1;
  const raw = max / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

// 눈금 글자: 억·만 단위(영문 K/M 축약은 쓰지 않음)
function axisLabel(v: number) {
  const a = Math.abs(v);
  if (a >= 1e8) return `${+(v / 1e8).toFixed(a % 1e8 ? 1 : 0)}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만`;
  return String(v);
}

function scale(values: number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(Math.max(max, -min));
  const top = Math.ceil(max / step) * step || step;
  const bottom = min < 0 ? Math.floor(min / step) * step : 0;
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * (H - PAD.top - PAD.bottom);
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(t);
  return { y, ticks };
}

function barPath(x: number, w: number, y0: number, y1: number) {
  const h = Math.abs(y0 - y1);
  if (h < 0.5) return "";
  const r = Math.min(4, w / 2, h);
  const dir = y1 < y0 ? 1 : -1; // 위로(양수) / 아래로(음수)
  return `M${x},${y0} V${y1 + dir * r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + dir * r} V${y0} Z`;
}

function Axes({ ticks, y }: { ticks: number[]; y: (v: number) => number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#cbd5e1" : "#edf2f7"} />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {axisLabel(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

export function BarChart({ values, label, labels = MONTHS }: { values: number[]; label: string; labels?: string[] }) {
  const { showTip, hideTip } = useUi();
  const { y, ticks } = scale(values);
  if (values.every((v) => !v)) return <div className="empty">아직 입력된 금액이 없습니다.</div>;
  const slot = (W - PAD.left - PAD.right) / values.length;
  const bw = Math.min(40, slot * 0.46);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <Axes ticks={ticks} y={y} />
        {values.map((v, i) => {
          const x = PAD.left + slot * i + (slot - bw) / 2;
          return (
            <g key={i}>
              <path d={barPath(x, bw, y(0), y(v))} fill="var(--series-1)" />
              <text x={PAD.left + slot * i + slot / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="#64748b">
                {labels[i]}
              </text>
              <rect
                className="hit"
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={H - PAD.top - PAD.bottom}
                onMouseEnter={(e) => showTip(e.currentTarget, `${labels[i]}  ${money(v)}원`, true)}
                onMouseLeave={hideTip}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface Series {
  label: string;
  color: string;
  values: (number | null)[];
}

// 두 계열 묶음 막대(목표 vs 실적) — 계열 사이 2px 간격, 범례는 위에
export function GroupedBarChart({ series, label, labels = MONTHS, extra }: { series: Series[]; label: string; labels?: string[]; extra?: (i: number) => string }) {
  const { showTip, hideTip } = useUi();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const { y, ticks } = scale(all.length ? all : [0]);
  const slot = (W - PAD.left - PAD.right) / labels.length;
  const bw = Math.min(26, (slot * 0.62 - 2 * (series.length - 1)) / series.length);
  const groupW = bw * series.length + 2 * (series.length - 1);
  return (
    <div className="chart">
      <div className="chart-legend" style={{ marginBottom: 6 }}>
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="muted">단위: 원</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <Axes ticks={ticks} y={y} />
        {labels.map((name, i) => {
          const x0 = PAD.left + slot * i + (slot - groupW) / 2;
          const tip = [name, ...series.map((s) => `${s.label}: ${s.values[i] === null ? "실적 없음" : `${money(s.values[i])}원`}`), extra?.(i) ?? ""].filter(Boolean).join("\n");
          return (
            <g key={name}>
              {series.map((s, k) => {
                const v = s.values[i];
                return v === null ? null : <path key={s.label} d={barPath(x0 + k * (bw + 2), bw, y(0), y(v))} fill={s.color} />;
              })}
              <text x={PAD.left + slot * i + slot / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="#64748b">
                {name}
              </text>
              <rect className="hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} onMouseEnter={(e) => showTip(e.currentTarget, tip, true)} onMouseLeave={hideTip} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RankBars({ rows }: { rows: { key: string; name: string; total: number; onClick?: () => void }[] }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div>
      {rows.map((r) => (
        <div className="rank-row" key={r.key}>
          {r.onClick ? (
            <button type="button" className="account-button" onClick={r.onClick}>
              {r.name}
            </button>
          ) : (
            <span>{r.name}</span>
          )}
          <div className="track" title={`${r.name} ${money(r.total)}원`}>
            <div className="fill" style={{ width: `${Math.max(0, (r.total / max) * 100)}%` }} />
          </div>
          <strong>{money(r.total)}</strong>
        </div>
      ))}
    </div>
  );
}
