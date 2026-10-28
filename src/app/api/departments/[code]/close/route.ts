import { requireAdmin, requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

type Context = { params: Promise<{ code: string }> };

async function setClosed(code: string, closed: boolean) {
  if (!(await getDepartment(code))) return fail("없는 부서입니다.", 404);
  const department = await getStore().setClosed(BUDGET_YEAR, code, closed);
  return json({ department });
}

// 마감 — 부서 본인 또는 경영지원. 이후 계정·인원·첨부는 조회만 가능
export const POST = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  return setClosed(code, true);
});

// 마감 해제 — 경영지원만
export const DELETE = handle(async (request: Request, { params }: Context) => {
  await requireAdmin(request);
  return setClosed((await params).code, false);
});
