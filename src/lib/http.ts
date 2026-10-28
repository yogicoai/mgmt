import "server-only";
import { ZodError } from "zod";
import { AuthError } from "./auth/guard";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: message, ...extra }, status);

// 라우트 공통 오류 처리 — DB 연결 실패는 알아보기 쉬운 말로
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AuthError) return fail(e.message, e.status);
      if (e instanceof ZodError) return fail(e.issues[0]?.message || "입력값을 확인해 주세요.", 400);
      const message = e instanceof Error ? e.message : String(e);
      console.error("[budget api]", message);
      if (/ECONNREFUSED|ENOTFOUND|Server selection timed out|querySrv|Authentication failed|bad auth/i.test(message)) {
        return fail(`MongoDB 에 연결하지 못했습니다 — .local/.env 의 MONGODB_URI(주소·비밀번호·IP 허용)를 확인해 주세요. (${message})`, 503);
      }
      return fail(message, 500);
    }
  };
}
