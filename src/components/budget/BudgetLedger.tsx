"use client";

import { useEffect, useMemo, useState } from "react";
import { MONTHS, accountMonths, accountsMonths, filledAccountCount, money, sum } from "@/lib/budget";
import { api, downloadFrom, formatTime } from "@/lib/client";
import type { BudgetAccount, DepartmentDoc, ReviewComment } from "@/lib/types";
import { StatCard, useUi } from "../ui";
import { AccountDetailDialog } from "./AccountDetailDialog";

// 계정별 월별 예산 원장 — 부서 화면과 통합 화면의 부서 탭이 같이 쓴다
export function BudgetLedger({
  doc,
  editable,
  statusLabel,
  actions,
  onAccountsChange,
  onBeforeExport,
  openReviews = {},
  isAdmin = false,
}: {
  doc: DepartmentDoc;
  editable: boolean;
  statusLabel: string;
  actions?: React.ReactNode;
  onAccountsChange: (updater: (accounts: BudgetAccount[]) => BudgetAccount[]) => void;
  onBeforeExport?: () => Promise<unknown>; // 내려받기 전에 저장 대기 중인 값부터 저장
  openReviews?: Record<string, ReviewComment[]>; // 계정별 반영 필요 검토 의견
  isAdmin?: boolean; // 경영지원 — '경영지원 입력' 줄도 입력·잠금 전환
}) {
  const { showTip, hideTip, notify } = useUi();
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [prior, setPrior] = useState<Record<string, number[]>>({});

  // 행별 2026 실적(원본 자료) — 상세 창 참고 칸
  useEffect(() => {
    api<{ prior: Record<string, number[]> }>(`/api/departments/${doc.code}/prior`)
      .then((r) => setPrior(r.prior))
      .catch(() => undefined);
  }, [doc.code]);
  const accounts = doc.accounts;
  const months = accountsMonths(accounts);
  const total = sum(months);

  const visible = useMemo(() => {
    const q = query.replace(/\s/g, "").toLowerCase();
    return accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => !q || [account.name, ...account.rows.flatMap((r) => [r.item, r.desc])].join("").replace(/\s/g, "").toLowerCase().includes(q));
  }, [accounts, query]);

  const monthNotes = (account: BudgetAccount, m: number) =>
    account.rows
      .filter((r) => r.memos?.[m]?.trim())
      .map((r) => `${[r.item, r.desc].filter(Boolean).join(" · ")}\n${r.memos![m]}`)
      .join("\n\n");

  // 엑셀 — account 를 주면 그 계정 상세, 없으면 부서 전체(계정별 요약 + 상세 내역)
  const exportExcel = async (account?: number) => {
    setExporting(true);
    try {
      await onBeforeExport?.();
      await downloadFrom(`/api/departments/${doc.code}/excel${account === undefined ? "" : `?account=${account}`}`, `${doc.year}_${doc.name}.xlsx`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="cards">
        <StatCard label="연간 예산" value={money(total)} note={`${doc.name} 전체 계정 합계`} />
        <StatCard label="월평균 예산" value={money(total / 12)} note="연간 예산 ÷ 12개월" />
        <StatCard label="입력 계정" value={`${filledAccountCount(accounts)} / ${accounts.length}`} unit="개" note="금액이 입력된 계정" />
        <StatCard label="상태" value={statusLabel} unit="" note={doc.closed ? `마감 ${formatTime(doc.closedAt)}` : doc.savedAt ? `마지막 저장 ${formatTime(doc.savedAt)}` : "입력 전"} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>계정별 월별 예산</h3>
          <span className="muted">단위: 원 · 계정을 누르면 상세 {editable ? "입력" : "조회"}</span>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="계정명 · 상세내역 검색" aria-label="계정명 및 상세내역 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="actions">
            {actions}
            <button type="button" disabled={exporting} onClick={() => void exportExcel()} title="계정별 요약 + 상세 내역(메모 포함)">
              {exporting ? "만드는 중…" : "엑셀 다운로드"}
            </button>
          </div>
        </div>
        <div className="tablewrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>계정과목</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>연간 합계</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ account, index }) => {
                const values = accountMonths(account);
                return (
                  <tr key={account.name}>
                    <td>
                      <button type="button" className="account-button" onClick={() => setOpenIndex(index)} aria-haspopup="dialog">
                        {account.name}
                        <span>상세</span>
                        {account.rows.some((r) => r.locked) && (
                          <span className="lock-chip" title="급여·4대보험·회사 행사 등 경영지원이 입력하는 줄이 있습니다">
                            🔒 {account.rows.every((r) => r.locked) ? "경영지원" : "일부 경영지원"}
                          </span>
                        )}
                        {openReviews[account.name]?.length ? (
                          <span className="review-chip" title="경영지원 검토 의견(반영 필요)">
                            💬 {openReviews[account.name].length}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    {values.map((v, m) => {
                      const notes = monthNotes(account, m);
                      return (
                        <td
                          key={m}
                          className={`memo-cell${notes ? " has-memo" : ""}`}
                          tabIndex={notes ? 0 : undefined}
                          aria-label={notes ? `${MONTHS[m]} ${money(v)}원, 메모 있음` : undefined}
                          onMouseEnter={notes ? (e) => showTip(e.currentTarget, notes) : undefined}
                          onMouseLeave={notes ? hideTip : undefined}
                          onFocus={notes ? (e) => showTip(e.currentTarget, notes) : undefined}
                          onBlur={notes ? hideTip : undefined}
                        >
                          {money(v)}
                        </td>
                      );
                    })}
                    <td>
                      <b>{money(sum(values))}</b>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={14} className="empty">
                    검색 결과가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>{doc.name} 합계</td>
                {months.map((v, m) => (
                  <td key={m}>{money(v)}</td>
                ))}
                <td>{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      {openIndex !== null && accounts[openIndex] && (
        <AccountDetailDialog
          deptName={doc.name}
          account={accounts[openIndex]}
          editable={editable}
          onChange={(next) => onAccountsChange((list) => list.map((a, i) => (i === openIndex ? next : a)))}
          onClose={() => setOpenIndex(null)}
          onExport={() => void exportExcel(openIndex)}
          exporting={exporting}
          reviews={openReviews[accounts[openIndex].name] ?? []}
          isAdmin={isAdmin}
          prior={prior}
        />
      )}
    </>
  );
}
