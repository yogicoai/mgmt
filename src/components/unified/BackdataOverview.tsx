"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { AttachmentMeta, DepartmentDoc } from "@/lib/types";
import { BackdataPanel } from "../budget/BackdataPanel";

// 부서별 백데이터 — 부서가 올린 첨부를 부서별로(원본 renderDepartmentBackdata)
export function BackdataOverview({ departments }: { departments: DepartmentDoc[] }) {
  const [selected, setSelected] = useState(departments[0]?.code ?? "");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const current = departments.find((d) => d.code === selected);

  const loadCounts = useCallback(async () => {
    try {
      const { attachments } = await api<{ attachments: AttachmentMeta[] }>("/api/attachments");
      const next: Record<string, number> = {};
      for (const a of attachments) next[a.deptCode] = (next[a.deptCode] ?? 0) + 1;
      setCounts(next);
    } catch {
      // 목록 숫자는 보조 정보 — 실패해도 아래 패널은 따로 불러온다
    }
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>부서별 백데이터</h2>
          <span className="muted">부서 화면 ‘백데이터’에서 올린 첨부파일</span>
        </div>
      </div>
      <div className="dept-chips">
        {departments.map((d) => (
          <button key={d.code} type="button" className={d.code === selected ? "active" : ""} onClick={() => setSelected(d.code)}>
            {d.name}
            <span>{counts[d.code] ?? 0}</span>
          </button>
        ))}
      </div>
      {current && <BackdataPanel key={current.code} code={current.code} editable={!current.closed} onChanged={loadCounts} />}
    </>
  );
}
