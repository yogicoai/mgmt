import "server-only";
import templates from "@/data/templates.json";
import revenue from "@/data/revenue.json";
import { zeros } from "./budget";
import type { Channel, DepartmentDoc, DeptMeta, FeeRow, PersonRow, PnlPrior, Revenue2026Row, RevenuePlan, SalesRow } from "./types";

// 원본 HTML 에서 뽑은 템플릿(scripts/extract-from-html.mjs) — 부서 문서를 처음 만들 때만 쓴다.
interface DeptTemplate extends DeptMeta {
  accounts: { name: string; rows: { item: string; desc: string; locked?: boolean; actual?: number[] }[] }[];
  personnel: PersonRow[];
  salesForecastRows: SalesRow[];
}

const deptTemplates = templates.departments as DeptTemplate[];

export const BUDGET_YEAR = Number(process.env.BUDGET_YEAR || templates.year);

export const deptMetas: DeptMeta[] = deptTemplates.map(({ code, name, category, note, positions, hasStore, storePositions }) => ({
  code,
  name,
  category,
  note,
  positions,
  hasStore,
  storePositions,
}));

export const channels = revenue.channels as Channel[];
export const revenue2026 = revenue.rows2026 as Revenue2026Row[];
export const pnlPrior = revenue.pnlPrior as PnlPrior[];

export const rowKey = (account: string, item: string, desc: string) => `${account}\u0000${item}\u0000${desc}`;

// 행별 2026 실적(원본 데이터) — 계정|구분|상세설명 → 12개월
export function priorFor(code: string): Record<string, number[]> {
  const t = deptTemplates.find((d) => d.code === code);
  const out: Record<string, number[]> = {};
  for (const a of t?.accounts ?? []) for (const r of a.rows) if (r.actual) out[rowKey(a.name, r.item, r.desc)] = r.actual;
  return out;
}

// 템플릿상 경영지원 입력 줄인가(이미 만들어진 부서 문서에 잠금을 처음 붙일 때 사용)
export function templateLocked(code: string, account: string, item: string, desc: string) {
  const t = deptTemplates.find((d) => d.code === code);
  return Boolean(t?.accounts.find((a) => a.name === account)?.rows.find((r) => r.item === item && r.desc === desc)?.locked);
}

export const defaultCogs = (): FeeRow[] => [
  { key: "productCogs", label: "제품매출원가", values: zeros() },
  { key: "goodsCogs", label: "상품매출원가", values: zeros() },
];

export const findDeptMeta = (code: string) => deptMetas.find((d) => d.code === code) ?? null;
export const findDeptByName = (name: string) =>
  deptMetas.find((d) => d.name === name || (name === "물류센터" && d.name === "물류")) ?? null;

export const departmentId = (year: number, code: string) => `${year}:${code}`;

export function buildDepartmentDoc(year: number, code: string): DepartmentDoc {
  const t = deptTemplates.find((d) => d.code === code);
  if (!t) throw new Error(`알 수 없는 부서 코드입니다: ${code}`);
  const now = new Date().toISOString();
  return {
    _id: departmentId(year, code),
    year,
    code,
    name: t.name,
    accounts: t.accounts.map((a) => ({
      name: a.name,
      rows: a.rows.map((r) => ({ item: r.item, desc: r.desc, values: zeros(), formulas: {}, memos: {}, ...(r.locked ? { locked: true } : {}) })),
    })),
    personnel: t.personnel.map((p) => ({ ...p, values: p.values.slice() })),
    salesForecastRows: t.salesForecastRows.map((r) => ({ kind: r.kind, values: r.values.slice() })),
    revisions: { accounts: 0, personnel: 0, sales: 0 },
    closed: false,
    closedAt: null,
    locksApplied: true,
    savedAt: null,
    updatedAt: now,
    createdAt: now,
  };
}

export function buildRevenuePlan(year: number): RevenuePlan {
  return {
    _id: String(year),
    year,
    fees: (revenue.fees as FeeRow[]).map((f) => ({ key: f.key, label: f.label, values: f.values.slice() })),
    cogs: defaultCogs(),
    revision: 0,
    updatedAt: null,
  };
}
