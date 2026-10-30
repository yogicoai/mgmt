import type { Metadata } from "next";
import { UiProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false }, // 사내용 — 검색 엔진에 안 잡히게
  title: "요기코퍼레이션 예산 대시보드",
  description: "부서별 예산 입력과 통합 예산 현황",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 회사 기본 글꼴 Pretendard */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <UiProvider>{children}</UiProvider>
      </body>
    </html>
  );
}
