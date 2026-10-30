import "server-only";
import { isSensitiveAccount, zeros } from "./budget";
import type { AccountEdit, BudgetAccount, DepartmentDoc } from "./types";

// 경영지원 전용 계정(전 줄이 '경영지원 입력' — 직원급여·퇴직급여·세금과공과금 등)
//   팀 계정에는 금액·계산식·메모를 아예 보내지 않는다(화면·엑셀·실시간 반영 모두). 경영지원은 화면에서 비밀번호를 한 번 더 넣어야 보임.

const noIp = (edit?: AccountEdit) => (edit ? { ...edit, ip: "" } : undefined);

export function maskAccountsForTeam(accounts: BudgetAccount[]): BudgetAccount[] {
  return accounts.map((a) =>
    isSensitiveAccount(a)
      ? { ...a, masked: true, lastEdit: noIp(a.lastEdit), rows: a.rows.map((r) => ({ ...r, values: zeros(), formulas: {}, memos: {} })) }
      : { ...a, lastEdit: noIp(a.lastEdit) },
  );
}

export const maskForTeam = (doc: DepartmentDoc): DepartmentDoc => ({ ...doc, accounts: maskAccountsForTeam(doc.accounts) });

// 수정 기록에 남길 접속 IP(배포 서버는 x-forwarded-for 첫 값이 실제 접속 주소)
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}
