"use client";

import { useMemo, useRef, useState } from "react";
import { useLongPressDrag } from "@/hooks/useLongPressDrag";
import { MONTHS, accountMonths, accountsMonths, filledAccountCount, isSensitiveAccount, money, percent, sum } from "@/lib/budget";
import { api, downloadFrom, formatTime } from "@/lib/client";
import type { BudgetAccount, DepartmentDoc, ReviewComment } from "@/lib/types";
import { UnlockDialog, useSensitiveAccess } from "../SensitiveGate";
import { Modal, OrderSaveBar, StatCard, useUi } from "../ui";
import { AccountDetailDialog } from "./AccountDetailDialog";

interface UploadPreview {
  accounts: BudgetAccount[];
  summary: {
    changed: number;
    added: number;
    unchanged: number;
    lockedSkipped: number;
    newSkipped: number;
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
  onReload,
  prior2026Auto = 0,
  prior2026 = null,
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
  onReload?: () => Promise<unknown>; // 계정과목 순서를 바꾼 뒤 부서 문서를 다시 받기 — 주면 경영지원은 계정과목 칸을 끌어 순서를 바꿀 수 있다
  prior2026Auto?: number; // 우리 부서 2026 자동 추정(템플릿 9개월 ÷9×12)
  prior2026?: number | null; // 경영지원/팀이 입력해 저장한 2026 추정실적(없으면 자동)
}) {
  const { showTip, hideTip, notify } = useUi();
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  // 우리 부서 2026 추정실적 — 팀·경영지원이 본인 부서 값을 입력(저장하면 전체 예산 현황의 2026 추정에도 반영)
  const [priorText, setPriorText] = useState(prior2026 != null ? String(prior2026) : "");
  const [savingPrior, setSavingPrior] = useState(false);
  const [editing2026, setEditing2026] = useState(false); // 경영지원이 [수정]을 누르면 입력 모드
  const savePrior = async () => {
    const t = priorText.replace(/,/g, "").trim();
    const n = Number(t);
    if (t !== "" && (!Number.isFinite(n) || n < 0)) return notify("2026 추정실적은 0 이상 숫자로 입력해 주세요.", true);
    setSavingPrior(true);
    try {
      await api(`/api/departments/${doc.code}/prior2026`, { method: "PATCH", body: JSON.stringify({ value: t === "" ? null : Math.round(n) }) });
      notify(t === "" ? "2026 추정실적을 비웠습니다(자동 추정을 씁니다)." : "2026 추정실적을 저장했습니다.");
      setEditing2026(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSavingPrior(false);
    }
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  // 경영지원 전용 계정(급여 등) — 팀은 서버가 금액을 안 보냄, 경영지원은 비밀번호 확인 후
  const sensitive = useSensitiveAccess({ isAdmin, master });
  const [unlocking, setUnlocking] = useState(false);
  const hiddenAmount = (account: BudgetAccount) => account.masked || (isSensitiveAccount(account) && !sensitive.visible);

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

  // 계정과목 순서 바꾸기(경영지원만, 전 부서 공통) — 계정과목 칸을 누른 채 끌고, 위 [변경내용 저장]을 눌러야 반영
  const { drag, press, suppressClick } = useLongPressDrag();
  const tableRef = useRef<HTMLTableElement>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const names = accounts.map((a) => a.name);
  // 그 사이 계정과목이 추가·삭제되면 저장 안 한 순서는 버린다
  const pending = pendingOrder && pendingOrder.length === names.length && pendingOrder.every((n) => names.includes(n)) ? pendingOrder : null;
  const canDragAccounts = isAdmin && Boolean(onReload) && !query.trim() && accounts.length > 1 && !savingOrder;
  const accountOrder = drag?.group === "ledger-accounts" ? drag.order : (pending ?? names);
  const rowsShown = drag?.group === "ledger-accounts" || pending ? accountOrder.map((n) => visible.find((v) => v.account.name === n)).filter((v): v is (typeof visible)[number] => v !== undefined) : visible;
  const dropAccounts = (next: string[]) => setPendingOrder(next.join("\u0000") === names.join("\u0000") ? null : next);
  const saveAccountOrder = async () => {
    if (!pending) return;
    setSavingOrder(true);
    try {
      if ((await onBeforeExport?.()) === false) throw new Error("입력 중인 금액을 먼저 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
      await api("/api/visibility/accounts", { method: "POST", body: JSON.stringify({ action: "reorder", order: pending }) });
      setPendingOrder(null);
      await onReload?.();
      notify("계정과목 순서를 바꿨습니다(전 부서 공통).");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSavingOrder(false);
    }
  };
  // 끌고 놓은 직후의 클릭은 무시(상세 창이 열리지 않게)
  const clickUnlessDragged = (action: () => void) => () => {
    if (!suppressClick.current) action();
  };

  const monthNotes = (account: BudgetAccount, m: number) =>
    account.rows
      .filter((r) => r.memos?.[m]?.trim())
      .map((r) => [r.item, r.memos![m]].filter(Boolean).join("\n"))
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
          [`바뀐 금액이 없습니다(같은 행 ${s.unchanged}개).`, s.lockedSkipped ? `🔒 경영지원 입력 줄 ${s.lockedSkipped}개는 건너뜀.` : "", s.newSkipped ? `새로 적은 줄 ${s.newSkipped}개는 건너뜀(줄 추가는 경영지원팀).` : "", s.unknownAccounts.length ? `없는 계정과목: ${s.unknownAccounts.join(", ")}` : ""]
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
      <div className="cards cards-3col">
        <StatCard label="연간 예산" value={money(total)} note={accounts.some((a) => a.masked) ? `${doc.name} 합계 · 급여 등 경영지원 입력 계정 제외` : `${doc.name} 전체 계정 합계`} />
        <StatCard label="월평균 예산" value={money(total / 12)} note="연간 예산 ÷ 12개월" />
        <StatCard label="입력 계정" value={`${filledAccountCount(shownAccounts)} / ${shownAccounts.length}`} unit="개" note="금액이 입력된 계정" />
        {(() => {
          const t = priorText.replace(/,/g, "").trim();
          const n = Number(t);
          const eff = t !== "" && Number.isFinite(n) ? n : prior2026Auto; // 저장값(있으면) 아니면 자동 추정
          const chg = eff ? (total - eff) / eff : null;
          const prevYear = doc.year - 1;
          return (
            <>
              <StatCard
                label={`${prevYear} 추정실적`}
                unit=""
                note={editing2026 ? `비우면 자동 추정 ${money(prior2026Auto)}` : prior2026 != null ? "경영지원 입력값" : `자동 추정(1~9월 ÷9×12)`}
                value={
                  isAdmin && editing2026 ? (
                    <span className="prior2026-edit">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={priorText}
                        disabled={savingPrior}
                        placeholder="자동 사용"
                        aria-label={`${prevYear} 추정실적`}
                        autoFocus
                        onChange={(e) => setPriorText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) void savePrior();
                        }}
                      />
                      <button type="button" className="primary" disabled={savingPrior} onClick={() => void savePrior()}>
                        저장
                      </button>
                      <button
                        type="button"
                        disabled={savingPrior}
                        onClick={() => {
                          setPriorText(prior2026 != null ? String(prior2026) : "");
                          setEditing2026(false);
                        }}
                      >
                        취소
                      </button>
                    </span>
                  ) : (
                    <span className="prior2026-view">
                      {money(eff)}
                      {isAdmin && (
                        <button type="button" className="link" onClick={() => setEditing2026(true)} title="2026 추정실적 수정(경영지원)">
                          수정
                        </button>
                      )}
                    </span>
                  )
                }
              />
              <StatCard label={`${prevYear} 대비`} value={chg === null ? "—" : percent(chg)} unit="" note={`${doc.year} 예산 ÷ ${prevYear} 추정실적`} />
            </>
          );
        })()}
        <StatCard label="상태" value={statusLabel} unit="" note={doc.closed ? `마감 ${formatTime(doc.closedAt)}` : doc.savedAt ? `마지막 저장 ${formatTime(doc.savedAt)}` : "입력 전"} />
      </div>
      <section className="panel" data-anchor="ledger">
        <div className="panel-head">
          <h3>계정별 월별 예산</h3>
          <span className="muted">
            단위: 원 · 계정을 누르면 상세 {editable ? "입력" : "조회"}
            {canDragAccounts ? " · 계정과목 칸을 누른 채 끌면 순서 변경(전 부서 공통)" : ""}
          </span>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="계정명 · 상세내역 검색" aria-label="계정명 및 상세내역 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="actions">
            {savingOrder ? <span className="chip busy">순서 저장 중…</span> : pending && <OrderSaveBar onSave={() => void saveAccountOrder()} onCancel={() => setPendingOrder(null)} />}
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
          <table className={`ledger-table fit-table${drag ? " is-dragging" : ""}`} ref={tableRef}>
            <colgroup>
              <col style={{ width: "11%" }} />
              {MONTHS.map((m) => (
                <col key={m} />
              ))}
              <col style={{ width: "7.5%" }} />
            </colgroup>
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
              {rowsShown.map(({ account, index }) => {
                const values = accountMonths(account);
                // 전 줄이 '경영지원 입력'인 계정(직원급여·퇴직급여 등)은 팀 화면에서 상세 창을 열지 않는다
                const adminOnly = !isAdmin && account.rows.length > 0 && account.rows.every((r) => r.locked);
                const masked = hiddenAmount(account);
                const dragging = drag?.group === "ledger-accounts" && drag.id === account.name;
                const rowClass = [hiddenAccounts.includes(account.name) ? "hidden-account" : "", dragging ? "dragging" : ""].filter(Boolean).join(" ");
                const namePress = canDragAccounts
                  ? press("ledger-accounts", account.name, accountOrder, () => [...(tableRef.current?.querySelectorAll<HTMLElement>("tbody tr[data-drag-id]") ?? [])], dropAccounts)
                  : undefined;
                return (
                  <tr key={account.name} data-drag-id={account.name} className={rowClass || undefined}>
                    <td className={canDragAccounts ? "draggable" : undefined} title={canDragAccounts ? "누른 채 위아래로 끌면 계정과목 순서를 바꿉니다(전 부서 공통)" : undefined} {...namePress}>
                      {adminOnly ? (
                        <span className="account-button admin-only" title="경영지원이 입력하는 계정입니다(급여·4대보험 등) — 팀 화면에서는 볼 수 없습니다">
                          {account.name}
                          <span className="lock-chip">🔒 경영지원</span>
                        </span>
                      ) : masked && sensitive.canUnlock ? (
                        <button type="button" className="account-button" onClick={clickUnlessDragged(() => setUnlocking(true))} title="급여 등 경영지원 전용 계정 — 비밀번호를 한 번 더 넣으면 이 창을 닫을 때까지 보입니다">
                          {account.name}
                          <span className="lock-chip">🔒 비밀번호 확인</span>
                        </button>
                      ) : (
                        <button type="button" className="account-button" onClick={clickUnlessDragged(() => setOpenIndex(index))} aria-haspopup="dialog">
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
            {preview.summary.newSkipped > 0 && <p className="muted">파일에 새로 적은 줄 {preview.summary.newSkipped}개는 건너뜁니다(줄 추가는 경영지원팀에서).</p>}
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
