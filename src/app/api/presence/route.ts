import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth/guard";
import { MASTER_ID, isLocalMaster } from "@/lib/auth/local";
import { handle, json } from "@/lib/http";
import { getStore } from "@/lib/store";
import { BUDGET_YEAR } from "@/lib/templates";
import type { PresenceEntry, SyncInfo } from "@/lib/types";

// 같은 화면 접속 표시·실시간 커서 — 창마다 짧은 간격으로 신호를 보내고, 같은 화면의 다른 사람 신호를 받아 간다.
//   page: dept:0005(부서 화면 + 통합 화면의 그 부서 탭) · unified(통합 화면 나머지 탭)
//   로컬 마스터(이 PC 개발 서버)에서 온 신호는 남기지 않는다 — '계정으로 보기'로 팀 계정에 들어가도 다른 사람 화면에 안 보임, 받아 보기만
//   응답에 저장 번호(sync)를 실어 보내 다른 사람이 고친 값을 새로고침 없이 바로 받아 가게 한다
const FRESH_MS = 20_000;

const loc = z.object({
  a: z.string().max(120),
  t: z.number().int().min(0).max(50).optional(),
  r: z.number().int().min(0).max(5000).optional(),
  c: z.number().int().min(0).max(100).optional(),
  fx: z.number().min(0).max(1),
  fy: z.number().min(0).max(1),
});

const schema = z.object({
  clientId: z.string().regex(/^[a-z0-9-]{8,40}$/),
  page: z.string().regex(/^(unified|dept:\d{4})$/),
  where: z.string().max(60).default(""),
  editing: z.boolean().default(false),
  loc: loc.nullable().default(null),
  focus: loc.nullable().default(null),
  click: z.object({ loc, at: z.number() }).nullable().default(null),
  leave: z.boolean().optional(),
});

export const POST = handle(async (request: Request) => {
  const user = await requireUser(request);
  // sendBeacon(창 닫을 때)은 text/plain 으로 오므로 본문을 직접 읽는다
  const body = schema.parse(JSON.parse((await request.text()) || "{}"));
  const dept = body.page.startsWith("dept:") ? body.page.slice(5) : null;
  if (dept ? user.role !== "admin" && user.deptCode !== dept : user.role !== "admin") throw new AuthError("이 화면의 접속 정보는 볼 수 없습니다.", 403);

  const store = getStore();
  const isMaster = user._id === MASTER_ID || isLocalMaster(request.headers);
  if (body.leave) {
    if (!isMaster) await store.dropPresence(body.clientId);
    return json({ others: [] });
  }
  const now = Date.now();
  if (!isMaster) {
    const entry: PresenceEntry = {
      _id: body.clientId,
      page: body.page,
      accountId: user._id,
      loginId: user.loginId,
      deptName: user.deptName,
      where: body.where,
      editing: body.editing,
      loc: body.loc,
      focus: body.focus,
      click: body.click,
      at: now,
    };
    await store.putPresence(entry);
  }
  const [list, revisions, plan, visibility] = await Promise.all([
    store.listPresence(body.page, now - FRESH_MS),
    store.departmentRevisions(BUDGET_YEAR, dept ?? undefined),
    dept ? null : store.getRevenuePlan(BUDGET_YEAR),
    store.getVisibility(BUDGET_YEAR),
  ]);
  const sync: SyncInfo = { depts: Object.fromEntries(revisions.map((r) => [r.code, r])), ...(plan ? { plan: plan.revision } : {}), visibility: visibility?.revision ?? 0 };
  return json({ others: list.filter((e) => e._id !== body.clientId), sync, now });
});
