import "server-only";
import type { BudgetStore } from "./types";
import { fileStore } from "./file";
import { mongoStore } from "./mongo";

// MONGODB_URI 가 있으면 MongoDB, 없으면 로컬 파일 저장소(시험용)
export function getStore(): BudgetStore {
  return process.env.MONGODB_URI?.trim() ? mongoStore : fileStore;
}

export type { BudgetStore, DeptPatch } from "./types";
