import { requireAdmin } from "@/lib/auth/guard";
import { handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

export const dynamic = "force-dynamic";

// 통합 화면용 — 팀별 검토 의견 수(반영 필요 / 전체)
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  const counts: Record<string, { open: number; total: number }> = {};
  for (const r of await getStore().listReviews(BUDGET_YEAR)) {
    const c = (counts[r.deptCode] ??= { open: 0, total: 0 });
    c.total += 1;
    if (r.status === "open") c.open += 1;
  }
  return json({ counts });
});
