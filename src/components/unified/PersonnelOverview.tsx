"use client";

import { useState } from "react";
import { MONTHS, personnelMonths } from "@/lib/budget";
import { downloadCsv } from "@/lib/client";
import type { DepartmentDoc } from "@/lib/types";

// 인원현황 — 부서가 입력한 2027년 인원정보를 부서별로 묶어서(원본 renderPersonnelOverview)
export function PersonnelOverview({ year, departments }: { year: number; departments: DepartmentDoc[] }) {
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? departments : departments.filter((d) => d.code === filter);
  const totals = MONTHS.map((_, m) => shown.reduce((t, d) => t + personnelMonths(d.personnel)[m], 0));

  const exportCsv = () =>
    downloadCsv(`${year}_인원현황.csv`, [
      ["부서코드", "부서", "직급", "매장명", "이름", ...MONTHS],
      ...shown.flatMap((d) => d.personnel.map((p) => [d.code, d.name, p.position, p.store ?? "", p.name, ...p.values])),
    ]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>{year}년 인원현황</h2>
          <span className="muted">인원 구성은 경영지원이 각 팀 화면 ‘{year}년 인원정보’에서 입력(영업 매장 직원은 영업 계정도 입력 가능)</span>
        </div>
        <div className="actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="인원현황 부서 선택">
            <option value="all">전체</option>
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={exportCsv}>
            인원 CSV
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>부서별 월별 인원</h3>
          <span className="muted">단위: 명</span>
        </div>
        <div className="tablewrap">
          <table className="headcount-table">
            <colgroup>
              <col style={{ width: 170 }} />
              <col style={{ width: 140 }} />
              {MONTHS.map((m) => (
                <col key={m} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>부서명 / 직급</th>
                <th>성명</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((d) => [
                <tr key={d.code} className="dept">
                  <td>
                    {d.name} ({d.code})
                  </td>
                  <td>
                    <a href={`/dept/${d.code}#personnel`} target="_blank" rel="noreferrer" title={`${d.name} 인원정보 입력 화면`}>
                      인원 입력 ↗
                    </a>
                  </td>
                  {personnelMonths(d.personnel).map((v, m) => (
                    <td key={m}>{v.toLocaleString("ko-KR")}</td>
                  ))}
                </tr>,
                ...d.personnel.map((p, i) => (
                  <tr key={`${d.code}-${i}`} className="person">
                    <td>
                      {p.position || "—"}
                      {p.store ? ` · ${p.store}` : ""}
                    </td>
                    <td>{p.name}</td>
                    {p.values.map((v, m) => (
                      <td key={m}>{v.toLocaleString("ko-KR")}</td>
                    ))}
                  </tr>
                )),
                ...(d.personnel.length
                  ? []
                  : [
                      <tr key={`${d.code}-none`} className="none">
                        <td colSpan={14}>입력된 인원정보가 없습니다.</td>
                      </tr>,
                    ]),
              ])}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>전체 합계</td>
                {totals.map((v, m) => (
                  <td key={m}>{v.toLocaleString("ko-KR")}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
