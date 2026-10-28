import { requireAdmin } from "@/lib/auth/guard";
import { listDepartments } from "@/lib/departments";
import { handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

export const dynamic = "force-dynamic";

// 통합 대시보드(경영지원) — 전 부서 문서를 한 번에(부서가 저장한 값이 그대로 합산된다)
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  const departments = await listDepartments(BUDGET_YEAR);
  return json({ year: BUDGET_YEAR, storage: getStore().kind, departments });
});
