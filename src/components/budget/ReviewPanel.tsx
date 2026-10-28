"use client";

import { useState } from "react";
import type { ReviewsState } from "@/hooks/useReviews";
import { MONTHS } from "@/lib/budget";
import { formatTime } from "@/lib/client";
import type { ReviewComment } from "@/lib/types";
import { useUi, type Viewer } from "../ui";

export const reviewTarget = (r: Pick<ReviewComment, "account" | "month">) => (r.account ? `${r.account}${r.month !== null ? ` · ${MONTHS[r.month]}` : ""}` : "부서 전체");

// 경영지원 검토 의견 — 경영지원은 남기고 반영 완료로 닫는다, 팀은 보고 답글
export function ReviewPanel({ state, viewer, accounts, deptName }: { state: ReviewsState; viewer: Viewer; accounts: string[]; deptName: string }) {
  const { notify } = useUi();
  const { reviews, openCount } = state;
  const [target, setTarget] = useState("");
  const [month, setMonth] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await task();
      if (done) notify(done);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!text.trim()) return notify("의견 내용을 입력해 주세요.");
    const ok = await run(() => state.create({ text, account: target || null, month: target && month !== "" ? Number(month) : null }), `${deptName}에 의견을 남겼습니다.`);
    if (ok) setText("");
  };

  const sorted = [...(reviews ?? [])].sort((a, b) => (a.status === b.status ? (a.status === "open" ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)) : a.status === "open" ? -1 : 1));

  return (
    <section className="panel review-panel">
      <div className="panel-head">
        <h3>경영지원 검토 의견</h3>
        <span className="muted">{reviews ? `반영 필요 ${openCount}건 · 전체 ${reviews.length}건` : "불러오는 중"}</span>
      </div>

      {viewer.isAdmin && (
        <div className="review-form">
          <div className="review-form-row">
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="의견 대상 계정">
              <option value="">부서 전체</option>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!target} aria-label="의견 대상 월">
              <option value="">연간</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <span className="muted">계정·월을 고르면 그 팀 화면의 해당 계정에 💬 표시가 붙습니다</span>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`${deptName} 예산에 대한 첨언·수정 요청을 남겨 주세요.`} aria-label="검토 의견 내용" rows={3} />
          <div className="actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
              의견 남기기
            </button>
          </div>
        </div>
      )}

      {reviews && !reviews.length && <div className="empty">{viewer.isAdmin ? "아직 남긴 의견이 없습니다." : "경영지원 검토 의견이 아직 없습니다."}</div>}
      <div className="review-list">
        {sorted.map((r) => (
          <ReviewItem key={r._id} review={r} viewer={viewer} busy={busy} run={run} state={state} />
        ))}
      </div>
    </section>
  );
}

function ReviewItem({ review: r, viewer, busy, run, state }: { review: ReviewComment; viewer: Viewer; busy: boolean; run: (task: () => Promise<unknown>, done?: string) => Promise<boolean>; state: ReviewsState }) {
  const [reply, setReply] = useState("");
  const open = r.status === "open";
  return (
    <article className={`review-item${open ? "" : " resolved"}`}>
      <header>
        <span className="review-target">{reviewTarget(r)}</span>
        <span className={`badge ${open ? "warn" : "saved"}`}>{open ? "반영 필요" : `반영 완료 ${formatTime(r.resolvedAt)}`}</span>
        <span className="muted">
          {r.author.deptName} · {formatTime(r.createdAt)}
        </span>
        {viewer.isAdmin && (
          <span className="actions review-admin">
            <button type="button" disabled={busy} onClick={() => void run(() => state.setStatus(r._id, open ? "resolved" : "open"), open ? "반영 완료로 닫았습니다." : "다시 열었습니다.")}>
              {open ? "반영 완료" : "다시 열기"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                if (confirm("이 의견을 삭제할까요? 답글도 함께 지워집니다.")) void run(() => state.remove(r._id), "삭제했습니다.");
              }}
            >
              삭제
            </button>
          </span>
        )}
      </header>
      <p className="review-text">{r.text}</p>
      {r.replies.length > 0 && (
        <div className="review-replies">
          {r.replies.map((x) => (
            <div key={x.id} className={`review-reply${x.author.role === "admin" ? " admin" : ""}`}>
              <span className="muted">
                <b>{x.author.deptName}</b> · {formatTime(x.createdAt)}
              </span>
              <p>{x.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="review-reply-form">
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={viewer.isAdmin ? "답글" : "답글 (반영 내용·질문 등)"} aria-label="답글" onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && reply.trim()) {
            void run(() => state.reply(r._id, reply)).then((ok) => ok && setReply(""));
          }
        }} />
        <button type="button" disabled={busy || !reply.trim()} onClick={() => void run(() => state.reply(r._id, reply)).then((ok) => ok && setReply(""))}>
          답글
        </button>
      </div>
    </article>
  );
}
