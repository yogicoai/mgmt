"use client";

import { useCallback, useEffect, useState } from "react";
import { accountMonths, money, sum } from "@/lib/budget";
import { api, type ApiError } from "@/lib/client";
import type { DepartmentDoc, DeptMeta, SyncInfo } from "@/lib/types";
import { SYNC_EVENT } from "../Presence";
import { useUi } from "../ui";

interface Visibility {
  hidden: Record<string, string[]>;
  revision: number;
}

// 계정과목 노출(경영지원) — 계정과목마다 어느 부서 화면에 보일지 체크. 끄면 그 부서 팀 화면·엑셀에서 빠진다
export function AccountVisibilityPanel({ metas, departments }: { metas: DeptMeta[]; departments: DepartmentDoc[] }) {
  const { notify } = useUi();
  const [state, setState] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<Visibility>("/api/visibility"));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // 다른 화면에서 바꾸면 바로 다시
  useEffect(() => {
    const onSync = (e: Event) => {
      const next = (e as CustomEvent<SyncInfo>).detail.visibility;
      if (next !== undefined && state && next !== state.revision && !saving) void load();
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [load, state, saving]);

  // 계정과목은 전 부서 같은 30개
  const names = departments[0]?.accounts.map((a) => a.name) ?? [];
  const amountOf = (code: string, name: string) => {
    const account = departments.find((d) => d.code === code)?.accounts.find((a) => a.name === name);
    return account ? sum(accountMonths(account)) : 0;
  };

  const save = async (hidden: Record<string, string[]>) => {
    if (!state) return;
    const previous = state;
    setState({ ...state, hidden }); // 먼저 화면에 반영
    setSaving(true);
    try {
      setState(await api<Visibility>("/api/visibility", { method: "PUT", body: JSON.stringify({ revision: previous.revision, hidden }) }));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body) setState({ hidden: (err.body.hidden as Record<string, string[]>) ?? {}, revision: Number(err.body.revision ?? 0) });
      else setState(previous);
      notify(err.message || String(e), true);
    } finally {
      setSaving(false);
    }
  };

  if (!state) return <div className="empty">불러오는 중…</div>;
  const isHidden = (name: string, code: string) => state.hidden[name]?.includes(code) ?? false;
  const toggle = (name: string, code: string) => {
    const codes = state.hidden[name] ?? [];
    void save({ ...state.hidden, [name]: isHidden(name, code) ? codes.filter((c) => c !== code) : [...codes, code] });
  };
  // 한 줄 전체: 모두 보이면 → 금액 없는 부서는 모두 숨김 / 하나라도 숨겼으면 → 모두 보이기
  const toggleRow = (name: string) => {
    const anyHidden = metas.some((m) => isHidden(name, m.code));
    void save({ ...state.hidden, [name]: anyHidden ? [] : metas.filter((m) => amountOf(m.code, name) === 0).map((m) => m.code) });
  };
  const hiddenCount = Object.values(state.hidden).reduce((n, codes) => n + codes.length, 0);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>계정과목 노출</h2>
          <span className="muted">계정과목마다 어느 부서 화면에 보일지 정합니다 — 끄면 그 부서 팀 화면의 계정별 예산·엑셀에서 빠집니다(경영지원 화면에는 흐리게 ‘숨김’으로 남음)</span>
        </div>
        <span className="muted">{saving ? "저장 중…" : `숨긴 칸 ${hiddenCount}개 · 체크하면 바로 저장`}</span>
      </div>
      <section className="panel" data-anchor="visibility">
        <div className="tablewrap free">
          <table className="visibility-table">
            <thead>
              <tr>
                <th>계정과목</th>
                <th>전체</th>
                {metas.map((m) => (
                  <th key={m.code}>{m.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const shownAll = metas.every((m) => !isHidden(name, m.code));
                return (
                  <tr key={name}>
                    <td>
                      <b>{name}</b>
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => toggleRow(name)} title={shownAll ? "금액이 없는 부서에서는 모두 숨깁니다" : "모든 부서에 보이게 합니다"}>
                        {shownAll ? "안 쓰는 부서 숨기기" : "모두 보이기"}
                      </button>
                    </td>
                    {metas.map((m) => {
                      const amount = amountOf(m.code, name);
                      const hidden = isHidden(name, m.code);
                      const locked = !hidden && amount !== 0; // 금액이 있으면 숨길 수 없음
                      return (
                        <td key={m.code} className={hidden ? "off" : undefined}>
                          <label title={locked ? `금액 ${money(amount)}원이 있어 숨길 수 없습니다` : hidden ? `${m.name}에 숨김 — 누르면 보이기` : `${m.name}에 보임 — 누르면 숨기기`}>
                            <input type="checkbox" checked={!hidden} disabled={locked || saving} onChange={() => toggle(name, m.code)} />
                            <span>{hidden ? "숨김" : "보임"}</span>
                          </label>
                          {amount !== 0 && <small>{money(amount)}</small>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
