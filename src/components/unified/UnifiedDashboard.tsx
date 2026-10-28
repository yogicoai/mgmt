"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatTime } from "@/lib/client";
import type { Channel, DepartmentDoc, DeptMeta, PnlPrior, Revenue2026Row, RevenuePlan, StorageKind } from "@/lib/types";
import { UserMenu, useUi, type Viewer } from "../ui";
import { AccountsPanel } from "./AccountsPanel";
import { BackdataOverview } from "./BackdataOverview";
import { BudgetOverview } from "./BudgetOverview";
import { DeptLedgerTab } from "./DeptLedgerTab";
import { PersonnelOverview } from "./PersonnelOverview";
import { PnlOverview } from "./PnlOverview";
import { RevenueOverview } from "./RevenueOverview";

interface Health {
  storage: StorageKind;
  database: { ok: boolean; error?: string };
  onlineData: { configured: boolean; host: string };
}

const REFRESH_MS = 60_000;

// 통합 예산 대시보드 — 부서 문서들을 읽어 실시간 합산(파일 불러오기 없이)
export function UnifiedDashboard({
  year,
  prevYear,
  metas,
  channels,
  revenue2026,
  pnlPrior,
  viewer,
}: {
  year: number;
  prevYear: number;
  metas: DeptMeta[];
  channels: Channel[];
  revenue2026: Revenue2026Row[];
  pnlPrior: PnlPrior[];
  viewer: Viewer;
}) {
  const { notify } = useUi();
  const [departments, setDepartments] = useState<DepartmentDoc[] | null>(null);
  const [plan, setPlan] = useState<RevenuePlan | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [tab, setTab] = useState("revenue");
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tabs = [
    { key: "revenue", label: "전체 매출 현황" },
    { key: "budget", label: "전체 예산 현황" },
    { key: "pnl", label: `${year} 손익` },
    { key: "personnel", label: "인원현황" },
    ...metas.map((m) => ({ key: `dept-${m.code}`, label: m.name })),
    { key: "backdata", label: "부서별 백데이터" },
    { key: "accounts", label: "계정 관리" },
  ];

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([api<{ departments: DepartmentDoc[] }>("/api/departments"), api<{ plan: RevenuePlan }>("/api/revenue")]);
      setDepartments(d.departments);
      setPlan(r.plan);
      setError(null);
      setSyncedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    api<Health>("/api/health")
      .then(setHealth)
      .catch(() => undefined);
  }, [load]);

  // 주소의 #탭 (새로고침·링크·뒤로가기 모두)
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash) setTab(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // 다른 부서가 저장한 값도 보이도록 — 창으로 돌아올 때 + 1분마다
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [load]);

  // 부서 탭에서 저장하면 합산 화면도 곧 갱신
  const onDeptSaved = useCallback(() => {
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => void load(), 800);
  }, [load]);

  const choose = (key: string) => {
    setTab(key);
    window.history.replaceState(null, "", `#${key}`);
    window.scrollTo({ top: 0 });
  };

  const deptMeta = tab.startsWith("dept-") ? metas.find((m) => `dept-${m.code}` === tab) : undefined;
  const conn = error
    ? { dot: "err", label: "연결 오류" }
    : health?.storage === "file"
      ? { dot: "warn", label: "로컬 파일 저장소(시험용)" }
      : health
        ? { dot: "ok", label: "MongoDB 연결됨" }
        : { dot: "", label: "연결 확인 중" };

  return (
    <>
      <header className="app-header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YOGI CORPORATION 로고" />
          <h1>{year} 요기코퍼레이션 통합 예산</h1>
        </div>
        <div className="header-side no-print">
          <span className="conn" title={health?.database.error}>
            <span className={`dot ${conn.dot}`} />
            {conn.label}
          </span>
          <span className={`chip${health?.onlineData.configured ? " saved" : ""}`} title={health ? `onlineData MCP · ${health.onlineData.host}` : undefined}>
            매출 실적 MCP {health ? (health.onlineData.configured ? "연결 설정됨" : "토큰 미설정") : "…"}
          </span>
          <select
            aria-label="부서 화면 열기"
            value=""
            onChange={(e) => {
              if (e.target.value) window.open(`/dept/${e.target.value}`, "_blank");
            }}
          >
            <option value="">부서 화면 열기</option>
            {metas.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} [{m.code}]
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={async () => {
              await load();
              notify("최신 자료를 불러왔습니다.");
            }}
          >
            새로고침
          </button>
          <UserMenu viewer={viewer} />
        </div>
      </header>
      <nav className="tabs" aria-label="통합 예산 메뉴">
        {tabs.map((t, i) => (
          <span key={t.key} style={{ display: "contents" }}>
            {(t.key === `dept-${metas[0]?.code}` || t.key === "backdata") && i > 0 && <span className="tab-sep" aria-hidden="true" />}
            <button type="button" className={tab === t.key ? "active" : ""} onClick={() => choose(t.key)}>
              {t.label}
            </button>
          </span>
        ))}
      </nav>
      <main className="page">
        {error && (
          <div className="banner err">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              다시 시도
            </button>
          </div>
        )}
        {health?.storage === "file" && (
          <div className="banner info">
            <span>
              MONGODB_URI 가 비어 있어 이 PC 의 로컬 파일(.local/dev-db)에 저장하고 있습니다 — 시험용입니다. MongoDB 주소를 <b>.local/.env</b> 의 MONGODB_URI 에 넣고 서버를 다시 켜면 MongoDB 를 씁니다.
            </span>
          </div>
        )}
        {!departments || !plan ? (
          !error && <div className="empty">불러오는 중…</div>
        ) : (
          <>
            {tab === "revenue" && (
              <RevenueOverview
                year={year}
                prevYear={prevYear}
                metas={metas}
                departments={departments}
                channels={channels}
                revenue2026={revenue2026}
                plan={plan}
                onPlanSaved={setPlan}
                onDeptSaved={onDeptSaved}
              />
            )}
            {tab === "budget" && <BudgetOverview year={year} departments={departments} onSelect={(code) => choose(`dept-${code}`)} onImported={() => void load()} />}
            {tab === "pnl" && (
              <PnlOverview year={year} prevYear={prevYear} departments={departments} channels={channels} plan={plan} pnlPrior={pnlPrior} onPlanSaved={setPlan} />
            )}
            {tab === "personnel" && <PersonnelOverview year={year} departments={departments} />}
            {deptMeta && <DeptLedgerTab key={deptMeta.code} meta={deptMeta} year={year} onSaved={onDeptSaved} viewer={viewer} />}
            {tab === "backdata" && <BackdataOverview departments={departments} />}
            {tab === "accounts" && <AccountsPanel year={year} />}
          </>
        )}
        <p className="muted no-print" style={{ marginTop: 24 }}>
          부서 화면에서 저장한 값이 바로 합산됩니다 · 1분마다 자동 갱신{syncedAt ? ` · 마지막 갱신 ${formatTime(syncedAt)}` : ""}
        </p>
      </main>
    </>
  );
}
