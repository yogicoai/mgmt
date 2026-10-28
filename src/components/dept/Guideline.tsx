"use client";

import { MONTHS, money, rowTotal, salesMonths, sum } from "@/lib/budget";
import type { ActualsResult, SalesRow } from "@/lib/types";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// 가이드라인 1번의 빈 월 표 자리에 이 부서 목표매출(확정 금액)을 넣는다 — 원본 renderGuideline 과 같음
function salesTableHtml(rows: SalesRow[], actuals: ActualsResult | null) {
  if (!rows.length) return `<p class="editor-help">이 부서에 배정된 목표매출이 없습니다.</p>`;
  const cells = (values: (number | null)[]) => values.map((v) => `<td>${v === null ? "" : money(v)}</td>`).join("");
  const totals = salesMonths(rows);
  const actualRows: string[] = [];
  if (actuals?.configured && !actuals.error) {
    for (const [kind, values] of [
      ["온라인", actuals.online],
      ["오프라인", actuals.offline],
    ] as const) {
      if (!rows.some((r) => r.kind === kind)) continue;
      actualRows.push(`<tr class="actual"><th>${actuals.year} 실적 · ${kind}</th>${cells(values)}<td>${money(sum(values))}</td></tr>`);
    }
  }
  return (
    `<div class="guide-table-scroll"><table class="guideline-sales"><colgroup><col style="width:120px">${MONTHS.map(() => "<col>").join("")}<col style="width:120px"></colgroup>` +
    `<thead><tr><th>구분</th>${MONTHS.map((m) => `<th>${m}</th>`).join("")}<th>연간 합계</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.kind)}</td>${cells(r.values)}<td>${money(rowTotal(r))}</td></tr>`).join("") +
    `<tr class="sum"><th>합계</th>${cells(totals)}<td>${money(sum(totals))}</td></tr>` +
    actualRows.join("") +
    `</tbody></table></div><p class="editor-help">단위: 원 · 목표매출은 확정 금액입니다(통합 대시보드에서 관리).${
      actualRows.length ? ` 실적은 onlineData 기준(온라인=이카운트 출고, 오프라인=매장 주문서)이며 ${esc(actuals?.lastDate ?? "")}까지입니다.` : ""
    }</p>`
  );
}

export function Guideline({ guide, salesRows, actuals }: { guide: string; salesRows: SalesRow[]; actuals: ActualsResult | null }) {
  const html = guide.replace(/<div class="guide-table-scroll">[\s\S]*?<\/table><\/div>/, salesTableHtml(salesRows, actuals));
  return (
    <>
      <div className="reference-intro">
        <h2>2027년 예산 작성 가이드라인</h2>
        <p>
          2026년 예산 파일의 작성 기준을 참고용으로 옮겼습니다. 금액 기준·월별 일정·요율은 원본 기준이며 2027년 확정 기준은 아닙니다. 입력한 값은 바로 저장되어 통합 예산에 합산됩니다.
        </p>
      </div>
      {/* 원본 HTML 에서 옮긴 고정 안내문 + 위에서 만든 표(값은 모두 escape) */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
