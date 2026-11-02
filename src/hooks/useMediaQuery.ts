"use client";

import { useSyncExternalStore } from "react";

// 화면 폭 조건(예: "(max-width: 1760px)") — 창 크기를 바꾸면 바로 다시 그린다. 서버 렌더에서는 false
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
