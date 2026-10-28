"use client";

import { useCallback, useEffect, useState } from "react";
import { MONTHS, money, percent } from "@/lib/budget";
import { api, formatTime } from "@/lib/client";
import type { ActualsResult } from "@/lib/types";
import { GroupedBarChart } from "../charts";

type Metric = "total" | "online" | "offline";
const METRIC_NAMES: Record<Metric, string> = { total: "온·오프 합계", online: "온라인", offline: "오프라인" };

const addNullable = (a: (number | null)[], b: (number | null)[]) => a.map((v, m) => (v === null && b[m] === null ? null : (v ?? 0) + (b[m] ?? 0)));

// 매출 실적(onlineData MCP) ↔ 목표매출 비교 — 전년 실적이면 증감률, 같은 해면 달성률
export function ActualsPanel({ year, prevYear, targetOnline, targetOffline }: { year: number; prevYear: number; targetOnline: number[]; targetOffline: number[] }) {
  const [actualYear, setActualYear] = useState(prevYear);
  const [data, setData] = useState<ActualsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<Metric>("total");

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        setData(await api<ActualsResult>(`/api/actuals?year=${actualYear}${refresh ? "&refresh=1" : ""}`));
      } catch (e) {
        setData({ configured: true, year: actualYear, online: [], offline: [], start: null, end: null, lastDate: null, fetchedAt: null, error: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    },
    [actualYear],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const achievement = actualYear === year; // 같은 해 → 달성률(실적÷목표)
  const online = data?.online.length ? data.online : Array<number | null>(12).fill(null);
  const offline = data?.offline.length ? data.offline : Array<number | null>(12).fill(null);
  const groups: Record<Metric, { actual: (number | null)[]; target: number[] }> = {
    online: { actual: online, target: targetOnline },
    offline: { actual: offline, target: targetOffline },
    total: { actual: addNullable(online, offline), target: targetOnline.map((v, m) => v + targetOffline[m]) },
  };
  const rate = (actual: number | null, target: number) => {
    if (actual === null) return null;
    if (achievement) return target ? actual / target : null;
    return actual ? target / actual - 1 : null;
  };
  const showRate = (r: number | null) => (r === null ? "—" : achievement ? `${(r * 100).toFixed(1)}%` : percent(r));
  const filled = MONTHS.map((_, m) => groups.total.actual[m] !== null);
  const lastMonth = filled.lastIndexOf(true);
  // 아직 끝나지 않은 달(예: 10월은 26일까지) — 표 머리에 * 표시
  const partialMonth =
    data?.lastDate && lastMonth >= 0 && Number(data.lastDate.slice(5, 7)) - 1 === lastMonth && new Date(Number(data.lastDate.slice(0, 4)), lastMonth + 1, 0).getDate() > Number(data.lastDate.slice(8, 10))
      ? lastMonth
      : null;
  const partial = partialMonth !== null && data?.lastDate ? `* ${partialMonth + 1}월은 ${Number(data.lastDate.slice(5, 7))}/${Number(data.lastDate.slice(8, 10))}까지(진행 중)` : null;

  const yearOptions = [prevYear - 1, prevYear, year];

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {achievement ? `${year} 목표 대비 실적 (달성률)` : `${actualYear} 실적 대비 ${year} 목표 (증감률)`} · 온라인/오프라인
        </h3>
        <div className="actions">
          <select value={actualYear} onChange={(e) => setActualYear(Number(e.target.value))} aria-label="실적 연도">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}년 실적
              </option>
            ))}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="차트 구분">
            {(Object.keys(METRIC_NAMES) as Metric[]).map((k) => (
              <option key={k} value={k}>
                차트: {METRIC_NAMES[k]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void load(true)} disabled={loading || data?.configured === false}>
            {loading ? "가져오는 중…" : "실적 새로 가져오기"}
          </button>
        </div>
      </div>

      {data && !data.configured && (
        <div className="banner warn">
          <span>
            onlineData MCP 토큰이 아직 없습니다. cloudtype 의 onlineData MCP 서비스 환경변수 <b>MCP_TOKENS</b> 에 <code>yogico-budget:&lt;24자 이상 무작위 토큰&gt;:read</code> 를 추가해 재배포하고, 같은 토큰을
            <b> .local/.env 의 ONLINEDATA_MCP_TOKEN</b> 에 넣은 뒤 서버를 다시 켜 주세요.
          </span>
        </div>
      )}
      {data?.configured && data.error && <div className="banner err">{data.error}</div>}

      {data?.configured && (
        <>
          <p className="muted" style={{ margin: "0 0 10px" }}>
            {data.start && data.lastDate ? `실적 ${data.start} ~ ${data.lastDate}` : data.note || "실적 없음"}
            {partial ? ` · ${partial}` : ""}
            {data.fetchedAt ? ` · ${data.source === "cache" ? "저장된 값" : "방금 조회"} ${formatTime(data.fetchedAt)}` : ""}
          </p>
          <GroupedBarChart
            label={`${METRIC_NAMES[metric]} 월별 목표와 실적`}
            series={[
              { label: `${year} 목표`, color: "var(--series-1)", values: groups[metric].target },
              { label: `${actualYear} 실적`, color: "var(--series-2)", values: groups[metric].actual },
            ]}
            extra={(i) => {
              const r = rate(groups[metric].actual[i], groups[metric].target[i]);
              return r === null ? "" : `${achievement ? "달성률" : "목표 증감률"} ${showRate(r)}`;
            }}
          />
          <div className="tablewrap free" style={{ marginTop: 12 }}>
            <table className="compare-table" style={{ minWidth: 1250 }}>
              <thead>
                <tr>
                  <th>구분</th>
                  {MONTHS.map((m, i) => (
                    <th key={m}>
                      {m}
                      {i === partialMonth ? "*" : ""}
                    </th>
                  ))}
                  <th>실적 있는 달 합계</th>
                </tr>
              </thead>
              <tbody>
                {(["online", "offline", "total"] as Metric[]).map((key) => {
                  const g = groups[key];
                  const actualSum = g.actual.reduce<number>((s, v) => s + (v ?? 0), 0);
                  const targetSum = g.target.reduce((s, v, m) => s + (filled[m] ? v : 0), 0);
                  return [
                    <tr key={`${key}-a`} className="group-start">
                      <td className="label-cell">
                        {actualYear} 실적 · {METRIC_NAMES[key]}
                      </td>
                      {g.actual.map((v, m) => (
                        <td key={m}>{v === null ? "" : money(v)}</td>
                      ))}
                      <td>{money(actualSum)}</td>
                    </tr>,
                    <tr key={`${key}-t`}>
                      <td className="label-cell">
                        {year} 목표 · {METRIC_NAMES[key]}
                      </td>
                      {g.target.map((v, m) => (
                        <td key={m}>{money(v)}</td>
                      ))}
                      <td>{money(targetSum)}</td>
                    </tr>,
                    <tr key={`${key}-r`}>
                      <td className="label-cell">{achievement ? "달성률" : "목표 증감률"}</td>
                      {g.actual.map((v, m) => (
                        <td key={m} className="rate">
                          {showRate(rate(v, g.target[m]))}
                        </td>
                      ))}
                      <td className="rate">{showRate(rate(lastMonth >= 0 ? actualSum : null, targetSum))}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {data.note || "온라인=이카운트 출고 기준(자사몰+스마트스토어+외부채널, 공동구매 제외), 오프라인=매장 주문서 — 서로 다른 원장이라 합산은 근사치."} 목표의 온라인은 ‘(매출) 온라인’ 행, 오프라인은 ‘(매출) 오프라인’ 행만 비교합니다(B2B·BC·공동구매 등 제외).
          </p>
        </>
      )}
      {!data && <div className="empty">실적을 불러오는 중…</div>}
    </section>
  );
}
