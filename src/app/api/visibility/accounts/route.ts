import { z } from "zod";
import { AccountNameError, addAccountName, deleteAccountName, renameAccountName } from "@/lib/accountNames";
import { requireAdmin } from "@/lib/auth/guard";
import { fail, handle, json } from "@/lib/http";

// 계정과목 추가·이름 수정·삭제(경영지원) — 전 부서 공통. 응답은 바뀐 노출 설정
const newName = z
  .string()
  .trim()
  .min(1, "계정과목 이름을 입력해 주세요.")
  .max(30, "계정과목 이름은 30자까지 쓸 수 있습니다.")
  .regex(/^[^.$]+$/, "계정과목 이름에 . 과 $ 는 쓸 수 없습니다."); // 노출 설정이 이름을 DB 필드 키로 쓴다
const oldName = z.string().min(1).max(100);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: newName }),
  z.object({ action: z.literal("rename"), name: oldName, to: newName }),
  z.object({ action: z.literal("delete"), name: oldName }),
]);

export const POST = handle(async (request: Request) => {
  await requireAdmin(request);
  const body = schema.parse(await request.json());
  try {
    if (body.action === "add") return json(await addAccountName(body.name));
    if (body.action === "rename") return json(await renameAccountName(body.name, body.to));
    return json(await deleteAccountName(body.name));
  } catch (e) {
    if (e instanceof AccountNameError) return fail(e.message);
    throw e;
  }
});
