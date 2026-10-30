import { requireDept } from "@/lib/auth/guard";
import { fail, handle, json } from "@/lib/http";
import { authorFor, newId, reviewReplySchema } from "@/lib/reviews";
import { getStore } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

// 답글 — 그 팀과 경영지원 모두
export const POST = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const store = getStore();
  const found = await store.getReview(id);
  if (!found) return fail("없는 의견입니다.", 404);
  const user = await requireDept(request, found.deptCode);
  const body = reviewReplySchema.parse(await request.json());
  const review = await store.addReviewReply(id, { id: newId(), text: body.text, author: await authorFor(user), createdAt: new Date().toISOString() });
  return json({ review });
});
