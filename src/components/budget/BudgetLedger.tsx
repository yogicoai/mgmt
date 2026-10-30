"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MONTHS, accountMonths, accountsMonths, filledAccountCount, isSensitiveAccount, money, sum } from "@/lib/budget";
import { api, downloadFrom, formatTime } from "@/lib/client";
import type { BudgetAccount, DepartmentDoc, ReviewComment } from "@/lib/types";
import { UnlockDialog, useSensitiveAccess } from "../SensitiveGate";
import { Modal, StatCard, useUi } from "../ui";
import { AccountDetailDialog } from "./AccountDetailDialog";

interface UploadPreview {
  accounts: BudgetAccount[];
  summary: {
    changed: number;
    added: number;
    unchanged: number;
    lockedSkipped: number;
    unknownAccounts: string[];
    details: { account: string; item: string; desc: string; before: number; after: number; added?: boolean }[];
  };
  problems: string[];
  fileName: string;
}

const NONE: string[] = [];

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
  master = false,
  hiddenAccounts = NONE,
}: {
  doc: DepartmentDoc;
  editable: boolean;
  statusLabel: string;
  actions?: React.ReactNode;
  onAccountsChange: (updater: (accounts: BudgetAccount[]) => BudgetAccount[]) => void;
  onBeforeExport?: () => Promise<unknown>; // 내려받기 전에 저장 대기 중인 값부터 저장
  openReviews?: Record<string, ReviewComment[]>; // 계정별 반영 필요 검토 의견
  isAdmin?: boolean; // 경영지원 — '경영지원 입력' 줄도 입력·잠금 전환
  hiddenAccounts?: string[]; // 계정과목 노출 설정에서 이 부서에 숨긴 계정 — 팀 화면에서는 빠지고 경영지원 화면에는 흐리게
  master?: boolean;
}) {
  const { showTip, hideTip, notify } = useUi();
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [prior, setPrior] = useState<Record<string, number[]>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  // 경영지원 전용 계정(급여 등) — 팀은 서버가 금액을 안 보냄, 경영지원은 비밀번호 확인 후
  const sensitive = useSensitiveAccess({ isAdmin, master });
  const [unlocking, setUnlocking] = useState(false);
  const hiddenAmount = (account: BudgetAccount) => account.masked || (isSensitiveAccount(account) && !sensitive.visible);

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
      .filter(({ account }) => isAdmin || !hiddenAccounts.includes(account.name))
      .filter(({ account }) => !q || [account.name, ...account.rows.flatMap((r) => [r.item, r.desc])].join("").replace(/\s/g, "").toLowerCase().includes(q));
  }, [accounts, query, isAdmin, hiddenAccounts]);
  const shownAccounts = isAdmin ? accounts : accounts.filter((a) => !hiddenAccounts.includes(a.name));

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
      const query = new URLSearchParams();
      if (account !== undefined) query.set("account", String(account));
      if (isAdmin && sensitive.visible) query.set("sensitive", "1"); // 비밀번호 확인 전에는 급여 등은 빼고 내려받음
      const qs = query.toString();
      await downloadFrom(`/api/departments/${doc.code}/excel${qs ? `?${qs}` : ""}`, `${doc.year}_${doc.name}.xlsx`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setExporting(false);
    }
  };

  // 엑셀 업로드 — 서버가 파일을 읽어 지금 예산에 합친 결과를 주면, 확인 후 평소 저장 경로로 반영
  const uploadExcel = async (file: File) => {
    setUploading(true);
    try {
      await onBeforeExport?.();
      const res = await fetch(`/api/departments/${doc.code}/excel`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "엑셀을 읽지 못했습니다.");
      const s = body.summary as UploadPreview["summary"];
      if (!s.changed && !s.added) {
        notify(
          [`바뀐 금액이 없습니다(같은 행 ${s.unchanged}개).`, s.lockedSkipped ? `🔒 경영지원 입력 줄 ${s.lockedSkipped}개는 건너뜀.` : "", s.unknownAccounts.length ? `없는 계정과목: ${s.unknownAccounts.join(", ")}` : ""]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }
      setPreview({ ...body, fileName: file.name });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const pickExcel = () => fileInput.current?.click();

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadExcel(file);
        }}
      />
      <div className="cards">
        <StatCard label="연간 예산" value={money(total)} note={accounts.some((a) => a.masked) ? `${doc.name} 합계 · 급여 등 경영지원 입력 계정 제외` : `${doc.name} 전체 계정 합계`} />
        <StatCard label="월평균 예산" value={money(total / 12)} note="연간 예산 ÷ 12개월" />
        <StatCard label="입력 계정" value={`${filledAccountCount(shownAccounts)} / ${shownAccounts.length}`} unit="개" note="금액이 입력된 계정" />
        <StatCard label="상태" value={statusLabel} unit="" note={doc.closed ? `마감 ${formatTime(doc.closedAt)}` : doc.savedAt ? `마지막 저장 ${formatTime(doc.savedAt)}` : "입력 전"} />
      </div>
      <section className="panel" data-anchor="ledger">
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
            {editable && (
              <button type="button" disabled={uploading} onClick={pickExcel} title="내려받은 엑셀에서 금액·메모를 고쳐 올리면 반영합니다(반영 전에 바뀌는 행을 보여 줌)">
                {uploading ? "읽는 중…" : "엑셀 업로드"}
              </button>
            )}
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
                // 전 줄이 '경영지원 입력'인 계정(직원급여·퇴직급여 등)은 팀 화면에서 상세 창을 열지 않는다
                const adminOnly = !isAdmin && account.rows.length > 0 && account.rows.every((r) => r.locked);
                const masked = hiddenAmount(account);
                return (
                  <tr key={account.name} className={hiddenAccounts.includes(account.name) ? "hidden-account" : undefined}>
                    <td>
                      {adminOnly ? (
                        <span className="account-button admin-only" title="경영지원이 입력하는 계정입니다(급여·4대보험 등) — 팀 화면에서는 볼 수 없습니다">
                          {account.name}
                          <span className="lock-chip">🔒 경영지원</span>
                        </span>
                      ) : masked && sensitive.canUnlock ? (
                        <button type="button" className="account-button" onClick={() => setUnlocking(true)} title="급여 등 경영지원 전용 계정 — 비밀번호를 한 번 더 넣으면 이 창을 닫을 때까지 보입니다">
                          {account.name}
                          <span className="lock-chip">🔒 비밀번호 확인</span>
                        </button>
                      ) : (
                        <button type="button" className="account-button" onClick={() => setOpenIndex(index)} aria-haspopup="dialog">
                          {account.name}
                          <span>상세</span>
                          {hiddenAccounts.includes(account.name) && (
                            <span className="hidden-chip" title="계정과목 노출 설정에서 이 부서에 숨긴 계정 — 팀 화면에는 안 보입니다">
                              숨김
                            </span>
                          )}
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
                      )}
                      {isSensitiveAccount(account) && !masked && account.lastEdit && (
                        <span className="edit-stamp" title={account.lastEdit.ip ? `IP ${account.lastEdit.ip}` : undefined}>
                          수정 {formatTime(account.lastEdit.at)} · {account.lastEdit.loginId}
                        </span>
                      )}
                    </td>
                    {values.map((v, m) => {
                      if (masked)
                        return (
                          <td key={m} className="masked-cell">
                            •••
                          </td>
                        );
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
                    <td className={masked ? "masked-cell" : undefined}>
                      <b>{masked ? "•••" : money(sum(values))}</b>
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
          onImport={editable ? pickExcel : undefined}
          importing={uploading}
          reviews={openReviews[accounts[openIndex].name] ?? []}
          isAdmin={isAdmin}
          prior={prior}
        />
      )}
      {unlocking && <UnlockDialog onClose={() => setUnlocking(false)} />}
      {preview && (
        <Modal
          className="detail-dialog upload-dialog"
          title={`엑셀 업로드 — 반영 전 확인 (${preview.fileName})`}
          onClose={() => setPreview(null)}
          footer={
            <>
              <span className="muted">반영하면 바로 저장되어 통합 예산에 합산됩니다</span>
              <div className="actions">
                <button type="button" onClick={() => setPreview(null)}>
                  취소
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const next = preview.accounts;
                    onAccountsChange(() => next);
                    notify(`엑셀 내용을 반영했습니다 — 바뀐 행 ${preview.summary.changed}개 · 새 행 ${preview.summary.added}개`);
                    setPreview(null);
                  }}
                >
                  반영하기
                </button>
              </div>
            </>
          }
        >
          <div className="modal-body">
            <p>
              금액이 바뀌는 행 <b>{preview.summary.changed}개</b> · 새로 추가되는 행 <b>{preview.summary.added}개</b> · 그대로 {preview.summary.unchanged}개
            </p>
            {preview.summary.lockedSkipped > 0 && <p className="muted">🔒 경영지원 입력 줄 {preview.summary.lockedSkipped}개는 바뀐 값이 있어도 건너뜁니다(경영지원만 입력).</p>}
            {preview.summary.unknownAccounts.length > 0 && <p className="muted">이 부서에 없는 계정과목이라 건너뜀: {preview.summary.unknownAccounts.join(", ")}</p>}
            {preview.problems.length > 0 && (
              <p className="muted" style={{ whiteSpace: "pre-line" }}>
                {preview.problems.join("\n")}
              </p>
            )}
            <div className="tablewrap">
              <table className="upload-table">
                <thead>
                  <tr>
                    <th>계정과목</th>
                    <th>구분</th>
                    <th>상세설명</th>
                    <th>지금 연간</th>
                    <th>올린 파일 연간</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.summary.details.map((d, i) => (
                    <tr key={i}>
                      <td>{d.account}</td>
                      <td>
                        {d.item}
                        {d.added && <span className="chip saved" style={{ marginLeft: 6 }}>새 행</span>}
                      </td>
                      <td className="upload-desc">{d.desc.split("\n")[0]}</td>
                      <td>{d.added ? "—" : money(d.before)}</td>
                      <td>
                        <b>{money(d.after)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
