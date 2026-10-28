import { requireDept } from "@/lib/auth/guard";
import { fail, handle, json } from "@/lib/http";
import { findDeptMeta, priorFor } from "@/lib/templates";

type Context = { params: Promise<{ code: string }> };

// 행별 2026 실적(원본 HTML 데이터) — 상세 입력 창의 '2026 실적' 참고 칸. 키 = 계정\0구분\0상세설명
export const GET = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  if (!findDeptMeta(code)) return fail("없는 부서입니다.", 404);
  return json({ prior: priorFor(code) });
});
