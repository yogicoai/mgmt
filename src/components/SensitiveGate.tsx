"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal } from "./ui";

// 경영지원 전용 계정(직원급여·퇴직급여 등) 보기 — 경영지원은 비밀번호를 한 번 더 넣어야 보이고, 그 창(탭)을 닫을 때까지 유지
const KEY = "budget-sensitive-unlocked";
const EVENT = "budget:sensitive-unlocked";

export function useSensitiveAccess({ isAdmin, master }: { isAdmin: boolean; master?: boolean }) {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(KEY) === "1");
    } catch {
      // 저장소를 못 쓰면 매번 확인
    }
    const on = () => setUnlocked(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return {
    visible: Boolean(master) || (isAdmin && unlocked), // 팀은 서버가 금액을 보내지 않으므로 항상 가림
    canUnlock: isAdmin && !master,
  };
}

function markUnlocked() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // 이 창에서만 유지
  }
  window.dispatchEvent(new Event(EVENT));
}

export function UnlockDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<{ set: boolean; loginId: string } | null>(null);
  useEffect(() => {
    api<{ set: boolean; loginId: string }>("/api/auth/view-password")
      .then(setMode)
      .catch(() => setMode({ set: false, loginId: "" }));
  }, []);
  const submit = async () => {
    if (!password) return;
    setBusy(true);
    try {
      await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ password }) });
      markUnlocked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      className="memo-dialog"
      title="🔒 경영지원 전용 계정 보기"
      onClose={onClose}
      footer={
        <>
          <span className="muted">{error ?? "직원급여·퇴직급여 등 — 이 창을 닫을 때까지 보입니다"}</span>
          <button type="button" className="primary" disabled={!password || busy} onClick={() => void submit()}>
            확인
          </button>
        </>
      }
    >
      <div className="modal-body form-grid">
        <p>
          {mode === null
            ? "확인 중…"
            : mode.set
              ? "급여 열람 비밀번호를 입력하세요 — 계정 관리 탭에서 따로 정한 비밀번호입니다."
              : `경영지원팀 로그인 비밀번호(아이디 ${mode.loginId || "경영지원"})를 입력하세요. 계정 관리 탭에서 급여 열람 비밀번호를 따로 정할 수 있습니다.`}
        </p>
        <label>
          {mode?.set ? "급여 열람 비밀번호" : "경영지원팀 비밀번호"}
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
