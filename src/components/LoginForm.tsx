"use client";

import { useState } from "react";

// 로그인 — 부서 계정은 자기 부서 화면으로, 경영지원 계정은 통합예산으로 들어간다
export function LoginForm({ year, next, current }: { year: number; next: string | null; current: { deptName: string; loginId: string; home: string } | null }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId, password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "로그인하지 못했습니다.");
      // next 가 있어도 권한 없는 곳이면 서버가 다시 자기 화면으로 돌려보낸다
      window.location.href = next || body.home || "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="YOGI CORPORATION 로고" />
        <h1>{year} 정기 예산</h1>
        <p className="muted">부서 아이디로 로그인하세요. 아이디·비밀번호는 경영지원팀에서 발급합니다.</p>
        {current && (
          <div className="banner info">
            <span>
              지금 <b>{current.deptName}</b>({current.loginId})로 로그인되어 있습니다.
            </span>
            <a className="button-link" href={current.home}>
              이동
            </a>
          </div>
        )}
        <label>
          아이디
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          비밀번호
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
