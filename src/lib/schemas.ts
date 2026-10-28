import { z } from "zod";

// API 로 들어오는 값 검사 — 원본 HTML 의 validPlan/validPersonnel 규칙(12개월·유한수·1e15 미만)
const amount = z.number().refine((v) => Number.isFinite(v) && Math.abs(v) < 1e15, "금액 범위를 확인해 주세요.");
const months = z.array(amount).length(12);
const monthKey = z.string().regex(/^(?:[0-9]|1[01])$/);

export const budgetRowSchema = z.object({
  item: z.string().max(200),
  desc: z.string().max(2000),
  values: months,
  formulas: z.record(monthKey, z.string().max(500)).optional(),
  memos: z.record(monthKey, z.string().max(5000)).optional(),
  custom: z.boolean().optional(),
  locked: z.boolean().optional(),
});

export const accountSchema = z.object({
  name: z.string().min(1).max(100),
  rows: z.array(budgetRowSchema).max(500),
});

export const personSchema = z.object({
  code: z.string().max(10),
  dept: z.string().max(50),
  store: z.string().max(100).optional(),
  position: z.string().max(50),
  name: z.string().max(100),
  values: z.array(z.number().int().min(0).max(100_000)).length(12),
});

export const salesRowSchema = z.object({
  kind: z.string().max(50),
  values: z.array(amount.refine((v) => v >= 0, "0 이상의 금액을 입력해 주세요.")).length(12),
});

const section = <T extends z.ZodType>(data: T) => z.object({ revision: z.number().int().min(0), data });

export const departmentPatchSchema = z
  .object({
    accounts: section(z.array(accountSchema).min(1).max(100)).optional(),
    personnel: section(z.array(personSchema).max(500)).optional(),
    sales: section(z.array(salesRowSchema).max(50)).optional(),
  })
  .refine((v) => v.accounts || v.personnel || v.sales, "저장할 내용이 없습니다.");

const planRows = z
  .array(z.object({ key: z.string().max(50), label: z.string().max(100), values: z.array(amount.refine((v) => v >= 0)).length(12) }))
  .max(30);

// 매출 예산안 수수료·매출원가 — 경영지원
export const planPatchSchema = z
  .object({ revision: z.number().int().min(0), fees: planRows.optional(), cogs: planRows.optional() })
  .refine((v) => v.fees || v.cogs, "저장할 내용이 없습니다.");
