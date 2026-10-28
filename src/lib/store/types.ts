import type { AttachmentMeta, BudgetAccount, DepartmentDoc, FeeRow, LoginAccount, PersonRow, RevenuePlan, ReviewComment, ReviewReply, SalesRow, Section, StorageKind } from "../types";

export interface DeptPatch {
  accounts?: BudgetAccount[];
  personnel?: PersonRow[];
  salesForecastRows?: SalesRow[];
  locksApplied?: boolean;
}

export interface PlanPatch {
  fees?: FeeRow[];
  cogs?: FeeRow[];
}

export interface PatchOptions {
  markSaved: boolean; // 부서 입력(계정·인원)이면 savedAt 갱신
  allowClosed: boolean; // 목표매출(통합 담당자 입력)은 마감 후에도 허용
}

export type PatchResult =
  | { ok: true; doc: DepartmentDoc }
  | { ok: false; reason: "conflict" | "closed" | "missing"; doc: DepartmentDoc | null };

export interface BudgetStore {
  kind: StorageKind;
  listDepartments(year: number): Promise<DepartmentDoc[]>;
  getDepartment(year: number, code: string): Promise<DepartmentDoc | null>;
  insertDepartment(doc: DepartmentDoc): Promise<void>; // 이미 있으면 그대로 둔다
  /** expected = 클라이언트가 마지막으로 본 구역별 저장 번호. 다르면 conflict */
  patchDepartment(year: number, code: string, expected: Partial<Record<Section, number>>, patch: DeptPatch, options: PatchOptions): Promise<PatchResult>;
  setClosed(year: number, code: string, closed: boolean): Promise<DepartmentDoc | null>;

  listAttachments(year: number, deptCode?: string): Promise<AttachmentMeta[]>;
  getAttachment(id: string): Promise<{ meta: AttachmentMeta; data: Buffer } | null>;
  addAttachment(meta: Omit<AttachmentMeta, "id">, data: Buffer): Promise<AttachmentMeta>;
  deleteAttachment(id: string): Promise<boolean>;

  getRevenuePlan(year: number): Promise<RevenuePlan | null>;
  insertRevenuePlan(plan: RevenuePlan): Promise<void>;
  savePlanRows(year: number, expectedRevision: number, patch: PlanPatch): Promise<{ ok: boolean; plan: RevenuePlan | null }>;

  getCache<T>(key: string): Promise<{ data: T; fetchedAt: string } | null>;
  setCache<T>(key: string, data: T): Promise<void>;

  listAccounts(): Promise<LoginAccount[]>;
  getAccount(id: string): Promise<LoginAccount | null>;
  findAccountByLoginId(loginId: string): Promise<LoginAccount | null>;
  insertAccount(doc: LoginAccount): Promise<void>; // 이미 있으면 그대로 둔다
  /** bumpToken = 기존 로그인 세션 무효(비밀번호 변경·사용 중지) */
  updateAccount(id: string, patch: Partial<Omit<LoginAccount, "_id" | "tokenVersion">>, bumpToken?: boolean): Promise<LoginAccount | null>;

  listReviews(year: number, deptCode?: string): Promise<ReviewComment[]>;
  getReview(id: string): Promise<ReviewComment | null>;
  insertReview(doc: ReviewComment): Promise<void>;
  updateReview(id: string, patch: Partial<Pick<ReviewComment, "status" | "resolvedAt" | "text">>): Promise<ReviewComment | null>;
  addReviewReply(id: string, reply: ReviewReply): Promise<ReviewComment | null>;
  deleteReview(id: string): Promise<boolean>;
}
