"use client";

import { useEffect, useRef, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { useLongPressDrag, type RowDrag } from "@/hooks/useLongPressDrag";
import { MONTHS, money, rowTotal, salesDeptName, salesMonths, sortByOrder, sum } from "@/lib/budget";
import type { DepartmentDoc, DeptMeta, SalesRow } from "@/lib/types";
import { MoneyInput } from "../budget/MoneyInput";
import { OrderSaveBar, useUi } from "../ui";

const DRAG_HINT = "누른 채 위아래로 끌면 순서가 바뀝니다";

// 전체 매출 현황 — 부서별 월별 목표매출을 한 표에서 바로 고친다(경영지원). 고친 값은 매출 예산안 채널에 합산
//   순서: 부서 칸을 끌면 부서 순서(매출 예산안에 저장), 매출 구분 칸을 끌면 그 부서 안 줄 순서(부서 문서에 저장 — 부서 화면도 같은 순서). [변경내용 저장]을 눌러야 반영
export function DeptSalesOverview({
  metas,
  departments,
  kinds,
  kindNames,
  deptOrder,
  onSaveDeptOrder,
  onSaved,
}: {
  metas: DeptMeta[];
  departments: DepartmentDoc[];
  kinds: string[];
  kindNames: Record<string, string>; // 매출 예산안에서 고친 구분명(표시만)
  deptOrder?: string[];
  onSaveDeptOrder: (order: string[]) => Promise<boolean>;
  onSaved: () => void;
}) {
  const { notify } = useUi();
  const { drag, press } = useLongPressDrag();
  const tableRef = useRef<HTMLTableElement>(null);
  // 끌어서 바꾼 순서 — [변경내용 저장]을 눌러야 저장
  const [pendingDepts, setPendingDepts] = useState<string[] | null>(null);
  const [pendingRows, setPendingRows] = useState<Record<string, number[]>>({});
  const rowSavers = useRef(new Map<string, (order: number[]) => void>());
  // 입력 담당 부서(마케팅·영업·온라인고객지원) + 목표매출이 이미 있는 부서
  const listed = metas.filter((m) => m.salesInput || departments.find((d) => d.code === m.code)?.salesForecastRows.length);
  const shown = sortByOrder(listed, drag?.group === "depts" ? drag.order : (pendingDepts ?? deptOrder), (m) => m.code);
  const grand = MONTHS.map((_, m) => departments.reduce((t, d) => t + salesMonths(d.salesForecastRows)[m], 0));
  const [editing, setEditing] = useState(false); // 평소 고정, [수정]을 눌러야 입력
  const dirty = Boolean(pendingDepts) || Object.keys(pendingRows).length > 0;
  const codes = shown.map((m) => m.code);
  const dropDepts = (order: string[]) => {
    const saved = sortByOrder(listed, deptOrder, (m) => m.code).map((m) => m.code);
    setPendingDepts(order.join() === saved.join() ? null : order); // 제자리로 돌아오면 저장할 것 없음
  };
  const setRowOrder = (code: string, order: number[] | null) =>
    setPendingRows((all) => {
      if (!order && !all[code]) return all;
      const { [code]: _old, ...rest } = all;
      return order ? { ...rest, [code]: order } : rest;
    });
  const cancelOrder = () => {
    setPendingDepts(null);
    setPendingRows({});
  };
  const saveOrder = async () => {
    if (pendingDepts && !(await onSaveDeptOrder(pendingDepts))) return false;
    for (const [code, order] of Object.entries(pendingRows)) rowSavers.current.get(code)?.(order);
    cancelOrder();
    notify("변경 내용을 저장했습니다.");
    return true;
  };

  return (
    <section className="panel" data-anchor="dept-sales">
      <div className="panel-head">
        <h3>부서별 월별 목표매출</h3>
        <div className="actions">
          <span className="muted">
            단위: 원 · {editing ? "칸을 고치면 바로 저장되어 아래 매출 예산안 채널에 합산 — 다 고쳤으면 [고정]" : "부서·매출 구분 칸을 누른 채 위아래로 끈 뒤 [변경내용 저장] · [수정]을 눌러야 입력 · 마케팅·영업·온라인고객지원은 부서 화면에서도 입력"}
          </span>
          {dirty && <OrderSaveBar onSave={() => void saveOrder()} onCancel={cancelOrder} />}
          <button
            type="button"
            className="primary"
            onClick={async () => {
              // 순서를 바꾼 채 [고정]을 누르면 저장까지
              if (editing && dirty && !(await saveOrder())) return;
              setEditing((v) => !v);
            }}
            aria-pressed={editing}
          >
            {editing ? "고정" : "수정"}
          </button>
        </div>
      </div>
      <div className="tablewrap free">
        <table className={`sales-table dept-sales-table fit-table${drag ? " is-dragging" : ""}`} ref={tableRef}>
          <colgroup>
            {/* 부서·매출 구분 칸은 글자 크기에 맞춤 — % 면 큰 화면에서 빈칸만 커진다. 평소엔 끌기 표시(⋮⋮) 몫만큼 더, [수정] 중엔 금액 칸에 양보 */}
            <col style={{ width: `calc(var(--num-font) * ${editing ? 7.2 : 8.2} + 13px)` }} />
            <col style={{ width: `calc(var(--num-font) * ${editing ? 9 : 9.8} + 20px)` }} />
            {MONTHS.map((m) => (
              <col key={m} />
            ))}
            <col style={{ width: editing ? "9.2%" : "9.8%" }} />
            {editing && <col style={{ width: "5.2%" }} />}
          </colgroup>
          <thead>
            <tr>
              <th>부서</th>
              <th>매출 구분</th>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>연간 합계</th>
              {editing && <th aria-label="관리" />}
            </tr>
          </thead>
          {shown.map((meta) => (
            <DeptSalesGroup
              key={meta.code}
              meta={meta}
              kinds={kinds}
              kindNames={kindNames}
              onSaved={onSaved}
              editing={editing}
              drag={drag}
              press={press}
              deptPress={!editing && shown.length > 1 ? press("depts", meta.code, codes, () => [...(tableRef.current?.querySelectorAll<HTMLElement>("tbody.dept-group") ?? [])], dropDepts) : undefined}
              rowOrder={pendingRows[meta.code]}
              onRowOrder={setRowOrder}
              rowSavers={rowSavers.current}
            />
          ))}
          <tfoot>
            <tr>
              <td colSpan={2}>전체 합계</td>
              {grand.map((v, m) => (
                <td key={m}>{money(v)}</td>
              ))}
              <td>{money(sum(grand))}</td>
              {editing && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// 부서 하나 = tbody 하나. 부서 문서를 따로 불러 고치고 자동 저장(충돌·마감 처리는 useDepartment 가 맡음)
function DeptSalesGroup({
  meta,
  kinds,
  kindNames,
  onSaved,
  editing,
  drag,
  press,
  deptPress,
  rowOrder,
  onRowOrder,
  rowSavers,
}: {
  meta: DeptMeta;
  kinds: string[];
  kindNames: Record<string, string>;
  onSaved: () => void;
  editing: boolean;
  drag: RowDrag | null;
  press: ReturnType<typeof useLongPressDrag>["press"];
  deptPress?: ReturnType<ReturnType<typeof useLongPressDrag>["press"]>;
  rowOrder?: number[]; // 끌어서 바꾼 줄 순서(저장 전) — 줄 번호(저장된 순서의 자리)
  onRowOrder: (code: string, order: number[] | null) => void;
  rowSavers: Map<string, (order: number[]) => void>;
}) {
  const state = useDepartment(meta.code, { onSaved });
  const body = useRef<HTMLTableSectionElement>(null);
  const { doc, update, conflict, saveError, resolveConflict } = state;
  const rowCount = doc?.salesForecastRows.length;
  useEffect(() => onRowOrder(meta.code, null), [rowCount, meta.code]); // eslint-disable-line react-hooks/exhaustive-deps -- 줄 수가 바뀌면 줄 번호가 안 맞으므로 취소
  useEffect(() => {
    rowSavers.set(meta.code, (order) => update("sales", (list) => (list.length === order.length ? order.map((i) => list[i]) : list)));
    return () => void rowSavers.delete(meta.code);
  }, [rowSavers, meta.code, update]);
  const groupClass = `dept-group${drag?.group === "depts" && drag.id === meta.code ? " dragging" : ""}`;
  const deptName = salesDeptName(meta); // 이 표에 보이는 부서 이름 — 불러오고 저장하는 부서는 meta.code 그대로
  if (!doc)
    return (
      <tbody className={groupClass} data-drag-id={meta.code}>
        <tr>
          <td className="dept-cell">{deptName}</td>
          <td colSpan={15} className="muted">
            {state.loadError ?? "불러오는 중…"}
          </td>
        </tr>
      </tbody>
    );
  const rows = doc.salesForecastRows;
  const months = salesMonths(rows);
  const setRows = (fn: (rows: SalesRow[]) => SalesRow[]) => update("sales", fn);
  const nameOf = (kind: string) => kindNames[kind] ?? kind;
  const group = `rows:${meta.code}`;
  // 보여 줄 줄 순서 — 끄는 중이면 그 순서, 저장 전이면 바꾼 순서. 줄 번호(저장된 순서의 자리)로 다룬다
  const order = (drag?.group === group ? drag.order.map(Number) : (rowOrder ?? rows.map((_, i) => i))).filter((i) => rows[i]);
  const canDrag = !editing && rows.length > 1;
  const dropRows = (next: string[]) => {
    const numbers = next.map(Number);
    onRowOrder(meta.code, numbers.every((n, at) => n === at) ? null : numbers); // 제자리로 돌아오면 저장할 것 없음
  };
  const deptCell = (
    <td className={`dept-cell${deptPress ? " draggable" : ""}`} rowSpan={rows.length + 1} title={deptPress ? DRAG_HINT : undefined} {...deptPress}>
      <b>{deptName}</b>
    </td>
  );

  return (
    <tbody className={groupClass} data-drag-id={meta.code} ref={body}>
      {order.map((i, at) => {
        const r = rows[i];
        const rowPress = canDrag ? press(group, String(i), order.map(String), () => [...(body.current?.querySelectorAll<HTMLElement>("tr[data-drag-id]") ?? [])], dropRows) : undefined;
        return (
          <tr key={i} data-drag-id={i} className={drag?.group === group && drag.id === String(i) ? "dragging" : undefined}>
            {at === 0 && deptCell}
            <td className={`kind${canDrag ? " draggable" : ""}`} title={canDrag ? DRAG_HINT : undefined} {...rowPress}>
              {editing ? (
                <select value={r.kind} aria-label={`${deptName} 매출 구분`} onChange={(e) => setRows((list) => list.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>
                  {(kinds.includes(r.kind) ? kinds : [r.kind, ...kinds]).map((k) => (
                    <option key={k} value={k}>
                      {nameOf(k)}
                    </option>
                  ))}
                </select>
              ) : (
                <b>{nameOf(r.kind)}</b>
              )}
            </td>
            {r.values.map((v, m) => (
              <td key={m}>
                {editing ? (
                  <MoneyInput
                    value={v}
                    label={`${deptName} ${nameOf(r.kind)} ${MONTHS[m]} 목표매출`}
                    onCommit={(value) => setRows((list) => list.map((x, k) => (k === i ? { ...x, values: x.values.map((y, n) => (n === m ? Math.max(0, value) : y)) } : x)))}
                  />
                ) : (
                  money(v)
                )}
              </td>
            ))}
            <td>
              <b>{money(rowTotal(r))}</b>
            </td>
            {editing && (
              <td>
                <button
                  type="button"
                  className="danger"
                  disabled={Boolean(rowOrder)}
                  title={rowOrder ? "변경 내용을 먼저 저장하거나 취소해 주세요" : undefined}
                  onClick={() => {
                    if (confirm(`${deptName} ‘${nameOf(r.kind)}’ 목표매출 행을 삭제할까요?`)) setRows((list) => list.filter((_, k) => k !== i));
                  }}
                >
                  삭제
                </button>
              </td>
            )}
          </tr>
        );
      })}
      <tr className="subtotal">
        {rows.length === 0 && deptCell}
        <td className="kind">{rows.length ? `${deptName} 소계` : "목표매출 없음"}</td>
        {months.map((v, m) => (
          <td key={m}>{money(v)}</td>
        ))}
        <td>{money(sum(months))}</td>
        <td hidden={!editing}>
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
