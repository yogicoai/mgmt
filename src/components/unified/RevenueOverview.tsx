"use client";

import { useMemo, useRef, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { useLongPressDrag } from "@/hooks/useLongPressDrag";
import { MONTHS, channelTotals, kindNames, kindOf, money, revenueMetrics, rowTotal, salesDeptName, salesMonths, sortByOrder, sum, zeros } from "@/lib/budget";
import { api, downloadCsv, type ApiError } from "@/lib/client";
import type { Channel, DepartmentDoc, DeptMeta, Revenue2026Row, RevenuePlan, SalesRow } from "@/lib/types";
import { DeptBanners } from "../budget/DeptBanners";
import { SalesEditor, nextSalesRow } from "../budget/SalesEditor";
import { BarChart } from "../charts";
import { ConfirmDialog, NameDialog, OrderSaveBar, StatCard, useUi } from "../ui";
import { ActualsPanel } from "./ActualsPanel";
import { DeptSalesOverview } from "./DeptSalesOverview";
import { PlanRowDialog } from "./PlanRowDialog";

interface PlanRow {
  id: string; // 순서·구분명 저장용(연도 안에서 유일)
  label: string;
  type: "net" | "erp" | "ratio" | "channel" | "fee" | "fee-total";
  values: (number | null)[];
  total: number | null;
  title?: string;
  feeIndex?: number;
}

// 마지막 카드에 묶는 채널(마케팅 B2B·샐리필, 온라인고객지원 CS)
const OTHER_CHANNELS = ["b2b", "seller", "cs"];

// 구분명을 고치거나 지울 줄 — base = 처음 이름
type NamedRow = Pick<PlanRow, "id" | "label" | "type" | "total"> & { base: string };

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
  channels: Channel[]; // 매출 예산안에서 지운 채널은 빠진 목록
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
  // 구분명 수정·삭제 — 위쪽 [수정]을 눌러야 줄마다 [수정]·[삭제]가 나타나고, 끝나면 [저장]
  const [manage, setManage] = useState(false);
  const [renaming, setRenaming] = useState<{ yearKey: string; row: NamedRow } | null>(null);
  const [removing, setRemoving] = useState<{ yearKey: string; row: NamedRow } | null>(null);
  const [restoring, setRestoring] = useState(false);
  // 줄 순서 — 펼친 연도에서 줄 이름을 눌러 끈 뒤 [변경내용 저장](연도별)
  const { drag, press, suppressClick } = useLongPressDrag();
  const [pending, setPending] = useState<Record<string, string[]>>({}); // 끌어서 바꾼 순서 — [변경내용 저장]을 눌러야 저장
  const tableRef = useRef<HTMLTableElement>(null);
  // 이 화면(목표매출)에 보이는 부서 이름은 salesDeptName — 임원은 사업개발로 보이고 불러오고 저장하는 부서코드는 그대로
  const { values, sources, unmatched } = useMemo(() => channelTotals(departments.map((d) => ({ ...d, name: salesDeptName(d) })), channels), [departments, channels]);
  const names = useMemo(() => kindNames(channels, plan), [channels, plan]);
  const metrics = revenueMetrics(values, plan.fees);
  // 카드용 — 채널 연간 합계, 채널 이름(매출 예산안에서 고친 이름)
  const channelSum = (key: string) => sum(values[key] ?? []);
  const channelName = (key: string) => {
    const channel = channels.find((c) => c.key === key);
    return channel ? (names[kindOf(channel)] ?? kindOf(channel)) : key;
  };
  // "온라인: 2,400,000,000원, 공동구매: …" — 좁은 창에서 줄이 바뀌어도 항목 중간(숫자와 원 사이)에서는 안 끊기게
  const breakdown = (items: [string, number][]) =>
    items.map(([name, amount], i) => (
      <span key={name}>
        {i > 0 && ", "}
        <span className="nowrap">
          {name}: {money(amount)}원
        </span>
      </span>
    ));
  const picked = metas.find((m) => m.code === dept);
  const selected = picked && { ...picked, name: salesDeptName(picked) };

  const y26 = String(prevYear);
  const y27 = String(year);
  // 삭제한 줄을 빼고 고친 구분명을 입힌다
  const applySettings = <T extends { id: string; label: string }>(yearKey: string, rows: T[]) =>
    rows.filter((r) => !plan.rowHidden?.[yearKey]?.includes(r.id)).map((r) => ({ ...r, base: r.label, label: plan.rowLabels?.[yearKey]?.[r.id] ?? r.label }));

  const rows2027 = applySettings<PlanRow>(y27, [
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
      title: sources[c.key].length ? sources[c.key].map((s) => `${s.dept} · ${names[s.kind] ?? s.kind}: ${money(s.total)}원`).join("\n") : "입력한 부서 없음",
    })),
  ]);
  const rows2026 = applySettings(y26, revenue2026.map((r, i) => ({ ...r, id: `p${i}` })));

  const orderOf = (key: string) => (drag?.group === key ? drag.order : (pending[key] ?? plan.rowOrder?.[key]));
  const ordered2026 = sortByOrder(rows2026, orderOf(y26), (r) => r.id);
  const ordered2027 = sortByOrder(rows2027, orderOf(y27), (r) => r.id);
  // 접으면 손익 매출·ERP 매출 한 줄씩(정한 순서대로)
  const keyRows = <T extends { id: string; type: string }>(rows: T[]) => {
    const keep = new Set([rows.find((r) => r.type === "net")?.id, rows.find((r) => r.type === "erp")?.id]);
    return rows.filter((r) => keep.has(r.id));
  };
  const shown2026 = open[y26] ? ordered2026 : keyRows(ordered2026);
  const shown2027 = open[y27] ? ordered2027 : keyRows(ordered2027);
  const anyOpen = Boolean(open[y26] || open[y27]);
  const customOrder = Boolean(plan.rowOrder && Object.values(plan.rowOrder).some((o) => o.length));
  const hiddenCount = Object.values(plan.rowHidden ?? {}).reduce((n, ids) => n + ids.length, 0);

  // 매출 예산안 줄 설정(순서·구분명·삭제) 저장 — 실패하면 알리고 false
  const patchPlan = async (change: object, message: string) => {
    try {
      const r = await api<{ plan: RevenuePlan }>("/api/revenue", { method: "PATCH", body: JSON.stringify({ revision: plan.revision, ...change }) });
      onPlanSaved(r.plan);
      notify(message);
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body.plan) onPlanSaved(err.body.plan as RevenuePlan); // 최신 값으로 — 바로 다시 시도할 수 있게
      notify(err.message || String(e), true);
      return false;
    }
  };
  // 끌어 놓으면 저장 전 상태로 — 제자리로 돌아오면 저장할 것 없음
  const dropOrder = (yearKey: string, rows: { id: string }[], order: string[]) => {
    const saved = sortByOrder(rows, plan.rowOrder?.[yearKey], (r) => r.id).map((r) => r.id);
    setPending(({ [yearKey]: _old, ...rest }) => (order.join() === saved.join() ? rest : { ...rest, [yearKey]: order }));
  };
  const saveOrder = async () => {
    if (await patchPlan({ rowOrder: { ...plan.rowOrder, ...pending } }, "변경 내용을 저장했습니다.")) setPending({});
  };
  const resetOrder = async () => {
    if (await patchPlan({ rowOrder: {} }, "기본 순서로 되돌렸습니다.")) setPending({});
  };

  const saveName = async (yearKey: string, row: NamedRow, name: string) => {
    // 채널끼리 이름이 같으면 매출 구분 목록에서 구별이 안 된다 — ‘(매출)’ 만 다른 이름도 목록에서는 같은 이름
    const kindName = (label: string) => kindOf({ key: "", label });
    if (yearKey === y27 && row.type === "channel" && rows2027.some((r) => r.type === "channel" && r.id !== row.id && kindName(r.label) === kindName(name))) return notify(`‘${name}’ 구분이 이미 있습니다.`, true);
    const labels = { ...(plan.rowLabels?.[yearKey] ?? {}) };
    if (name === row.base) delete labels[row.id];
    else labels[row.id] = name;
    if (await patchPlan({ rowLabels: { ...plan.rowLabels, [yearKey]: labels } }, "구분명을 바꿨습니다.")) setRenaming(null);
  };
  const removeRow = (yearKey: string, row: NamedRow) => {
    // 올해 수수료·채널은 합계에 들어가므로 금액이 남아 있으면 지울 수 없다(전년 줄은 참고값이라 바로)
    if (yearKey === y27 && (row.type === "fee" || row.type === "channel") && row.total) return notify(`‘${row.label}’에 금액이 남아 있어 삭제할 수 없습니다. 금액을 0으로 만든 뒤 삭제해 주세요.`, true);
    setRemoving({ yearKey, row });
  };

  const dragProps = (yearKey: string, id: string, ids: string[]) =>
    open[yearKey]
      ? {
          className: "label draggable",
          title: "누른 채 위아래로 끌면 순서가 바뀝니다",
          ...press(yearKey, id, ids, () => [...(tableRef.current?.querySelectorAll<HTMLElement>(`tbody tr[data-year="${yearKey}"]`) ?? [])], (order) => dropOrder(yearKey, yearKey === y26 ? rows2026 : rows2027, order)),
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
  const manageCell = (yearKey: string, row: NamedRow) =>
    manage && (
      <td className="row-manage">
        <button type="button" className="link" onClick={() => setRenaming({ yearKey, row })} aria-label={`${row.label} 구분명 수정`}>
          수정
        </button>
        {row.type !== "net" && row.type !== "erp" && (
          <button type="button" className="link danger" onClick={() => removeRow(yearKey, row)} aria-label={`${row.label} 줄 삭제`}>
            삭제
          </button>
        )}
      </td>
    );

  const exportCsv = () =>
    downloadCsv(`${year}_매출_예산안.csv`, [
      ["연도", "구분", ...MONTHS, "Total"],
      ...ordered2026.map((r) => [prevYear, r.label, ...r.values, r.total]),
      ...ordered2027.map((r) => [year, r.label, ...r.values, r.total]),
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
                {salesDeptName(m)}
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
        <DeptRevenue key={selected.code} meta={selected} channels={channels} names={names} year={year} onSaved={onDeptSaved} />
      ) : (
        <>
          {/* 전체 → 오프라인 → 온라인(+공동구매) → 사업개발(BC) → B2B·샐리필·CS — 매출 구분별로 나눠 다섯 장을 더하면 전체와 같다(지운 채널 제외) */}
          <div className="cards five">
            <StatCard
              label="전체 연간 목표매출"
              value={money(metrics.erpTotal)}
              note={
                <>
                  ERP 목표 매출액(부서 목표매출 합계)
                  <br />
                  <b>월평균 목표매출 {money(metrics.erpTotal / 12)}원</b>
                </>
              }
            />
            <StatCard label="오프라인 목표매출" value={money(channelSum("offline"))} />
            <StatCard label="온라인 목표매출" value={money(channelSum("online") + channelSum("group"))} note={breakdown([["온라인", channelSum("online")], ["공동구매", channelSum("group")]])} />
            <StatCard label="사업개발 목표매출" value={money(channelSum("bc"))} />
            <StatCard
              label={`${OTHER_CHANNELS.map(channelName).join("/")} 목표매출`}
              value={money(sum(OTHER_CHANNELS.map(channelSum)))}
              note={breakdown(OTHER_CHANNELS.map((key) => [channelName(key), channelSum(key)]))}
            />
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
          <DeptSalesOverview
            metas={metas}
            departments={departments}
            kinds={channels.map(kindOf)}
            kindNames={names}
            deptOrder={plan.deptOrder}
            onSaveDeptOrder={(order) => patchPlan({ deptOrder: order }, "변경 내용을 저장했습니다.")}
            onSaved={onDeptSaved}
          />
          <section className="panel" data-anchor="revenue-plan">
            <div className="panel-head">
              <h3>{year}년 매출 예산안</h3>
              <div className="actions">
                <span className="muted">
                  단위: 원 · {prevYear}년은 재무 보고 참고값(빨간 글씨는 전망치) ·{" "}
                  {manage ? "줄 오른쪽의 [수정]·[삭제]를 누르세요 — 다 하면 [저장]" : `연도 옆 ▸로 펼침${anyOpen ? " · 펼친 연도에서 줄 이름을 누른 채 위아래로 끈 뒤 [변경내용 저장] · 수수료 행을 누르면 수정" : ""}`}
                </span>
                {Object.keys(pending).length > 0 && <OrderSaveBar onSave={() => void saveOrder()} onCancel={() => setPending({})} />}
                {manage && hiddenCount > 0 && (
                  <button type="button" onClick={() => setRestoring(true)}>
                    삭제한 줄 복원 ({hiddenCount})
                  </button>
                )}
                {customOrder && !manage && Object.keys(pending).length === 0 && (
                  <button type="button" onClick={() => void resetOrder()} title="끌어서 바꾼 줄 순서를 처음대로">
                    기본 순서로
                  </button>
                )}
                {!manage && (
                  <button type="button" onClick={() => setOpen(anyOpen ? {} : { [y26]: true, [y27]: true })} aria-expanded={anyOpen}>
                    {anyOpen ? "모두 접기 ▴" : "모두 펼치기 ▾"}
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    // 이름 수정·삭제는 창에서 [저장]·[예]를 누를 때 이미 저장된다 — 여기서는 수정 상태를 닫는다
                    if (manage) notify("저장했습니다.");
                    else setOpen({ [y26]: true, [y27]: true }); // 모든 줄을 고칠 수 있게 펼친다
                    setManage((v) => !v);
                  }}
                  aria-pressed={manage}
                  title={manage ? "수정 끝내기" : "구분명 수정·삭제 — 누르면 줄마다 [수정]·[삭제] 버튼이 나타납니다"}
                >
                  {manage ? "저장" : "수정"}
                </button>
              </div>
            </div>
            <div className="tablewrap free">
              <table className={`revenue-report fit-table${drag ? " is-dragging" : ""}`} ref={tableRef}>
                <colgroup>
                  <col style={{ width: 74 }} />
                  {/* 구분·합계 칸은 글자 크기에 맞춤 — % 면 큰 화면에서 빈칸만 커진다 */}
                  <col style={{ width: "calc(var(--num-font) * 12.4 + 7px)" }} />
                  {MONTHS.map((m) => (
                    <col key={m} />
                  ))}
                  <col style={{ width: "calc(var(--num-font) * 9.6)" }} />
                  {manage && <col style={{ width: 58 }} />}
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2}>구분</th>
                    {MONTHS.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>연간 합계</th>
                    {manage && <th>관리</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown2026.map((r, i) => (
                    <tr key={`p:${r.id}`} data-year={y26} data-drag-id={r.id} className={`${r.type}${drag?.group === y26 && drag.id === r.id ? " dragging" : ""}`}>
                      {i === 0 && yearCell(y26, prevYear, shown2026.length)}
                      <td {...dragProps(y26, r.id, shown2026.map((x) => x.id))}>{r.label}</td>
                      {r.values.map((v, m) => (
                        <td key={m} className={`v${r.type === "net" && m >= 9 ? " forecast" : ""}`}>
                          {v === null ? "" : r.type === "ratio" ? `${v.toFixed(2)}%` : money(v)}
                        </td>
                      ))}
                      <td className="total">{r.total === null ? "" : r.type === "ratio" ? `${r.total}%` : money(r.total)}</td>
                      {manageCell(y26, r)}
                    </tr>
                  ))}
                  {shown2027.map((r, i) => (
                    <tr
                      key={`c:${r.id}`}
                      data-year={y27}
                      data-drag-id={r.id}
                      className={`${r.type}${i === 0 ? " year-start" : ""}${drag?.group === y27 && drag.id === r.id ? " dragging" : ""}`}
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
                      {manageCell(y27, r)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {feeIndex !== null && <PlanRowDialog plan={plan} field="fees" index={feeIndex} name={plan.rowLabels?.[y27]?.[`fee:${plan.fees[feeIndex].key}`]} onSaved={onPlanSaved} onClose={() => setFeeIndex(null)} />}
      {removing && (
        <ConfirmDialog
          title="구분 삭제"
          message={`‘${removing.row.label}’ 줄을 삭제하시겠습니까? [삭제한 줄 복원]으로 되돌릴 수 있습니다.`}
          onConfirm={async () => {
            await patchPlan({ rowHidden: { ...plan.rowHidden, [removing.yearKey]: [...(plan.rowHidden?.[removing.yearKey] ?? []), removing.row.id] } }, "줄을 삭제했습니다.");
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {restoring && (
        <ConfirmDialog
          title="삭제한 줄 복원"
          message={`삭제한 줄 ${hiddenCount}개를 모두 되살리시겠습니까?`}
          danger={false}
          onConfirm={async () => {
            await patchPlan({ rowHidden: {} }, "삭제한 줄을 복원했습니다.");
            setRestoring(false);
          }}
          onClose={() => setRestoring(false)}
        />
      )}
      {renaming && (
        <NameDialog
          title={`${renaming.yearKey}년 구분명 수정`}
          label={`구분명 (처음 이름: ${renaming.row.base})`}
          initial={renaming.row.label}
          maxLength={60}
          hint={renaming.yearKey === y27 && renaming.row.type === "channel" ? "매출 구분 이름도 함께 바뀌고, 금액 합산은 그대로입니다" : "처음 이름을 다시 넣으면 원래대로 돌아갑니다"}
          onSave={(name) => saveName(renaming.yearKey, renaming.row, name)}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}


// 부서를 고르면 그 부서 목표매출을 바로 편집(통합 담당자용) — 저장하면 부서 화면 가이드라인에도 반영
function DeptRevenue({ meta, channels, names, year, onSaved }: { meta: DeptMeta; channels: Channel[]; names: Record<string, string>; year: number; onSaved: () => void }) {
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
        <SalesEditor deptName={meta.name} rows={rows} kinds={kinds} kindNames={names} editable={editing} onChange={setRows} emptyText={`${meta.name}에 배정된 목표매출이 없습니다. ‘매출 행 추가’로 입력하세요.`} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {year}년 목표매출은 부서 화면 ‘가이드라인’ 1번 표에도 나타납니다{meta.salesInput ? `(${meta.name}은 부서 화면에서도 직접 입력)` : "(조회 전용)"}.
        </p>
      </section>
    </>
  );
}
