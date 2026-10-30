"use client";

import { useDepartment } from "@/hooks/useDepartment";
import { MONTHS, money, rowTotal, salesMonths, sum } from "@/lib/budget";
import type { DepartmentDoc, DeptMeta, SalesRow } from "@/lib/types";
import { MoneyInput } from "../budget/MoneyInput";

// 전체 매출 현황 — 부서별 월별 목표매출을 한 표에서 바로 고친다(경영지원). 고친 값은 매출 예산안 채널에 합산
export function DeptSalesOverview({ metas, departments, kinds, onSaved }: { metas: DeptMeta[]; departments: DepartmentDoc[]; kinds: string[]; onSaved: () => void }) {
  // 입력 담당 부서(마케팅·영업·온라인고객지원) + 목표매출이 이미 있는 부서
  const shown = metas.filter((m) => m.salesInput || departments.find((d) => d.code === m.code)?.salesForecastRows.length);
  const grand = MONTHS.map((_, m) => departments.reduce((t, d) => t + salesMonths(d.salesForecastRows)[m], 0));

  return (
    <section className="panel" data-anchor="dept-sales">
      <div className="panel-head">
        <h3>부서별 월별 목표매출</h3>
        <span className="muted">단위: 원 · 칸을 고치면 바로 저장되어 아래 매출 예산안 채널에 합산 · 마케팅·영업·온라인고객지원은 부서 화면에서도 입력</span>
      </div>
      <div className="tablewrap free">
        <table className="sales-table dept-sales-table">
          <colgroup>
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
            {MONTHS.map((m) => (
              <col key={m} />
            ))}
            <col style={{ width: 120 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th>부서</th>
              <th>매출 구분</th>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>연간 합계</th>
              <th aria-label="관리" />
            </tr>
          </thead>
          {shown.map((meta) => (
            <DeptSalesGroup key={meta.code} meta={meta} kinds={kinds} onSaved={onSaved} />
          ))}
          <tfoot>
            <tr>
              <td colSpan={2}>전체 합계</td>
              {grand.map((v, m) => (
                <td key={m}>{money(v)}</td>
              ))}
              <td>{money(sum(grand))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// 부서 하나 = tbody 하나. 부서 문서를 따로 불러 고치고 자동 저장(충돌·마감 처리는 useDepartment 가 맡음)
function DeptSalesGroup({ meta, kinds, onSaved }: { meta: DeptMeta; kinds: string[]; onSaved: () => void }) {
  const state = useDepartment(meta.code, { onSaved });
  const { doc, update, conflict, saveError, resolveConflict } = state;
  if (!doc)
    return (
      <tbody className="dept-group">
        <tr>
          <td className="dept-cell">{meta.name}</td>
          <td colSpan={15} className="muted">
            {state.loadError ?? "불러오는 중…"}
          </td>
        </tr>
      </tbody>
    );
  const rows = doc.salesForecastRows;
  const months = salesMonths(rows);
  const setRows = (fn: (rows: SalesRow[]) => SalesRow[]) => update("sales", fn);
  const deptCell = (
    <td className="dept-cell" rowSpan={rows.length + 1}>
      <b>{meta.name}</b>
    </td>
  );

  return (
    <tbody className="dept-group">
      {rows.map((r, i) => (
        <tr key={i}>
          {i === 0 && deptCell}
          <td>
            <select value={r.kind} aria-label={`${meta.name} 매출 구분`} onChange={(e) => setRows((list) => list.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>
              {(kinds.includes(r.kind) ? kinds : [r.kind, ...kinds]).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </td>
          {r.values.map((v, m) => (
            <td key={m}>
              <MoneyInput
                value={v}
                label={`${meta.name} ${r.kind} ${MONTHS[m]} 목표매출`}
                onCommit={(value) => setRows((list) => list.map((x, k) => (k === i ? { ...x, values: x.values.map((y, n) => (n === m ? Math.max(0, value) : y)) } : x)))}
              />
            </td>
          ))}
          <td>
            <b>{money(rowTotal(r))}</b>
          </td>
          <td>
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm(`${meta.name} ‘${r.kind}’ 목표매출 행을 삭제할까요?`)) setRows((list) => list.filter((_, k) => k !== i));
              }}
            >
              삭제
            </button>
          </td>
        </tr>
      ))}
      <tr className="subtotal">
        {rows.length === 0 && deptCell}
        <td>{rows.length ? `${meta.name} 소계` : "목표매출 없음"}</td>
        {months.map((v, m) => (
          <td key={m}>{money(v)}</td>
        ))}
        <td>{money(sum(months))}</td>
        <td>
          {conflict ? (
            <button type="button" className="danger" title="다른 화면에서 먼저 저장했습니다 — 최신 값을 불러옵니다" onClick={() => resolveConflict("reload")}>
              충돌
            </button>
          ) : saveError ? (
            <span className="chip err" title={saveError}>
              실패
            </span>
          ) : null}
        </td>
      </tr>
    </tbody>
  );
}
