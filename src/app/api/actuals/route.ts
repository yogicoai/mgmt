import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { fail, handle, json } from "@/lib/http";
import { getActuals } from "@/lib/onlineData";
import { BUDGET_YEAR } from "@/lib/templates";

// 월별 매출 실적(온라인·오프라인) — onlineData MCP. ?year=2026&refresh=1
export const GET = handle(async (request: NextRequest) => {
  await requireUser(request);
  const params = request.nextUrl.searchParams;
  const year = Number(params.get("year") || BUDGET_YEAR - 1);
  if (!Number.isInteger(year) || year < 2024 || year > BUDGET_YEAR + 1) return fail("연도를 확인해 주세요.");
  return json(await getActuals(year, { refresh: params.get("refresh") === "1" }));
});
