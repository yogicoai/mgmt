"use client";

import { useCallback, useEffect, useState } from "react";
import { accountMonths, inBudgetTotal, money, sum } from "@/lib/budget";
import { api, type ApiError } from "@/lib/client";
import type { DepartmentDoc, DeptMeta, SyncInfo } from "@/lib/types";
import { SYNC_EVENT } from "../Presence";
import { ConfirmDialog, NameDialog, useUi } from "../ui";

interface Visibility {
  hidden: Record<string, string[]>;
  revision: number;
}

// 계정과목 노출(경영지원) — 계정과목마다 어느 부서 화면에 보일지 체크. 끄면 그 부서 팀 화면·엑셀에서 빠진다.
//   계정과목 추가·이름 수정·삭제도 여기서(전 부서 공통). 부서명 줄과 계정과목 칸은 틀고정
export function AccountVisibilityPanel({ metas, departments, onChanged }: { metas: DeptMeta[]; departments: DepartmentDoc[]; onChanged: () => Promise<unknown> }) {
  const { notify } = useUi();
  const [state, setState] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);
  const [manage, setManage] = useState(false); // [− 계정과목 수정/삭제]를 눌러야 줄마다 [수정]·[삭제]가 나타난다
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "rename"; name: string } | { kind: "delete"; name: string } | null>(null);

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

  // 계정과목은 전 부서 공통
  const names = [...new Set(departments.flatMap((d) => d.accounts.map((a) => a.name)))];
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

  // 계정과목 추가·수정·삭제 — 표를 새로 받은 뒤 창을 닫는다. 실패하면 알리고 창은 그대로
  const changeAccounts = async (body: Record<string, string>, message: string) => {
    setSaving(true);
    try {
      setState(await api<Visibility>("/api/visibility/accounts", { method: "POST", body: JSON.stringify(body) }));
      await onChanged();
      notify(message);
      setDialog(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setSaving(false);
    }
  };
  const removeAccount = (name: string) => {
    const filled = metas.filter((m) => amountOf(m.code, name) !== 0).map((m) => m.name);
    if (filled.length) return notify(`${filled.join("·")}에 금액이 있어 ‘${name}’을(를) 삭제할 수 없습니다. 부서 탭 상세 창에서 금액을 지운 뒤 삭제해 주세요.`, true);
    setDialog({ kind: "delete", name });
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
        <div className="actions">
          <span className="muted">{saving ? "저장 중…" : `숨긴 칸 ${hiddenCount}개 · 체크하면 바로 저장`}</span>
          <button type="button" className={manage ? "" : "danger-solid"} onClick={() => setManage((v) => !v)} aria-pressed={manage} title={manage ? "수정·삭제 끝내기" : "누르면 계정과목마다 [수정]·[삭제] 버튼이 나타납니다"}>
            {manage ? "완료" : "− 계정과목 수정/삭제"}
          </button>
          <button type="button" className="primary" onClick={() => setDialog({ kind: "add" })}>
            + 계정과목 추가
          </button>
        </div>
      </div>
      <section className="panel" data-anchor="visibility">
        <div className="tablewrap visibility-wrap">
          <table className="visibility-table">
            <thead>
              <tr>
                <th>계정과목</th>
                <th>{manage ? "관리" : "전체"}</th>
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
                    <td className={manage ? "row-manage" : undefined}>
                      {manage ? (
                        <>
                          <button type="button" className="link" disabled={saving} onClick={() => setDialog({ kind: "rename", name })} aria-label={`${name} 이름 수정`}>
                            수정
                          </button>
                          <button type="button" className="link danger" disabled={saving} onClick={() => removeAccount(name)} aria-label={`${name} 삭제`}>
                            삭제
                          </button>
                        </>
                      ) : (
                        <button type="button" className="link" onClick={() => toggleRow(name)} title={shownAll ? "금액이 없는 부서에서는 모두 숨깁니다" : "모든 부서에 보이게 합니다"}>
                          {shownAll ? "안 쓰는 부서 숨기기" : "모두 보이기"}
                        </button>
                      )}
                    </td>
                    {metas.map((m) => {
                      const amount = amountOf(m.code, name);
                      const hidden = isHidden(name, m.code);
                      const locked = !hidden && amount !== 0; // 금액이 있으면 숨길 수 없음
                      return (
                        <td key={m.code} className={hidden ? "off" : undefined}>
                          <label title={locked ? (inBudgetTotal(m.code) ? `금액 ${money(amount)}원이 있어 숨길 수 없습니다` : "금액이 있어 숨길 수 없습니다") : hidden ? `${m.name}에 숨김 — 누르면 보이기` : `${m.name}에 보임 — 누르면 숨기기`}>
                            <input type="checkbox" checked={!hidden} disabled={locked || saving} onChange={() => toggle(name, m.code)} />
                            <span>{hidden ? "숨김" : "보임"}</span>
                          </label>
                          {amount !== 0 && inBudgetTotal(m.code) && <small>{money(amount)}</small>}
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
      {dialog?.kind === "add" && (
        <NameDialog
          title="계정과목 추가"
          label="새 계정과목 이름"
          maxLength={30}
          hint="모든 부서의 계정별 예산 맨 아래에 추가됩니다"
          onSave={(name) => changeAccounts({ action: "add", name }, `‘${name}’ 계정과목을 추가했습니다.`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="계정과목 삭제"
          message={`‘${dialog.name}’ 계정과목을 삭제하시겠습니까? 모든 부서에서 사라지며 되돌릴 수 없습니다.`}
          onConfirm={() => changeAccounts({ action: "delete", name: dialog.name }, `‘${dialog.name}’ 계정과목을 삭제했습니다.`)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={`‘${dialog.name}’ 이름 수정`}
          label="계정과목 이름"
          initial={dialog.name}
          maxLength={30}
          hint="모든 부서에 함께 바뀌고 금액은 그대로입니다"
          onSave={(to) => changeAccounts({ action: "rename", name: dialog.name, to }, `‘${to}’(으)로 이름을 바꿨습니다.`)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
