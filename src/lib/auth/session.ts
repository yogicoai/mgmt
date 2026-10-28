import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 로그인 세션 = 서명한 쿠키 하나(계정코드·세션 번호·만료). 서버(페이지·API)가 서명과 DB 세션 번호까지 확인한다.
export const SESSION_COOKIE = "budget_session";
export const SESSION_HOURS = 12;

export interface SessionPayload {
  sub: string; // 계정 _id (= 부서코드)
  v: number; // 계정 tokenVersion — 비밀번호를 바꾸면 달라져서 옛 쿠키가 무효
  exp: number; // 만료 시각(ms)
}

const globalForSecret = globalThis as unknown as { __budgetDevSecret?: string };

function secret() {
  const value = process.env.SESSION_SECRET?.trim();
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET(32자 이상)이 설정되지 않았습니다.");
  // 개발용 임시 값 — 서버를 다시 켜면 로그인이 풀린다
  globalForSecret.__budgetDevSecret ??= randomBytes(32).toString("hex");
  return globalForSecret.__budgetDevSecret;
}

export function signSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function decode(body: string): SessionPayload | null {
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.sub !== "string" || typeof p.v !== "number" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return decode(body);
}

// proxy 용 — 쿠키 모양·만료만 본다(실제 확인은 페이지·API 가 서명과 DB 로 한다)
export function peekSession(token: string | null | undefined) {
  const body = token?.split(".")[0];
  return body ? decode(body) : null;
}

export function readCookie(header: string | null, name = SESSION_COOKIE) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
