"use client";

import { useMemo, useState } from "react";

// 코드설명표 — 같은 구분·계정은 칸을 합쳐 보여 준다(원본 mergedClassificationTable)
function spansOf(rows: string[][]) {
  const spans = rows.map(() => [0, 0, 0]);
  for (let column = 0; column < 3; column++) {
    for (let i = 0; i < rows.length; ) {
      let end = i + 1;
      const same = (a: string[], b: string[]) => (column === 0 ? a[0] === b[0] : a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
      while (end < rows.length && same(rows[i], rows[end])) end++;
      spans[i][column] = end - i;
      i = end;
    }
  }
  return spans;
}

export function CodesTable({ codes, depts }: { codes: string[][]; depts: string[][] }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return codes.filter((r) => r.join(" ").toLowerCase().includes(q));
  }, [codes, query]);
  const spans = spansOf(rows);

  return (
    <>
      <section className="panel" data-anchor="codes">
        <div className="panel-head">
          <h3>코드설명표</h3>
          <input type="search" placeholder="계정명 · 코드 · 상세설명 검색" aria-label="코드설명표 검색" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "min(100%, 420px)" }} />
        </div>
        <div className="tablewrap">
          <table className="codes-table">
            <colgroup>
              <col style={{ width: 75 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 190 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                {["구분", "계정코드", "계정명", "세부 구분", "상세설명"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, column) =>
                    column < 3 ? (
                      spans[i][column] ? (
                        <td key={column} rowSpan={spans[i][column]}>
                          {cell}
                        </td>
                      ) : null
                    ) : (
                      <td key={column}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    검색 결과가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" data-anchor="dept-codes">
        <div className="panel-head">
          <h3>부서코드</h3>
        </div>
        <div className="tablewrap free">
          <table className="dept-codes-table">
            <thead>
              <tr>
                {["부서코드", "부서명", "분류", "비고"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {depts.map((r) => (
                <tr key={r[0]}>
                  {r.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
