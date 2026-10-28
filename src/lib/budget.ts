// 금액 계산·표시 — 서버와 브라우저 공용 (원본 HTML 의 money/rowTotal/monthsFor/calculate 이식)
import type { BudgetAccount, Channel, DepartmentDoc, FeeRow, SalesRow } from "./types";

export const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
export const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const zeros = () => Array<number>(12).fill(0);
export const sum = (values: (number | null | undefined)[]) => values.reduce<number>((a, b) => a + (b || 0), 0);
export const rowTotal = (row: { values: number[] }) => sum(row.values);

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : Number(n || 0).toLocaleString("ko-KR", { maximumFractionDigits: 0 });

export const percent = (ratio: number | null) =>
  ratio === null || !Number.isFinite(ratio) ? "—" : `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;

export const accountMonths = (account: BudgetAccount) =>
  MONTHS.map((_, m) => account.rows.reduce((s, r) => s + (r.values[m] || 0), 0));

export const accountsMonths = (accounts: BudgetAccount[]) =>
  MONTHS.map((_, m) => accounts.reduce((t, a) => t + a.rows.reduce((s, r) => s + (r.values[m] || 0), 0), 0));

export const accountsTotal = (accounts: BudgetAccount[]) => sum(accountsMonths(accounts));

export const salesMonths = (rows: SalesRow[]) => MONTHS.map((_, m) => rows.reduce((s, r) => s + (r.values[m] || 0), 0));

export const personnelMonths = (rows: { values: number[] }[]) =>
  MONTHS.map((_, m) => rows.reduce((s, r) => s + (r.values[m] || 0), 0));

export const filledAccountCount = (accounts: BudgetAccount[]) =>
  accounts.filter((a) => a.rows.some((r) => r.values.some((v) => v !== 0))).length;

export function departmentStatus(doc: Pick<DepartmentDoc, "closed" | "savedAt">) {
  if (doc.closed) return "마감 완료";
  return doc.savedAt ? "저장 완료" : "미입력";
}

// 숫자 또는 "=" 로 시작하는 사칙연산 계산식 (eval 없이 직접 해석)
export function calculate(value: string): number {
  let s = String(value).replace(/,/g, "").replace(/\s/g, "");
  if (!s) return 0;
  if (s[0] !== "=") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error("금액을 확인해 주세요.");
    return Number(s);
  }
  s = s.slice(1);
  if (s.length > 500) throw new Error("계산식이 너무 깁니다.");
  let i = 0;
  const atom = (): number => {
    if (s[i] === "+") { i++; return atom(); }
    if (s[i] === "-") { i++; return -atom(); }
    if (s[i] === "(") {
      i++;
      const n = add();
      if (s[i++] !== ")") throw new Error("괄호를 확인해 주세요.");
      return n;
    }
    const m = s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!m) throw new Error("계산식을 완성해 주세요.");
    i += m[0].length;
    return Number(m[0]);
  };
  const mul = (): number => {
    let n = atom();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const r = atom();
      if (op === "/" && r === 0) throw new Error("0으로 나눌 수 없습니다.");
      n = op === "*" ? n * r : n / r;
    }
    return n;
  };
  const add = (): number => {
    let n = mul();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = mul();
      n = op === "+" ? n + r : n - r;
    }
    return n;
  };
  const n = add();
  if (i !== s.length) throw new Error("숫자와 + - * / 괄호만 사용할 수 있습니다.");
  if (!Number.isFinite(n) || Math.abs(n) >= 1e15) throw new Error("금액 범위를 확인해 주세요.");
  return n;
}

// ── 매출: 부서 목표매출 구분 → 통합 매출 예산안 채널 ──
// 원본 통합 대시보드 applySalesToRevenueReport 의 매핑 + 채널 라벨 그대로
const KIND_ALIASES: Record<string, string> = { 셀러퀼: "seller", 공동구매: "group" };

export const kindOf = (channel: Channel) => channel.label.replace(/^\(매출\)\s*/, "");

export function channelKeyForKind(kind: string, channels: Channel[]) {
  const k = kind.trim();
  return channels.find((c) => kindOf(c) === k)?.key ?? KIND_ALIASES[k] ?? null;
}

export function channelTotals(departments: Pick<DepartmentDoc, "name" | "salesForecastRows">[], channels: Channel[]) {
  const values: Record<string, number[]> = Object.fromEntries(channels.map((c) => [c.key, zeros()]));
  const sources: Record<string, { dept: string; kind: string; total: number }[]> = Object.fromEntries(channels.map((c) => [c.key, []]));
  const unmatched: { dept: string; kind: string; total: number }[] = [];
  for (const d of departments) {
    for (const row of d.salesForecastRows) {
      const key = channelKeyForKind(row.kind, channels);
      const total = rowTotal(row);
      if (!key) {
        if (total) unmatched.push({ dept: d.name, kind: row.kind, total });
        continue;
      }
      row.values.forEach((v, m) => (values[key][m] += v || 0));
      sources[key].push({ dept: d.name, kind: row.kind, total });
    }
  }
  return { values, sources, unmatched };
}

export function revenueMetrics(channelValues: Record<string, number[]>, fees: FeeRow[]) {
  const erp = MONTHS.map((_, m) => Object.values(channelValues).reduce((s, v) => s + (v[m] || 0), 0));
  const feeMonths = MONTHS.map((_, m) => fees.reduce((s, f) => s + (f.values[m] || 0), 0));
  const net = erp.map((v, m) => v - feeMonths[m]);
  return { erp, fees: feeMonths, net, erpTotal: sum(erp), feeTotal: sum(feeMonths), netTotal: sum(net) };
}

// ── CSV (엑셀에서 한글 깨지지 않게 BOM) ──
export function toCsv(rows: (string | number | null | undefined)[][]) {
  return "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
}
