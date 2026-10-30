import "server-only";
import { getStore } from "./store";
import { BUDGET_YEAR } from "./templates";

// 계정과목 노출 — 이 부서에 숨긴 계정과목 이름들(팀 화면·엑셀·저장 규칙에서 쓴다)
export async function hiddenAccountsFor(code: string, year = BUDGET_YEAR): Promise<string[]> {
  const visibility = await getStore().getVisibility(year);
  if (!visibility) return [];
  return Object.entries(visibility.hidden)
    .filter(([, codes]) => codes.includes(code))
    .map(([name]) => name);
}
