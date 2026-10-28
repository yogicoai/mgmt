// 브라우저 전용 도우미 — API 호출·파일 내려받기
import { toCsv } from "./budget";

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isForm || !init.body ? init.headers : { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  // 로그인이 풀렸으면(시간 만료·비밀번호 변경) 로그인 화면으로
  if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
  }
  if (!response.ok) throw new ApiError(String(body.error || `요청 실패 (${response.status})`), response.status, body);
  return body as T;
}

// 서버가 만든 파일 받기(엑셀 등) — 오류면 서버 문구로 알려 주고, 파일 이름은 응답 헤더를 따른다
export async function downloadFrom(url: string, fallbackName: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
    throw new Error(body.error || `내려받기 실패 (${response.status})`);
  }
  const blob = await response.blob();
  const match = (response.headers.get("content-disposition") || "").match(/filename\*=UTF-8''([^;]+)/);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match ? decodeURIComponent(match[1]) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;

export const formatTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
