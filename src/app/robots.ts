import type { MetadataRoute } from "next";

// 사내용 대시보드 — 모든 검색 엔진·수집기에 전체 차단
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
