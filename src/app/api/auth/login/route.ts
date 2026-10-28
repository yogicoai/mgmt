import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ensureAccounts, homeOf, normalizeLoginId } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { fail, handle } from "@/lib/http";
import { getStore } from "@/lib/store";

const schema = z.object({ loginId: z.string().min(1).max(60), password: z.string().min(1).max(200) });

// 같은 아이디·IP 로 5번 틀리면 5분 막는다(서버 메모리 — 재시작하면 풀림)
const LIMIT = 5;
const LOCK_MS = 5 * 60_000;
const globalForLogin = globalThis as unknown as { __budgetLoginFails?: Map<string, { count: number; until: number }> };
const fails = (globalForLogin.__budgetLoginFails ??= new Map());

export const POST = handle(async (request: NextRequest) => {
  const body = schema.parse(await request.json());
  const loginId = normalizeLoginId(body.loginId);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${ip}|${loginId}`;
  const record = fails.get(key);
  if (record && record.until > Date.now()) {
    return fail(`비밀번호를 여러 번 틀려 잠시 막혔습니다. ${Math.ceil((record.until - Date.now()) / 60000)}분 뒤 다시 시도해 주세요.`, 429);
  }

  await ensureAccounts();
  const store = getStore();
  const account = await store.findAccountByLoginId(loginId);
  const ok = Boolean(account?.active && account.passwordHash && (await verifyPassword(body.password, account.passwordHash)));
  if (!ok || !account) {
    // 잠금 시간이 끝난 기록만 0부터 다시 센다
    const lockExpired = Boolean(record && record.until > 0 && record.until <= Date.now());
    const count = (lockExpired ? 0 : (record?.count ?? 0)) + 1;
    fails.set(key, { count, until: count >= LIMIT ? Date.now() + LOCK_MS : 0 });
    if (account && (!account.active || !account.passwordHash)) return fail("아직 사용할 수 없는 계정입니다. 경영지원팀에 비밀번호 발급을 요청해 주세요.", 403);
    return fail("아이디 또는 비밀번호가 맞지 않습니다.", 401);
  }
  fails.delete(key);
  const updated = (await store.updateAccount(account._id, { lastLoginAt: new Date().toISOString() })) ?? account;
  const response = NextResponse.json({ home: homeOf(updated), deptName: updated.deptName });
  setSessionCookie(response, updated, request);
  return response;
});
