import type { NextRequest } from "next/server";
import { requireDept } from "@/lib/auth/guard";
import { MASTER_ID } from "@/lib/auth/local";
import { isSensitiveAccount } from "@/lib/budget";
import { getDepartment } from "@/lib/departments";
import { accountWorkbook, departmentWorkbook } from "@/lib/excel";
import { mergeUpload, readBudgetWorkbook } from "@/lib/excelImport";
import { fail, handle, json } from "@/lib/http";
import { BUDGET_YEAR } from "@/lib/templates";
import type { BudgetAccount } from "@/lib/types";
import { maskAccountsForTeam } from "@/lib/sensitive";
import { hiddenAccountsFor } from "@/lib/visibility";

type Context = { params: Promise<{ code: string }> };

const MAX_UPLOAD_MB = 5;

// 엑셀 내려받기 — ?account=번호 면 그 계정 상세, 없으면 부서 전체(계정별 요약 + 상세 내역)
export const GET = handle(async (request: NextRequest, { params }: Context) => {
  const { code } = await params;
  const user = await requireDept(request, code);
  const doc = await getDepartment(code);
  if (!doc) return fail("없는 부서입니다.", 404);
  const hidden = user.role === "admin" ? [] : await hiddenAccountsFor(code);
  // 경영지원 전용 계정(급여 등): 팀은 빼고, 경영지원은 화면에서 비밀번호를 확인한 뒤(sensitive=1)에만 넣는다
  const withSensitive = user.role === "admin" && (user._id === MASTER_ID || request.nextUrl.searchParams.get("sensitive") === "1");
  const excluded = (a: BudgetAccount) => hidden.includes(a.name) || (!withSensitive && isSensitiveAccount(a));

  const index = request.nextUrl.searchParams.get("account");
  let buffer: Buffer;
  let fileName: string;
  if (index !== null) {
    const account = doc.accounts[Number(index)];
    if (!account || excluded(account)) return fail("없는 계정과목입니다.", 404);
    buffer = await accountWorkbook({ year: BUDGET_YEAR, deptName: doc.name, account });
    fileName = `${BUDGET_YEAR}_${doc.name}_${account.name}_상세예산.xlsx`;
  } else {
    buffer = await departmentWorkbook({ year: BUDGET_YEAR, deptName: doc.name, deptCode: doc.code, accounts: doc.accounts.filter((a) => !excluded(a)) });
    fileName = `${BUDGET_YEAR}_${doc.name}_계정별예산.xlsx`;
  }
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="budget.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
});

// 엑셀 업로드 — 파일을 읽어 지금 계정별 예산에 합친 결과와 요약을 돌려준다(저장은 화면에서 확인한 뒤 평소 저장 경로로)
export const POST = handle(async (request: NextRequest, { params }: Context) => {
  const { code } = await params;
  const user = await requireDept(request, code);
  const doc = await getDepartment(code);
  if (!doc) return fail("없는 부서입니다.", 404);
  if (doc.closed) return fail("마감된 부서는 엑셀로 반영할 수 없습니다.", 423);
  const data = await request.arrayBuffer();
  if (!data.byteLength) return fail("파일이 비어 있습니다.");
  if (data.byteLength > MAX_UPLOAD_MB * 1024 * 1024) return fail(`엑셀은 ${MAX_UPLOAD_MB}MB 까지 올릴 수 있습니다.`, 413);
  const { rows, problems } = await readBudgetWorkbook(data);
  const hidden = user.role === "admin" ? [] : await hiddenAccountsFor(code);
  const { accounts, summary } = mergeUpload(doc.accounts, rows, { canEditLocked: user.role === "admin", hidden });
  return json({ accounts: user.role === "admin" ? accounts : maskAccountsForTeam(accounts), summary, problems: problems.slice(0, 20), revision: doc.revisions.accounts });
});
