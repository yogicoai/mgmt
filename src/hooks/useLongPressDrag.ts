"use client";

import { useCallback, useRef, useState } from "react";

export interface RowDrag {
  group: string; // 어느 묶음을 끄는 중인가(연도·부서 등)
  id: string;
  order: string[]; // 지금 보여 줄 순서
}

/**
 * 줄 순서 바꾸기 — 칸을 누른 채 움직이거나(4px 넘게) 꾹 누르면(0.4초) 끌기 시작, 놓으면 onDrop. 그냥 클릭은 평소처럼(클릭은 suppressClick 확인).
 *   줄 요소마다 data-drag-id 를 달고, 누르는 칸에 press(...) 를 펼쳐 넣는다.
 *   끄는 동안 창 전체에서 포인터를 따라가므로 줄이 옮겨지거나 칸 밖에서 놓아도 놓치지 않는다.
 */
export function useLongPressDrag() {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const suppressClick = useRef(false);

  const press = useCallback(
    (group: string, id: string, ids: string[], items: () => HTMLElement[], onDrop: (order: string[]) => void) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        let active: RowDrag | null = null;
        const begin = () => {
          clearTimeout(timer);
          suppressClick.current = true;
          window.getSelection()?.removeAllRanges(); // 끄는 동안 숫자 칸이 선택되어 파랗게 칠해지지 않게
          active = { group, id, order: ids };
          setDrag(active);
        };
        const timer = setTimeout(begin, 400);

        const move = (ev: PointerEvent) => {
          if (!active) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 4) return; // 손떨림은 무시
            begin();
          }
          if (!active) return;
          // 끄는 줄을 t번째에 두면 [T_t, T_t + 높이) 를 차지 — 포인터가 그 안에 드는 첫 t. 다른 줄 높이로만 계산해서 제자리로 돌아오면 원래 순서
          const rows = items();
          const self = rows.find((r) => r.dataset.dragId === id);
          if (!self) return;
          const height = self.getBoundingClientRect().height;
          const others = rows.filter((r) => r !== self);
          let top = rows[0].getBoundingClientRect().top;
          let to = others.length;
          for (let t = 0; t < others.length; t++) {
            if (ev.clientY < top + height) {
              to = t;
              break;
            }
            top += others[t].getBoundingClientRect().height;
          }
          const next = others.map((r) => r.dataset.dragId ?? "");
          next.splice(to, 0, id);
          if (next.join() !== active.order.join()) {
            active = { ...active, order: next };
            setDrag(active);
          }
        };
        const noNativeDrag = (ev: Event) => ev.preventDefault(); // 브라우저 기본 끌기가 시작되면 포인터 신호가 끊긴다
        const finish = (commit: boolean) => {
          clearTimeout(timer);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("dragstart", noNativeDrag);
          if (!active) return;
          setDrag(null);
          if (commit && active.order.join() !== ids.join()) onDrop(active.order);
          setTimeout(() => (suppressClick.current = false), 0);
        };
        const up = () => finish(true);
        const cancel = () => finish(false);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("dragstart", noNativeDrag);
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    }),
    [],
  );

  return { drag, press, suppressClick };
}
