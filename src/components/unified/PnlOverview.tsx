"use client";

import { useMemo, useState } from "react";
import { MONTHS, channelTotals, hiddenInPnl, inBudgetTotal, isSensitiveAccount, money, percent, revenueMetrics, sum } from "@/lib/budget";
import { api, downloadCsv } from "@/lib/client";
import type { Channel, DepartmentDoc, PnlPrior, RevenuePlan } from "@/lib/types";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { UnlockDialog, useSensitiveAccess } from "../SensitiveGate";
import { StatCard, useUi, type Viewer } from "../ui";
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
//   매출액(손익계산서 = ERP 목표 − 수수료) − 매출원가(경영지원 입력) = 매출총이익 − 판관비(물류를 뺀 전 부서 계정 — 물류 금액은 물류 탭에서만) = 영업손익
export function PnlOverview({
  year,
  prevYear,
  departments,
  channels,
  plan,
  pnlPrior,
  hidden,
  onPlanSaved,
  viewer,
}: {
  year: number;
  prevYear: number;
  departments: DepartmentDoc[];
  channels: Channel[];
  plan: RevenuePlan;
  pnlPrior: PnlPrior[];
  hidden: Record<string, string[]>; // 계정과목 노출 설정(계정과목 → 숨긴 부서코드)
  onPlanSaved: (plan: RevenuePlan) => void;
  viewer: Viewer;
}) {
  const [cogsIndex, setCogsIndex] = useState<number | null>(null);
  // 2026(전년)·증감률을 별도 칸으로 편다 — 아주 좁은 화면(모바일)에서만 아랫줄로 접어 가로 폭을 줄인다
  const compact = useMediaQuery("(max-width: 820px)");
  // 급여 등 경영지원 전용 계정 줄은 비밀번호 확인 전 가림
  const sensitive = useSensitiveAccess({ isAdmin: viewer.isAdmin, master: viewer.master });
  const [unlocking, setUnlocking] = useState(false);

  // 원가율(매출원가 = 매출액 × 원가율) — 경영지원만. 적용하면 저장되어 모두에게 반영
  const { notify } = useUi();
  const [rateText, setRateText] = useState(plan.cogsRate != null ? String(+(plan.cogsRate * 100).toFixed(2)) : "");
  const [savingRate, setSavingRate] = useState(false);
  const saveRate = async (rate: number | null) => {
    setSavingRate(true);
    try {
      const { plan: next } = await api<{ plan: RevenuePlan }>("/api/revenue", { method: "PATCH", body: JSON.stringify({ revision: plan.revision, cogsRate: rate }) });
      onPlanSaved(next);
      notify(rate == null ? "원가율을 해제했습니다 — 제품·상품 매출원가 수동 입력을 씁니다." : `원가율 ${+(rate * 100).toFixed(2)}%를 적용했습니다.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSavingRate(false);
    }
  };
  const applyRate = () => {
    const pct = Number(rateText.replace(/,/g, "").trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return notify("원가율은 0~100 사이 숫자로 입력해 주세요.", true);
    void saveRate(pct / 100);
  };

  const sensitiveNames = useMemo(() => new Set(departments.flatMap((d) => d.accounts.filter(isSensitiveAccount).map((a) => a.name))), [departments]);
  const maskedRow = (label: string) => !sensitive.visible && sensitiveNames.has(label);
  const priorOf = (name: string) => pnlPrior.find((p) => p.name === name)?.prior ?? null;

  const rows = useMemo<PnlRow[]>(() => {
    const { values } = channelTotals(departments, channels);
    const revenue = revenueMetrics(values, plan.fees).net;
    // 원가율이 있으면 매출원가 = 매출액 × 원가율(월별 자동), 없으면 제품·상품 수동입력 합
    const rate = plan.cogsRate ?? null;
    const cogs = rate != null ? revenue.map((v) => Math.round(v * rate)) : MONTHS.map((_, m) => plan.cogs.reduce((s, r) => s + (r.values[m] || 0), 0));
    const gross = revenue.map((v, m) => v - cogs[m]);
    // 계정과목 노출의 ‘2027 손익’ 칸에서 미포함한 계정은 판관비 합계·표에서 모두 뺀다(물류처럼 — 금액이 있어도 제외)
    const accountList = (departments[0]?.accounts ?? []).filter((a) => !hiddenInPnl(hidden, a.name));
    const accountNames = accountList.map((a) => a.name);
    const accountMonths = accountNames.map((name) =>
      MONTHS.map((_, m) => departments.filter((d) => inBudgetTotal(d.code)).reduce((t, d) => t + (d.accounts.find((a) => a.name === name)?.rows.reduce((s, r) => s + (r.values[m] || 0), 0) ?? 0), 0)),
    );
    const sga = MONTHS.map((_, m) => accountMonths.reduce((t, a) => t + a[m], 0));
    const operating = gross.map((v, m) => v - sga[m]);
    const accountRows = accountList.map((a, i) => ({ label: a.name, months: accountMonths[i], prior: priorOf(a.origin ?? a.name), kind: "account" as const })); // 이름을 고쳐도 전년 값은 원래 이름으로
    return [
      { label: "Ⅰ.매출액", months: revenue, prior: priorOf("Ⅰ.매출액"), kind: "head" },
      { label: rate != null ? `Ⅱ.매출원가 (원가율 ${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%)` : "Ⅱ.매출원가", months: cogs, prior: priorOf("Ⅱ.매출원가"), kind: "head" },
      // 원가율 적용 중이면 제품·상품 수동줄은 숨긴다(원가율이 매출원가를 덮어쓰므로)
      ...(rate != null ? [] : plan.cogs.map((c, i) => ({ label: c.label, months: c.values, prior: null, kind: "sub" as const, cogsIndex: i }))),
      { label: "Ⅲ.매출총이익", months: gross, prior: priorOf("Ⅲ.매출총이익"), kind: "result" },
      ...accountRows,
      { label: "Ⅳ.판매비와관리비", months: sga, prior: priorOf("Ⅳ.판매비와관리비"), kind: "head" },
      { label: "Ⅴ.영업손익", months: operating, prior: priorOf("Ⅴ.영업손익"), kind: "result" },
    ];
  }, [departments, channels, plan, pnlPrior, hidden]); // priorOf 는 pnlPrior 로만 결정된다

  const get = (label: string) => rows.find((r) => r.label === label)!;
  const total = (label: string) => sum(get(label).months);
  const revenueTotal = total("Ⅰ.매출액");
  const grossTotal = total("Ⅲ.매출총이익");
  const sgaTotal = total("Ⅳ.판매비와관리비");
  const opTotal = total("Ⅴ.영업손익");
  const cogsEmpty = plan.cogsRate == null && total("Ⅱ.매출원가") === 0; // 원가율 적용 중이면 '미입력' 안내 안 함
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
          <span className="muted">매출액(손익계산서) − 매출원가 = 매출총이익 − 판매비와관리비(물류 제외 전 부서 합산) = 영업손익</span>
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
          {viewer.isAdmin && (
            <span className="cogs-rate" title="매출원가 = 매출액 × 원가율로 자동 계산됩니다. 비우고 [해제]하면 제품·상품 매출원가 수동 입력을 씁니다.">
              원가율
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.1}
                value={rateText}
                disabled={savingRate}
                placeholder="예: 50"
                aria-label="매출원가 원가율(%)"
                onChange={(e) => setRateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) applyRate();
                }}
              />
              %
              <button type="button" className="primary" disabled={savingRate} onClick={applyRate}>
                적용
              </button>
              {plan.cogsRate != null && (
                <button type="button" disabled={savingRate} onClick={() => { setRateText(""); void saveRate(null); }}>
                  해제
                </button>
              )}
            </span>
          )}
        </div>
        <p className="muted" style={{ margin: "-4px 0 10px", fontSize: 12 }}>
          단위: 원 · {prevYear}는 원본 손익표의 전년 값 · 매출액은 전체 매출 현황의 ‘(손익계산서) 매출액’ · 판관비는 부서 화면 입력값 실시간 합산 · 원가율을 넣으면 매출원가·매출총이익·증감이 자동으로 바뀝니다
        </p>
        <div className="tablewrap free">
          <table className="pnl-table fit-table">
            <colgroup>
              <col style={{ width: "9%" }} />
              {compact ? (
                <>
                  <col style={{ width: "8.4%" }} />
                  <col style={{ width: "7.8%" }} />
                </>
              ) : (
                <>
                  <col style={{ width: "7.2%" }} />
                  <col style={{ width: "7.2%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "4.6%" }} />
                </>
              )}
              {MONTHS.map((m) => (
                <col key={m} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                {compact ? (
                  <>
                    <th>
                      {year}
                      <span className="sub-line">{prevYear}</span>
                    </th>
                    <th>
                      증감
                      <span className="sub-line">증감률</span>
                    </th>
                  </>
                ) : (
                  <>
                    <th>{prevYear}</th>
                    <th>{year}</th>
                    <th>증감</th>
                    <th>증감률</th>
                  </>
                )}
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
                      {Array.from({ length: (compact ? 2 : 4) + MONTHS.length }, (_, i) => (
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
                    {compact ? (
                      <>
                        <td>
                          <b>{money(now)}</b>
                          {r.prior !== null && <span className="sub-line">{money(r.prior)}</span>}
                        </td>
                        <td className={r.prior !== null && now - r.prior < 0 ? "neg" : undefined}>
                          {r.prior === null ? "" : money(now - r.prior)}
                          {r.prior !== null && <span className={`sub-line${c !== null && c < 0 ? " neg" : ""}`}>{percent(c)}</span>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="muted">{r.prior === null ? "" : money(r.prior)}</td>
                        <td>
                          <b>{money(now)}</b>
                        </td>
                        <td className={r.prior !== null && now - r.prior < 0 ? "neg" : undefined}>{r.prior === null ? "" : money(now - r.prior)}</td>
                        <td className={c !== null && c < 0 ? "neg" : undefined}>{r.prior === null ? "" : percent(c)}</td>
                      </>
                    )}
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
