"use client";

import { MONTHS, personnelMonths, zeros } from "@/lib/budget";
import type { DeptMeta, PersonRow } from "@/lib/types";

// 인원 입력 권한 — all: 경영지원(전부) / store: 영업 계정(매장 직원 행만) / view: 그 밖의 팀(조회만)
export type PersonnelScope = "all" | "store" | "view";

const NOTES: Record<PersonnelScope, string> = {
  all: "신규 채용 계획은 이름에 [모집분야], 예상 채용월에 1을 입력",
  store: "매장 직원(매니저·부매니저·시니어·서포터·일급제)만 추가·수정할 수 있습니다 — 본사 인원은 경영지원팀에서 입력합니다",
  view: "인원 구성은 경영지원팀에서 입력합니다 — 조회만 가능합니다",
};

// 2027년 인원정보 — 월별 예상 인원 (원본 renderPersonnel)
export function PersonnelEditor({
  meta,
  rows,
  editable,
  scope,
  onChange,
}: {
  meta: DeptMeta;
  rows: PersonRow[];
  editable: boolean;
  scope: PersonnelScope;
  onChange: (updater: (rows: PersonRow[]) => PersonRow[]) => void;
}) {
  const totals = personnelMonths(rows);
  const isStore = (position: string) => meta.storePositions.includes(position);
  // 영업 계정: 매장 직급 행 + 직급이 빈 행(원본에서 넘어온 빈칸)
  const canEdit = (r: PersonRow) => editable && (scope === "all" || (scope === "store" && (r.position === "" || isStore(r.position))));
  const canAdd = editable && scope !== "view";
  const anyEditable = rows.some(canEdit);
  const setRow = (index: number, change: Partial<PersonRow>) => onChange((list) => list.map((r, i) => (i === index ? { ...r, ...change } : r)));
  // 영업 계정은 매장 직급만 고를 수 있다(본사 직급으로 바꾸면 서버가 거절)
  const options = (current: string) => {
    const base = scope === "store" ? meta.storePositions : meta.positions;
    return current && !base.includes(current) ? [current, ...base] : base;
  };
  const showDelete = canAdd || anyEditable;
  // 위아래 순서 바꾸기 — 영업 계정은 매장 직원 행만 움직인다(본사 인원끼리의 순서는 그대로라 서버 규칙과 맞음)
  const move = (index: number, dir: -1 | 1) =>
    onChange((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const next = list.slice();
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  return (
    <section className="panel" data-anchor="personnel">
      <div className="panel-head">
        <h3>{"2027년 인원정보"}</h3>
        <div className="actions">
          <span className="muted">{NOTES[scope]}</span>
          {canAdd && (
            <button
              type="button"
              className="primary"
              onClick={() =>
                onChange((list) => [
                  ...list,
                  { code: meta.code, dept: meta.name, ...(meta.hasStore ? { store: "" } : {}), position: scope === "store" ? meta.storePositions[0] : "", name: "", values: zeros() },
                ])
              }
            >
              {scope === "store" ? "매장 직원 추가" : "인원 행 추가"}
            </button>
          )}
        </div>
      </div>
      <div className="tablewrap">
        <table className="person-table">
          <colgroup>
            {showDelete && <col style={{ width: 62 }} />}
            <col style={{ width: 64 }} />
            <col style={{ width: 120 }} />
            {meta.hasStore && <col style={{ width: 130 }} />}
            <col style={{ width: 130 }} />
            <col style={{ width: 96 }} />
            {MONTHS.map((m) => (
              <col key={m} />
            ))}
            {showDelete && <col style={{ width: 60 }} />}
          </colgroup>
          <thead>
            <tr>
              {showDelete && <th>순서</th>}
              <th>부서코드</th>
              <th>부서명</th>
              {meta.hasStore && <th>매장명</th>}
              <th>직급</th>
              <th>이름</th>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              {showDelete && <th aria-label="삭제" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowEditable = canEdit(r);
              return (
                <tr key={i} className={rowEditable || scope === "view" ? undefined : "locked"}>
                  {showDelete && (
                    <td>
                      {rowEditable && (
                        <span className="move-buttons">
                          <button type="button" aria-label={`${r.name || "인원"} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>
                            ▲
                          </button>
                          <button type="button" aria-label={`${r.name || "인원"} 아래로`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                            ▼
                          </button>
                        </span>
                      )}
                    </td>
                  )}
                  <td className="fixed">{r.code}</td>
                  <td className="fixed">{r.dept}</td>
                  {meta.hasStore && (
                    <td>
                      <input
                        value={r.store ?? ""}
                        disabled={!rowEditable || !isStore(r.position)}
                        placeholder={isStore(r.position) ? "매장명" : ""}
                        aria-label="매장명"
                        onChange={(e) => setRow(i, { store: e.target.value })}
                      />
                    </td>
                  )}
                  <td>
                    <select value={r.position} disabled={!rowEditable} aria-label="직급" onChange={(e) => setRow(i, { position: e.target.value })}>
                      <option value="" disabled>
                        선택
                      </option>
                      {options(r.position).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={r.name} readOnly={!rowEditable} aria-label="이름" onChange={(e) => setRow(i, { name: e.target.value })} />
                  </td>
                  {r.values.map((v, m) => (
                    <td key={m}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={v}
                        readOnly={!rowEditable}
                        aria-label={`${r.name || "인원"} ${MONTHS[m]} 인원`}
                        onChange={(e) => {
                          const n = e.target.value === "" ? 0 : Number(e.target.value);
                          if (!Number.isInteger(n) || n < 0) return e.target.setCustomValidity("0 이상의 정수를 입력해 주세요.");
                          e.target.setCustomValidity("");
                          setRow(i, { values: r.values.map((x, k) => (k === m ? n : x)) });
                        }}
                      />
                    </td>
                  ))}
                  {showDelete && (
                    <td>
                      {rowEditable && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (confirm("이 인원 행을 삭제할까요?")) onChange((list) => list.filter((_, k) => k !== i));
                          }}
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={18} className="empty">
                  입력된 인원이 없습니다. {canAdd ? "위 버튼으로 추가하세요." : "경영지원팀에서 입력합니다."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={(meta.hasStore ? 5 : 4) + (showDelete ? 1 : 0)}>월별 인원 합계</td>
              {totals.map((v, m) => (
                <td key={m}>{v.toLocaleString("ko-KR")}명</td>
              ))}
              {showDelete && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
