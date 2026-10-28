import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AttachmentMeta, DepartmentDoc, LoginAccount, RevenuePlan, ReviewComment } from "../types";
import type { BudgetStore, PatchResult } from "./types";

// MONGODB_URI 가 비어 있을 때 쓰는 시험용 저장소 — .local/dev-db 안의 JSON 파일.
// 주의: 이 PC 의 Node 24 는 한글·'·' 경로에서 fs.rm(Sync) 를 부르면 프로세스가 죽는다 → 삭제는 unlink 만 쓴다.
const dir = path.resolve(process.env.FILE_STORE_DIR || path.join(process.cwd(), ".local", "dev-db"));
const attachmentDir = path.join(dir, "attachments");

type Tables = {
  departments: Record<string, DepartmentDoc>;
  attachments: Record<string, AttachmentMeta>;
  plans: Record<string, RevenuePlan>;
  cache: Record<string, { data: unknown; fetchedAt: string }>;
  accounts: Record<string, LoginAccount>;
  reviews: Record<string, ReviewComment>;
};

const globalForFile = globalThis as unknown as { __budgetFileQueue?: Promise<unknown> };

// 쓰기는 한 번에 하나씩(파일을 통째로 다시 쓰므로)
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = (globalForFile.__budgetFileQueue ?? Promise.resolve()).then(task, task);
  globalForFile.__budgetFileQueue = run.catch(() => undefined);
  return run;
}

async function read<K extends keyof Tables>(table: K): Promise<Tables[K]> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${table}.json`), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {} as Tables[K];
    throw e;
  }
}

async function write<K extends keyof Tables>(table: K, value: Tables[K]) {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${table}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value));
  // Windows 는 백신·색인이 파일을 잠깐 잡고 있으면 EPERM/EBUSY — 몇 번 다시 시도
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, target);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY")) throw e;
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
    }
  }
}

const update = <K extends keyof Tables, T>(table: K, change: (value: Tables[K]) => T) =>
  serialize(async () => {
    const value = await read(table);
    const result = change(value);
    await write(table, value);
    return result;
  });

const clone = <T>(v: T): T => structuredClone(v);

export const fileStore: BudgetStore = {
  kind: "file",

  async listDepartments(year) {
    return Object.values(await read("departments")).filter((d) => d.year === year);
  },

  async getDepartment(year, code) {
    return (await read("departments"))[`${year}:${code}`] ?? null;
  },

  async insertDepartment(doc) {
    await update("departments", (all) => {
      all[doc._id] ??= clone(doc);
    });
  },

  patchDepartment(year, code, expected, patch, options) {
    return update("departments", (all): PatchResult => {
      const doc = all[`${year}:${code}`];
      if (!doc) return { ok: false, reason: "missing", doc: null };
      if (!options.allowClosed && doc.closed) return { ok: false, reason: "closed", doc: clone(doc) };
      for (const [section, revision] of Object.entries(expected)) {
        if (doc.revisions[section as keyof DepartmentDoc["revisions"]] !== revision) return { ok: false, reason: "conflict", doc: clone(doc) };
      }
      Object.assign(doc, clone(patch));
      for (const section of Object.keys(expected)) doc.revisions[section as keyof DepartmentDoc["revisions"]] += 1;
      const now = new Date().toISOString();
      doc.updatedAt = now;
      if (options.markSaved) doc.savedAt = now;
      return { ok: true, doc: clone(doc) };
    });
  },

  setClosed(year, code, closed) {
    return update("departments", (all) => {
      const doc = all[`${year}:${code}`];
      if (!doc) return null;
      const now = new Date().toISOString();
      Object.assign(doc, { closed, closedAt: closed ? now : null, updatedAt: now });
      return clone(doc);
    });
  },

  async listAttachments(year, deptCode) {
    return Object.values(await read("attachments"))
      .filter((a) => a.year === year && (!deptCode || a.deptCode === deptCode))
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  },

  async getAttachment(id) {
    const meta = (await read("attachments"))[id];
    if (!meta) return null;
    return { meta, data: await fs.readFile(path.join(attachmentDir, `${id}.bin`)) };
  },

  async addAttachment(meta, data) {
    const id = randomUUID().replace(/-/g, "");
    await fs.mkdir(attachmentDir, { recursive: true });
    await fs.writeFile(path.join(attachmentDir, `${id}.bin`), data);
    const full: AttachmentMeta = { id, ...meta };
    await update("attachments", (all) => {
      all[id] = full;
    });
    return full;
  },

  async deleteAttachment(id) {
    if (!/^[0-9a-f]{32}$/.test(id)) return false;
    const existed = await update("attachments", (all) => {
      const found = id in all;
      delete all[id];
      return found;
    });
    if (existed) await fs.unlink(path.join(attachmentDir, `${id}.bin`)).catch(() => undefined);
    return existed;
  },

  async getRevenuePlan(year) {
    return (await read("plans"))[String(year)] ?? null;
  },

  async insertRevenuePlan(plan) {
    await update("plans", (all) => {
      all[plan._id] ??= clone(plan);
    });
  },

  savePlanRows(year, expectedRevision, patch) {
    return update("plans", (all) => {
      const plan = all[String(year)];
      if (!plan || plan.revision !== expectedRevision) return { ok: false, plan: plan ? clone(plan) : null };
      Object.assign(plan, clone(patch));
      plan.revision += 1;
      plan.updatedAt = new Date().toISOString();
      return { ok: true, plan: clone(plan) };
    });
  },

  async getCache<T>(key: string) {
    const hit = (await read("cache"))[key];
    return hit ? { data: hit.data as T, fetchedAt: hit.fetchedAt } : null;
  },

  async setCache(key, data) {
    await update("cache", (all) => {
      all[key] = { data, fetchedAt: new Date().toISOString() };
    });
  },

  async listAccounts() {
    return Object.values(await read("accounts"));
  },

  async getAccount(id) {
    return (await read("accounts"))[id] ?? null;
  },

  async findAccountByLoginId(loginId) {
    return Object.values(await read("accounts")).find((a) => a.loginId === loginId) ?? null;
  },

  async insertAccount(doc) {
    await update("accounts", (all) => {
      all[doc._id] ??= clone(doc);
    });
  },

  updateAccount(id, patch, bumpToken = false) {
    return update("accounts", (all) => {
      const doc = all[id];
      if (!doc) return null;
      Object.assign(doc, clone(patch), { updatedAt: new Date().toISOString() });
      if (bumpToken) doc.tokenVersion += 1;
      return clone(doc);
    });
  },

  async listReviews(year, deptCode) {
    return Object.values(await read("reviews"))
      .filter((r) => r.year === year && (!deptCode || r.deptCode === deptCode))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getReview(id) {
    return (await read("reviews"))[id] ?? null;
  },

  async insertReview(doc) {
    await update("reviews", (all) => {
      all[doc._id] = clone(doc);
    });
  },

  updateReview(id, patch) {
    return update("reviews", (all) => {
      const doc = all[id];
      if (!doc) return null;
      Object.assign(doc, clone(patch), { updatedAt: new Date().toISOString() });
      return clone(doc);
    });
  },

  addReviewReply(id, reply) {
    return update("reviews", (all) => {
      const doc = all[id];
      if (!doc) return null;
      doc.replies.push(clone(reply));
      doc.updatedAt = reply.createdAt;
      return clone(doc);
    });
  },

  deleteReview(id) {
    return update("reviews", (all) => {
      const found = id in all;
      delete all[id];
      return found;
    });
  },
};
