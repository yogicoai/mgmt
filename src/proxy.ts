import { NextResponse, type NextRequest } from "next/server";
import { isLocalMaster } from "@/lib/auth/local";
import { SESSION_COOKIE, peekSession } from "@/lib/auth/session";

// 로그인 안 한 요청은 로그인 화면으로(API 는 401). 실제 권한 확인(서명·부서)은 각 페이지·API 가 한다.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/icon.svg", "/logo.png", "/favicon.ico", "/robots.txt"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (peekSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (isLocalMaster(request.headers)) return NextResponse.next(); // 이 PC 개발 서버 — 로그인 없이 마스터
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
