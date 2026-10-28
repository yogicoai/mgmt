import "server-only";
import { getStore } from "./store";
import { BUDGET_YEAR, buildDepartmentDoc, buildRevenuePlan, defaultCogs, deptMetas, findDeptMeta, templateLocked } from "./templates";
import type { DepartmentDoc, RevenuePlan } from "./types";

const order = new Map(deptMetas.map((d, i) => [d.code, i]));
const byOrder = (a: DepartmentDoc, b: DepartmentDoc) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99);

// '경영지원 입력' 잠금이 생기기 전에 만든 부서 문서 — 템플릿 기준으로 잠금 표시만 한 번 붙인다(금액은 그대로).
// 계정 저장 번호를 올려서, 옛 화면이 잠금 없이 덮어쓰려 하면 충돌로 다시 불러오게 한다.
async function ensureLocks(doc: DepartmentDoc): Promise<DepartmentDoc> {
  if (doc.locksApplied) return doc;
  const accounts = doc.accounts.map((a) => ({
    ...a,
    rows: a.rows.map((r) => (r.custom || r.locked !== undefined || !templateLocked(doc.code, a.name, r.item, r.desc) ? r : { ...r, locked: true })),
  }));
  const store = getStore();
  const result = await store.patchDepartment(doc.year, doc.code, { accounts: doc.revisions.accounts }, { accounts, locksApplied: true }, { markSaved: false, allowClosed: true });
  return result.ok ? result.doc : ((await store.getDepartment(doc.year, doc.code)) ?? doc);
}

// 부서 문서가 없으면 템플릿으로 만든 뒤 돌려준다(처음 한 번만)
export async function listDepartments(year = BUDGET_YEAR) {
  const store = getStore();
  let docs = await store.listDepartments(year);
  const missing = deptMetas.filter((m) => !docs.some((d) => d.code === m.code));
  if (missing.length) {
    await Promise.all(missing.map((m) => store.insertDepartment(buildDepartmentDoc(year, m.code))));
    docs = await store.listDepartments(year);
  }
  docs = await Promise.all(docs.map(ensureLocks));
  return docs.filter((d) => order.has(d.code)).sort(byOrder);
}

export async function getDepartment(code: string, year = BUDGET_YEAR) {
  if (!findDeptMeta(code)) return null;
  const store = getStore();
  const found = await store.getDepartment(year, code);
  if (found) return ensureLocks(found);
  await store.insertDepartment(buildDepartmentDoc(year, code));
  return store.getDepartment(year, code);
}

// 매출원가 칸이 생기기 전에 만든 매출 예산안도 빈 매출원가를 갖도록
export const withPlanDefaults = (plan: RevenuePlan): RevenuePlan => (plan.cogs?.length ? plan : { ...plan, cogs: defaultCogs() });

export async function getRevenuePlan(year = BUDGET_YEAR): Promise<RevenuePlan> {
  const store = getStore();
  const found = await store.getRevenuePlan(year);
  if (found) return withPlanDefaults(found);
  await store.insertRevenuePlan(buildRevenuePlan(year));
  return withPlanDefaults((await store.getRevenuePlan(year))!);
}
