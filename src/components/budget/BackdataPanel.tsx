"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatSize, formatTime } from "@/lib/client";
import type { AttachmentMeta } from "@/lib/types";
import { useUi } from "../ui";

const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;

// 백데이터 첨부 — 파일은 DB 에 저장되고 통합 대시보드 '부서별 백데이터'에서 같이 보인다.
//   목표매출·판관비를 나누지 않고 한 칸으로(예전에 나눠 올린 파일도 같이 보임). 새 파일의 저장 구분은 sales 로 둔다
export function BackdataPanel({ code, editable, onChanged }: { code: string; editable: boolean; onChanged?: () => void }) {
  const { notify } = useUi();
  const [files, setFiles] = useState<AttachmentMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { attachments } = await api<{ attachments: AttachmentMeta[] }>(`/api/departments/${code}/attachments`);
      setFiles(attachments);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  }, [code, notify]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const form = new FormData();
    form.set("kind", "sales");
    for (const file of Array.from(list)) form.append("files", file);
    setBusy(true);
    try {
      await api(`/api/departments/${code}/attachments`, { method: "POST", body: form });
      notify(`${list.length}개 파일을 첨부했습니다.`);
      await load();
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (file: AttachmentMeta) => {
    if (!confirm(`${file.name} 파일을 삭제할까요?`)) return;
    try {
      await api(`/api/attachments/${file.id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>목표매출 및 판관비 백데이터</h3>
        <div className="actions">
          <span className="muted">채널별·월별 예상 매출, 계정별 예산 산출 근거 자료 · {files ? `${files.length}개` : "불러오는 중"}</span>
          {editable && (
            <>
              <button type="button" className="primary" disabled={busy} onClick={() => input.current?.click()}>
                {busy ? "올리는 중…" : "첨부파일 업로드"}
              </button>
              <input ref={input} className="hidden" type="file" multiple onChange={(e) => void upload(e.target.files)} />
            </>
          )}
        </div>
      </div>
      {files?.length ? (
        <div className="attachment-list">
          {files.map((f) => (
            <div className="attachment-row" key={f.id}>
              <span className="name">{f.name}</span>
              <span className="muted">{formatTime(f.uploadedAt)}</span>
              <span className="size">{formatSize(f.size)}</span>
              {VIEWABLE.test(f.type) && (
                <a href={`/api/attachments/${f.id}?inline=1`} target="_blank" rel="noreferrer">
                  보기
                </a>
              )}
              <a href={`/api/attachments/${f.id}`}>다운로드</a>
              {editable && (
                <button type="button" className="danger" onClick={() => void remove(f)}>
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">{files ? "첨부된 파일이 없습니다." : "불러오는 중…"}</div>
      )}
    </section>
  );
}
