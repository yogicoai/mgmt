"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActualsResult, SalesRow } from "@/lib/types";
import { SalesEditor, nextSalesRow, type SalesReference } from "../budget/SalesEditor";

// 가이드라인 1번(월별 예상매출액)의 빈 월 표 자리 — 이 부서 목표매출 표를 끼워 넣는다(원본 renderGuideline 과 같은 위치)
const SALES_SLOT = '<div class="guide-sales-slot"></div>';

export function Guideline({
  guide,
  deptName,
  salesRows,
  salesKinds,
  salesEditable,
  onSalesChange,
  actuals,
}: {
  guide: string;
  deptName: string;
  salesRows: SalesRow[];
  salesKinds: string[];
  salesEditable: boolean; // 마케팅·영업·온라인고객지원 + 경영지원
  onSalesChange: (updater: (rows: SalesRow[]) => SalesRow[]) => void;
  actuals: ActualsResult | null;
}) {
  const html = useMemo(() => guide.replace(/<div class="guide-table-scroll">[\s\S]*?<\/table><\/div>/, SALES_SLOT), [guide]);
  // 같은 객체를 넘겨야 React 가 다시 그릴 때 HTML 을 새로 쓰지 않는다(새로 쓰면 표를 넣은 자리가 사라짐)
  const inner = useMemo(() => ({ __html: html }), [html]);
  const box = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(box.current?.querySelector<HTMLElement>(".guide-sales-slot") ?? null), [html]);

  const references: SalesReference[] = [];
  if (actuals?.configured && !actuals.error) {
    for (const [kind, values] of [
      ["온라인", actuals.online],
      ["오프라인", actuals.offline],
    ] as const) {
      if (salesRows.some((r) => r.kind === kind)) references.push({ label: `${actuals.year} 실적 · ${kind}`, values: values.map((v) => v ?? 0) });
    }
  }

  const sales = (
    <div className="guide-sales">
      {salesEditable && (
        <div className="toolbar">
          <span className="muted">월별 목표매출을 입력하면 바로 저장되어 통합 대시보드 전체 매출 현황에 합산됩니다</span>
          <div className="actions">
            <button type="button" className="primary" onClick={() => onSalesChange((list) => [...list, nextSalesRow(list, salesKinds)])}>
              매출 행 추가
            </button>
          </div>
        </div>
      )}
      <SalesEditor
        deptName={deptName}
        rows={salesRows}
        kinds={salesKinds}
        editable={salesEditable}
        onChange={onSalesChange}
        references={references}
        emptyText={salesEditable ? "‘매출 행 추가’로 매출 구분을 고르고 월별 금액을 입력하세요." : "이 부서에 배정된 목표매출이 없습니다."}
      />
      <p className="editor-help">
        단위: 원 · {salesEditable ? "매출 구분은 통합 매출 예산안의 채널과 같아야 합산됩니다." : "목표매출은 통합 대시보드에서 경영지원이 관리합니다."}
        {references.length ? ` 실적은 onlineData 기준(온라인=이카운트 출고, 오프라인=매장 주문서)이며 ${actuals?.lastDate ?? ""}까지입니다.` : ""}
      </p>
    </div>
  );

  return (
    <>
      <div className="reference-intro">
        <h2>2027년 예산 작성 가이드라인</h2>
        <p>
          2026년 예산 파일의 작성 기준을 참고용으로 옮겼습니다. 금액 기준·월별 일정·요율은 원본 기준이며 2027년 확정 기준은 아닙니다. 입력한 값은 바로 저장되어 통합 예산에 합산됩니다.
        </p>
      </div>
      {/* 원본 HTML 에서 옮긴 고정 안내문 — 1번 표 자리에는 아래 목표매출 표가 들어간다 */}
      <div ref={box} data-anchor="guide" dangerouslySetInnerHTML={inner} />
      {slot ? createPortal(sales, slot) : html.includes(SALES_SLOT) ? null : sales}
    </>
  );
}
