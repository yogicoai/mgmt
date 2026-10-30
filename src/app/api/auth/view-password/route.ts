import { z } from "zod";
import { ADMIN_DEPT } from "@/lib/auth/accounts";
import { requireAdmin } from "@/lib/auth/guard";
import { MASTER_ID } from "@/lib/auth/local";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";

// 급여 열람 비밀번호 — 급여 등 경영지원 전용 계정을 볼 때 넣는 별도 비밀번호(경영지원 계정에 저장, 해시만).
//   정하지 않았으면 경영지원 로그인 비밀번호로 확인한다. 바꿀 때는 지금 로그인 비밀번호를 한 번 확인(로컬 마스터는 확인 없이 — 잊었을 때 다시 정하는 길)
const schema = z.object({ currentPassword: z.string().max(200).optional(), newPassword: z.string().max(200) });

export const GET = handle(async (request: Request) => {
  await requireAdmin(request);
  const admin = await getStore().getAccount(ADMIN_DEPT);
  return json({ set: Boolean(admin?.viewPasswordHash), updatedAt: admin?.viewPasswordUpdatedAt ?? null, loginId: admin?.loginId ?? "" });
});

export const POST = handle(async (request: Request) => {
  const user = await requireAdmin(request);
  const body = schema.parse(await request.json());
  const store = getStore();
  const admin = await store.getAccount(ADMIN_DEPT);
  if (!admin) return fail("경영지원 계정이 없습니다.", 404);
  if (user._id !== MASTER_ID) {
    if (!body.currentPassword || !admin.passwordHash || !(await verifyPassword(body.currentPassword, admin.passwordHash))) return fail("지금 로그인 비밀번호가 맞지 않습니다.", 400);
  }
  const problem = passwordProblem(body.newPassword);
  if (problem) return fail(problem.replace("비밀번호", "열람 비밀번호"));
  if (admin.passwordHash && (await verifyPassword(body.newPassword, admin.passwordHash))) return fail("로그인 비밀번호와 다른 비밀번호로 정해 주세요.");
  const updated = await store.updateAccount(ADMIN_DEPT, { viewPasswordHash: await hashPassword(body.newPassword), viewPasswordUpdatedAt: new Date().toISOString() });
  return json({ set: true, updatedAt: updated?.viewPasswordUpdatedAt ?? null });
});
