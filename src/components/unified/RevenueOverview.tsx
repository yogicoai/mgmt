"use client";

import { useMemo, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { MONTHS, MONTHS_EN, channelTotals, kindOf, money, revenueMetrics, rowTotal, salesMonths, sum, zeros } from "@/lib/budget";
import { downloadCsv } from "@/lib/client";
import type { Channel, DepartmentDoc, DeptMeta, Revenue2026Row, RevenuePlan, SalesRow } from "@/lib/types";
import { DeptBanners } from "../budget/DeptBanners";
import { SalesEditor, nextSalesRow } from "../budget/SalesEditor";
import { BarChart } from "../charts";
import { StatCard } from "../ui";
import { ActualsPanel } from "./ActualsPanel";
import { DeptSalesOverview } from "./DeptSalesOverview";
import { PlanRowDialog } from "./PlanRowDialog";

interface PlanRow {
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
  // 매출 예산안 — 접으면 연도별 손익 매출·ERP 매출만(구분 - 2026 손익 - 2026 ERP - 2027 손익 - 2027 ERP)
  const [expanded, setExpanded] = useState(false);
  const { values, sources, unmatched } = useMemo(() => channelTotals(departments, channels), [departments, channels]);
  const metrics = revenueMetrics(values, plan.fees);
  const selected = metas.find((m) => m.code === dept);

  const rows2027: PlanRow[] = [
    { label: "(손익계산서) 매출액", type: "net", values: metrics.net, total: metrics.netTotal },
    { label: "수수료 합계", type: "fee-total", values: metrics.fees, total: metrics.feeTotal },
    ...plan.fees.map((f, i) => ({ label: f.label, type: "fee" as const, values: f.values, total: sum(f.values), feeIndex: i })),
    { label: `(ERP) ${year} 목표 매출액`, type: "erp", values: metrics.erp, total: metrics.erpTotal },
    ...channels.map((c) => ({
      label: c.label,
      type: "channel" as const,
      values: values[c.key],
      total: sum(values[c.key]),
      title: sources[c.key].length ? sources[c.key].map((s) => `${s.dept} · ${s.kind}: ${money(s.total)}원`).join("\n") : "입력한 부서 없음",
    })),
  ];

  const keyRow = (type: string) => type === "net" || type === "erp";
  const shown2026 = expanded ? revenue2026 : revenue2026.filter((r, i) => keyRow(r.type) && revenue2026.findIndex((x) => x.type === r.type) === i);
  const shown2027 = expanded ? rows2027 : rows2027.filter((r) => keyRow(r.type));

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
                  단위: 원 · {prevYear}년은 재무 보고 참고값(빨간 글씨는 전망치){expanded ? " · 수수료 행을 누르면 수정 · 채널 행에 마우스를 올리면 부서별 내역" : ""}
                </span>
                <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                  {expanded ? "접기 ▴" : "펼치기 ▾"}
                </button>
              </div>
            </div>
            <div className="tablewrap free">
              <table className="revenue-report">
                <colgroup>
                  <col style={{ width: 70 }} />
                  <col style={{ width: 175 }} />
                  {MONTHS.map((m) => (
                    <col key={m} />
                  ))}
                  <col style={{ width: 150 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={2}>구분</th>
                    {MONTHS_EN.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {shown2026.map((r, i) => (
                    <tr key={`p${i}`} className={r.type}>
                      {i === 0 && (
                        <td className="year" rowSpan={shown2026.length}>
                          {prevYear}
                        </td>
                      )}
                      <td className="label">{r.label}</td>
                      {r.values.map((v, m) => (
                        <td key={m} className={`v${r.type === "net" && m >= 9 ? " forecast" : ""}`}>
                          {v === null ? "" : r.type === "ratio" ? `${v.toFixed(2)}%` : money(v)}
                        </td>
                      ))}
                      <td className="total">{r.total === null ? "" : r.type === "ratio" ? `${r.total}%` : money(r.total)}</td>
                    </tr>
                  ))}
                  {shown2027.map((r, i) => (
                    <tr key={`c${i}`} className={`${r.type}${i === 0 ? " year-start" : ""}`} title={r.title}>
                      {i === 0 && (
                        <td className="year" rowSpan={shown2027.length}>
                          {year}
                        </td>
                      )}
                      <td className="label">
                        {r.feeIndex !== undefined ? (
                          <button type="button" onClick={() => setFeeIndex(r.feeIndex!)} title="월별 금액 수정">
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
            <span className="muted">매출 구분은 통합 매출 예산안의 채널과 같아야 합산됩니다</span>
            <button type="button" className="primary" onClick={() => setRows((list) => [...list, nextSalesRow(list, kinds)])}>
              매출 행 추가
            </button>
          </div>
        </div>
        <SalesEditor deptName={meta.name} rows={rows} kinds={kinds} editable onChange={setRows} emptyText={`${meta.name}에 배정된 목표매출이 없습니다. ‘매출 행 추가’로 입력하세요.`} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {year}년 목표매출은 부서 화면 ‘가이드라인’ 1번 표에도 나타납니다{meta.salesInput ? `(${meta.name}은 부서 화면에서도 직접 입력)` : "(조회 전용)"}.
        </p>
      </section>
    </>
  );
}
