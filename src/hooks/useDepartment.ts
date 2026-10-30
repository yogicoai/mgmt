"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { departmentStatus } from "@/lib/budget";
import { api, type ApiError } from "@/lib/client";
import { SECTIONS, SECTION_FIELD, type DepartmentDoc, type DeptRevisionInfo, type Section, type SyncInfo } from "@/lib/types";
import { SYNC_EVENT } from "../components/Presence";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";
type FieldOf<S extends Section> = DepartmentDoc[(typeof SECTION_FIELD)[S]];

const SECTION_NAME: Record<Section, string> = { accounts: "계정별 예산", personnel: "인원정보", sales: "목표매출" };

const SAVE_DELAY = 700;
const RETRY_DELAY = 5000;

/**
 * 부서 문서 하나를 불러와 고치고 자동 저장한다.
 *   - 구역(계정·인원·목표매출)마다 저장 번호를 같이 보내서, 그 사이 다른 화면이 저장했으면 409 → 충돌 안내(덮어쓰지 않음)
 *   - 저장 중에 더 고친 내용은 응답 뒤 이어서 저장
 *   - 다른 화면이 저장하면(접속 신호의 저장 번호) 그 구역만 바로 받아 온다 — 내가 고치는 중인 구역은 건드리지 않음
 */
