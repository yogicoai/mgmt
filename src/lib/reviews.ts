import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LoginAccount, ReviewAuthor } from "./types";

// 검토 의견 공용 — 작성자 표시·id·입력값 검사
export const newId = () => randomUUID().replace(/-/g, "");

export const authorOf = (account: LoginAccount): ReviewAuthor => ({ loginId: account.loginId, deptName: account.deptName, role: account.role });

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
