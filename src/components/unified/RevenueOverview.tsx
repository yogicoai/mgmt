"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { MONTHS, channelTotals, kindOf, money, revenueMetrics, rowTotal, salesMonths, sum, zeros } from "@/lib/budget";
import { api, downloadCsv } from "@/lib/client";
import type { Channel, DepartmentDoc, DeptMeta, Revenue2026Row, RevenuePlan, SalesRow } from "@/lib/types";
import { DeptBanners } from "../budget/DeptBanners";
import { SalesEditor, nextSalesRow } from "../budget/SalesEditor";
import { BarChart } from "../charts";
import { StatCard, useUi } from "../ui";
import { ActualsPanel } from "./ActualsPanel";
import { DeptSalesOverview } from "./DeptSalesOverview";
import { PlanRowDialog } from "./PlanRowDialog";

interface PlanRow {
  id: string; // 순서 저장용(연도 안에서 유일)
  label: string;
  type: "net" | "erp" | "ratio" | "channel" | "fee" | "fee-total";
  values: (number | null)[];
  total: number | null;
  title?: string;
  feeIndex?: number;
}

// 전체 매출 현황 — 채널 금액 = 부서 목표매출 합산(자동), 수수료 = 이 화면에서 입력, 실적 = onlineData MCP
export function RevenueOverview({
  year,
  prevYear,
  metas,
  departments,
  channels,
  revenue2026,
  plan,
  onPlanSaved,
  onDeptSaved,
}: {
  year: number;
  prevYear: number;
  metas: DeptMeta[];
  departments: DepartmentDoc[];
  channels: Channel[];
  revenue2026: Revenue2026Row[];
  plan: RevenuePlan;
  onPlanSaved: (plan: RevenuePlan) => void;
  onDeptSaved: () => void;
}) {
  const [dept, setDept] = useState("all");
  const [feeIndex, setFeeIndex] = useState<number | null>(null);
  const { notify } = useUi();
  // 매출 예산안 — 연도마다 접고 펼친다. 접으면 손익 매출·ERP 매출만(구분 - 2026 손익 - 2026 ERP - 2027 손익 - 2027 ERP)
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // 줄 순서 — 펼친 연도에서 줄 이름을 꾹 눌러 끌면 바뀌고 저장(연도별)
  const [drag, setDrag] = useState<{ year: string; id: string; order: string[]; start: string[] } | null>(null);
  const [pending, setPending] = useState<Record<string, string[]>>({}); // 저장 응답 오기 전까지 보여 줄 순서
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => setPending({}), [plan.revision]);
  const { values, sources, unmatched } = useMemo(() => channelTotals(departments, channels), [departments, channels]);
  const metrics = revenueMetrics(values, plan.fees);
  const selected = metas.find((m) => m.code === dept);

  const rows2027: PlanRow[] = [
    { id: "net", label: "(손익계산서) 매출액", type: "net", values: metrics.net, total: metrics.netTotal },
    { id: "fee-total", label: "수수료 합계", type: "fee-total", values: metrics.fees, total: metrics.feeTotal },
    ...plan.fees.map((f, i) => ({ id: `fee:${f.key}`, label: f.label, type: "fee" as const, values: f.values, total: sum(f.values), feeIndex: i })),
    { id: "erp", label: `(ERP) ${year} 목표 매출액`, type: "erp", values: metrics.erp, total: metrics.erpTotal },
    ...channels.map((c) => ({
      id: `ch:${c.key}`,
      label: c.label,
      type: "channel" as const,
      values: values[c.key],
      total: sum(values[c.key]),
      title: sources[c.key].length ? sources[c.key].map((s) => `${s.dept} · ${s.kind}: ${money(s.total)}원`).join("\n") : "입력한 부서 없음",
    })),
  ];

  const y26 = String(prevYear);
  const y27 = String(year);
  const orderOf = (key: string) => (drag?.year === key ? drag.order : (pending[key] ?? plan.rowOrder?.[key]));
  const sortRows = <T extends { id: string }>(rows: T[], order?: string[]) => {
    if (!order?.length) return rows;
    const at = new Map(order.map((id, i) => [id, i]));
    return rows.map((r, i) => ({ r, k: at.get(r.id) ?? order.length + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
  };
  const ordered2026 = sortRows(revenue2026.map((r, i) => ({ ...r, id: `p${i}` })), orderOf(y26));
  const ordered2027 = sortRows(rows2027, orderOf(y27));
  // 접으면 손익 매출·ERP 매출 한 줄씩(정한 순서대로)
  const keyRows = <T extends { id: string; type: string }>(rows: T[]) => {
    const keep = new Set([rows.find((r) => r.type === "net")?.id, rows.find((r) => r.type === "erp")?.id]);
    return rows.filter((r) => keep.has(r.id));
  };
  const shown2026 = open[y26] ? ordered2026 : keyRows(ordered2026);
  const shown2027 = open[y27] ? ordered2027 : keyRows(ordered2027);
  const anyOpen = Boolean(open[y26] || open[y27]);
  const customOrder = Boolean(plan.rowOrder && Object.values(plan.rowOrder).some((o) => o.length));

  const saveOrder = async (rowOrder: Record<string, string[]>, message: string) => {
    setPending(rowOrder);
    try {
      const r = await api<{ plan: RevenuePlan }>("/api/revenue", { method: "PATCH", body: JSON.stringify({ revision: plan.revision, rowOrder }) });
      onPlanSaved(r.plan);
      notify(message);
    } catch (e) {
      setPending({});
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };

  // 꾹 누르기(0.4초) → 끌기 → 놓으면 저장. 짧게 누르면 평소처럼(수수료 줄은 수정 창)
  const pressStart = (e: React.PointerEvent<HTMLElement>, yearKey: string, id: string, ids: string[]) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        try {
          el.setPointerCapture(pointerId);
        } catch {
          // 이미 손을 뗀 경우
        }
        suppressClick.current = true;
        window.getSelection()?.removeAllRanges(); // 끄는 동안 숫자 칸이 선택되어 파랗게 칠해지지 않게
        setDrag({ year: yearKey, id, order: ids, start: ids });
      }, 400),
    };
  };
  const pressMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) {
        clearTimeout(p.timer); // 그냥 움직이면(스크롤·선택) 끌기 안 함
        press.current = null;
      }
      return;
    }
    // 끄는 줄을 t번째에 두면 [T_t, T_t + 높이) 를 차지 — 포인터가 그 안에 드는 첫 t. 다른 줄 높이로만 계산해서 제자리로 돌아오면 원래 순서
    const rows = [...(tableRef.current?.querySelectorAll<HTMLElement>(`tbody tr[data-year="${drag.year}"]`) ?? [])];
    const self = rows.find((r) => r.dataset.rowId === drag.id);
    if (!self) return;
    const height = self.getBoundingClientRect().height;
    const others = rows.filter((r) => r !== self);
    let top = rows[0].getBoundingClientRect().top;
    let to = others.length;
    for (let t = 0; t < others.length; t++) {
      if (e.clientY < top + height) {
        to = t;
        break;
      }
      top += others[t].getBoundingClientRect().height;
    }
    const next = others.map((r) => r.dataset.rowId ?? "");
    next.splice(to, 0, drag.id);
    if (next.join() !== drag.order.join()) setDrag({ ...drag, order: next });
  };
  const pressEnd = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    if (drag) {
      const changed = drag.order.join() !== drag.start.join();
      const done = drag;
      setDrag(null);
      if (changed) void saveOrder({ ...(plan.rowOrder ?? {}), [done.year]: done.order }, "줄 순서를 바꿨습니다.");
      setTimeout(() => (suppressClick.current = false), 0);
    }
  };
  const pressCancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
    suppressClick.current = false;
  };
  const dragProps = (yearKey: string, id: string, ids: string[]) =>
    open[yearKey]
      ? {
          className: "label draggable",
          title: "꾹 눌러 위아래로 끌면 순서가 바뀝니다",
          onPointerDown: (e: React.PointerEvent<HTMLElement>) => pressStart(e, yearKey, id, ids),
          onPointerMove: pressMove,
          onPointerUp: pressEnd,
          onPointerCancel: pressCancel,
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        }
      : { className: "label" };
  const yearCell = (yearKey: string, label: number, rowSpan: number) => (
    <td className="year" rowSpan={rowSpan}>
      <button type="button" className="year-toggle" onClick={() => setOpen((o) => ({ ...o, [yearKey]: !o[yearKey] }))} aria-expanded={Boolean(open[yearKey])} title={open[yearKey] ? "접기" : "펼치기"}>
        {label}
        <span>{open[yearKey] ? "▾" : "▸"}</span>
      </button>
    </td>
  );

  const exportCsv = () =>
    downloadCsv(`${year}_매출_예산안.csv`, [
      ["연도", "구분", ...MONTHS, "Total"],
      ...revenue2026.map((r) => [prevYear, r.label, ...r.values, r.total]),
      ...rows2027.map((r) => [year, r.label, ...r.values, r.total]),
    ]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>전체 매출 현황</h2>
          <span className="muted">{selected ? `${selected.name} 목표매출 — 여기서 고친 값이 부서 화면과 통합 합산에 바로 반영됩니다` : `${year}년 매출 예산안 · 채널 금액은 부서 목표매출 자동 합산`}</span>
        </div>
        <div className="actions">
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="목표매출 부서 선택">
            <option value="all">전체</option>
            {metas.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
          {!selected && (
            <button type="button" onClick={exportCsv}>
              매출 CSV
            </button>
          )}
        </div>
      </div>

      {selected ? (
        <DeptRevenue key={selected.code} meta={selected} channels={channels} year={year} onSaved={onDeptSaved} />
      ) : (
        <>
          <div className="cards">
            <StatCard label="전체 연간 예상매출" value={money(metrics.erpTotal)} note="ERP 목표 매출액(부서 목표매출 합계)" />
            <StatCard label="온라인 예상매출" value={money(sum(values.online ?? []))} note="(매출) 온라인 기준" />
            <StatCard label="오프라인 예상매출" value={money(sum(values.offline ?? []))} note="(매출) 오프라인 기준" />
            <StatCard label="월평균 예상매출" value={money(metrics.erpTotal / 12)} note="연간 예상매출 ÷ 12개월" />
          </div>
          {unmatched.length > 0 && (
            <div className="banner warn">
              채널과 맞지 않는 매출 구분이 있어 합산에서 빠졌습니다: {unmatched.map((u) => `${u.dept} ‘${u.kind}’ ${money(u.total)}원`).join(", ")} — 부서를 골라 매출 구분을 바꿔 주세요.
            </div>
          )}
          <section className="panel">
            <div className="panel-head">
              <h3>월별 전체 예상매출 (ERP 목표)</h3>
              <span className="muted">단위: 원 · 막대에 마우스를 올리면 금액</span>
            </div>
            <BarChart values={metrics.erp} label="월별 전체 예상매출" />
          </section>
          <ActualsPanel year={year} prevYear={prevYear} targetOnline={values.online ?? zeros()} targetOffline={values.offline ?? zeros()} />
          <DeptSalesOverview metas={metas} departments={departments} kinds={channels.map(kindOf)} onSaved={onDeptSaved} />
          <section className="panel" data-anchor="revenue-plan">
            <div className="panel-head">
              <h3>{year}년 매출 예산안</h3>
              <div className="actions">
                <span className="muted">
                  단위: 원 · {prevYear}년은 재무 보고 참고값(빨간 글씨는 전망치) · 연도 옆 ▸로 펼침{anyOpen ? " · 펼친 연도에서 줄 이름을 꾹 눌러 끌면 순서 변경 · 수수료 행을 누르면 수정" : ""}
                </span>
                {customOrder && (
                  <button type="button" onClick={() => void saveOrder({}, "기본 순서로 되돌렸습니다.")} title="꾹 눌러 바꾼 줄 순서를 처음대로">
                    기본 순서로
                  </button>
                )}
                <button type="button" onClick={() => setOpen(anyOpen ? {} : { [y26]: true, [y27]: true })} aria-expanded={anyOpen}>
                  {anyOpen ? "모두 접기 ▴" : "모두 펼치기 ▾"}
                </button>
              </div>
            </div>
            <div className="tablewrap free">
              <table className={`revenue-report fit-table${drag ? " is-dragging" : ""}`} ref={tableRef}>
                <colgroup>
                  <col style={{ width: 74 }} />
                  {/* 구분 칸은 글자 크기에 맞춤 — % 면 큰 화면에서 빈칸만 커진다 */}
                  <col style={{ width: "calc(var(--num-font) * 12.4 + 7px)" }} />
                  {MONTHS.map((m) => (
                    <col key={m} />
                  ))}
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2}>구분</th>
                    {MONTHS.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>연간 합계</th>
                  </tr>
                </thead>
                <tbody>
                  {shown2026.map((r, i) => (
                    <tr key={`p:${r.id}`} data-year={y26} data-row-id={r.id} className={`${r.type}${drag?.year === y26 && drag.id === r.id ? " dragging" : ""}`}>
                      {i === 0 && yearCell(y26, prevYear, shown2026.length)}
                      <td {...dragProps(y26, r.id, shown2026.map((x) => x.id))}>{r.label}</td>
                      {r.values.map((v, m) => (
                        <td key={m} className={`v${r.type === "net" && m >= 9 ? " forecast" : ""}`}>
                          {v === null ? "" : r.type === "ratio" ? `${v.toFixed(2)}%` : money(v)}
                        </td>
                      ))}
                      <td className="total">{r.total === null ? "" : r.type === "ratio" ? `${r.total}%` : money(r.total)}</td>
                    </tr>
                  ))}
                  {shown2027.map((r, i) => (
                    <tr
                      key={`c:${r.id}`}
                      data-year={y27}
                      data-row-id={r.id}
                      className={`${r.type}${i === 0 ? " year-start" : ""}${drag?.year === y27 && drag.id === r.id ? " dragging" : ""}`}
                      title={r.title}
                    >
                      {i === 0 && yearCell(y27, year, shown2027.length)}
                      <td {...dragProps(y27, r.id, shown2027.map((x) => x.id))}>
                        {r.feeIndex !== undefined ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!suppressClick.current) setFeeIndex(r.feeIndex!);
                            }}
                            title="월별 금액 수정"
                          >
                            {r.label} ✎
                          </button>
                        ) : (
                          r.label
                        )}
                      </td>
                      {r.values.map((v, m) => (
                        <td key={m} className="v">
                          {money(v)}
                        </td>
                      ))}
                      <td className="total">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {feeIndex !== null && <PlanRowDialog plan={plan} field="fees" index={feeIndex} onSaved={onPlanSaved} onClose={() => setFeeIndex(null)} />}
    </>
  );
}


// 부서를 고르면 그 부서 목표매출을 바로 편집(통합 담당자용) — 저장하면 부서 화면 가이드라인에도 반영
function DeptRevenue({ meta, channels, year, onSaved }: { meta: DeptMeta; channels: Channel[]; year: number; onSaved: () => void }) {
  const state = useDepartment(meta.code, { onSaved });
  const [editing, setEditing] = useState(false); // 평소 고정, [수정]을 눌러야 입력
  const { doc, update, statusLabel } = state;
  if (!doc) return <DeptBanners state={state} showClosed={false} />;
  const rows = doc.salesForecastRows;
  const months = salesMonths(rows);
  const total = sum(months);
  const kinds = channels.map(kindOf);
  const byKind = (kind: string) => sum(rows.filter((r) => r.kind === kind).map(rowTotal));
  const setRows = (fn: (rows: SalesRow[]) => SalesRow[]) => update("sales", fn);

  return (
    <>
      <DeptBanners state={state} showClosed={false} />
      <div className="cards">
        <StatCard label="연간 목표매출" value={money(total)} note={`${meta.name} 기준`} />
        <StatCard label="온라인 목표" value={money(byKind("온라인"))} note="매출 구분 ‘온라인’" />
        <StatCard label="오프라인 목표" value={money(byKind("오프라인"))} note="매출 구분 ‘오프라인’" />
        <StatCard label="저장 상태" value={statusLabel === "저장 완료" || statusLabel === "미입력" || statusLabel === "마감 완료" ? "자동 저장" : statusLabel} unit="" note="고치면 바로 저장됩니다" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>{meta.name} 월별 목표매출</h3>
          <span className="muted">단위: 원</span>
        </div>
        <BarChart values={months} label={`${meta.name} 월별 목표매출`} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>{meta.name} 목표매출 입력</h3>
          <div className="actions">
            <span className="muted">{editing ? "매출 구분은 통합 매출 예산안의 채널과 같아야 합산됩니다 — 다 고쳤으면 [고정]" : "[수정]을 눌러야 입력할 수 있습니다"}</span>
            {editing && (
              <button type="button" onClick={() => setRows((list) => [...list, nextSalesRow(list, kinds)])}>
                매출 행 추가
              </button>
            )}
            <button type="button" className="primary" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? "고정" : "수정"}
            </button>
          </div>
        </div>
        <SalesEditor deptName={meta.name} rows={rows} kinds={kinds} editable={editing} onChange={setRows} emptyText={`${meta.name}에 배정된 목표매출이 없습니다. ‘매출 행 추가’로 입력하세요.`} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {year}년 목표매출은 부서 화면 ‘가이드라인’ 1번 표에도 나타납니다{meta.salesInput ? `(${meta.name}은 부서 화면에서도 직접 입력)` : "(조회 전용)"}.
        </p>
      </section>
    </>
  );
}
