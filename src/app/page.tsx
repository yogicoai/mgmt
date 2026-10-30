import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UnifiedDashboard } from "@/components/unified/UnifiedDashboard";
import { homeOf } from "@/lib/auth/accounts";
import { currentAccount } from "@/lib/auth/guard";
import { MASTER_ID } from "@/lib/auth/local";
import { BUDGET_YEAR, channels, deptMetas, pnlPrior, revenue2026 } from "@/lib/templates";

export const metadata: Metadata = { title: `${BUDGET_YEAR} 요기코퍼레이션 통합 예산` };
export const dynamic = "force-dynamic";

// 통합 예산 대시보드 — 경영지원 계정 전용. 부서별 화면(/dept/코드)에서 입력한 값을 실시간 합산
export default async function Home() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.role !== "admin") redirect(homeOf(account));
  return (
    <UnifiedDashboard
      year={BUDGET_YEAR}
      prevYear={BUDGET_YEAR - 1}
      metas={deptMetas}
      channels={channels}
      revenue2026={revenue2026}
      pnlPrior={pnlPrior}
      viewer={{ loginId: account.loginId, deptName: account.deptName, isAdmin: true, master: account._id === MASTER_ID }}
    />
  );
}
