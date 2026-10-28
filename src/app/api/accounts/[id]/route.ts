import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_DEPT, LOGIN_ID_RULE, ensureAccounts, normalizeLoginId, toPublic } from "@/lib/auth/accounts";
import { requireAdmin, setSessionCookie } from "@/lib/auth/guard";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { fail, handle } from "@/lib/http";
import { getStore } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

const schema = z
  .object({
    loginId: z.string().max(60).optional(),
    password: z.string().max(200).optional(), // 경영지원이 정한 새 비밀번호
    active: z.boolean().optional(),
  })
  .refine((v) => v.loginId !== undefined || v.password !== undefined || v.active !== undefined, "바꿀 내용이 없습니다.");

// 경영지원이 부서 계정의 아이디·비밀번호·사용 여부를 바꾼다
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const admin = await requireAdmin(request);
  const { id } = await params;
  await ensureAccounts();
  const store = getStore();
  const target = await store.getAccount(id);
  if (!target) return fail("없는 계정입니다.", 404);
  const body = schema.parse(await request.json());

  const patch: Parameters<typeof store.updateAccount>[1] = {};
  let bump = false;

  if (body.loginId !== undefined) {
    const loginId = normalizeLoginId(body.loginId);
    if (!LOGIN_ID_RULE.test(loginId)) return fail("아이디는 영문 소문자·숫자로 시작하는 3~30자(영문·숫자·. _ -)로 정해 주세요.");
    const taken = await store.findAccountByLoginId(loginId);
    if (taken && taken._id !== id) return fail(`‘${loginId}’ 는 ${taken.deptName} 계정이 쓰고 있습니다.`, 409);
    patch.loginId = loginId;
  }
  if (body.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem);
    patch.passwordHash = await hashPassword(body.password);
    patch.passwordUpdatedAt = new Date().toISOString();
    bump = true; // 옛 비밀번호로 로그인해 둔 화면은 다시 로그인
  }
  if (body.active !== undefined) {
    if (!body.active && id === ADMIN_DEPT) return fail("경영지원 계정은 사용 중지할 수 없습니다.");
    patch.active = body.active;
    if (!body.active) bump = true;
  }

  const updated = await store.updateAccount(id, patch, bump);
  if (!updated) return fail("없는 계정입니다.", 404);
  const response = NextResponse.json({ account: toPublic(updated) });
  // 경영지원이 자기 비밀번호를 바꾸면 지금 화면의 로그인을 새 번호로 이어 준다
  if (bump && updated._id === admin._id) setSessionCookie(response, updated, request);
  return response;
});
