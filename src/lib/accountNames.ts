import "server-only";
import { zeros } from "./budget";
import { listDepartments } from "./departments";
import { getStore } from "./store";
import { BUDGET_YEAR } from "./templates";
import type { BudgetAccount, DepartmentDoc } from "./types";

// 설정 > 계정과목 노출의 추가·수정·삭제 — 계정과목은 전 부서 공통이라 부서 문서를 모두 고친다.
//   저장 번호를 올려서 열려 있는 화면은 새로 받고, 옛 화면이 덮어쓰려 하면 충돌로 돌아간다.

export class AccountNameError extends Error {}

const norm = (name: string) => name.replace(/\s/g, "");
const hasName = (doc: DepartmentDoc, name: string) => doc.accounts.some((a) => a.name === name);

// 부서 하나가 실패하면 오류 — 다시 누르면 이미 바뀐 부서는 건너뛰고 이어서 한다(change 가 null)
async function patchEveryDept(departments: DepartmentDoc[], change: (accounts: BudgetAccount[]) => BudgetAccount[] | null) {
  const store = getStore();
  for (const listed of departments) {
    let doc: DepartmentDoc | null = listed;
    for (let attempt = 0; doc; attempt++) {
      const accounts = change(doc.accounts);
      if (!accounts) break;
      const result = await store.patchDepartment(BUDGET_YEAR, doc.code, { accounts: doc.revisions.accounts }, { accounts }, { markSaved: false, allowClosed: true, by: "admin" });
      if (result.ok) break;
      if (attempt >= 3) throw new AccountNameError(`${doc.name} 저장이 겹쳐 처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.`);
      doc = result.doc;
    }
  }
}

// 노출 설정은 계정과목 이름을 키로 쓴다
async function changeHidden(change: (hidden: Record<string, string[]>) => Record<string, string[]>) {
  const store = getStore();
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await store.getVisibility(BUDGET_YEAR);
    const result = await store.saveVisibility(BUDGET_YEAR, current?.revision ?? 0, change(current?.hidden ?? {}));
    if (result.ok && result.doc) return { hidden: result.doc.hidden, revision: result.doc.revision };
  }
  throw new AccountNameError("노출 설정 저장이 겹쳐 처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
}

// 새 계정과목 — 상세 창에서 바로 금액을 넣을 수 있게 빈 줄 하나로 시작
export async function addAccountName(name: string) {
  const departments = await listDepartments();
  const similar = departments.some((d) => d.accounts.some((a) => a.name !== name && norm(a.name) === norm(name)));
  if (similar || departments.every((d) => hasName(d, name))) throw new AccountNameError(`‘${name}’ 계정과목이 이미 있습니다.`);
  await patchEveryDept(departments, (accounts) => (accounts.some((a) => a.name === name) ? null : [...accounts, { name, rows: [{ item: name, desc: "", values: zeros(), formulas: {}, memos: {}, custom: true }] }]));
  return changeHidden((hidden) => hidden);
}

// 이름 수정 — 금액·수정 기록은 그대로. 손익 전년 값(원본 손익표)은 원래 이름(origin)으로 계속 찾는다
export async function renameAccountName(from: string, to: string) {
  const departments = await listDepartments();
  if (!departments.some((d) => hasName(d, from))) throw new AccountNameError(`‘${from}’ 계정과목이 없습니다.`);
  if (from === to) return changeHidden((hidden) => hidden);
  // 같은 부서에 이미 그 이름이 있으면 안 된다(공백만 다른 이름도 같은 것으로 본다). 자기 이름의 띄어쓰기만 고치는 것은 허용
  const taken = (d: DepartmentDoc) => d.accounts.some((a) => a.name !== from && norm(a.name) === norm(to));
  if (departments.some((d) => hasName(d, from) && taken(d))) throw new AccountNameError(`‘${to}’ 계정과목이 이미 있습니다.`);
  await patchEveryDept(departments, (accounts) => (accounts.some((a) => a.name === from) ? accounts.map((a) => (a.name === from ? { ...a, name: to, origin: a.origin ?? from } : a)) : null));
  await getStore().renameReviewAccount(BUDGET_YEAR, from, to);
  return changeHidden(({ [from]: codes, ...rest }) => (codes ? { ...rest, [to]: codes } : rest));
}

// 삭제 — 금액·메모가 남은 부서가 있으면 막는다(합계가 줄고 적어 둔 근거가 사라지므로)
export async function deleteAccountName(name: string) {
  const departments = await listDepartments();
  const filled = departments.filter((d) => d.accounts.find((a) => a.name === name)?.rows.some((r) => r.values.some((v) => v !== 0) || Object.values(r.memos ?? {}).some((m) => m?.trim())));
  if (filled.length) throw new AccountNameError(`${filled.map((d) => d.name).join("·")}에 금액이나 메모가 있어 삭제할 수 없습니다. 부서 탭 상세 창에서 지운 뒤 삭제해 주세요.`);
  if (departments.some((d) => hasName(d, name) && d.accounts.length <= 1)) throw new AccountNameError("계정과목이 하나뿐이라 삭제할 수 없습니다.");
  await patchEveryDept(departments, (accounts) => (accounts.some((a) => a.name === name) ? accounts.filter((a) => a.name !== name) : null));
  return changeHidden(({ [name]: _removed, ...rest }) => rest);
}
