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

// 같은 구분이 이어지면 구분 칸을 합친다(직접 추가한 행은 따로)
function itemSpans(rows: BudgetRow[]) {
  return rows.map((row, i) => {
    if (row.custom) return 1;
    if (i > 0 && !rows[i - 1].custom && rows[i - 1].item === row.item) return 0;
    let n = 1;
    while (i + n < rows.length && !rows[i + n].custom && rows[i + n].item === row.item) n++;
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
  reviews?: ReviewComment[]; // 이 계정에 남은 경영지원 의견(반영 필요)
  isAdmin?: boolean; // 경영지원 — 잠긴 줄도 입력하고 잠금을 켜고 끈다
  prior?: Record<string, number[]>; // 행별 2026 실적(원본) — 키 계정\0구분\0상세설명
}) {
  const { showTip, hideTip, notify } = useUi();
  const [memo, setMemo] = useState<{ row: number; month: number } | null>(null);
  const [draft, setDraft] = useState({ item: "", desc: "" });
  const rows = account.rows;
  const spans = itemSpans(rows);
  const months = accountMonths(account);
  // '경영지원 입력' 줄은 팀 화면에서 조회만
  const canEditRow = (row: BudgetRow) => editable && (isAdmin || !row.locked);
  const priorOf = (row: BudgetRow) => prior[`${account.name}\u0000${row.item}\u0000${row.desc}`];
  const priorTotal = sum(rows.map((r) => sum(priorOf(r) ?? [])));
  const lockedCount = rows.filter((r) => r.locked).length;
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

  const addRow = () => {
    if (!draft.item.trim()) return notify("구분을 입력해 주세요.");
    onChange({ ...account, rows: [...rows, { item: draft.item.trim(), desc: draft.desc.trim(), values: zeros(), formulas: {}, memos: {}, custom: true }] });
    setDraft({ item: "", desc: "" });
  };

  const removeRow = (index: number) => {
    const row = rows[index];
    if (rowTotal(row) !== 0 && !confirm(`'${row.item}' 행에 금액이 있습니다. 삭제할까요?`)) return;
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
            {editable ? "금액 칸에 숫자 또는 =10000*4 같은 계산식을 입력하면 자동 저장됩니다 · 📝 산출근거 메모" : "마감된 예산 — 조회만 가능합니다"}
            {lockedCount > 0 && !isAdmin ? " · 🔒 줄은 경영지원이 입력" : ""}
            {priorTotal ? " · 2026 실적은 원본 자료 기준(대부분 1~3월분)" : ""}
          </span>
          {onExport && (
            <button type="button" disabled={exporting} onClick={onExport} title="이 표 그대로 엑셀로(메모는 엑셀 메모, 계산식은 수식)">
              {exporting ? "만드는 중…" : "엑셀 다운로드"}
            </button>
          )}
          {editable && (
            <div className="add-row">
              <input placeholder="구분 (예: 외부 행사)" value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} aria-label="새 행 구분" />
              <input placeholder="상세설명" value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} aria-label="새 행 상세설명" style={{ width: 260 }} />
              <button type="button" onClick={addRow}>
                행 추가
              </button>
            </div>
          )}
        </>
      }
    >
      <div className="modal-body">
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
              <col style={{ width: "7%" }} />
              <col style={{ width: "10%" }} />
              {MONTHS.map((m) => (
                <col key={m} style={{ width: "6%" }} />
              ))}
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "4.5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>상세설명</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>연간 합계</th>
                <th title="원본 HTML 데이터의 행별 2026 실적(대부분 1~3월분) — 월별 값은 금액 칸에 마우스를 올리면 보입니다">2026 실적</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const rowEditable = canEditRow(row);
                const priorRow = priorOf(row);
                return (
                <tr key={ri} className={row.locked ? "locked-row" : undefined}>
                  {row.custom ? (
                    <>
                      <td className="item">
                        <div className="row-edit">
                          <input value={row.item} readOnly={!rowEditable} aria-label="구분" onChange={(e) => setRow(ri, (r) => ({ ...r, item: e.target.value }))} />
                          {rowEditable && (
                            <button type="button" className="danger" onClick={() => removeRow(ri)}>
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="desc">
                        {lockControl(ri, row)}
                        <input value={row.desc} readOnly={!rowEditable} aria-label="상세설명" style={{ width: "100%" }} onChange={(e) => setRow(ri, (r) => ({ ...r, desc: e.target.value }))} />
                      </td>
                    </>
                  ) : (
                    <>
                      {spans[ri] > 0 && (
                        <td className="item" rowSpan={spans[ri]}>
                          {row.item}
                        </td>
                      )}
                      <td className="desc">
                        {lockControl(ri, row)}
                        <DescLines text={row.desc} />
                      </td>
                    </>
                  )}
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
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
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
