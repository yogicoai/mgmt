"use client";

import { MONTHS, money, rowTotal, salesMonths, sum, zeros } from "@/lib/budget";
import type { SalesRow } from "@/lib/types";
import { MoneyInput } from "./MoneyInput";

// 조회 전용 참고 줄(예: 2026 실적)
export interface SalesReference {
  label: string;
  values: number[];
}

// 다음에 추가할 매출 구분 — 아직 안 쓴 채널부터
export const nextSalesRow = (rows: SalesRow[], kinds: string[]): SalesRow => ({ kind: kinds.find((k) => !rows.some((r) => r.kind === k)) ?? kinds[0], values: zeros() });

// 월별 목표매출 표 — 매출 구분(=통합 매출 예산안 채널)별 12개월. 통합 화면(경영지원)과 부서 화면(마케팅·영업·온라인고객지원)이 같이 쓴다
export function SalesEditor({
  deptName,
  rows,
  kinds,
  editable,
  onChange,
  references = [],
  emptyText,
}: {
  deptName: string;
  rows: SalesRow[];
  kinds: string[];
  editable: boolean;
  onChange: (updater: (rows: SalesRow[]) => SalesRow[]) => void;
  references?: SalesReference[];
  emptyText?: string;
}) {
  const months = salesMonths(rows);
  const setValue = (i: number, m: number, value: number) =>
    onChange((list) => list.map((x, k) => (k === i ? { ...x, values: x.values.map((y, n) => (n === m ? Math.max(0, value) : y)) } : x)));

  return (
    <div className="tablewrap free">
      <table className="sales-table">
        <colgroup>
          <col style={{ width: 150 }} />
          {MONTHS.map((m) => (
            <col key={m} />
          ))}
          <col style={{ width: 120 }} />
          {editable && <col style={{ width: 60 }} />}
        </colgroup>
        <thead>
          <tr>
            <th>매출 구분</th>
            {MONTHS.map((m) => (
              <th key={m}>{m}</th>
            ))}
            <th>연간 합계</th>
            {editable && <th aria-label="삭제" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {editable ? (
                  <select value={r.kind} aria-label="매출 구분" onChange={(e) => onChange((list) => list.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>
                    {(kinds.includes(r.kind) ? kinds : [r.kind, ...kinds]).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : (
                  <b>{r.kind}</b>
                )}
              </td>
              {r.values.map((v, m) => (
                <td key={m}>{editable ? <MoneyInput value={v} label={`${r.kind} ${MONTHS[m]} 목표매출`} onCommit={(value) => setValue(i, m, value)} /> : money(v)}</td>
              ))}
              <td>
                <b>{money(rowTotal(r))}</b>
              </td>
              {editable && (
                <td>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (confirm(`‘${r.kind}’ 목표매출 행을 삭제할까요?`)) onChange((list) => list.filter((_, k) => k !== i));
                    }}
                  >
                    삭제
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={15} className="empty">
                {emptyText ?? `${deptName}에 배정된 목표매출이 없습니다.`}
              </td>
            </tr>
          )}
          {references.map((r) => (
            <tr key={r.label} className="reference">
              <td>{r.label}</td>
              {r.values.map((v, m) => (
                <td key={m}>{money(v)}</td>
              ))}
              <td>{money(sum(r.values))}</td>
              {editable && <td />}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{deptName} 합계</td>
            {months.map((v, m) => (
              <td key={m}>{money(v)}</td>
            ))}
            <td>{money(sum(months))}</td>
            {editable && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
