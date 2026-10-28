import { requireAdmin } from "@/lib/auth/guard";
import { accountsTotal, rowTotal, sum } from "@/lib/budget";
import { getDepartment, getRevenuePlan } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { parseLegacyHtml } from "@/lib/legacyImport";
import { getStore, type DeptPatch } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";
import type { Section } from "@/lib/types";

// 기존 HTML 작성본 옮기기 — form-data: file + mode(preview|apply) + depts(적용할 부서코드, 쉼표) + fees(1=수수료도)
export const POST = handle(async (request: Request) => {
  await requireAdmin(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("HTML 작성본 파일을 골라 주세요.");
  const parsed = parseLegacyHtml(await file.text());

  if (form.get("mode") !== "apply") {
    const departments = await Promise.all(
      parsed.departments.map(async (d) => {
        const current = await getDepartment(d.code);
        return {
          code: d.code,
          name: d.name,
          closed: Boolean(current?.closed),
          currentTotal: current ? accountsTotal(current.accounts) : 0,
          accountsTotal: d.accounts ? accountsTotal(d.accounts) : null,
          accountRows: d.accounts ? d.accounts.reduce((n, a) => n + a.rows.length, 0) : 0,
          personnel: d.personnel?.length ?? null,
          headcount: d.personnel ? sum(d.personnel.map((p) => Math.max(...p.values))) : null,
          salesTotal: d.salesForecastRows ? sum(d.salesForecastRows.map(rowTotal)) : null,
          attachments: d.attachments.sales.length + d.attachments.expenses.length,
        };
      }),
    );
    return json({ kind: parsed.kind, fileName: file.name, departments, fees: Boolean(parsed.fees), skipped: parsed.skipped });
  }

  const selected = new Set(String(form.get("depts") || "").split(",").filter(Boolean));
  const store = getStore();
  const applied: string[] = [];
  const skipped: string[] = [...parsed.skipped];
  for (const d of parsed.departments) {
    if (!selected.has(d.code)) continue;
    const current = await getDepartment(d.code);
    if (!current) continue;
    if (current.closed) {
      skipped.push(`${d.name}(마감됨)`);
      continue;
    }
    const expected: Partial<Record<Section, number>> = {};
    const patch: DeptPatch = {};
    if (d.accounts) {
      expected.accounts = current.revisions.accounts;
      patch.accounts = d.accounts;
    }
    if (d.personnel) {
      expected.personnel = current.revisions.personnel;
      patch.personnel = d.personnel;
    }
    if (d.salesForecastRows) {
      expected.sales = current.revisions.sales;
      patch.salesForecastRows = d.salesForecastRows;
    }
    if (Object.keys(expected).length) {
      const result = await store.patchDepartment(BUDGET_YEAR, d.code, expected, patch, { markSaved: true, allowClosed: false });
      if (!result.ok) {
        skipped.push(`${d.name}(${result.reason === "closed" ? "마감됨" : "저장 충돌 — 다시 시도"})`);
        continue;
      }
    }
    // 첨부는 파일에 들어 있는 구분만 교체(빈 목록이면 기존 첨부를 지우지 않는다)
    for (const kind of ["sales", "expenses"] as const) {
      const files = d.attachments[kind];
      if (!files.length) continue;
      for (const old of await store.listAttachments(BUDGET_YEAR, d.code)) if (old.kind === kind) await store.deleteAttachment(old.id);
      for (const f of files) {
        await store.addAttachment({ year: BUDGET_YEAR, deptCode: d.code, kind, name: f.name, type: f.type, size: f.size, uploadedAt: new Date().toISOString() }, f.data);
      }
    }
    applied.push(d.name);
  }
  if (parsed.fees && form.get("fees") === "1") {
    const plan = await getRevenuePlan(BUDGET_YEAR);
    await store.savePlanRows(BUDGET_YEAR, plan.revision, { fees: parsed.fees });
    applied.push("매출 수수료");
  }
  return json({ applied, skipped });
});
