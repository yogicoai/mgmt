// 금액 계산·표시 — 서버와 브라우저 공용 (원본 HTML 의 money/rowTotal/monthsFor/calculate 이식)
import type { BudgetAccount, Channel, DepartmentDoc, FeeRow, RevenuePlan, SalesRow } from "./types";

export const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

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

// 경영지원 전용 계정 — 전 줄이 '경영지원 입력'(직원급여·퇴직급여·세금과공과금 등). 팀에는 금액을 보내지 않고, 경영지원도 비밀번호를 한 번 더 넣어야 보임
export const isSensitiveAccount = (account: BudgetAccount) => account.rows.length > 0 && account.rows.every((r) => r.locked);

// 목표매출 화면에서만 다른 이름으로 보이는 부서 — 부서코드는 그대로라 데이터 연결은 바뀌지 않는다(임원 0001 = 사업개발)
const SALES_DEPT_NAMES: Record<string, string> = { "0001": "사업개발" };
export const salesDeptName = (dept: { code: string; name: string }) => SALES_DEPT_NAMES[dept.code] ?? dept.name;

// 통합 합산에서 빼는 부서 — 금액은 통합 화면의 그 부서 탭에서만 본다(물류)
const BUDGET_EXCLUDED_DEPTS = new Set(["0020"]);
export const inBudgetTotal = (code: string) => !BUDGET_EXCLUDED_DEPTS.has(code);

// 계정과목 노출 표의 ‘2027 손익’ 칸 — 숨긴 부서코드 목록에 이 값이 있으면 통합 손익 표에서 그 줄을 뺀다(판관비 합계 계산은 그대로)
export const PNL_VISIBILITY = "pnl";
export const hiddenInPnl = (hidden: Record<string, string[]>, name: string) => hidden[name]?.includes(PNL_VISIBILITY) ?? false;
/** 손익 줄의 2027 금액 — 합산하는 부서(물류 제외)의 그 계정과목 연간 합 */
export const pnlAccountTotal = (departments: DepartmentDoc[], name: string) =>
  departments.filter((d) => inBudgetTotal(d.code)).reduce((t, d) => {
    const account = d.accounts.find((a) => a.name === name);
    return t + (account ? sum(accountMonths(account)) : 0);
  }, 0);

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

const stripKind = (label: string) => label.replace(/^\(매출\)\s*/, "");
export const kindOf = (channel: Channel) => stripKind(channel.label);

export function channelKeyForKind(kind: string, channels: Channel[]) {
  const k = kind.trim();
  const alias = KIND_ALIASES[k];
  return channels.find((c) => kindOf(c) === k)?.key ?? (channels.some((c) => c.key === alias) ? alias : null);
}

type PlanRowSettings = Pick<RevenuePlan, "year" | "rowLabels" | "rowHidden">;

// 매출 예산안에서 지운 채널은 합산·매출 구분 목록에서도 뺀다
export const activeChannels = (channels: Channel[], plan: PlanRowSettings) => {
  const hidden = plan.rowHidden?.[String(plan.year)] ?? [];
  return channels.filter((c) => !hidden.includes(`ch:${c.key}`));
};

// 매출 예산안에서 고친 구분명 → 매출 구분 표시 이름. 저장된 매출 구분(kind)은 그대로 두어 합산 연결이 끊기지 않는다
export function kindNames(channels: Channel[], plan: PlanRowSettings) {
  const labels = plan.rowLabels?.[String(plan.year)] ?? {};
  const named = (key: string) => {
    const label = labels[`ch:${key}`];
    return label ? stripKind(label) : "";
  };
  const names: Record<string, string> = {};
  for (const c of channels) if (named(c.key)) names[kindOf(c)] = named(c.key);
  for (const [alias, key] of Object.entries(KIND_ALIASES)) if (named(key)) names[alias] = named(key);
  return names;
}

// 정한 순서대로 — 순서에 없는 것은 원래 순서 그대로 뒤에
export function sortByOrder<T>(items: T[], order: string[] | undefined, idOf: (item: T) => string) {
  if (!order?.length) return items;
  const at = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, k: at.get(idOf(item)) ?? order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.item);
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
