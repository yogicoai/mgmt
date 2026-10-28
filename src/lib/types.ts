// 서버·브라우저가 같이 쓰는 데이터 모양

export interface BudgetRow {
  item: string; // 구분
  desc: string; // 상세설명
  values: number[]; // 1~12월 금액(원)
  formulas?: Record<string, string>; // 월 → "=10000*4" 같은 계산식
  memos?: Record<string, string>; // 월 → 산출근거 메모
  custom?: boolean; // 부서가 직접 추가한 행(삭제 가능)
  locked?: boolean; // 경영지원 입력 줄 — 팀 화면에서는 조회만(급여·4대보험·회사 행사 등)
}

export interface BudgetAccount {
  name: string; // 계정과목
  rows: BudgetRow[];
}

export interface PersonRow {
  code: string;
  dept: string;
  store?: string; // 영업만 — 매장명
  position: string;
  name: string;
  values: number[]; // 1~12월 인원
}

export interface SalesRow {
  kind: string; // 매출 구분(오프라인·온라인·B2B …)
  values: number[];
}

export type Section = "accounts" | "personnel" | "sales";
export const SECTIONS: Section[] = ["accounts", "personnel", "sales"];
export const SECTION_FIELD = { accounts: "accounts", personnel: "personnel", sales: "salesForecastRows" } as const;

export interface DepartmentDoc {
  _id: string; // `${year}:${code}`
  year: number;
  code: string;
  name: string;
  accounts: BudgetAccount[];
  personnel: PersonRow[];
  salesForecastRows: SalesRow[];
  revisions: Record<Section, number>; // 구역별 저장 번호 — 동시 수정 충돌 확인용
  closed: boolean;
  closedAt: string | null;
  locksApplied?: boolean; // 템플릿의 '경영지원 입력' 잠금을 붙였는지(옛 문서 이전용)
  savedAt: string | null; // 부서 입력(계정·인원)이 마지막으로 저장된 시각
  updatedAt: string;
  createdAt: string;
}

export interface DeptMeta {
  code: string;
  name: string;
  category: string;
  note: string;
  positions: string[];
  hasStore: boolean;
  storePositions: string[];
}

export type AttachmentKind = "sales" | "expenses";

export interface AttachmentMeta {
  id: string;
  year: number;
  deptCode: string;
  kind: AttachmentKind;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
}

export interface FeeRow {
  key: string;
  label: string;
  values: number[];
}

export interface RevenuePlan {
  _id: string; // `${year}`
  year: number;
  fees: FeeRow[];
  cogs: FeeRow[]; // 매출원가(제품·상품) — 경영지원 입력, 손익 탭에서 사용
  revision: number;
  updatedAt: string | null;
}

export interface PnlPrior {
  name: string; // Ⅰ.매출액 … 계정과목 … Ⅴ.영업손익
  prior: number; // 원본 손익표의 전년 값
}

export interface Channel {
  key: string;
  label: string;
}

export interface Revenue2026Row {
  label: string;
  type: "net" | "erp" | "ratio" | "channel";
  values: (number | null)[];
  total: number | null;
}

export interface ActualsResult {
  configured: boolean;
  year: number;
  online: (number | null)[];
  offline: (number | null)[];
  start: string | null;
  end: string | null;
  lastDate: string | null; // 실적이 있는 마지막 날
  fetchedAt: string | null;
  source?: "cache" | "live";
  note?: string;
  error?: string;
}

export type StorageKind = "mongo" | "file";

// 로그인 계정 — 부서당 1개. 경영지원(admin)은 통합예산과 모든 부서·계정 관리
export type AccountRole = "admin" | "dept";

export interface LoginAccount {
  _id: string; // 부서코드
  loginId: string;
  deptCode: string;
  deptName: string;
  role: AccountRole;
  passwordHash: string | null; // 없으면 로그인 불가(경영지원이 비밀번호를 정해 줘야 함)
  tokenVersion: number; // 비밀번호 변경·사용 중지 때 +1 → 기존 로그인 무효
  active: boolean;
  passwordUpdatedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicAccount = Omit<LoginAccount, "passwordHash"> & { hasPassword: boolean };

// 검토 의견 — 경영지원이 팀 예산에 남기는 첨언·수정 요청, 팀은 답글
export interface ReviewAuthor {
  loginId: string;
  deptName: string;
  role: AccountRole;
}

export interface ReviewReply {
  id: string;
  text: string;
  author: ReviewAuthor;
  createdAt: string;
}

export interface ReviewComment {
  _id: string;
  year: number;
  deptCode: string;
  account: string | null; // 계정과목(없으면 부서 전체)
  month: number | null; // 0~11 (없으면 연간)
  text: string;
  author: ReviewAuthor;
  status: "open" | "resolved"; // 반영 필요 / 반영 완료
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  replies: ReviewReply[];
}
