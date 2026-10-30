import "server-only";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { getStore } from "../store";
import type { LoginAccount } from "../types";
import { MASTER, isLocalMaster } from "./local";
import { SESSION_COOKIE, SESSION_HOURS, readCookie, signSession, verifySession } from "./session";

// 권한 규칙
//   경영지원(admin): 통합예산·모든 부서·계정 관리
//   부서(dept): 자기 부서 문서·첨부만
//   로컬 마스터: 이 PC 개발 서버에서 로그인 안 했을 때 경영지원 권한으로(local.ts)
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function accountFromToken(token: string | null | undefined): Promise<LoginAccount | null> {
  const payload = verifySession(token);
  if (!payload) return null;
  const account = await getStore().getAccount(payload.sub);
  if (!account || !account.active || !account.passwordHash || account.tokenVersion !== payload.v) return null;
  return account;
}

export async function requireUser(request: Request) {
  const account = await accountFromToken(readCookie(request.headers.get("cookie")));
  if (account) return account;
  if (isLocalMaster(request.headers)) return MASTER;
  throw new AuthError("로그인이 필요합니다.", 401);
}

export async function requireAdmin(request: Request) {
  const account = await requireUser(request);
  if (account.role !== "admin") throw new AuthError("경영지원 계정만 할 수 있습니다.", 403);
  return account;
}

export async function requireDept(request: Request, code: string) {
  const account = await requireUser(request);
  if (account.role !== "admin" && account.deptCode !== code) throw new AuthError("다른 부서 자료는 볼 수 없습니다.", 403);
  return account;
}

// 서버 컴포넌트(페이지)용
export async function currentAccount() {
  const account = await accountFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (account) return account;
  return isLocalMaster(await headers()) ? MASTER : null;
}

export function setSessionCookie(response: NextResponse, account: LoginAccount, request: Request) {
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  response.cookies.set(SESSION_COOKIE, signSession({ sub: account._id, v: account.tokenVersion, exp: Date.now() + SESSION_HOURS * 3600e3 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
