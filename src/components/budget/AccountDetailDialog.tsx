"use client";

import { useState } from "react";
import { MONTHS, accountMonths, money, rowTotal, sum, zeros } from "@/lib/budget";
import { formatTime } from "@/lib/client";
import type { BudgetAccount, BudgetRow, ReviewComment } from "@/lib/types";
import { Modal, useUi } from "../ui";
import { MemoDialog } from "./MemoDialog";
import { MoneyInput } from "./MoneyInput";

// 상세설명 여러 줄 → "- 항목" 목록 (원본 formatDetailDescription)
function DescLines({ text }: { text: string }) {
  const value = String(text || "").trim();
  if (!value || /^[-—–ㅡ_]+$/.test(value)) return null;
  const items = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•·]\s*/, ""))
    .filter((line) => line && !/^[-—–ㅡ_]+$/.test(line));
  return (
    <>
      {items.map((item, i) => (
        <div className="desc-line" key={i}>
          <span aria-hidden="true">-</span>
          <span>{item}</span>
        </div>
      ))}
    </>
  );
}

// 행 추가·수정 창의 구분 선택에서 '새 구분 직접 입력'
const NEW_ITEM = "__new_item__";

// 같은 구분이 이어지면 구분 칸을 합친다
function itemSpans(rows: BudgetRow[]) {
  return rows.map((row, i) => {
    if (i > 0 && rows[i - 1].item === row.item) return 0;
    let n = 1;
    while (i + n < rows.length && rows[i + n].item === row.item) n++;
    return n;
  });
}

