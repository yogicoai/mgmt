import { requireDept } from "@/lib/auth/guard";
import { isSensitiveAccount } from "@/lib/budget";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { findDeptMeta, priorFor } from "@/lib/templates";

type Context = { params: Promise<{ code: string }> };

// 행별 2026 실적(원본 HTML 데이터) — 상세 입력 창의 '2026 실적' 참고 칸. 키 = 계정\0구분\0상세설명
export const GET = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  const user = await requireDept(request, code);
  if (!findDeptMeta(code)) return fail("없는 부서입니다.", 404);
  const prior = priorFor(code);
  if (user.role === "admin") return json({ prior });
  // 팀에는 경영지원 전용 계정(급여 등)의 2026 실적도 보내지 않는다
  const doc = await getDepartment(code);
  const sensitive = new Set((doc?.accounts ?? []).filter(isSensitiveAccount).map((a) => a.name));
  return json({ prior: Object.fromEntries(Object.entries(prior).filter(([key]) => !sensitive.has(key.split("\u0000")[0]))) });
});
