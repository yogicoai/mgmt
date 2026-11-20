import { z } from "zod";
import { requireDept } from "@/lib/auth/guard";
import { getRevenuePlan } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR, findDeptMeta } from "@/lib/templates";

type Context = { params: Promise<{ code: string }> };

// 팀이 '우리 부서 2026 추정실적'을 직접 저장 — 매출 예산안(plan)의 prior2026[부서코드]에 넣는다(전 부서 공통 설정).
//   팀은 자기 부서코드만 바꿀 수 있다(requireDept). null 이면 지워서 자동 추정(9개월 ÷9×12)으로 되돌린다.
const schema = z.object({ value: z.number().min(0).max(1e13).nullable() });

export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  if (!findDeptMeta(code)) return fail("없는 부서입니다.", 404);
  const { value } = schema.parse(await request.json());
  // 다른 부서·경영지원이 그 사이 plan 을 저장했으면 저장 번호가 바뀌므로, 최신을 다시 읽어 그 키만 고쳐 다시 저장
  for (let attempt = 0; attempt < 5; attempt++) {
    const plan = await getRevenuePlan(BUDGET_YEAR);
    const prior2026 = { ...(plan.prior2026 ?? {}) };
    if (value == null) delete prior2026[code];
    else prior2026[code] = Math.round(value);
    const result = await getStore().savePlanRows(BUDGET_YEAR, plan.revision, { prior2026 });
    if (result.ok) return json({ prior2026: result.plan?.prior2026?.[code] ?? null, revision: result.plan?.revision ?? 0 });
  }
  return fail("다른 화면에서 먼저 저장했습니다. 잠시 뒤 다시 시도해 주세요.", 409);
});
