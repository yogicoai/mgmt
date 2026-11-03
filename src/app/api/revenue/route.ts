import { requireAdmin } from "@/lib/auth/guard";
import { channelTotals, sum } from "@/lib/budget";
import { getRevenuePlan, listDepartments, withPlanDefaults } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { planPatchSchema } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR, channels, revenue2026 } from "@/lib/templates";
import type { RevenuePlan } from "@/lib/types";

export const dynamic = "force-dynamic";

// 합계 줄(손익 매출·ERP)은 지울 수 없고(접으면 이 두 줄만 보인다), 금액이 남은 수수료·채널도 지울 수 없다(합계가 보이는 줄과 안 맞게 되므로)
async function cannotHide(rowHidden: Record<string, string[]>, plan: RevenuePlan) {
  const current = String(BUDGET_YEAR);
  const added = (rowHidden[current] ?? []).filter((id) => !plan.rowHidden?.[current]?.includes(id));
  const prior = rowHidden[String(BUDGET_YEAR - 1)] ?? [];
  const keyPrior = prior.some((id) => ["net", "erp"].includes(revenue2026[Number(id.slice(1))]?.type));
  if (keyPrior || added.includes("net") || added.includes("erp")) return "합계 줄은 삭제할 수 없습니다(이름만 수정 가능).";
  const filled = "금액이 남아 있는 줄은 삭제할 수 없습니다. 금액을 0으로 만든 뒤 삭제해 주세요.";
  if (added.some((id) => sum(plan.fees.find((f) => `fee:${f.key}` === id)?.values ?? []) !== 0)) return filled;
  if (added.some((id) => id.startsWith("ch:"))) {
    const { values } = channelTotals(await listDepartments(), channels);
    if (added.some((id) => sum(values[id.slice(3)] ?? []) !== 0)) return filled;
  }
  return null;
}

// 매출 예산안의 수수료 행(오프라인 수수료·PG수수료·VAT)과 매출원가(제품·상품), 줄 순서·구분명·삭제한 줄 — 경영지원.
// 채널 금액은 부서 목표매출에서 자동 합산
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return json({ plan: await getRevenuePlan(BUDGET_YEAR) });
});

export const PATCH = handle(async (request: Request) => {
  await requireAdmin(request);
  const body = planPatchSchema.parse(await request.json());
  const current = await getRevenuePlan(BUDGET_YEAR);
  const problem = body.rowHidden ? await cannotHide(body.rowHidden, current) : null;
  if (problem) return fail(problem);
  const result = await getStore().savePlanRows(BUDGET_YEAR, body.revision, {
    ...(body.fees ? { fees: body.fees } : {}),
    ...(body.cogs ? { cogs: body.cogs } : {}),
    ...(body.rowOrder ? { rowOrder: body.rowOrder } : {}),
    ...(body.rowLabels ? { rowLabels: body.rowLabels } : {}),
    ...(body.rowHidden ? { rowHidden: body.rowHidden } : {}),
    ...(body.deptOrder ? { deptOrder: body.deptOrder } : {}),
  });
  const plan = result.plan && withPlanDefaults(result.plan);
  if (!result.ok) return fail("다른 화면에서 먼저 저장한 내용이 있습니다.", 409, { plan });
  return json({ plan });
});
