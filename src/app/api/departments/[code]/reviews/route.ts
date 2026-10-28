import { requireAdmin, requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { authorOf, newId, reviewCreateSchema } from "@/lib/reviews";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";
import type { ReviewComment } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };

// 검토 의견 목록 — 그 팀과 경영지원
export const GET = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  return json({ reviews: await getStore().listReviews(BUDGET_YEAR, code) });
});

// 검토 의견 남기기 — 경영지원만. account/month 로 계정·월을 집어 줄 수 있다
export const POST = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  const admin = await requireAdmin(request);
  const doc = await getDepartment(code);
  if (!doc) return fail("없는 부서입니다.", 404);
  const body = reviewCreateSchema.parse(await request.json());
  const account = body.account?.trim() || null;
  if (account && !doc.accounts.some((a) => a.name === account)) return fail("없는 계정과목입니다.");
  const now = new Date().toISOString();
  const review: ReviewComment = {
    _id: newId(),
    year: BUDGET_YEAR,
    deptCode: code,
    account,
    month: account ? (body.month ?? null) : null,
    text: body.text,
    author: authorOf(admin),
    status: "open",
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    replies: [],
  };
  await getStore().insertReview(review);
  return json({ review });
});
