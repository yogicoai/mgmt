import { requireAdmin } from "@/lib/auth/guard";
import { handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

export const dynamic = "force-dynamic";

// 통합 대시보드 '부서별 백데이터'(경영지원) — 전 부서 첨부 목록(파일 내용 제외)
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return json({ attachments: await getStore().listAttachments(BUDGET_YEAR) });
});
