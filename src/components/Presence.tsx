"use client";

import { useEffect, useRef, useState } from "react";
import type { CursorLoc, PresenceEntry, SyncInfo } from "@/lib/types";

// 다른 사람이 저장하면 이 이벤트로 알린다 — useDepartment·통합 화면이 듣고 바뀐 구역만 다시 받아 온다
export const SYNC_EVENT = "budget:sync";

// 같은 화면 접속 표시 + 실시간 커서
//   위치는 좌표 대신 "가장 가까운 data-anchor 영역 → 그 안 몇째 표의 몇 행 몇 칸 → 칸 안 비율"로 주고받아
//   화면 크기·스크롤이 달라도 같은 칸을 가리킨다. 같은 화면에 누가 있으면 0.6초, 혼자면 3초마다 신호.

const PALETTE = ["#2a78d6", "#eb6834", "#1f9d6b", "#9b51e0", "#d6336c", "#0f8fa8", "#b7791f", "#5c6ac4"];
const colorOf = (key: string) => PALETTE[[...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const ease = (t: number) => 1 - (1 - t) * (1 - t);
const MOVE_MS = 550;

function newClientId() {
  const random = () => Math.random().toString(36).slice(2, 10);
  try {
    let id = sessionStorage.getItem("budget-presence-id");
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${random()}-${random()}`;
      sessionStorage.setItem("budget-presence-id", id);
    }
    return id;
  } catch {
    return `${random()}-${random()}`;
  }
}

function locate(target: Element | null, x: number, y: number): CursorLoc | null {
  const anchor = target?.closest<HTMLElement>("[data-anchor]");
  if (!target || !anchor) return null;
  const a = anchor.dataset.anchor!;
  const cell = target.closest<HTMLTableCellElement>("td, th");
  if (cell && anchor.contains(cell)) {
    const table = cell.closest("table");
    const row = cell.parentElement as HTMLTableRowElement | null;
    const t = table ? [...anchor.querySelectorAll("table")].indexOf(table) : -1;
    if (table && row && t >= 0) {
      const rect = cell.getBoundingClientRect();
      return { a, t, r: row.rowIndex, c: cell.cellIndex, fx: clamp((x - rect.left) / rect.width), fy: clamp((y - rect.top) / rect.height) };
    }
  }
  const rect = anchor.getBoundingClientRect();
  return { a, fx: clamp((x - rect.left) / rect.width), fy: clamp((y - rect.top) / rect.height) };
}

function elementOf(loc: CursorLoc): Element | null {
  const anchor = document.querySelector(`[data-anchor="${CSS.escape(loc.a)}"]`);
  if (!anchor) return null;
  if (loc.t === undefined) return anchor;
  const table = anchor.querySelectorAll("table")[loc.t];
  return table?.rows[loc.r ?? -1]?.cells[loc.c ?? -1] ?? null;
}

function resolve(loc: CursorLoc | null) {
  if (!loc) return null;
  const el = elementOf(loc);
  const rect = el?.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return { x: rect.left + loc.fx * rect.width, y: rect.top + loc.fy * rect.height, rect };
}

const sameLoc = (a: CursorLoc | null, b: CursorLoc | null) => JSON.stringify(a) === JSON.stringify(b);

interface Track {
  prev: CursorLoc | null;
  next: CursorLoc | null;
  since: number;
  clickAt: number;
  clickLoc: CursorLoc | null;
  clickShown: number;
}

export function PresenceLayer({ page, where }: { page: string; where: string }) {
  const [others, setOthers] = useState<PresenceEntry[]>([]);
  const othersRef = useRef<PresenceEntry[]>([]);
  const tracks = useRef(new Map<string, Track>());
  const nodes = useRef(new Map<string, { cursor?: HTMLDivElement | null; focus?: HTMLDivElement | null; ripple?: HTMLDivElement | null }>());
  const layer = useRef<HTMLDivElement>(null);
  const me = useRef({ loc: null as CursorLoc | null, focus: null as CursorLoc | null, click: null as { loc: CursorLoc; at: number } | null, lastInput: 0 });
  const id = useRef("");
  const target = useRef({ page, where });
  const kick = useRef<() => void>(() => undefined);

  // 내 마우스·클릭·입력 칸
  useEffect(() => {
    id.current = newClientId();
    const s = me.current;
    const onMove = (e: PointerEvent) => {
      s.loc = locate(e.target as Element, e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      const loc = locate(e.target as Element, e.clientX, e.clientY);
      if (loc) s.click = { loc, at: Date.now() };
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.matches?.("input, select, textarea")) return;
      const r = el.getBoundingClientRect();
      s.focus = locate(el, r.left + r.width / 2, r.top + r.height / 2);
    };
    const onBlur = () => {
      s.focus = null;
    };
    const onInput = () => {
      s.lastInput = Date.now();
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) s.loc = null; // 창 밖으로
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  // 신호 주고받기
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receive = (list: PresenceEntry[]) => {
      const now = performance.now();
      const seen = new Set<string>();
      for (const e of list) {
        seen.add(e._id);
        const t = tracks.current.get(e._id);
        if (!t) tracks.current.set(e._id, { prev: e.loc, next: e.loc, since: now, clickAt: e.click?.at ?? 0, clickLoc: null, clickShown: 0 });
        else {
          if (!sameLoc(t.next, e.loc)) Object.assign(t, { prev: t.next, next: e.loc, since: now });
          if (e.click && e.click.at !== t.clickAt) Object.assign(t, { clickAt: e.click.at, clickLoc: e.click.loc, clickShown: now });
        }
      }
      for (const key of [...tracks.current.keys()]) if (!seen.has(key)) tracks.current.delete(key);
      for (const key of [...nodes.current.keys()]) if (!seen.has(key)) nodes.current.delete(key);
      othersRef.current = list;
      setOthers(list);
    };
    const tick = async () => {
      if (stopped) return;
      clearTimeout(timer);
      const s = me.current;
      const visible = document.visibilityState === "visible";
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: id.current,
            page: target.current.page,
            where: target.current.where,
            editing: Date.now() - s.lastInput < 15_000,
            loc: visible ? s.loc : null,
            focus: visible ? s.focus : null,
            click: s.click,
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as { others: PresenceEntry[]; sync?: SyncInfo };
          receive(body.others);
          if (body.sync) window.dispatchEvent(new CustomEvent<SyncInfo>(SYNC_EVENT, { detail: body.sync }));
        }
      } catch {
        // 신호가 한두 번 빠져도 다음 차례에 다시
      }
      if (!stopped) timer = setTimeout(tick, !visible ? 15_000 : othersRef.current.length ? 600 : 3_000);
    };
    kick.current = () => void tick();
    void tick();
    const leave = () => navigator.sendBeacon?.("/api/presence", JSON.stringify({ clientId: id.current, page: target.current.page, leave: true }));
    const onVisible = () => document.visibilityState === "visible" && void tick();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      leave();
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // 탭을 바꾸면 바로 알림
  useEffect(() => {
    target.current = { page, where };
    kick.current();
  }, [page, where]);

  // 커서 층은 브라우저 맨 위 층(top layer) — 상세 입력 창(<dialog>)이 열려도 그 위에 보이도록 창이 열릴 때마다 다시 올린다
  const active = others.length > 0;
  useEffect(() => {
    const el = layer.current;
    if (!active || !el || typeof el.showPopover !== "function") return;
    const raise = () => {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch {
        // 이미 닫힌 경우 등
      }
    };
    raise();
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.target instanceof HTMLDialogElement && r.target.open)) raise();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [active]);

  // 매 프레임: 내 스크롤·창 크기에 맞춰 위치를 다시 계산하고, 움직임은 부드럽게
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const frame = () => {
      const now = performance.now();
      for (const e of othersRef.current) {
        const t = tracks.current.get(e._id);
        const n = nodes.current.get(e._id);
        if (!t || !n) continue;
        if (n.cursor) {
          const to = resolve(t.next);
          const from = resolve(t.prev) ?? to;
          if (!to || !from) n.cursor.style.opacity = "0";
          else {
            const k = ease(Math.min(1, (now - t.since) / MOVE_MS));
            n.cursor.style.opacity = "1";
            n.cursor.style.transform = `translate(${from.x + (to.x - from.x) * k}px, ${from.y + (to.y - from.y) * k}px)`;
          }
        }
        if (n.focus) {
          const f = resolve(e.focus);
          if (!f) n.focus.style.opacity = "0";
          else {
            Object.assign(n.focus.style, { opacity: "1", left: `${f.rect.left - 2}px`, top: `${f.rect.top - 2}px`, width: `${f.rect.width + 4}px`, height: `${f.rect.height + 4}px` });
          }
        }
        if (n.ripple) {
          const p = (now - t.clickShown) / 700;
          const c = p < 1 ? resolve(t.clickLoc) : null;
          if (!c) n.ripple.style.opacity = "0";
          else {
            n.ripple.style.opacity = String(1 - p);
            n.ripple.style.transform = `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) scale(${0.4 + p * 1.4})`;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // 같은 아이디(팀이 같이 쓰는 계정)는 묶어서
  const groups = new Map<string, { entry: PresenceEntry; count: number; editing: boolean; wheres: Set<string> }>();
  for (const e of others) {
    const g = groups.get(e.loginId) ?? { entry: e, count: 0, editing: false, wheres: new Set<string>() };
    g.count++;
    g.editing ||= e.editing;
    if (e.where) g.wheres.add(e.where);
    groups.set(e.loginId, g);
  }

  if (!active) return null;
  return (
    <>
      <div className="presence-bar" role="status" aria-live="polite">
        <span className="muted">같은 화면</span>
        {[...groups.values()].map(({ entry, count, editing, wheres }) => (
          <span key={entry.loginId} className={`presence-chip${editing ? " editing" : ""}`} style={{ ["--who" as string]: colorOf(entry.loginId) }} title={`${entry.deptName}(${entry.loginId}) · ${[...wheres].join(", ")}`}>
            <i aria-hidden="true" />
            <b>{entry.loginId}</b>
            {count > 1 && <span>×{count}</span>}
            <span className="muted">
              {entry.deptName} · {editing ? "수정 중" : "보는 중"}
              {wheres.size ? ` · ${[...wheres].join(", ")}` : ""}
            </span>
          </span>
        ))}
      </div>
      <div ref={layer} className="presence-layer" popover="manual" aria-hidden="true">
        {others.map((e) => {
          const color = colorOf(e.loginId);
          const set = (key: "cursor" | "focus" | "ripple") => (el: HTMLDivElement | null) => {
            const n = nodes.current.get(e._id) ?? {};
            n[key] = el;
            nodes.current.set(e._id, n);
          };
          return (
            <div key={e._id}>
              <div ref={set("focus")} className="presence-focus" style={{ borderColor: color }}>
                <span style={{ background: color }}>{e.loginId} 입력 중</span>
              </div>
              <div ref={set("ripple")} className="presence-ripple" style={{ borderColor: color }} />
              <div ref={set("cursor")} className="presence-cursor" style={{ color }}>
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M2 1.5 L15.5 8.2 L9.2 9.6 L6.4 15.8 Z" fill="currentColor" stroke="white" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span style={{ background: color }}>{e.loginId}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
