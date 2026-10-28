import { requireUser } from "@/lib/auth/guard";
import { listDepartments } from "@/lib/departments";
import { handle, json } from "@/lib/http";
import { onlineDataConfig } from "@/lib/onlineData";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";

export const dynamic = "force-dynamic";

// 화면 상단 연결 표시용 — 저장소 종류·연결 여부·MCP 설정 여부 (비밀값은 내보내지 않음)
export const GET = handle(async (request: Request) => {
  await requireUser(request);
  const store = getStore();
  let database: { ok: boolean; error?: string } = { ok: true };
  try {
    await listDepartments(BUDGET_YEAR);
  } catch (e) {
    database = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const { url, token } = onlineDataConfig();
  return json({
    year: BUDGET_YEAR,
    storage: store.kind,
    database,
    onlineData: { configured: Boolean(token), host: new URL(url).host },
  });
});
