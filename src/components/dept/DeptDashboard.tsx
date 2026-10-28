"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDepartment } from "@/hooks/useDepartment";
import { useReviews } from "@/hooks/useReviews";
import { api } from "@/lib/client";
import type { ActualsResult, DeptMeta } from "@/lib/types";
import { BackdataPanel } from "../budget/BackdataPanel";
import { BudgetLedger } from "../budget/BudgetLedger";
import { DeptBanners } from "../budget/DeptBanners";
import { PersonnelEditor } from "../budget/PersonnelEditor";
import { ReviewPanel } from "../budget/ReviewPanel";
import { UserMenu, useUi, type Viewer } from "../ui";
import { CodesTable } from "./CodesTable";
import { Guideline } from "./Guideline";

type TabKey = "guide" | "codes" | "personnel" | "accounts" | "backdata" | "reviews";
const TAB_KEYS: TabKey[] = ["guide", "codes", "personnel", "accounts", "backdata", "reviews"];

export interface Reference {
  guide: string;
  codes: string[][];
  depts: string[][];
}

export function statusChipClass(label: string) {
  if (label === "마감 완료") return "chip closed";
  if (label === "저장 완료") return "chip saved";
  if (label === "저장 중" || label === "저장 대기") return "chip busy";
  if (label === "저장 실패" || label === "변경 충돌") return "chip err";
  return "chip";
}

// 부서별 예산 대시보드 — 원본 '2027년_정기_예산_대시보드_0011_영업.html' 과 같은 탭 구성
export function DeptDashboard({ meta, reference, year, prevYear, viewer }: { meta: DeptMeta; reference: Reference; year: number; prevYear: number; viewer: Viewer }) {
  const { notify } = useUi();
  const state = useDepartment(meta.code);
  const { doc, update, statusLabel, saveNow, setClosed } = state;
  const [tab, setTab] = useState<TabKey>("guide");
  const [actuals, setActuals] = useState<ActualsResult | null>(null);
  const reviews = useReviews(meta.code);
  const editable = Boolean(doc && !doc.closed);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "guide", label: "가이드라인" },
    { key: "codes", label: "코드설명표" },
    { key: "personnel", label: `${year}년 인원정보` },
    { key: "accounts", label: `계정별 예산(${meta.name})` },
    { key: "backdata", label: "백데이터" },
    { key: "reviews", label: `검토 의견${reviews.openCount ? ` (${reviews.openCount})` : ""}` },
  ];

  // 새로고침·링크로 들어와도 주소의 #탭 유지
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1) as TabKey;
      if (TAB_KEYS.includes(hash)) setTab(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const choose = (key: TabKey) => {
    setTab(key);
    window.history.replaceState(null, "", `#${key}`);
  };
  // 로고 → 첫 화면: 팀 계정은 자기 팀 가이드라인, 경영지원은 통합 대시보드
  const goHome = (e: React.MouseEvent) => {
    if (viewer.isAdmin) return;
    e.preventDefault();
    setTab("guide");
    window.history.replaceState(null, "", window.location.pathname);
    window.scrollTo({ top: 0 });
  };

  // 목표매출에 온라인/오프라인이 있으면 전년 실적(onlineData MCP)을 참고로 같이 보여 준다
  const wantsActuals = Boolean(doc?.salesForecastRows.some((r) => r.kind === "온라인" || r.kind === "오프라인"));
  useEffect(() => {
    if (tab !== "guide" || !wantsActuals || actuals) return;
    api<ActualsResult>(`/api/actuals?year=${prevYear}`)
      .then(setActuals)
      .catch(() => undefined);
  }, [tab, wantsActuals, actuals, prevYear]);

  const save = async () => {
    if (await saveNow()) notify("저장했습니다.");
  };
  const close = async () => {
    if (!confirm(`${meta.name} 예산을 마감할까요? 마감하면 계정별 예산·인원정보·백데이터를 고칠 수 없습니다(해제는 통합 대시보드에서).`)) return;
    try {
      await setClosed(true);
      notify(`${meta.name} 예산을 마감했습니다.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <a href={viewer.isAdmin ? "/" : `/dept/${meta.code}`} className="brand-home" onClick={goHome} title={viewer.isAdmin ? "통합 대시보드 첫 화면으로" : "첫 화면으로"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="YOGI CORPORATION 로고 — 첫 화면으로" />
          </a>
          <h1>
            {year} 요기코퍼레이션 정기 예산 설정_{meta.name}[{meta.code}]
          </h1>
        </div>
        <div className="header-side no-print">
          {doc && <span className={statusChipClass(statusLabel)}>{statusLabel}</span>}
          {viewer.isAdmin && (
            <Link href="/" className="muted">
              통합 대시보드
            </Link>
          )}
          <button type="button" onClick={() => window.print()}>
            인쇄 / PDF 저장
          </button>
          <UserMenu viewer={viewer} />
        </div>
      </header>
      <nav className="tabs" aria-label="부서 예산 메뉴">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? "active" : ""} onClick={() => choose(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">
        <DeptBanners state={state} closedHint={viewer.isAdmin ? "통합 대시보드의 부서 탭에서 마감을 해제할 수 있습니다." : "수정이 필요하면 경영지원팀에 마감 해제를 요청하세요."} />
        {reviews.openCount > 0 && tab !== "reviews" && (
          <div className="banner warn">
            <span>
              💬 경영지원 검토 의견 <b>{reviews.openCount}건</b>이 반영을 기다리고 있습니다.
            </span>
            <button type="button" onClick={() => choose("reviews")}>
              확인하기
            </button>
          </div>
        )}
        {!doc && !state.loadError && <div className="empty">불러오는 중…</div>}
        {doc && tab === "guide" && <Guideline guide={reference.guide} salesRows={doc.salesForecastRows} actuals={actuals} />}
        {tab === "codes" && <CodesTable codes={reference.codes} depts={reference.depts} />}
        {doc && tab === "personnel" && (
          <PersonnelEditor
            meta={meta}
            rows={doc.personnel}
            editable={editable}
            scope={viewer.isAdmin ? "all" : meta.hasStore ? "store" : "view"}
            onChange={(fn) => update("personnel", fn)}
          />
        )}
        {doc && tab === "accounts" && (
          <BudgetLedger
            doc={doc}
            editable={editable}
            statusLabel={statusLabel}
            onAccountsChange={(fn) => update("accounts", fn)}
            onBeforeExport={saveNow}
            openReviews={reviews.openByAccount}
            isAdmin={viewer.isAdmin}
            actions={
              editable && (
                <>
                  <button type="button" onClick={() => void save()}>
                    저장
                  </button>
                  <button type="button" className="primary" onClick={() => void close()}>
                    마감
                  </button>
                </>
              )
            }
          />
        )}
        {doc && tab === "backdata" && <BackdataPanel code={meta.code} editable={editable} />}
        {doc && tab === "reviews" && <ReviewPanel state={reviews} viewer={viewer} accounts={doc.accounts.map((a) => a.name)} deptName={meta.name} />}
      </main>
    </>
  );
}
