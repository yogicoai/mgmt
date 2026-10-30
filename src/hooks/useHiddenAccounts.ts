"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { SyncInfo } from "@/lib/types";
import { SYNC_EVENT } from "../components/Presence";

// 이 부서에 숨긴 계정과목(경영지원의 계정과목 노출 설정) — 설정이 바뀌면 접속 신호의 저장 번호로 알아채고 다시 받는다
export function useHiddenAccounts(code: string) {
  const [hidden, setHidden] = useState<string[]>([]);
  const revision = useRef(-1);

  const load = useCallback(async () => {
    try {
      const r = await api<{ hidden: string[]; revision: number }>(`/api/visibility?dept=${code}`);
      revision.current = r.revision;
      setHidden(r.hidden);
    } catch {
      // 다음 신호 때 다시
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSync = (e: Event) => {
      const next = (e as CustomEvent<SyncInfo>).detail.visibility;
      if (next !== undefined && next !== revision.current) void load();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [load]);

  return hidden;
}
