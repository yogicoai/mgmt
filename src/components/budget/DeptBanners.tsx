"use client";

import type { DepartmentState } from "@/hooks/useDepartment";

const SECTION_NAMES = { accounts: "계정별 예산", personnel: "인원정보", sales: "목표매출" } as const;

// 부서 문서 상태 안내 — 불러오기 실패·저장 충돌·저장 실패·마감
export function DeptBanners({ state, closedHint, showClosed = true }: { state: DepartmentState; closedHint?: string; showClosed?: boolean }) {
  const { doc, loadError, conflict, saveError, saveState, reload, resolveConflict, saveNow, adminNotice, dismissAdminNotice } = state;
  return (
    <>
      {adminNotice && (
        <div className="banner warn">
          <span>{adminNotice}</span>
          <button type="button" onClick={dismissAdminNotice}>
            확인
          </button>
        </div>
      )}
      {loadError && (
        <div className="banner err">
          <span>자료를 불러오지 못했습니다 — {loadError}</span>
          <button type="button" onClick={() => void reload()}>
            다시 불러오기
          </button>
        </div>
      )}
      {conflict && (
        <div className="banner warn">
          <span>
            다른 화면에서 <b>{conflict.sections.map((s) => SECTION_NAMES[s]).join(", ")}</b>을(를) 먼저 저장했습니다. 이 화면의 마지막 변경은 아직 저장되지 않았습니다.
          </span>
          <span className="actions">
            <button type="button" onClick={() => void resolveConflict("reload")}>
              최신 내용 불러오기
            </button>
            <button type="button" className="primary" onClick={() => void resolveConflict("overwrite")}>
              내 내용으로 저장
            </button>
          </span>
        </div>
      )}
      {saveError && saveState === "error" && !doc?.closed && (
        <div className="banner err">
          <span>저장하지 못했습니다 — {saveError} (잠시 뒤 자동으로 다시 시도합니다)</span>
          <button type="button" onClick={() => void saveNow()}>
            지금 다시 저장
          </button>
        </div>
      )}
      {showClosed && doc?.closed && (
        <div className="banner closed">
          <span>마감된 예산입니다 — 조회만 가능합니다. {closedHint}</span>
          {saveError && <span>{saveError}</span>}
        </div>
      )}
    </>
  );
}
