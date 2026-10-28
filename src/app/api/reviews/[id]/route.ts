import { requireAdmin } from "@/lib/auth/guard";
import { fail, handle, json } from "@/lib/http";
import { reviewPatchSchema } from "@/lib/reviews";
import { getStore } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

// 반영 완료 / 다시 열기 / 내용 고치기 — 경영지원만
export const PATCH = handle(async (request: Request, { params }: Context) => {
  await requireAdmin(request);
  const { id } = await params;
  const body = reviewPatchSchema.parse(await request.json());
  const store = getStore();
  if (!(await store.getReview(id))) return fail("없는 의견입니다.", 404);
  const review = await store.updateReview(id, {
    ...(body.text ? { text: body.text } : {}),
    ...(body.status ? { status: body.status, resolvedAt: body.status === "resolved" ? new Date().toISOString() : null } : {}),
  });
  return json({ review });
});

export const DELETE = handle(async (request: Request, { params }: Context) => {
  await requireAdmin(request);
  const { id } = await params;
  if (!(await getStore().deleteReview(id))) return fail("없는 의견입니다.", 404);
  return json({ ok: true });
});
