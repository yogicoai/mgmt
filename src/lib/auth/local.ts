import type { LoginAccount } from "../types";

// 로컬 마스터 — 이 PC에서 띄운 개발 서버(npm run dev)는 로그인 없이 마스터(경영지원 권한 전체)로 연다.
//   켜지는 조건: .local/.env 의 LOCAL_MASTER=1 + 개발 모드 + Vercel 아님 + 주소가 localhost
//   배포 서버는 .local/.env 가 없고 production 이라 항상 꺼져 있다(팀은 지금처럼 로그인).
export const MASTER_ID = "master";

export const MASTER: LoginAccount = {
  _id: MASTER_ID,
  loginId: "master",
  deptCode: "0002",
  deptName: "마스터",
  role: "admin",
  passwordHash: null,
  tokenVersion: 0,
  active: true,
  passwordUpdatedAt: null,
  lastLoginAt: null,
  createdAt: "",
  updatedAt: "",
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_IP = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;

export function localMasterEnabled() {
  return process.env.LOCAL_MASTER === "1" && process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

// 다른 PC(사내망 주소)나 다른 사이트를 거친 요청은 제외 — 주소와 출발지가 모두 이 PC여야 한다
export function isLocalMaster(headers: { get(name: string): string | null }) {
  if (!localMasterEnabled()) return false;
  if (!LOCAL_HOST.test(headers.get("host") ?? "")) return false;
  const from = headers.get("x-forwarded-for");
  return !from || from.split(",").every((ip) => LOCAL_IP.test(ip.trim()));
}
