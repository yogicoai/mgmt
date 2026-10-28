import type { NextRequest } from "next/server";
import { requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { accountWorkbook, departmentWorkbook } from "@/lib/excel";
import { fail, handle } from "@/lib/http";
import { BUDGET_YEAR } from "@/lib/templates";

type Context = { params: Promise<{ code: string }> };

// 엑셀 내려받기 — ?account=번호 면 그 계정 상세, 없으면 부서 전체(계정별 요약 + 상세 내역)
export const GET = handle(async (request: NextRequest, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  const doc = await getDepartment(code);
  if (!doc) return fail("없는 부서입니다.", 404);

  const index = request.nextUrl.searchParams.get("account");
  let buffer: Buffer;
  let fileName: string;
  if (index !== null) {
    const account = doc.accounts[Number(index)];
    if (!account) return fail("없는 계정과목입니다.", 404);
    buffer = await accountWorkbook({ year: BUDGET_YEAR, deptName: doc.name, account });
    fileName = `${BUDGET_YEAR}_${doc.name}_${account.name}_상세예산.xlsx`;
  } else {
    buffer = await departmentWorkbook({ year: BUDGET_YEAR, deptName: doc.name, deptCode: doc.code, accounts: doc.accounts });
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
