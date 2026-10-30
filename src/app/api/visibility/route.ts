import { z } from "zod";
import { requireAdmin, requireDept } from "@/lib/auth/guard";
import { accountMonths, money, sum } from "@/lib/budget";
import { listDepartments } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR, findDeptMeta } from "@/lib/templates";
import { hiddenAccountsFor } from "@/lib/visibility";

// 계정과목 노출 설정
//   GET ?dept=0005 → 그 부서에 숨긴 계정과목(팀·경영지원)   GET → 전체 표(경영지원)
//   PUT → 전체 표 저장(경영지원). 금액이 들어 있는 부서에는 숨길 수 없다(팀이 못 보는 금액이 합계에 남지 않게)
export const GET = handle(async (request: Request) => {
  const dept = new URL(request.url).searchParams.get("dept");
  const visibility = await getStore().getVisibility(BUDGET_YEAR);
  if (dept) {
    await requireDept(request, dept);
    return json({ hidden: await hiddenAccountsFor(dept), revision: visibility?.revision ?? 0 });
  }
  await requireAdmin(request);
  return json({ hidden: visibility?.hidden ?? {}, revision: visibility?.revision ?? 0 });
});

const schema = z.object({
  revision: z.number().int().min(0),
  hidden: z.record(z.string().max(100), z.array(z.string().regex(/^\d{4}$/)).max(20)),
});

export const PUT = handle(async (request: Request) => {
  await requireAdmin(request);
  const body = schema.parse(await request.json());
  const departments = await listDepartments();
  const names = new Set(departments.flatMap((d) => d.accounts.map((a) => a.name)));
  const hidden: Record<string, string[]> = {};
  for (const [name, codes] of Object.entries(body.hidden)) {
    if (!names.has(name)) return fail(`‘${name}’ 계정과목이 없습니다.`);
    const unique = [...new Set(codes)].filter((code) => findDeptMeta(code));
    for (const code of unique) {
      const doc = departments.find((d) => d.code === code);
      const account = doc?.accounts.find((a) => a.name === name);
      const total = account ? sum(accountMonths(account)) : 0;
      if (total !== 0) return fail(`${doc!.name} ‘${name}’에 금액(${money(total)}원)이 있어 숨길 수 없습니다. 금액을 0으로 만든 뒤 숨겨 주세요.`);
    }
    if (unique.length) hidden[name] = unique;
  }
  const result = await getStore().saveVisibility(BUDGET_YEAR, body.revision, hidden);
  if (!result.ok) return fail("다른 화면에서 먼저 바꿨습니다. 최신 설정을 불러왔습니다.", 409, { hidden: result.doc?.hidden ?? {}, revision: result.doc?.revision ?? 0 });
  return json({ hidden: result.doc!.hidden, revision: result.doc!.revision });
});
