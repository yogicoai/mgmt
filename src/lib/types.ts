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

// 계정 마지막 수정 기록 — 언제·누가(팀 ID)·어디서(IP). 서버가 남김
export interface AccountEdit {
  at: string;
  loginId: string;
  deptName: string;
  ip: string; // 팀 계정에 보낼 때는 비움
}

export interface BudgetAccount {
  name: string; // 계정과목
  rows: BudgetRow[];
  masked?: boolean; // 팀 화면용 — 경영지원 전용 계정이라 금액을 보내지 않음
  lastEdit?: AccountEdit;
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
  savedBy?: Partial<Record<Section, AccountRole>>; // 구역별 마지막 저장자 — 동시 수정 충돌 때 경영지원 값 우선
  updatedAt: string;
  createdAt: string;
}

// 같은 화면 접속 표시·실시간 커서 — 위치는 좌표가 아니라 "어느 영역(data-anchor)의 어느 표 몇째 칸 안 어디"로 주고받는다
export interface CursorLoc {
  a: string; // data-anchor
  t?: number; // 영역 안 몇 번째 표
  r?: number; // 표의 행 번호(rowIndex)
  c?: number; // 행 안 칸 번호(cellIndex)
  fx: number; // 칸(또는 영역) 안 가로 위치 0~1
  fy: number; // 세로 위치 0~1
}

// 실시간 반영 — 접속 신호 응답에 실어 보내는 부서별 저장 번호(이 번호가 올라가면 그 구역만 다시 받아 온다)
export interface DeptRevisionInfo {
  code: string;
  revisions: Record<Section, number>;
  closed: boolean;
}

export interface SyncInfo {
  depts: Record<string, DeptRevisionInfo>;
  plan?: number; // 매출 예산안(수수료·매출원가) 저장 번호 — 통합 화면만
  visibility?: number; // 계정과목 노출 설정 저장 번호
}

// 계정과목 노출 — 경영지원이 계정과목별로 어느 부서에 보일지 정한다. hidden = 그 계정을 숨긴 부서코드들(없으면 전 부서에 보임)
export interface AccountVisibility {
  _id: string; // `${year}:visibility`
  year: number;
  hidden: Record<string, string[]>;
  revision: number;
  updatedAt: string;
}

export interface PresenceEntry {
  _id: string; // 창(탭)마다 하나
  page: string; // dept:0005 · unified
  accountId: string;
  loginId: string;
  deptName: string;
  where: string; // 보고 있는 탭 이름
  editing: boolean; // 최근 15초 안에 입력
  loc: CursorLoc | null;
  focus: CursorLoc | null; // 입력 중인 칸
  click: { loc: CursorLoc; at: number } | null;
  at: number; // 마지막 신호(ms)
}

export interface DeptMeta {
  code: string;
  name: string;
  category: string;
  note: string;
  positions: string[];
  hasStore: boolean;
  storePositions: string[];
  salesInput: boolean; // 부서 화면에서 월별 목표매출을 직접 입력(마케팅·영업·온라인고객지원)
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
  viewPasswordHash?: string | null; // 경영지원 계정만 — 급여 열람 비밀번호(해시)
  viewPasswordUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicAccount = Omit<LoginAccount, "passwordHash" | "viewPasswordHash"> & { hasPassword: boolean };

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
