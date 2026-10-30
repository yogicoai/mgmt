"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatTime } from "@/lib/client";
import type { PublicAccount } from "@/lib/types";
import { Modal, useUi } from "../ui";

type Dialog =
  | { kind: "password"; account: PublicAccount }
  | { kind: "loginId"; account: PublicAccount }
  | null;

const addressOf = (a: PublicAccount) => (typeof window === "undefined" ? "" : `${window.location.origin}${a.role === "admin" ? "/" : `/dept/${a.deptCode}`}`);

const statusOf = (a: PublicAccount) =>
  !a.active
    ? { label: "사용 중지", cls: "badge" }
    : !a.hasPassword
      ? { label: "비밀번호 없음", cls: "badge warn" }
      : !a.passwordUpdatedAt
        ? { label: "초기 비밀번호(1234)", cls: "badge warn" }
        : { label: "사용 중", cls: "badge saved" };

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// 계정 관리(경영지원) — 팀별 접속 주소·아이디·비밀번호
export function AccountsPanel({ year }: { year: number }) {
  const { notify } = useUi();
  const [accounts, setAccounts] = useState<PublicAccount[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts((await api<{ accounts: PublicAccount[] }>("/api/accounts")).accounts);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (account: PublicAccount, body: Record<string, unknown>) => {
    setBusy(account._id);
    try {
      const res = await api<{ account: PublicAccount }>(`/api/accounts/${account._id}`, { method: "PATCH", body: JSON.stringify(body) });
      setAccounts((list) => (list ?? []).map((a) => (a._id === res.account._id ? res.account : a)));
      return res;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (account: PublicAccount) => {
    const next = !account.active;
    if (!next && !confirm(`${account.deptName} 계정을 사용 중지할까요? 바로 로그아웃되고 다시 켤 때까지 들어올 수 없습니다.`)) return;
    if (await change(account, { active: next })) notify(next ? `${account.deptName} 계정을 다시 사용합니다.` : `${account.deptName} 계정을 사용 중지했습니다.`);
  };

  return (
    <>
      <div className="section-title">
        <div>
          <h2>계정 관리</h2>
          <span className="muted">팀별 접속 주소·아이디·비밀번호 — 경영지원 계정만 보이는 화면입니다</span>
        </div>
      </div>
      <div className="banner info">
        <span>
          팀 계정은 <b>자기 팀 페이지만</b> 열 수 있고, 경영지원 계정은 통합예산과 모든 팀 페이지에 들어갑니다. 모든 계정의 처음 비밀번호는 <b>1234</b> 입니다 — 다른 팀이 아이디만 알면 들어올 수 있으니 실제 입력을 시작하기 전에 팀마다 <b>비밀번호 변경</b>으로 바꿔 알려 주세요. 저장한 비밀번호는 암호화되어 이 화면에서도 다시 볼 수 없습니다(잊으면 새로 바꾸면 됩니다).
        </span>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>{year}년 예산 계정</h3>
          <span className="muted">{accounts ? `${accounts.length}개 계정` : "불러오는 중"}</span>
        </div>
        <div className="tablewrap free">
          <table className="accounts-table">
            <thead>
              <tr>
                <th>팀</th>
                <th>접속 주소</th>
                <th>아이디</th>
                <th>상태</th>
                <th>비밀번호 바꾼 날</th>
                <th>마지막 로그인</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {(accounts ?? []).map((a) => {
                const status = statusOf(a);
                const address = addressOf(a);
                return (
                  <tr key={a._id}>
                    <td>
                      <b>{a.deptName}</b> <span className="muted">[{a.deptCode}]</span>
                      {a.role === "admin" && <span className="badge closed" style={{ marginLeft: 6 }}>통합예산 관리</span>}
                    </td>
                    <td>
                      <button type="button" className="link" title="주소 복사" onClick={async () => notify((await copy(address)) ? "주소를 복사했습니다." : address)}>
                        {address.replace(/^https?:\/\//, "")} ⧉
                      </button>
                    </td>
                    <td>
                      <code>{a.loginId}</code>
                    </td>
                    <td>
                      <span className={status.cls}>{status.label}</span>
                    </td>
                    <td className="muted">{a.passwordUpdatedAt ? formatTime(a.passwordUpdatedAt) : "—"}</td>
                    <td className="muted">{a.lastLoginAt ? formatTime(a.lastLoginAt) : "—"}</td>
                    <td>
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="primary" disabled={busy === a._id} onClick={() => setDialog({ kind: "password", account: a })}>
                          비밀번호 변경
                        </button>
                        <button type="button" disabled={busy === a._id} onClick={() => setDialog({ kind: "loginId", account: a })}>
                          아이디 변경
                        </button>
                        {a.role !== "admin" && (
                          <button type="button" className={a.active ? "danger" : ""} disabled={busy === a._id} onClick={() => void toggleActive(a)}>
                            {a.active ? "사용 중지" : "다시 사용"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!accounts && (
                <tr>
                  <td colSpan={7} className="empty">
                    불러오는 중…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <ViewPasswordPanel />

      {dialog?.kind === "password" && (
        <PasswordDialog
          account={dialog.account}
          onSave={async (password) => {
            const res = await change(dialog.account, { password });
            if (res) {
              notify(`${dialog.account.deptName} 비밀번호를 바꿨습니다.`);
              setDialog(null);
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "loginId" && (
        <LoginIdDialog
          account={dialog.account}
          onSave={async (loginId) => {
            const res = await change(dialog.account, { loginId });
            if (res) {
              notify(`${dialog.account.deptName} 아이디를 ‘${res.account.loginId}’ 로 바꿨습니다.`);
              setDialog(null);
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// 경영지원이 정한 새 비밀번호 — 팀에 알려 줘야 하니 입력하는 글자가 보이게 둔다(가리기 가능)
function PasswordDialog({ account, onSave, onClose }: { account: PublicAccount; onSave: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [hidden, setHidden] = useState(false);
  const problem = password.length < 8 ? "8자 이상" : !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) ? "영문과 숫자를 섞어 주세요" : null;
  return (
    <Modal
      className="memo-dialog"
      title={`${account.deptName} 비밀번호 변경`}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{problem ?? "저장하면 로그인해 둔 화면은 다시 로그인해야 합니다"}</span>
          <button type="button" className="primary" disabled={Boolean(problem)} onClick={() => void onSave(password)}>
            저장
          </button>
        </>
      }
    >
      <div className="modal-body form-grid">
        <p className="muted">
          아이디 <code>{account.loginId}</code> · 지금 비밀번호는 몰라도 바꿀 수 있습니다
        </p>
        <label>
          새 비밀번호 (8자 이상, 영문+숫자)
          <input type={hidden ? "password" : "text"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" spellCheck={false} autoFocus />
        </label>
        <label className="check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> 입력한 글자 가리기
        </label>
      </div>
    </Modal>
  );
}

function LoginIdDialog({ account, onSave, onClose }: { account: PublicAccount; onSave: (loginId: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(account.loginId);
  const normalized = value.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9._-]{2,29}$/.test(normalized);
  return (
    <Modal
      className="memo-dialog"
      title={`${account.deptName} 아이디 변경`}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{valid ? "비밀번호는 그대로입니다" : "영문 소문자·숫자로 시작하는 3~30자 (영문·숫자·. _ -)"}</span>
          <button type="button" className="primary" disabled={!valid || normalized === account.loginId} onClick={() => void onSave(normalized)}>
            저장
          </button>
        </>
      }
    >
      <div className="modal-body form-grid">
        <label>
          새 아이디
          <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  );
}

// 급여 열람 비밀번호 — 급여 등 경영지원 전용 계정을 볼 때 넣는 비밀번호. 정하지 않으면 경영지원 로그인 비밀번호로 확인
function ViewPasswordPanel() {
  const { notify } = useUi();
  const [state, setState] = useState<{ set: boolean; updatedAt: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<{ set: boolean; updatedAt: string | null }>("/api/auth/view-password")
      .then(setState)
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);
  const problem =
    form.next.length < 8 ? "8자 이상" : !/[A-Za-z]/.test(form.next) || !/[0-9]/.test(form.next) ? "영문과 숫자를 섞어 주세요" : form.next !== form.again ? "두 번 입력한 값이 다릅니다" : null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ set: boolean; updatedAt: string | null }>("/api/auth/view-password", { method: "POST", body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }) });
      setState(r);
      setOpen(false);
      setForm({ current: "", next: "", again: "" });
      notify("급여 열람 비밀번호를 정했습니다. 급여 담당자에게만 알려 주세요.");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>급여 열람 비밀번호</h3>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          {state?.set ? "바꾸기" : "정하기"}
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        직원급여·퇴직급여 등 경영지원 전용 계정을 볼 때 한 번 더 넣는 비밀번호입니다.{" "}
        {state === null ? "" : state.set ? <b>설정됨 · {formatTime(state.updatedAt)}</b> : <b>아직 정하지 않음 — 지금은 경영지원 로그인 비밀번호로 확인합니다.</b>} 로그인 계정을 여럿이 같이 쓴다면 급여 담당자만 아는 비밀번호로 정해 두세요.
      </p>
      {open && (
        <Modal
          className="memo-dialog"
          title={`급여 열람 비밀번호 ${state?.set ? "바꾸기" : "정하기"}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <span className="muted">{problem ?? "로그인 비밀번호와 다르게 정해 주세요"}</span>
              <button type="button" className="primary" disabled={Boolean(problem) || busy} onClick={() => void save()}>
                저장
              </button>
            </>
          }
        >
          <div className="modal-body form-grid">
            <label>
              지금 로그인 비밀번호(확인용)
              <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} autoComplete="current-password" autoFocus />
            </label>
            <label>
              새 급여 열람 비밀번호 (8자 이상, 영문+숫자)
              <input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} autoComplete="new-password" />
            </label>
            <label>
              한 번 더
              <input type="password" value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} autoComplete="new-password" />
            </label>
          </div>
        </Modal>
      )}
    </section>
  );
}
