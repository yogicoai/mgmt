import "server-only";
import { getStore } from "../store";
import { deptMetas } from "../templates";
import type { LoginAccount, PublicAccount } from "../types";
import { hashPassword } from "./password";

// 경영지원(0002) = 통합예산 관리자. 모든 계정은 초기 비밀번호(기본 1234)로 만들고, 경영지원이 바꿔 준다.
// passwordUpdatedAt 이 비어 있으면 아직 초기 비밀번호를 쓰는 계정.
export const ADMIN_DEPT = "0002";
const INITIAL_PASSWORD = () => process.env.INITIAL_PASSWORD?.trim() || "1234";

const DEFAULT_LOGIN_IDS: Record<string, string> = {
  "0001": "exec",
  "0002": "mgmt",
  "0004": "marketing",
  "0005": "design",
  "0011": "sales",
  "0016": "onlinecs",
  "0017": "common",
  "0020": "logistics",
};

export const LOGIN_ID_RULE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const normalizeLoginId = (value: string) => value.trim().toLowerCase();

const order = new Map(deptMetas.map((d, i) => [d.code, i]));

// 부서마다 계정이 있는지 확인하고 없으면 초기 비밀번호로 만든다
export async function ensureAccounts(): Promise<LoginAccount[]> {
  const store = getStore();
  let list = await store.listAccounts();
  const missing = deptMetas.filter((m) => !list.some((a) => a._id === m.code));
  if (missing.length) {
    for (const meta of missing) {
      const now = new Date().toISOString();
      await store.insertAccount({
        _id: meta.code,
        loginId: DEFAULT_LOGIN_IDS[meta.code] ?? `dept${meta.code}`,
        deptCode: meta.code,
        deptName: meta.name,
        role: meta.code === ADMIN_DEPT ? "admin" : "dept",
        passwordHash: await hashPassword(INITIAL_PASSWORD()),
        tokenVersion: 0,
        active: true,
        passwordUpdatedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    list = await store.listAccounts();
  }
  return list.filter((a) => order.has(a._id)).sort((a, b) => order.get(a._id)! - order.get(b._id)!);
}

export function toPublic(account: LoginAccount): PublicAccount {
  const { passwordHash, ...rest } = account;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

export const homeOf = (account: Pick<LoginAccount, "role" | "deptCode">) => (account.role === "admin" ? "/" : `/dept/${account.deptCode}`);