export function useDepartment(code: string, options: { onSaved?: () => void; team?: boolean } = {}) {
  const [doc, setDoc] = useState<DepartmentDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ sections: Section[]; server: DepartmentDoc } | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null); // 경영지원 값으로 맞춘 구역 안내
  const team = Boolean(options.team);

  const docRef = useRef<DepartmentDoc | null>(null);
  const dirty = useRef(new Set<Section>());
  const inflight = useRef(false);
  const blocked = useRef(false); // 충돌을 정리하기 전에는 자동 저장 멈춤
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onSaved = useRef(options.onSaved);
  onSaved.current = options.onSaved;

  const commit = useCallback((next: DepartmentDoc | null) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const { department } = await api<{ department: DepartmentDoc }>(`/api/departments/${code}`);
      dirty.current.clear();
      blocked.current = false;
      commit(department);
      setLoadError(null);
      setConflict(null);
      setSaveError(null);
      setSaveState("idle");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [code, commit]);

  useEffect(() => {
    void load();
  }, [load]);

  // 다른 화면이 저장한 구역만 받아 온다. 내가 고치는 중(저장 대기·저장 중·충돌)인 구역은 그대로 → 저장 때 충돌 안내
  const syncing = useRef(false);
  const pull = useCallback(
    async (remote: DeptRevisionInfo) => {
      const current = docRef.current;
      if (!current || syncing.current || inflight.current) return;
      const newer = SECTIONS.filter((s) => remote.revisions[s] > current.revisions[s] && !dirty.current.has(s));
      if (!newer.length && remote.closed === current.closed) return;
      syncing.current = true;
      try {
        const { department } = await api<{ department: DepartmentDoc }>(`/api/departments/${code}`);
        if (inflight.current) return; // 그 사이 저장이 시작됐으면 다음 신호 때 다시
        const latest = docRef.current ?? current;
        const next: DepartmentDoc = { ...latest, closed: department.closed, closedAt: department.closedAt, savedAt: department.savedAt, updatedAt: department.updatedAt, revisions: { ...latest.revisions } };
        for (const s of SECTIONS) {
          if (department.revisions[s] <= latest.revisions[s] || dirty.current.has(s)) continue;
          const field = SECTION_FIELD[s];
          (next as unknown as Record<string, unknown>)[field] = department[field];
          next.revisions[s] = department.revisions[s];
        }
        commit(next);
      } catch {
        // 다음 신호 때 다시
      } finally {
        syncing.current = false;
      }
    },
    [code, commit],
  );

  useEffect(() => {
    const onSync = (e: Event) => {
      const remote = (e as CustomEvent<SyncInfo>).detail.depts[code];
      if (remote) void pull(remote);
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [code, pull]);

  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const schedule = useCallback((delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), delay);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    const current = docRef.current;
    if (!current || blocked.current) return false;
    if (inflight.current) return false;
    if (!dirty.current.size) return true;
    const sections = [...dirty.current];
    dirty.current.clear();
    inflight.current = true;
    setSaveState("saving");
    const body: Record<string, { revision: number; data: unknown }> = {};
    for (const s of sections) body[s] = { revision: current.revisions[s], data: current[SECTION_FIELD[s]] };
    let ok = false;
    try {
      const { department } = await api<{ department: DepartmentDoc }>(`/api/departments/${code}`, { method: "PATCH", body: JSON.stringify(body) });
      const latest = docRef.current ?? current;
      const revisions = { ...latest.revisions };
      for (const s of sections) revisions[s] = department.revisions[s];
      commit({ ...latest, revisions, savedAt: department.savedAt, updatedAt: department.updatedAt, closed: department.closed, closedAt: department.closedAt });
      setSaveError(null);
      setSaveState(dirty.current.size ? "pending" : "saved");
      onSaved.current?.();
      ok = true;
    } catch (e) {
      const err = e as ApiError;
      const server = err.body?.department as DepartmentDoc | undefined;
      sections.forEach((s) => dirty.current.add(s));
      if (err.status === 409 && server && team && sections.some((s) => server.savedBy?.[s] === "admin")) {
        // 통합예산(경영지원) 우선 — 경영지원이 먼저 저장한 구역은 그 값으로 맞추고, 나머지 구역은 이어서 저장
        const adopted = sections.filter((s) => server.savedBy?.[s] === "admin");
        const latest = docRef.current ?? current;
        const next: DepartmentDoc = { ...latest, revisions: { ...latest.revisions }, closed: server.closed, closedAt: server.closedAt };
        for (const s of SECTIONS) {
          if (!adopted.includes(s) && server.revisions[s] === latest.revisions[s]) continue;
          if (adopted.includes(s) || !dirty.current.has(s)) {
            (next as unknown as Record<string, unknown>)[SECTION_FIELD[s]] = server[SECTION_FIELD[s]];
            next.revisions[s] = server.revisions[s];
            dirty.current.delete(s);
          }
        }
        commit(next);
        setAdminNotice(`경영지원이 통합예산에서 먼저 수정한 ${adopted.map((s) => SECTION_NAME[s]).join(", ")} 값으로 맞췄습니다. 이 화면에서 방금 바꾼 내용은 저장되지 않았으니 필요하면 다시 입력해 주세요.`);
        setSaveState(dirty.current.size ? "pending" : "saved");
        if (dirty.current.size) schedule(300);
      } else if (err.status === 409 && server) {
        blocked.current = true;
        setConflict({ sections, server });
        setSaveState("conflict");
      } else if (err.status === 423 && server) {
        blocked.current = true;
        commit({ ...(docRef.current ?? current), closed: true, closedAt: server.closedAt });
        setSaveState("error");
        setSaveError(err.message);
      } else {
        setSaveState("error");
        setSaveError(err.message || "저장하지 못했습니다.");
        schedule(RETRY_DELAY); // 네트워크 문제 등은 잠시 뒤 다시
      }
    } finally {
      inflight.current = false;
    }
    if (ok && dirty.current.size && !blocked.current) schedule(300);
    return ok;
  }, [code, commit, schedule]);
  flushRef.current = flush;

  const update = useCallback(
    <S extends Section>(section: S, updater: (value: FieldOf<S>) => FieldOf<S>) => {
      const current = docRef.current;
      if (!current) return;
      const field = SECTION_FIELD[section];
      commit({ ...current, [field]: updater(current[field] as FieldOf<S>) });
      dirty.current.add(section);
      if (!blocked.current) {
        setSaveState("pending");
        schedule(SAVE_DELAY);
      }
    },
    [commit, schedule],
  );

  // 지금 바로 저장(저장 중이면 끝날 때까지 기다렸다가)
  const saveNow = useCallback(async () => {
    for (let i = 0; i < 50 && inflight.current; i++) await new Promise((r) => setTimeout(r, 100));
    return flush();
  }, [flush]);

  const resolveConflict = useCallback(
    async (choice: "reload" | "overwrite") => {
      if (!conflict) return;
      if (choice === "reload") {
        dirty.current.clear();
        blocked.current = false;
        commit(conflict.server);
        setConflict(null);
        setSaveError(null);
        setSaveState("idle");
        return;
      }
      const latest = docRef.current!;
      const revisions = { ...latest.revisions };
      for (const s of conflict.sections) revisions[s] = conflict.server.revisions[s];
      commit({ ...latest, revisions });
      blocked.current = false;
      setConflict(null);
      await flush();
    },
    [conflict, commit, flush],
  );

  const setClosed = useCallback(
    async (closed: boolean) => {
      if (closed && dirty.current.size && !(await saveNow())) throw new Error("저장되지 않은 내용이 있어 마감하지 못했습니다.");
      const { department } = await api<{ department: DepartmentDoc }>(`/api/departments/${code}/close`, { method: closed ? "POST" : "DELETE" });
      dirty.current.clear();
      blocked.current = false;
      commit(department);
      setSaveError(null);
      setSaveState("idle");
      onSaved.current?.();
    },
    [code, commit, saveNow],
  );

  // 저장 안 된 채로 창을 닫으려 하면 경고
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || inflight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);
    };
  }, []);

  const statusLabel = !doc
    ? ""
    : saveState === "conflict"
      ? "변경 충돌"
      : saveState === "saving"
        ? "저장 중"
        : saveState === "pending"
          ? "저장 대기"
          : saveState === "error"
            ? "저장 실패"
            : departmentStatus(doc);

  return { doc, loadError, saveState, saveError, conflict, statusLabel, update, saveNow, reload: load, resolveConflict, setClosed, adminNotice, dismissAdminNotice: () => setAdminNotice(null) };
}

export type DepartmentState = ReturnType<typeof useDepartment>;
