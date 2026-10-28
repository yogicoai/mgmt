"use client";

import { useMemo, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { MONTHS, MONTHS_EN, channelTotals, kindOf, money, revenueMetrics, rowTotal, salesMonths, sum, zeros } from "@/lib/budget";
import { downloadCsv } from "@/lib/client";
import type { Channel, DepartmentDoc, DeptMeta, Revenue2026Row, RevenuePlan, SalesRow } from "@/lib/types";
import { MoneyInput } from "../budget/MoneyInput";
import { DeptBanners } from "../budget/DeptBanners";
import { BarChart } from "../charts";
import { StatCard } from "../ui";
import { ActualsPanel } from "./ActualsPanel";
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
          <section className="panel">
            <div className="panel-head">
              <h3>{year}년 매출 예산안</h3>
              <span className="muted">단위: 원 · {prevYear}년은 재무 보고 참고값(빨간 글씨는 전망치) · 수수료 행을 누르면 수정 · 채널 행에 마우스를 올리면 부서별 내역</span>
            </div>
            <div className="tablewrap free">
              <table className="revenue-report">
                <colgroup>
                  <col style={{ width: 70 }} />
                  <col style={{ width: 175 }} />
                  {MONTHS.map((m) => (
                    <col key={m} />
                  ))}
                  <col style={{ width: 125 }} />
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
                  {revenue2026.map((r, i) => (
                    <tr key={`p${i}`} className={r.type}>
                      {i === 0 && (
                        <td className="year" rowSpan={revenue2026.length}>
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
                  {rows2027.map((r, i) => (
                    <tr key={`c${i}`} className={r.type} title={r.title}>
                      {i === 0 && (
                        <td className="year" rowSpan={rows2027.length}>
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
            <button type="button" className="primary" onClick={() => setRows((list) => [...list, { kind: kinds.find((k) => !list.some((r) => r.kind === k)) ?? kinds[0], values: zeros() }])}>
              매출 행 추가
            </button>
          </div>
        </div>
        <div className="tablewrap free">
          <table className="sales-table">
            <colgroup>
              <col style={{ width: 150 }} />
              {MONTHS.map((m) => (
                <col key={m} />
              ))}
              <col style={{ width: 120 }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th>매출 구분</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>연간 합계</th>
                <th aria-label="삭제" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <select value={r.kind} aria-label="매출 구분" onChange={(e) => setRows((list) => list.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))}>
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
                        label={`${r.kind} ${MONTHS[m]} 목표매출`}
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
                        if (confirm(`‘${r.kind}’ 목표매출 행을 삭제할까요?`)) setRows((list) => list.filter((_, k) => k !== i));
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={15} className="empty">
                    {meta.name}에 배정된 목표매출이 없습니다. ‘매출 행 추가’로 입력하세요.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>{meta.name} 합계</td>
                {months.map((v, m) => (
                  <td key={m}>{money(v)}</td>
                ))}
                <td>{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {year}년 목표매출은 부서 화면 ‘가이드라인’ 1번 표에 조회 전용으로 나타납니다.
        </p>
      </section>
    </>
  );
}
