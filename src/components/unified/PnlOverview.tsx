"use client";

import { useMemo, useState } from "react";
import { MONTHS, channelTotals, isSensitiveAccount, money, percent, revenueMetrics, sum } from "@/lib/budget";
import { downloadCsv } from "@/lib/client";
import type { Channel, DepartmentDoc, PnlPrior, RevenuePlan } from "@/lib/types";
import { UnlockDialog, useSensitiveAccess } from "../SensitiveGate";
import { StatCard, type Viewer } from "../ui";
import { PlanRowDialog } from "./PlanRowDialog";

interface PnlRow {
  label: string;
  months: number[];
  prior: number | null;
  kind: "head" | "sub" | "account" | "result";
  cogsIndex?: number;
}

const ratio = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

// 손익 기준 예산안 — 원본 HTML 에서 숨겨져 있던 '손익 기준 / 영업손익 취합본'을 되살린 것.
//   매출액(손익계산서 = ERP 목표 − 수수료) − 매출원가(경영지원 입력) = 매출총이익 − 판관비(전 부서 30개 계정) = 영업손익
export function PnlOverview({
  year,
  prevYear,
  departments,
  channels,
  plan,
  pnlPrior,
  onPlanSaved,
  viewer,
}: {
  year: number;
  prevYear: number;
  departments: DepartmentDoc[];
  channels: Channel[];
  plan: RevenuePlan;
  pnlPrior: PnlPrior[];
  onPlanSaved: (plan: RevenuePlan) => void;
  viewer: Viewer;
}) {
  const [cogsIndex, setCogsIndex] = useState<number | null>(null);
  // 급여 등 경영지원 전용 계정 줄은 비밀번호 확인 전 가림
  const sensitive = useSensitiveAccess({ isAdmin: viewer.isAdmin, master: viewer.master });
  const [unlocking, setUnlocking] = useState(false);
  const sensitiveNames = useMemo(() => new Set(departments.flatMap((d) => d.accounts.filter(isSensitiveAccount).map((a) => a.name))), [departments]);
  const maskedRow = (label: string) => !sensitive.visible && sensitiveNames.has(label);
  const priorOf = (name: string) => pnlPrior.find((p) => p.name === name)?.prior ?? null;

  const rows = useMemo<PnlRow[]>(() => {
    const { values } = channelTotals(departments, channels);
    const revenue = revenueMetrics(values, plan.fees).net;
    const cogs = MONTHS.map((_, m) => plan.cogs.reduce((s, r) => s + (r.values[m] || 0), 0));
    const gross = revenue.map((v, m) => v - cogs[m]);
    const accountNames = departments[0]?.accounts.map((a) => a.name) ?? [];
    const accountMonths = accountNames.map((name) =>
      MONTHS.map((_, m) => departments.reduce((t, d) => t + (d.accounts.find((a) => a.name === name)?.rows.reduce((s, r) => s + (r.values[m] || 0), 0) ?? 0), 0)),
    );
    const sga = MONTHS.map((_, m) => accountMonths.reduce((t, a) => t + a[m], 0));
    const operating = gross.map((v, m) => v - sga[m]);
    return [
      { label: "Ⅰ.매출액", months: revenue, prior: priorOf("Ⅰ.매출액"), kind: "head" },
      { label: "Ⅱ.매출원가", months: cogs, prior: priorOf("Ⅱ.매출원가"), kind: "head" },
      ...plan.cogs.map((c, i) => ({ label: c.label, months: c.values, prior: null, kind: "sub" as const, cogsIndex: i })),
      { label: "Ⅲ.매출총이익", months: gross, prior: priorOf("Ⅲ.매출총이익"), kind: "result" },
      ...accountNames.map((name, i) => ({ label: name, months: accountMonths[i], prior: priorOf(name), kind: "account" as const })),
      { label: "Ⅳ.판매비와관리비", months: sga, prior: priorOf("Ⅳ.판매비와관리비"), kind: "head" },
      { label: "Ⅴ.영업손익", months: operating, prior: priorOf("Ⅴ.영업손익"), kind: "result" },
    ];
  }, [departments, channels, plan, pnlPrior]); // priorOf 는 pnlPrior 로만 결정된다

  const get = (label: string) => rows.find((r) => r.label === label)!;
  const total = (label: string) => sum(get(label).months);
  const revenueTotal = total("Ⅰ.매출액");
  const grossTotal = total("Ⅲ.매출총이익");
  const sgaTotal = total("Ⅳ.판매비와관리비");
  const opTotal = total("Ⅴ.영업손익");
  const cogsEmpty = total("Ⅱ.매출원가") === 0;
  const change = (now: number, before: number | null) => (before === null || before === 0 ? null : (now - before) / Math.abs(before));

  const exportCsv = () =>
    downloadCsv(`${year}_손익_기준_예산안.csv`, [
      ["구분", `${prevYear}`, `${year}`, "증감", "증감률", ...MONTHS],
      ...rows.map((r) => {
        const now = sum(r.months);
        const c = change(now, r.prior);
        if (maskedRow(r.label)) return [r.label, "", "", "", "", ...r.months.map(() => "")];
        return [r.label, r.prior ?? "", now, r.prior === null ? "" : now - r.prior, c === null ? "" : `${(c * 100).toFixed(1)}%`, ...r.months];
      }),
    ]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>{year} 손익 기준 예산안</h2>
          <span className="muted">매출액(손익계산서) − 매출원가 = 매출총이익 − 판매비와관리비(전 부서 합산) = 영업손익</span>
        </div>
        <div className="actions">
          {!sensitive.visible && sensitive.canUnlock && (
            <button type="button" onClick={() => setUnlocking(true)} title="급여 등 경영지원 전용 계정 줄 보기">
              🔒 급여 등 보기
            </button>
          )}
          <button type="button" onClick={exportCsv}>
            손익 CSV
          </button>
        </div>
      </div>
      <div className="cards">
        <StatCard label={`${year} 매출액`} value={money(revenueTotal)} note={`${prevYear} 대비 ${percent(change(revenueTotal, priorOf("Ⅰ.매출액")))}`} />
        <StatCard label="매출총이익" value={money(grossTotal)} note={`매출총이익률 ${ratio(grossTotal, revenueTotal)}${cogsEmpty ? " · 매출원가 입력 전" : ""}`} />
        <StatCard label="판매비와관리비" value={money(sgaTotal)} note={`${prevYear} 대비 ${percent(change(sgaTotal, priorOf("Ⅳ.판매비와관리비")))} · 매출 대비 ${ratio(sgaTotal, revenueTotal)}`} />
        <StatCard label="영업손익" value={money(opTotal)} note={`영업이익률 ${ratio(opTotal, revenueTotal)} · ${prevYear} ${money(priorOf("Ⅴ.영업손익"))}원`} />
      </div>
      {cogsEmpty && (
        <div className="banner warn">
          <span>
            매출원가가 아직 입력되지 않아 매출총이익이 매출액과 같게 나옵니다. 표의 <b>제품매출원가·상품매출원가</b> 줄을 눌러 월별로 입력하세요(가이드라인 2번: 경영지원 담당).
          </span>
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>손익 기준 예산안</h3>
          <span className="muted">
            단위: 원 · {prevYear}는 원본 손익표의 전년 값 · 매출액은 전체 매출 현황의 ‘(손익계산서) 매출액’ · 판관비는 부서 화면 입력값 실시간 합산
          </span>
        </div>
        <div className="tablewrap free">
          <table className="pnl-table">
            <colgroup>
              <col style={{ width: 160 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 115 }} />
              <col style={{ width: 70 }} />
              {MONTHS.map((m) => (
                <col key={m} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>{prevYear}</th>
                <th>{year}</th>
                <th>증감</th>
                <th>증감률</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const now = sum(r.months);
                const c = change(now, r.prior);
                if (maskedRow(r.label))
                  return (
                    <tr key={r.label} className={`pnl-${r.kind}`}>
                      <td>
                        {r.label} <span className="lock-chip">🔒</span>
                      </td>
                      {Array.from({ length: 4 + MONTHS.length }, (_, i) => (
                        <td key={i} className="masked-cell">
                          •••
                        </td>
                      ))}
                    </tr>
                  );
                return (
                  <tr key={r.label} className={`pnl-${r.kind}`}>
                    <td>
                      {r.cogsIndex !== undefined ? (
                        <button type="button" className="link" onClick={() => setCogsIndex(r.cogsIndex!)} title="월별 매출원가 입력">
                          {r.label} ✎
                        </button>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="muted">{r.prior === null ? "" : money(r.prior)}</td>
                    <td>
                      <b>{money(now)}</b>
                    </td>
                    <td className={r.prior !== null && now - r.prior < 0 ? "neg" : undefined}>{r.prior === null ? "" : money(now - r.prior)}</td>
                    <td className={c !== null && c < 0 ? "neg" : undefined}>{r.prior === null ? "" : percent(c)}</td>
                    {r.months.map((v, m) => (
                      <td key={m} className={v < 0 ? "neg" : undefined}>
                        {money(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {unlocking && <UnlockDialog onClose={() => setUnlocking(false)} />}
      {cogsIndex !== null && <PlanRowDialog plan={plan} field="cogs" index={cogsIndex} onSaved={onPlanSaved} onClose={() => setCogsIndex(null)} />}
    </>
  );
}
