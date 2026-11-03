"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// 화면 공용: 알림(토스트) + 떠 있는 설명(툴팁) + 모달 대화상자

type Toast = { message: string; error?: boolean } | null;
type Tip = { text: string; left: number; top: number; chart?: boolean } | null;

interface UiContextValue {
  notify: (message: string, error?: boolean) => void;
  showTip: (target: Element, text: string, chart?: boolean) => void;
  hideTip: () => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("UiProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const [tip, setTip] = useState<Tip>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tipRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 3200);
  }, []);

  const showTip = useCallback((target: Element, text: string, chart = false) => {
    if (!text.trim()) return;
    const r = target.getBoundingClientRect();
    setTip({ text, left: r.left, top: r.bottom + 6, chart });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // 알림·툴팁은 popover(최상위 레이어)로 띄운다 — 모달 대화상자가 열려 있어도 그 위에 보이도록,
  // 보여 줄 때마다 다시 열어 가장 위로 올린다.
  useEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    if (!tip) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
    // 화면 밖으로 나가지 않게 실제 크기로 위치를 맞춘다
    const box = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(tip.left, window.innerWidth - box.width - 8));
    const top = tip.top + box.height + 8 > window.innerHeight ? Math.max(8, tip.top - box.height - 40) : tip.top;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [tip]);

  useEffect(() => {
    const el = toastRef.current;
    if (!el) return;
    if (el.matches(":popover-open")) el.hidePopover();
    if (toast) el.showPopover();
  }, [toast]);

  return (
    <UiContext.Provider value={{ notify, showTip, hideTip }}>
      {children}
      <div ref={tipRef} popover="manual" className={`tooltip${tip?.chart ? " chart" : ""}`} role="tooltip">
        {tip?.text}
      </div>
      <div ref={toastRef} popover="manual" className={`toast${toast?.error ? " err" : ""}`} role="status">
        {toast?.message}
      </div>
    </UiContext.Provider>
  );
}

// 브라우저 기본 <dialog> 를 모달로 — 열리면 showModal, Esc·닫기 버튼은 onClose
export function Modal({ className, title, onClose, children, footer }: { className?: string; title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { hideTip } = useUi();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => hideTip();
  }, [hideTip]);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button type="button" onClick={onClose}>
          닫기 ✕
        </button>
      </div>
      {children}
      {footer && <div className="modal-actions">{footer}</div>}
    </dialog>
  );
}

// 이름 하나 입력 창 — 매출 예산안 구분명·계정과목. 저장에 실패하면 onSave 쪽에서 알리고 창은 그대로 둔다
export function NameDialog({
  title,
  label,
  initial = "",
  hint,
  maxLength,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  hint?: string;
  maxLength: number;
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const value = name.trim();
  const save = async () => {
    if (!value || busy) return;
    setBusy(true);
    try {
      await onSave(value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      className="memo-dialog"
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{hint}</span>
          <button type="button" className="primary" disabled={!value || busy} onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      <div className="modal-body form-grid">
        <label>
          {label}
          <input
            value={name}
            maxLength={maxLength}
            autoFocus
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void save(); // 한글 조합 중 Enter 는 조합만 끝낸다
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

// 줄 순서를 바꾼 뒤 저장 전 안내 — 끌어서 바꾼 순서는 [변경내용 저장]을 눌러야 저장된다. 저장 안 하고 창을 닫으면 경고
export function OrderSaveBar({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return (
    <span className="order-save" role="status">
      <span className="chip busy">순서 변경됨 — 저장해야 반영</span>
      <button type="button" className="primary" onClick={onSave}>
        변경내용 저장
      </button>
      <button type="button" onClick={onCancel}>
        취소
      </button>
    </span>
  );
}

// 예/아니오 확인 창 — 처리가 끝날 때까지 열어 두고, 닫는 것은 부르는 쪽에서(onConfirm 끝난 뒤)
export function ConfirmDialog({ title, message, danger = true, onConfirm, onClose }: { title: string; message: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      className="memo-dialog"
      title={title}
      onClose={onClose}
      footer={
        <div className="actions" style={{ marginLeft: "auto" }}>
          <button type="button" disabled={busy} onClick={onClose}>
            아니오
          </button>
          <button
            type="button"
            className={danger ? "danger-solid" : "primary"}
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "처리 중…" : "예"}
          </button>
        </div>
      }
    >
      <div className="modal-body">
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{message}</p>
      </div>
    </Modal>
  );
}

export interface Viewer {
  loginId: string;
  deptName: string;
  isAdmin: boolean;
  master?: boolean; // 로컬 마스터(로그인 없이 들어온 이 PC)
}

// 머리말 오른쪽: 로그인한 계정 + 로그아웃
export function UserMenu({ viewer }: { viewer: Viewer }) {
  // 로컬 마스터 — 화면에 '마스터'라는 표시를 남기지 않는다(화면 공유 때도 드러나지 않게)
  if (viewer.master)
    return (
      <span className="user-menu">
        <a className="button-link" href="/login">
          계정으로 보기
        </a>
      </span>
    );
  return (
    <span className="user-menu">
      <span className="muted" title={viewer.isAdmin ? "통합예산·계정 관리 권한" : undefined}>
        <b>{viewer.deptName}</b> · {viewer.loginId}
      </span>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          window.location.href = "/login";
        }}
      >
        로그아웃
      </button>
    </span>
  );
}

export function StatCard({ label, value, unit = "원", note }: { label: string; value: React.ReactNode; unit?: string; note?: React.ReactNode }) {
  return (
    <div className="card">
      <small>{label}</small>
      <div className="value">
        {value}
        {unit && value !== "" && <span className="unit">{unit}</span>}
      </div>
      <p>{note}</p>
    </div>
  );
}
