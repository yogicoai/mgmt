import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/guard";
import { ADMIN_DEPT } from "@/lib/auth/accounts";
import { MASTER_ID } from "@/lib/auth/local";
import { getStore } from "@/lib/store";
import { verifyPassword } from "@/lib/auth/password";
import { fail, handle, json } from "@/lib/http";

// 경영지원 전용 계정(직원급여 등)을 보기 전 비밀번호 다시 확인 — 경영지원 계정만. 같은 계정으로 5번 틀리면 5분 막음(서버 메모리)
//   급여 열람 비밀번호를 정해 두었으면 그것으로, 아니면 경영지원 로그인 비밀번호로
const LIMIT = 5;
const LOCK_MS = 5 * 60_000;
const fails = new Map<string, { count: number; until: number }>();

const schema = z.object({ password: z.string().min(1).max(200) });

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  if (user._id === MASTER_ID) return json({ ok: true });
  if (user.role !== "admin") throw new AuthError("경영지원 계정만 볼 수 있습니다.", 403);
  const record = fails.get(user._id);
  if (record && record.until > Date.now()) return fail(`비밀번호를 여러 번 틀려 잠시 막혔습니다. ${Math.ceil((record.until - Date.now()) / 60000)}분 뒤 다시 시도해 주세요.`, 429);
  const { password } = schema.parse(await request.json());
  const admin = await getStore().getAccount(ADMIN_DEPT);
  const hash = admin?.viewPasswordHash || user.passwordHash;
  if (!hash || !(await verifyPassword(password, hash))) {
    const count = (record && record.until <= Date.now() && record.until > 0 ? 0 : (record?.count ?? 0)) + 1;
    fails.set(user._id, { count, until: count >= LIMIT ? Date.now() + LOCK_MS : 0 });
    return fail("비밀번호가 맞지 않습니다.", 400); // 401 은 화면이 '로그인 풀림'으로 보고 로그인 화면으로 보냄
  }
  fails.delete(user._id);
  return json({ ok: true });
});
