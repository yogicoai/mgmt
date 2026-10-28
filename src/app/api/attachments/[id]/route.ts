import type { NextRequest } from "next/server";
import { requireDept } from "@/lib/auth/guard";
import { getDepartment } from "@/lib/departments";
import { fail, handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

// 브라우저 안에서 열어도 되는 형식만(스크립트가 들어갈 수 있는 HTML·SVG 는 내려받기로)
const INLINE_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i;

export const GET = handle(async (request: NextRequest, { params }: Context) => {
  const { id } = await params;
  const found = await getStore().getAttachment(id);
  if (!found) return fail("첨부파일이 없습니다.", 404);
  await requireDept(request, found.meta.deptCode);
  const { meta, data } = found;
  const inline = request.nextUrl.searchParams.get("inline") === "1" && INLINE_TYPES.test(meta.type);
  const fallbackName = meta.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? meta.type : meta.type || "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = handle(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const store = getStore();
  const found = await store.getAttachment(id);
  if (!found) return fail("첨부파일이 없습니다.", 404);
  await requireDept(request, found.meta.deptCode);
  const department = await getDepartment(found.meta.deptCode);
  if (department?.closed) return fail("마감된 부서는 첨부파일을 바꿀 수 없습니다.", 423);
  await store.deleteAttachment(id);
  return json({ ok: true });
});
