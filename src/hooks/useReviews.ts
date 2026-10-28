"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { ReviewComment } from "@/lib/types";

// 팀 하나의 검토 의견 — 창으로 돌아오면 다시 불러와서 새 의견을 놓치지 않게
export function useReviews(code: string) {
  const [reviews, setReviews] = useState<ReviewComment[] | null>(null);

  const load = useCallback(async () => {
    try {
      setReviews((await api<{ reviews: ReviewComment[] }>(`/api/departments/${code}/reviews`)).reviews);
    } catch {
      setReviews((list) => list ?? []);
    }
  }, [code]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const replace = (review: ReviewComment) => setReviews((list) => (list ?? []).map((r) => (r._id === review._id ? review : r)));

  const create = async (input: { text: string; account: string | null; month: number | null }) => {
    const { review } = await api<{ review: ReviewComment }>(`/api/departments/${code}/reviews`, { method: "POST", body: JSON.stringify(input) });
    setReviews((list) => [...(list ?? []), review]);
  };
  const reply = async (id: string, text: string) => replace((await api<{ review: ReviewComment }>(`/api/reviews/${id}/replies`, { method: "POST", body: JSON.stringify({ text }) })).review);
  const setStatus = async (id: string, status: "open" | "resolved") =>
    replace((await api<{ review: ReviewComment }>(`/api/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })).review);
  const remove = async (id: string) => {
    await api(`/api/reviews/${id}`, { method: "DELETE" });
    setReviews((list) => (list ?? []).filter((r) => r._id !== id));
  };

  const openCount = reviews?.filter((r) => r.status === "open").length ?? 0;
  const openByAccount = useMemo(() => {
    const map: Record<string, ReviewComment[]> = {};
    for (const r of reviews ?? []) if (r.status === "open" && r.account) (map[r.account] ??= []).push(r);
    return map;
  }, [reviews]);

  return { reviews, load, create, reply, setStatus, remove, openCount, openByAccount };
}

export type ReviewsState = ReturnType<typeof useReviews>;