export function AccountDetailDialog({
  deptName,
  account,
  editable,
  onChange,
  onClose,
  onExport,
  exporting,
  onImport,
  importing,
  reviews = [],
  isAdmin = false,
  prior = {},
}: {
  deptName: string;
  account: BudgetAccount;
  editable: boolean;
  onChange: (next: BudgetAccount) => void;
  onClose: () => void;
  onExport?: () => void;
  exporting?: boolean;
  onImport?: () => void; // 엑셀 업로드(계정 하나 파일·부서 전체 파일 모두)
  importing?: boolean;
  reviews?: ReviewComment[]; // 이 계정에 남은 경영지원 의견(반영 필요)
  isAdmin?: boolean; // 경영지원 — 잠긴 줄도 입력하고 잠금을 켜고 끈다
  prior?: Record<string, number[]>; // 행별 2026 실적(원본) — 키 계정\0구분\0상세설명
}) {
  const { showTip, hideTip, notify } = useUi();
  const [memo, setMemo] = useState<{ row: number; month: number } | null>(null);
  // 행 추가(index null)·수정 창 — 구분은 기존 구분에서 고르거나(custom false) 새로 입력(custom true)
  const [rowForm, setRowForm] = useState<{ index: number | null; item: string; desc: string; custom: boolean } | null>(null);
  // 행 수정·삭제 모드 — 아래 [− 행 수정/삭제]를 눌러야 줄마다 [수정]·[삭제]가 나타난다
  const [manage, setManage] = useState(false);
  const rows = account.rows;
  const spans = itemSpans(rows);
  const itemOptions = [...new Set(rows.map((r) => r.item).filter(Boolean))];
  const months = accountMonths(account);
  // '경영지원 입력' 줄은 팀 화면에서 조회만
  const canEditRow = (row: BudgetRow) => editable && (isAdmin || !row.locked);
  const priorOf = (row: BudgetRow) => prior[`${account.name}\u0000${row.item}\u0000${row.desc}`];
  const priorTotal = sum(rows.map((r) => sum(priorOf(r) ?? [])));
  const lockedCount = rows.filter((r) => r.locked).length;
  const managing = editable && manage;
  const lockControl = (ri: number, row: BudgetRow) =>
    isAdmin && editable ? (
      <label className="lock-toggle" title="켜면 팀 화면에서 이 줄은 조회만 되고 경영지원만 입력합니다">
        <input type="checkbox" checked={Boolean(row.locked)} onChange={(e) => setRow(ri, (r) => ({ ...r, locked: e.target.checked }))} />
        경영지원 입력
      </label>
    ) : row.locked ? (
      <span className="lock-badge" title="급여·4대보험·회사 행사처럼 경영지원(인사·회계)이 일괄 입력하는 줄입니다">
        🔒 경영지원 입력
      </span>
    ) : null;

  const setRow = (index: number, change: (row: BudgetRow) => BudgetRow) =>
    onChange({ ...account, rows: rows.map((r, i) => (i === index ? change(r) : r)) });

  const setAmount = (index: number, m: number, value: number, formula: string | undefined) =>
    setRow(index, (r) => {
      const formulas = { ...(r.formulas ?? {}) };
      if (formula) formulas[m] = formula;
      else delete formulas[m];
      return { ...r, values: r.values.map((v, k) => (k === m ? value : v)), formulas };
    });

  const setMemoText = (index: number, monthsToSet: number[], text: string) =>
    setRow(index, (r) => {
      const memos = { ...(r.memos ?? {}) };
      for (const m of monthsToSet) {
        if (text.trim()) memos[m] = text;
        else delete memos[m];
      }
      return { ...r, memos };
    });

  const saveRowForm = () => {
    if (!rowForm) return;
    const item = rowForm.item.trim();
    const desc = rowForm.desc.trim();
    if (!item) return notify("구분을 입력해 주세요.");
    if (rowForm.index === null) {
      // 같은 구분이 있으면 그 묶음 바로 아래, 없으면 맨 아래
      const last = rows.map((r) => r.item).lastIndexOf(item);
      const at = last < 0 ? rows.length : last + 1;
      onChange({ ...account, rows: [...rows.slice(0, at), { item, desc, values: zeros(), formulas: {}, memos: {}, custom: true }, ...rows.slice(at)] });
    } else {
      setRow(rowForm.index, (r) => ({ ...r, item, desc }));
    }
    setRowForm(null);
  };

  const removeRow = (index: number) => {
    const row = rows[index];
    const name = [row.item, row.desc.split("\n")[0]].filter(Boolean).join(" · ");
    if (!confirm(rowTotal(row) !== 0 ? `‘${name}’ 행에 금액이 있습니다. 삭제할까요?` : `‘${name}’ 행을 삭제할까요?`)) return;
    onChange({ ...account, rows: rows.filter((_, i) => i !== index) });
  };

  const memoRow = memo ? rows[memo.row] : null;

  return (
    <Modal
      className="detail-dialog"
      title={`${deptName} · ${account.name} · 상세 예산 ${editable ? "입력" : "조회"}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted">
            {managing ? "고치거나 지울 줄 오른쪽의 [수정]·[삭제]를 누르세요 — 다 하면 [완료]" : editable ? "금액 칸에 숫자 또는 =10000*4 같은 계산식을 입력하면 자동 저장됩니다 · 📝 산출근거 메모" : "마감된 예산 — 조회만 가능합니다"}
            {lockedCount > 0 && !isAdmin ? " · 🔒 줄은 경영지원이 입력" : ""}
            {priorTotal ? " · 2026 실적은 원본 자료 기준(대부분 1~3월분)" : ""}
          </span>
          <div className="actions">
            {onExport && (
              <button type="button" disabled={exporting} onClick={onExport} title="이 표 그대로 엑셀로(메모는 엑셀 메모, 계산식은 수식)">
                {exporting ? "만드는 중…" : "엑셀 다운로드"}
              </button>
            )}
            {onImport && (
              <button type="button" disabled={importing} onClick={onImport} title="내려받은 엑셀을 고쳐 올리면 반영합니다(반영 전에 확인)">
                {importing ? "읽는 중…" : "엑셀 업로드"}
              </button>
            )}
            {editable && rows.some(canEditRow) && (
              <button type="button" className={manage ? "" : "danger-solid"} onClick={() => setManage((v) => !v)} aria-pressed={manage} title={manage ? "수정·삭제 끝내기" : "누르면 줄마다 [수정]·[삭제] 버튼이 나타납니다"}>
                {manage ? "완료" : "− 행 수정/삭제"}
              </button>
            )}
            {editable && (
              <button type="button" className="primary" onClick={() => setRowForm({ index: null, item: "", desc: "", custom: !itemOptions.length })}>
                + 행 추가
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="modal-body" data-anchor={`detail:${account.name}`}>
        {account.lastEdit && (
          <p className="edit-stamp-line">
            마지막 수정 {formatTime(account.lastEdit.at)} · {account.lastEdit.deptName}({account.lastEdit.loginId}){account.lastEdit.ip ? ` · IP ${account.lastEdit.ip}` : ""}
          </p>
        )}
        {reviews.length > 0 && (
          <div className="review-inline" role="note">
            <b>💬 경영지원 검토 의견 {reviews.length}건 (반영 필요)</b>
            {reviews.map((r) => (
              <p key={r._id}>
                <span className="muted">
                  [{r.month !== null ? MONTHS[r.month] : "연간"} · {formatTime(r.createdAt)}]
                </span>{" "}
                {r.text}
              </p>
            ))}
          </div>
        )}
        <div className="tablewrap">
          <table className="detail-table">
            <colgroup>
              <col style={{ width: managing ? "6.5%" : "7%" }} />
              <col style={{ width: managing ? "9.5%" : "10%" }} />
              {MONTHS.map((m) => (
                <col key={m} style={{ width: managing ? "5.7%" : "6%" }} />
              ))}
              <col style={{ width: managing ? "6%" : "6.5%" }} />
              <col style={{ width: "4.5%" }} />
              {managing && <col style={{ width: "5.1%" }} />}
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>상세설명</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>연간 합계</th>
                <th className="prior" title="원본 HTML 데이터의 행별 2026 실적(대부분 1~3월분) — 월별 값은 금액 칸에 마우스를 올리면 보입니다">2026 실적</th>
                {managing && <th>관리</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowEditable = canEditRow(row);
                const priorRow = priorOf(row);
                return (
                <tr key={ri} className={row.locked ? "locked-row" : undefined}>
                  {spans[ri] > 0 && (
                    <td className="item" rowSpan={spans[ri]}>
                      {row.item}
                    </td>
                  )}
                  <td className="desc">
                    {lockControl(ri, row)}
                    <DescLines text={row.desc} />
                  </td>
                  {row.values.map((v, m) => {
                    const note = row.memos?.[m]?.trim();
                    return (
                      <td key={m}>
                        <div className="cell-stack">
                          <MoneyInput
                            value={v}
                            formula={row.formulas?.[m]}
                            readOnly={!rowEditable}
                            label={`${row.item} ${MONTHS[m]} 금액`}
                            hint={priorRow?.[m] ? `2026년 ${MONTHS[m]} 실적 ${money(priorRow[m])}원` : undefined}
                            onCommit={(value, formula) => setAmount(ri, m, value, formula)}
                          />
                          <button
                            type="button"
                            className={`memo-button${note ? " filled" : ""}`}
                            aria-label={`${row.item} ${MONTHS[m]} 메모${note ? " (있음)" : ""}`}
                            onMouseEnter={(e) => note && showTip(e.currentTarget, note)}
                            onMouseLeave={hideTip}
                            onClick={() => {
                              hideTip();
                              setMemo({ row: ri, month: m });
                            }}
                          >
                            📝
                          </button>
                        </div>
                      </td>
                    );
                  })}
                  <td className="total">{money(rowTotal(row))}</td>
                  <td className="prior">{priorRow ? money(sum(priorRow)) : ""}</td>
                  {managing && (
                    <td className="row-actions">
                      {rowEditable && (
                        <>
                          <button type="button" onClick={() => setRowForm({ index: ri, item: row.item, desc: row.desc, custom: !row.item })} aria-label={`${row.item} 행 수정`}>
                            수정
                          </button>
                          <button type="button" className="danger" onClick={() => removeRow(ri)} aria-label={`${row.item} 행 삭제`}>
                            삭제
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{account.name} 합계</td>
                {months.map((v, m) => (
                  <td key={m}>{money(v)}</td>
                ))}
                <td>{money(sum(months))}</td>
                <td className="prior">{priorTotal ? money(priorTotal) : ""}</td>
                {managing && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {rowForm && (
        <Modal
          className="memo-dialog"
          title={`${account.name} · ${rowForm.index === null ? "행 추가" : "행 수정"}`}
          onClose={() => setRowForm(null)}
          footer={
            <>
              <span className="muted">{rowForm.index === null ? "같은 구분이 있으면 그 묶음 바로 아래에 들어갑니다" : "금액·메모는 그대로 둡니다"}</span>
              <button type="button" className="primary" onClick={saveRowForm}>
                {rowForm.index === null ? "추가" : "저장"}
              </button>
            </>
          }
        >
          <div className="modal-body form-grid">
            <label>
              구분
              {itemOptions.length > 0 && (
                <select
                  value={rowForm.custom ? NEW_ITEM : rowForm.item}
                  onChange={(e) => setRowForm(e.target.value === NEW_ITEM ? { ...rowForm, custom: true } : { ...rowForm, custom: false, item: e.target.value })}
                  autoFocus
                >
                  <option value="" disabled>
                    구분 선택
                  </option>
                  {itemOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                  <option value={NEW_ITEM}>+ 새 구분 직접 입력</option>
                </select>
              )}
              {rowForm.custom && (
                <input value={rowForm.item} onChange={(e) => setRowForm({ ...rowForm, item: e.target.value })} placeholder="새 구분 이름 (예: 외부 행사)" autoFocus aria-label="새 구분 이름" />
              )}
            </label>
            <label>
              상세설명 (여러 줄이면 한 줄에 한 항목)
              <textarea rows={4} value={rowForm.desc} onChange={(e) => setRowForm({ ...rowForm, desc: e.target.value })} />
            </label>
          </div>
        </Modal>
      )}
      {memo && memoRow && (
        <MemoDialog
          title={`${account.name} · ${memoRow.item} · ${MONTHS[memo.month]} 메모`}
          value={memoRow.memos?.[memo.month] ?? ""}
          readOnly={!canEditRow(memoRow)}
          otherMonthsFilled={MONTHS.some((_, m) => m !== memo.month && memoRow.memos?.[m]?.trim())}
          onChange={(text) => setMemoText(memo.row, [memo.month], text)}
          onPasteAll={(text) => setMemoText(memo.row, MONTHS.map((_, m) => m), text)}
          onClose={() => setMemo(null)}
        />
      )}
    </Modal>
  );
}
