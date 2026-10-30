"use client";

import { useDepartment } from "@/hooks/useDepartment";
import { useHiddenAccounts } from "@/hooks/useHiddenAccounts";
import { useReviews } from "@/hooks/useReviews";
import type { DeptMeta } from "@/lib/types";
import { BudgetLedger } from "../budget/BudgetLedger";
import { DeptBanners } from "../budget/DeptBanners";
import { ReviewPanel } from "../budget/ReviewPanel";
import { useUi, type Viewer } from "../ui";

// 통합 대시보드의 부서 탭 — 부서 화면과 같은 원장(같은 DB 문서)을 보고 고치며, 마감/마감 해제·검토 의견을 남긴다
export function DeptLedgerTab({ meta, year, onSaved, viewer }: { meta: DeptMeta; year: number; onSaved: () => void; viewer: Viewer }) {
  const { notify } = useUi();
  const state = useDepartment(meta.code, { onSaved });
  const reviews = useReviews(meta.code);
  const hiddenAccounts = useHiddenAccounts(meta.code);
  const { doc, update, statusLabel, saveNow, setClosed } = state;
  const editable = Boolean(doc && !doc.closed);

  const toggleClosed = async () => {
    if (!doc) return;
    const closing = !doc.closed;
    if (!confirm(closing ? `${meta.name} 예산을 마감할까요? 부서 화면에서 더 고칠 수 없게 됩니다.` : `${meta.name} 예산 마감을 해제할까요? 부서 화면에서 다시 고칠 수 있게 됩니다.`)) return;
    try {
      await setClosed(closing);
      notify(closing ? `${meta.name} 예산을 마감했습니다.` : `${meta.name} 마감을 해제했습니다.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <>
      <div className="section-title">
        <div>
          <h2>{meta.name} 계정별 예산</h2>
          <span className="muted">
            {year}년 계정별 원장 · 부서 화면(/dept/{meta.code})과 같은 자료입니다
          </span>
        </div>
        <div className="actions">
          <a className="button-link" href={`/dept/${meta.code}`} target="_blank" rel="noreferrer">
            부서 화면 열기 ↗
          </a>
          {editable && (
            <button
              type="button"
              onClick={async () => {
                if (await saveNow()) notify("저장했습니다.");
              }}
            >
              저장
            </button>
          )}
          {doc && (
            <button type="button" className={doc.closed ? "" : "primary"} onClick={() => void toggleClosed()}>
              {doc.closed ? "마감 해제" : "마감"}
            </button>
          )}
        </div>
      </div>
      <DeptBanners state={state} closedHint="고치려면 오른쪽 위 ‘마감 해제’를 누르세요." />
      {!doc && !state.loadError && <div className="empty">불러오는 중…</div>}
      {doc && (
        <BudgetLedger
          doc={doc}
          editable={editable}
          statusLabel={statusLabel}
          onAccountsChange={(fn) => update("accounts", fn)}
          onBeforeExport={saveNow}
          openReviews={reviews.openByAccount}
          isAdmin={viewer.isAdmin}
          master={viewer.master}
          hiddenAccounts={hiddenAccounts}
        />
      )}
      {doc && <ReviewPanel state={reviews} viewer={viewer} accounts={doc.accounts.map((a) => a.name)} deptName={meta.name} />}
    </>
  );
}
