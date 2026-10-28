import { AuthError, requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { departmentPatchSchema } from "@/lib/schemas";
import { getStore, type DeptPatch } from "@/lib/store";
import { BUDGET_YEAR, findDeptMeta } from "@/lib/templates";
import type { BudgetAccount, BudgetRow, PersonRow, Section } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };

export const GET = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  const department = await getDepartment(code);
  if (!department) return fail("없는 부서입니다.", 404);
  return json({ storage: getStore().kind, department });
});

// 구역(계정별 예산·인원정보·목표매출)별로 저장 — 클라이언트가 본 저장 번호와 다르면 409(다른 사람이 먼저 저장)
export const PATCH = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  const user = await requireDept(request, code);
  const meta = findDeptMeta(code);
  if (!meta) return fail("없는 부서입니다.", 404);
  const current = await getDepartment(code);
  if (!current) return fail("없는 부서입니다.", 404);

  const body = departmentPatchSchema.parse(await request.json());
  // 목표매출은 경영지원(통합예산)이 정하는 값
  if (body.sales && user.role !== "admin") throw new AuthError("목표매출은 경영지원 계정만 바꿀 수 있습니다.", 403);
  const expected: Partial<Record<Section, number>> = {};
  const patch: DeptPatch = {};
  if (body.accounts) {
    expected.accounts = body.accounts.revision;
    patch.accounts = body.accounts.data;
    // 팀 계정: 계정과목 구성은 그대로, '경영지원 입력' 줄(급여·4대보험·회사 행사 등)은 손대지 못한다
    if (user.role !== "admin") {
      const names = (list: BudgetAccount[]) => list.map((a) => a.name).join("\u0000");
      if (names(patch.accounts) !== names(current.accounts)) throw new AuthError("계정과목 구성은 바꿀 수 없습니다.", 403);
      const tidy = (o?: Record<string, string>) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)));
      const lockedRows = (rows: BudgetRow[]) =>
        JSON.stringify(rows.filter((r) => r.locked).map((r) => ({ item: r.item, desc: r.desc, values: r.values, formulas: tidy(r.formulas), memos: tidy(r.memos) })));
      patch.accounts.forEach((account, i) => {
        if (lockedRows(account.rows) !== lockedRows(current.accounts[i].rows)) throw new AuthError(`‘${account.name}’의 경영지원 입력 줄은 경영지원만 바꿀 수 있습니다.`, 403);
      });
    }
  }
  if (body.personnel) {
    expected.personnel = body.personnel.revision;
    // 부서코드·부서명은 화면에서 못 바꾸는 값 — 서버에서 다시 채운다(원본 renderPersonnel 과 같음)
    const canonical = (p: PersonRow): PersonRow => ({
      code: meta.code,
      dept: meta.name,
      ...(meta.hasStore ? { store: p.store ?? "" } : {}),
      position: p.position,
      name: p.name,
      values: p.values,
    });
    patch.personnel = body.personnel.data.map(canonical);
    // 인원 구성은 경영지원이 관리 — 팀 계정은 조회만. 단, 영업은 매장 직원(매장 직급) 행만 직접 추가·수정·삭제
    if (user.role !== "admin") {
      if (!meta.hasStore) throw new AuthError("인원정보는 경영지원팀에서 입력합니다.", 403);
      // 직급이 빈 행(원본에서 넘어온 빈칸)도 매장 직원 자리로 본다
      const isStore = (p: PersonRow) => p.position === "" || meta.storePositions.includes(p.position);
      const hq = (rows: PersonRow[]) => JSON.stringify(rows.filter((p) => !isStore(p)).map(canonical));
      if (hq(patch.personnel) !== hq(current.personnel)) throw new AuthError("본사 인원은 경영지원팀에서 입력합니다. 매장 직원만 추가·수정할 수 있습니다.", 403);
    }
  }
  if (body.sales) {
    expected.sales = body.sales.revision;
    patch.salesForecastRows = body.sales.data;
  }
  const deptInput = Boolean(body.accounts || body.personnel);
  const result = await getStore().patchDepartment(BUDGET_YEAR, code, expected, patch, {
    markSaved: deptInput,
    allowClosed: !deptInput, // 목표매출(통합 담당자 입력)만 보낼 때는 마감 후에도 저장
  });
  if (result.ok) return json({ department: result.doc });
  if (result.reason === "closed") return fail("마감된 부서는 수정할 수 없습니다. 통합 대시보드에서 마감을 해제해 주세요.", 423, { department: result.doc });
  if (result.reason === "conflict") return fail("다른 화면에서 먼저 저장한 내용이 있습니다.", 409, { department: result.doc });
  return fail("없는 부서입니다.", 404);
});
