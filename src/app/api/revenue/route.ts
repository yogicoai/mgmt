import { requireAdmin } from "@/lib/auth/guard";
import { getRevenuePlan, withPlanDefaults } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { planPatchSchema } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

export const dynamic = "force-dynamic";

// 매출 예산안의 수수료 행(오프라인 수수료·PG수수료·VAT)과 매출원가(제품·상품) — 경영지원.
// 채널 금액은 부서 목표매출에서 자동 합산
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return json({ plan: await getRevenuePlan(BUDGET_YEAR) });
});

export const PATCH = handle(async (request: Request) => {
  await requireAdmin(request);
  const body = planPatchSchema.parse(await request.json());
  await getRevenuePlan(BUDGET_YEAR);
  const result = await getStore().savePlanRows(BUDGET_YEAR, body.revision, { ...(body.fees ? { fees: body.fees } : {}), ...(body.cogs ? { cogs: body.cogs } : {}) });
  const plan = result.plan && withPlanDefaults(result.plan);
  if (!result.ok) return fail("다른 화면에서 먼저 저장한 내용이 있습니다.", 409, { plan });
  return json({ plan });
});
