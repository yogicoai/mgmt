import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DeptDashboard } from "@/components/dept/DeptDashboard";
import reference from "@/data/reference.json";
import { homeOf } from "@/lib/auth/accounts";
import { currentAccount } from "@/lib/auth/guard";
import { BUDGET_YEAR, findDeptMeta } from "@/lib/templates";

type Props = { params: Promise<{ code: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meta = findDeptMeta((await params).code);
  return { title: meta ? `${BUDGET_YEAR} 정기 예산 설정_${meta.name}[${meta.code}]` : "부서 예산" };
}

// 부서별 예산 입력 화면 — /dept/0011 (영업). 그 부서 계정과 경영지원 계정만 들어올 수 있다
export default async function DepartmentPage({ params }: Props) {
  const { code } = await params;
  const meta = findDeptMeta(code);
  if (!meta) notFound();
  const account = await currentAccount();
  if (!account) redirect(`/login?next=${encodeURIComponent(`/dept/${code}`)}`);
  if (account.role !== "admin" && account.deptCode !== code) redirect(homeOf(account));
  return (
    <DeptDashboard
      meta={meta}
      reference={reference}
      year={BUDGET_YEAR}
      prevYear={BUDGET_YEAR - 1}
      viewer={{ loginId: account.loginId, deptName: account.deptName, isAdmin: account.role === "admin" }}
    />
  );
}
