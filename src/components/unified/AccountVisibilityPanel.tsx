"use client";

import { useCallback, useEffect, useState } from "react";
import { PNL_VISIBILITY, accountMonths, inBudgetTotal, isSensitiveAccount, money, pnlAccountTotal, sum } from "@/lib/budget";
import { api, type ApiError } from "@/lib/client";
import type { DepartmentDoc, DeptMeta, PnlPrior, SyncInfo } from "@/lib/types";
import { SYNC_EVENT } from "../Presence";
import { ConfirmDialog, NameDialog, useUi } from "../ui";

interface Visibility {
  hidden: Record<string, string[]>;
  revision: number;
}

// 계정과목 노출(경영지원) — 계정과목마다 어느 부서 화면에 보일지 체크. 끄면 그 부서 팀 화면·엑셀에서 빠진다.
//   맨 오른쪽 ‘2027 손익’ 칸은 통합 손익 표에 그 줄을 보일지(물류 전용 계정과목 등). 계정과목 추가·이름 수정·삭제도 여기서(전 부서 공통). 부서명 줄과 계정과목 칸은 틀고정
export function AccountVisibilityPanel({
  year,
  metas,
  departments,
  pnlPrior,
  onChanged,
  onSaved,
}: {
  year: number;
  metas: DeptMeta[];
  departments: DepartmentDoc[];
  pnlPrior: PnlPrior[];
  onChanged: () => Promise<unknown>; // 계정과목 추가·수정·삭제 뒤 — 부서 문서까지 다시
  onSaved: (visibility: Visibility) => void; // 체크 저장 뒤 — 노출 설정만
}) {
  const { notify } = useUi();
  const [state, setState] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);
  const [manage, setManage] = useState(false); // 위쪽 [수정]을 눌러야 줄마다 [수정]·[삭제]가 나타나고, 끝나면 [저장](매출 예산안 구분명과 같은 방식)
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
      const next = await api<Visibility>("/api/visibility", { method: "PUT", body: JSON.stringify({ revision: previous.revision, hidden }) });
      setState(next);
      onSaved(next); // 손익 탭도 바로 같은 설정으로
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
  // 한 줄 전체(부서 칸만): 모두 보이면 → 금액 없는 부서는 모두 숨김 / 하나라도 숨겼으면 → 모두 보이기. ‘손익’ 칸은 그대로 둔다
  const toggleRow = (name: string) => {
    const anyHidden = metas.some((m) => isHidden(name, m.code));
    const keepPnl = isHidden(name, PNL_VISIBILITY) ? [PNL_VISIBILITY] : [];
    void save({ ...state.hidden, [name]: [...(anyHidden ? [] : metas.filter((m) => amountOf(m.code, name) === 0).map((m) => m.code)), ...keepPnl] });
  };
  const sensitiveNames = new Set(departments.flatMap((d) => d.accounts.filter(isSensitiveAccount).map((a) => a.name)));
  // 손익 줄 금액 — 2027(물류 제외 합)·2026 실적(이름을 고쳤으면 원래 이름으로). 어느 쪽이든 있으면 손익에서 못 숨김
  const pnlOf = (name: string) => {
    const origin = departments[0]?.accounts.find((a) => a.name === name)?.origin ?? name;
    return { total: pnlAccountTotal(departments, name), prior: pnlPrior.find((p) => p.name === origin)?.prior ?? 0 };
  };
  const hiddenCount = Object.values(state.hidden).reduce((n, codes) => n + codes.length, 0);

  return (
    <>
      <div className="section-title">
        <div>
          <h2>계정과목 노출</h2>
          <span className="muted">
            계정과목마다 어느 부서 화면에 보일지 정합니다 — 끄면 그 부서 팀 화면의 계정별 예산·엑셀에서 빠집니다(경영지원 화면에는 흐리게 ‘숨김’으로 남음). 맨 오른쪽 ‘{year} 손익’을 미포함으로 하면 {year} 손익 표에서 그 줄이 빠집니다
          </span>
        </div>
        <div className="actions">
          <span className="muted">{saving ? "저장 중…" : `숨긴 칸 ${hiddenCount}개 · 체크하면 바로 저장`}</span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              // 이름 수정·삭제는 창에서 [저장]·[예]를 누를 때 이미 저장된다 — 여기서는 수정 상태를 닫는다
              if (manage) notify("저장했습니다.");
              setManage((v) => !v);
            }}
            aria-pressed={manage}
            title={manage ? "수정 끝내기" : "계정과목 수정·삭제 — 누르면 계정과목마다 [수정]·[삭제] 버튼이 나타납니다"}
          >
            {manage ? "저장" : "수정"}
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
                <th className="pnl-col">{year} 손익</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name) => {
                const shownAll = metas.every((m) => !isHidden(name, m.code));
                // 합산하지 않는 부서(물류)에만 보이는 계정과목 — 이름 옆에 ‘물류’, 이름 칸 색으로 구분(노출 체크를 바꾸면 따라 바뀜)
                const shownIn = metas.filter((m) => !isHidden(name, m.code));
                const excludedOnly = shownIn.length > 0 && shownIn.every((m) => !inBudgetTotal(m.code));
                return (
                  <tr key={name} className={excludedOnly ? "excluded-only" : undefined}>
                    <td>
                      <b>{name}</b>
                      {excludedOnly && (
                        <span className="only-chip" title={`${shownIn.map((m) => m.name).join("·")} 화면에만 보이는 계정과목 — 금액은 통합 합산에서 빠집니다`}>
                          {shownIn.map((m) => m.name).join("·")}
                        </span>
                      )}
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
                          <label title={locked ? (inBudgetTotal(m.code) && !sensitiveNames.has(name) ? `금액 ${money(amount)}원이 있어 숨길 수 없습니다` : "금액이 있어 숨길 수 없습니다") : hidden ? `${m.name}에 숨김 — 누르면 보이기` : `${m.name}에 보임 — 누르면 숨기기`}>
                            <input type="checkbox" checked={!hidden} disabled={locked || saving} onChange={() => toggle(name, m.code)} />
                            <span>{hidden ? "숨김" : "보임"}</span>
                          </label>
                          {amount !== 0 && inBudgetTotal(m.code) && !sensitiveNames.has(name) && <small>{money(amount)}</small>}
                        </td>
                      );
                    })}
                    {(() => {
                      const { total, prior } = pnlOf(name);
                      const locked = total !== 0 || prior !== 0; // 손익 줄에 금액이 있으면 미포함으로 못 바꿈(미포함 뒤 금액이 생겨도 손익 표에는 나옴)
                      const hidden = isHidden(name, PNL_VISIBILITY) && !locked;
                      // 급여 등 경영지원 전용 계정은 손익 탭처럼 금액을 보이지 않는다(잠김 여부만)
                      const secret = sensitiveNames.has(name);
                      const title = locked
                        ? secret
                          ? "금액이 있어 미포함으로 바꿀 수 없습니다"
                          : total !== 0
                            ? `${year} 손익 금액 ${money(total)}원이 있어 미포함으로 바꿀 수 없습니다`
                            : `${year - 1} 실적 ${money(prior)}원이 있어 미포함으로 바꿀 수 없습니다`
                        : hidden
                          ? `${year} 손익 미포함 — 누르면 포함`
                          : `${year} 손익 포함 — 누르면 미포함`;
                      return (
                        <td className={hidden ? "pnl-col off" : "pnl-col"}>
                          <label title={title}>
                            <input type="checkbox" checked={!hidden} disabled={locked || saving} onChange={() => toggle(name, PNL_VISIBILITY)} />
                            <span>{hidden ? "미포함" : "포함"}</span>
                          </label>
                          {!secret && (total !== 0 ? <small>{money(total)}</small> : prior !== 0 && <small>{year - 1} {money(prior)}</small>)}
                        </td>
                      );
                    })()}
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
