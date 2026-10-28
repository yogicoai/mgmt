import { requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";
import type { AttachmentKind } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };

const MAX_BYTES = Number(process.env.MAX_ATTACHMENT_MB || 10) * 1024 * 1024;

export const GET = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  if (!(await getDepartment(code))) return fail("없는 부서입니다.", 404);
  return json({ attachments: await getStore().listAttachments(BUDGET_YEAR, code) });
});

// 백데이터 첨부 — form-data: kind(sales|expenses) + files(여러 개)
export const POST = handle(async (request: Request, { params }: Context) => {
  const { code } = await params;
  await requireDept(request, code);
  const department = await getDepartment(code);
  if (!department) return fail("없는 부서입니다.", 404);
  if (department.closed) return fail("마감된 부서는 첨부파일을 바꿀 수 없습니다.", 423);

  const form = await request.formData();
  const kind = form.get("kind");
  if (kind !== "sales" && kind !== "expenses") return fail("첨부 구분(kind)을 확인해 주세요.");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return fail("첨부할 파일을 골라 주세요.");
  const tooBig = files.find((f) => f.size > MAX_BYTES);
  if (tooBig) return fail(`${tooBig.name}: 파일 하나는 ${Math.round(MAX_BYTES / 1048576)}MB 까지 올릴 수 있습니다.`, 413);

  const store = getStore();
  const saved = [];
  for (const file of files) {
    saved.push(
      await store.addAttachment(
        {
          year: BUDGET_YEAR,
          deptCode: code,
          kind: kind as AttachmentKind,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          uploadedAt: new Date().toISOString(),
        },
        Buffer.from(await file.arrayBuffer()),
      ),
    );
  }
  return json({ attachments: saved });
});
