import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ADMIN_DEPT } from "./auth/accounts";
import { MASTER_ID } from "./auth/local";
import { getStore } from "./store";
import type { LoginAccount, ReviewAuthor } from "./types";

// 검토 의견 공용 — 작성자 표시·id·입력값 검사
export const newId = () => randomUUID().replace(/-/g, "");

export const authorOf = (account: LoginAccount): ReviewAuthor => ({ loginId: account.loginId, deptName: account.deptName, role: account.role });

// 로컬 마스터가 쓴 글은 경영지원 계정이 쓴 것으로 남긴다 — 경영지원·팀 화면에 마스터 흔적이 남지 않게
export async function authorFor(account: LoginAccount): Promise<ReviewAuthor> {
  if (account._id !== MASTER_ID) return authorOf(account);
  const admin = await getStore().getAccount(ADMIN_DEPT);
  return admin ? authorOf(admin) : { loginId: "", deptName: "경영지원", role: "admin" };
}

export const reviewCreateSchema = z.object({
  text: z.string().trim().min(1, "내용을 입력해 주세요.").max(2000, "2000자까지 쓸 수 있습니다."),
  account: z.string().max(100).nullable().optional(),
  month: z.number().int().min(0).max(11).nullable().optional(),
});

export const reviewReplySchema = z.object({
  text: z.string().trim().min(1, "내용을 입력해 주세요.").max(2000, "2000자까지 쓸 수 있습니다."),
});

export const reviewPatchSchema = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    text: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((v) => v.status || v.text, "바꿀 내용이 없습니다.");
