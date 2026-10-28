import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";
import { homeOf } from "@/lib/auth/accounts";
import { currentAccount } from "@/lib/auth/guard";
import { BUDGET_YEAR } from "@/lib/templates";

export const metadata: Metadata = { title: `로그인 · ${BUDGET_YEAR} 요기코퍼레이션 예산` };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const account = await currentAccount();
  // 다른 사이트로 보내는 주소는 받지 않는다(같은 사이트 경로만)
  const safeNext = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;
  return (
    <LoginForm
      year={BUDGET_YEAR}
      next={safeNext}
      current={account ? { deptName: account.deptName, loginId: account.loginId, home: homeOf(account) } : null}
    />
  );
}
