import { ensureAccounts, toPublic } from "@/lib/auth/accounts";
import { requireAdmin } from "@/lib/auth/guard";
import { handle, json } from "@/lib/http";

// 계정 관리(경영지원) — 부서별 아이디·비밀번호 상태
export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  return json({ accounts: (await ensureAccounts()).map(toPublic) });
});
