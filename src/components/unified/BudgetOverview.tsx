"use client";

import { useEffect, useState } from "react";
import { MONTHS, accountsMonths, departmentStatus, money, sum } from "@/lib/budget";
import { api, downloadCsv } from "@/lib/client";
import type { DepartmentDoc } from "@/lib/types";
import { BarChart, RankBars } from "../charts";
import { Modal, StatCard, useUi } from "../ui";

// 전체 예산 현황 — 부서 문서의 계정별 예산을 그대로 합산(원본 renderOverview)
export function BudgetOverview({ year, departments, onSelect, onImported }: { year: number; departments: DepartmentDoc[]; onSelect: (code: string) => void; onImported: () => void }) {
  const [importing, setImporting] = useState(false);
  const [reviewCounts, setReviewCounts] = useState<Record<string, { open: number; total: number }>>({});
  useEffect(() => {
    api<{ counts: Record<string, { open: number; total: number }> }>("/api/reviews")
      .then((r) => setReviewCounts(r.counts))
      .catch(() => undefined);
  }, [departments]);
  const perDept = departments.map((d) => ({ doc: d, months: accountsMonths(d.accounts) }));
  const months = MONTHS.map((_, m) => perDept.reduce((t, d) => t + d.months[m], 0));
  const total = sum(months);
  const saved = departments.filter((d) => d.savedAt || d.closed).length;
  const closed = departments.filter((d) => d.closed).length;
  const accountNames = new Set(departments.flatMap((d) => d.accounts.map((a) => a.name)));

  const exportCsv = () =>
    downloadCsv(`${year}_예산원장_통합.csv`, [
      ["연도", "부서", "계정과목", "구분", "상세설명", "연간 합계", ...MONTHS],
      ...departments.flatMap((d) => d.accounts.flatMap((a) => a.rows.map((r) => [year, d.name, a.name, r.item, r.desc, sum(r.values), ...r.values]))),
    ]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>전체 예산 현황</h2>
          <span className="muted">
            {year}년 · {departments.length}개 부서 통합 · 부서 화면에서 저장한 값이 바로 합산됩니다
          </span>
        </div>
        <div className="actions">
          <button type="button" onClick={() => setImporting(true)}>
            HTML 작성본 불러오기
          </button>
          <button type="button" onClick={exportCsv}>
            통합 원장 CSV
          </button>
        </div>
      </div>
      <div className="cards">
        <StatCard label="전체 연간 예산" value={money(total)} note={`${departments.length}개 부서 계정별 예산 합계`} />
        <StatCard label="월평균 예산" value={money(total / 12)} note="연간 예산 ÷ 12개월" />
        <StatCard label="자료 저장 부서" value={`${saved} / ${departments.length}`} unit="개" note={`마감 ${closed}개 부서`} />
        <StatCard label="예산 계정" value={accountNames.size} unit="개" note="전체 부서 계정 기준" />
      </div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h3>월별 전체 예산</h3>
            <span className="muted">단위: 원</span>
          </div>
          <BarChart values={months} label="월별 전체 예산" />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>부서별 연간 예산</h3>
            <span className="muted">단위: 원 · 부서를 누르면 원장</span>
          </div>
          <RankBars rows={perDept.map(({ doc, months: m }) => ({ key: doc.code, name: doc.name, total: sum(m), onClick: () => onSelect(doc.code) }))} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>부서별 월별 예산</h3>
          <span className="muted">단위: 원</span>
        </div>
        <div className="tablewrap free">
          <table style={{ minWidth: 1250 }}>
            <thead>
              <tr>
                <th>부서</th>
                <th>상태</th>
                <th>검토 의견</th>
                <th>연간 합계</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perDept.map(({ doc, months: m }) => {
                const status = departmentStatus(doc);
                return (
                  <tr key={doc.code}>
                    <td>
                      <button type="button" className="account-button" onClick={() => onSelect(doc.code)}>
                        {doc.name}
                      </button>
                    </td>
                    <td>
                      <span className={`badge${status === "마감 완료" ? " closed" : status === "저장 완료" ? " saved" : ""}`}>{status}</span>
                    </td>
                    <td>
                      {reviewCounts[doc.code]?.total ? (
                        <button type="button" className="link" onClick={() => onSelect(doc.code)} title={`전체 ${reviewCounts[doc.code].total}건`}>
                          {reviewCounts[doc.code].open ? <span className="badge warn">반영 필요 {reviewCounts[doc.code].open}</span> : <span className="badge saved">모두 반영</span>}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <b>{money(sum(m))}</b>
                    </td>
                    {m.map((v, i) => (
                      <td key={i}>{money(v)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>전체 합계</td>
                <td>{money(total)}</td>
                {months.map((v, i) => (
                  <td key={i}>{money(v)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={onImported} />}
    </>
  );
}

interface Preview {
  kind: "department" | "unified";
  fileName: string;
  fees: boolean;
  skipped: string[];
  departments: {
    code: string;
    name: string;
    closed: boolean;
    currentTotal: number;
    accountsTotal: number | null;
    accountRows: number;
    personnel: number | null;
    salesTotal: number | null;
    attachments: number;
  }[];
}

// 기존 HTML 작성본(부서 작성본·마감본, 통합 작성본) → DB 로 옮기기. 미리보기 후 고른 부서만 교체
function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { notify } = useUi();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fees, setFees] = useState(true);
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", f);
      form.set("mode", "preview");
      const result = await api<Preview>("/api/import", { method: "POST", body: form });
      setPreview(result);
      setSelected(new Set(result.departments.filter((d) => !d.closed).map((d) => d.code)));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!file || !preview || !selected.size) return;
    const names = preview.departments.filter((d) => selected.has(d.code)).map((d) => d.name);
    if (!confirm(`${names.join(", ")} 의 계정별 예산·인원정보·목표매출을 이 파일 내용으로 바꿉니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", "apply");
      form.set("depts", [...selected].join(","));
      form.set("fees", fees ? "1" : "0");
      const result = await api<{ applied: string[]; skipped: string[] }>("/api/import", { method: "POST", body: form });
      notify(`불러옴: ${result.applied.join(", ") || "없음"}${result.skipped.length ? ` · 건너뜀: ${result.skipped.join(", ")}` : ""}`);
      onImported();
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      className="fee-dialog"
      title="HTML 작성본 불러오기"
      onClose={onClose}
      footer={
        <>
          <span className="muted">마감된 부서는 바꿀 수 없습니다(먼저 마감 해제)</span>
          <button type="button" className="primary" disabled={busy || !preview || !selected.size} onClick={() => void apply()}>
            고른 부서에 적용
          </button>
        </>
      }
    >
      <div className="modal-body">
        <p className="muted" style={{ marginTop: 0 }}>
          예전 방식으로 저장한 ‘2027년_정기_예산_대시보드_…_작성본.html’ 또는 통합 작성본 HTML 을 고르면, 내용을 확인한 뒤 DB 로 옮깁니다.
        </p>
        <input type="file" accept=".html,.htm" onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
        {busy && !preview && <p className="muted">파일을 읽는 중…</p>}
        {preview && (
          <>
            <p className="muted">
              {preview.fileName} · {preview.kind === "unified" ? "통합 작성본" : "부서 작성본"}
              {preview.skipped.length ? ` · 알 수 없는 부서 건너뜀: ${preview.skipped.join(", ")}` : ""}
            </p>
            <div className="tablewrap free">
              <table className="import-summary">
                <thead>
                  <tr>
                    <th>적용</th>
                    <th>부서</th>
                    <th>파일 연간 예산</th>
                    <th>현재 연간 예산</th>
                    <th>인원 행</th>
                    <th>목표매출</th>
                    <th>첨부</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.departments.map((d) => (
                    <tr key={d.code}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(d.code)}
                          disabled={d.closed}
                          aria-label={`${d.name} 적용`}
                          onChange={(e) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(d.code);
                              else next.delete(d.code);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        {d.name}
                        {d.closed ? " (마감)" : ""}
                      </td>
                      <td>{d.accountsTotal === null ? "—" : money(d.accountsTotal)}</td>
                      <td>{money(d.currentTotal)}</td>
                      <td>{d.personnel ?? "—"}</td>
                      <td>{d.salesTotal === null ? "—" : money(d.salesTotal)}</td>
                      <td>{d.attachments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.fees && (
              <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} /> 파일의 매출 수수료(오프라인·PG·VAT) 금액도 적용
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
