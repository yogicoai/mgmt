"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatSize, formatTime } from "@/lib/client";
import type { AttachmentKind, AttachmentMeta } from "@/lib/types";
import { useUi } from "../ui";

const SECTIONS: { kind: AttachmentKind; title: string; hint: string }[] = [
  { kind: "sales", title: "1. 목표매출 백데이터", hint: "채널별·월별 예상 매출 산출 자료" },
  { kind: "expenses", title: "2. 판관비 백데이터", hint: "계정별 예산 산출 근거 자료" },
];
const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;

// 백데이터 첨부 — 파일은 DB 에 저장되고 통합 대시보드 '부서별 백데이터'에서 같이 보인다
export function BackdataPanel({ code, editable, onChanged }: { code: string; editable: boolean; onChanged?: () => void }) {
  const { notify } = useUi();
  const [files, setFiles] = useState<AttachmentMeta[] | null>(null);
  const [busy, setBusy] = useState<AttachmentKind | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const upload = async (kind: AttachmentKind, list: FileList | null) => {
    if (!list?.length) return;
    const form = new FormData();
    form.set("kind", kind);
    for (const file of Array.from(list)) form.append("files", file);
    setBusy(kind);
    try {
      await api(`/api/departments/${code}/attachments`, { method: "POST", body: form });
      notify(`${list.length}개 파일을 첨부했습니다.`);
      await load();
      onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
      const input = inputs.current[kind];
      if (input) input.value = "";
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
    <>
      {SECTIONS.map(({ kind, title, hint }) => {
        const list = (files ?? []).filter((f) => f.kind === kind);
        return (
          <section className="panel" key={kind}>
            <div className="panel-head">
              <h3>{title}</h3>
              <div className="actions">
                <span className="muted">
                  {hint} · {files ? `${list.length}개` : "불러오는 중"}
                </span>
                {editable && (
                  <>
                    <button type="button" className="primary" disabled={busy !== null} onClick={() => inputs.current[kind]?.click()}>
                      {busy === kind ? "올리는 중…" : "첨부파일 업로드"}
                    </button>
                    <input
                      ref={(el) => {
                        inputs.current[kind] = el;
                      }}
                      className="hidden"
                      type="file"
                      multiple
                      onChange={(e) => void upload(kind, e.target.files)}
                    />
                  </>
                )}
              </div>
            </div>
            {list.length ? (
              <div className="attachment-list">
                {list.map((f) => (
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
      })}
    </>
  );
}
