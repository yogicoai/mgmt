import "server-only";
import { Binary, MongoClient, ObjectId, type Db } from "mongodb";
import type { AttachmentMeta, DepartmentDoc, LoginAccount, RevenuePlan, ReviewComment } from "../types";
import type { BudgetStore, DeptPatch, PatchOptions, PatchResult } from "./types";

// 개발 서버가 코드 변경마다 모듈을 다시 읽어도 연결은 하나만 쓰도록 전역에 보관
const globalForMongo = globalThis as unknown as { __budgetMongo?: Promise<MongoClient> };

function client() {
  if (!globalForMongo.__budgetMongo) {
    const uri = process.env.MONGODB_URI!;
    globalForMongo.__budgetMongo = new MongoClient(uri, {
      appName: "yogico-budget",
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    })
      .connect()
      .catch((e) => {
        globalForMongo.__budgetMongo = undefined; // 다음 요청에서 다시 시도
        throw e;
      });
  }
  return globalForMongo.__budgetMongo;
}

let indexesReady: Promise<unknown> | null = null;

async function db(): Promise<Db> {
  const database = (await client()).db(process.env.MONGODB_DB || "yogico_budget");
  indexesReady ??= Promise.all([
    database.collection("departments").createIndex({ year: 1, code: 1 }),
    database.collection("attachments").createIndex({ year: 1, deptCode: 1, uploadedAt: 1 }),
    database.collection("accounts").createIndex({ loginId: 1 }, { unique: true }),
    database.collection("reviews").createIndex({ year: 1, deptCode: 1, createdAt: 1 }),
  ]).catch(() => (indexesReady = null));
  return database;
}

interface AttachmentDoc extends Omit<AttachmentMeta, "id"> {
  _id: ObjectId;
  data: Binary;
}

const toMeta = ({ _id, year, deptCode, kind, name, type, size, uploadedAt }: Omit<AttachmentDoc, "data">): AttachmentMeta => ({
  id: _id.toHexString(),
  year,
  deptCode,
  kind,
  name,
  type,
  size,
  uploadedAt,
});

const departments = async () => (await db()).collection<DepartmentDoc>("departments");
const attachments = async () => (await db()).collection<AttachmentDoc>("attachments");
const plans = async () => (await db()).collection<RevenuePlan>("revenue_plans");
const cache = async () => (await db()).collection<{ _id: string; data: unknown; fetchedAt: string }>("cache");
const accounts = async () => (await db()).collection<LoginAccount>("accounts");
const reviews = async () => (await db()).collection<ReviewComment>("reviews");

export const mongoStore: BudgetStore = {
  kind: "mongo",

  async listDepartments(year) {
    return (await departments()).find({ year }).toArray();
  },

  async getDepartment(year, code) {
    return (await departments()).findOne({ _id: `${year}:${code}` });
  },

  async insertDepartment(doc) {
    await (await departments()).updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  },

  async patchDepartment(year, code, expected, patch: DeptPatch, options: PatchOptions): Promise<PatchResult> {
    const col = await departments();
    const _id = `${year}:${code}`;
    const filter: Record<string, unknown> = { _id };
    const inc: Record<string, number> = {};
    for (const [section, revision] of Object.entries(expected)) {
      filter[`revisions.${section}`] = revision;
      inc[`revisions.${section}`] = 1;
    }
    if (!options.allowClosed) filter.closed = false;
    const now = new Date().toISOString();
    const updated = await col.findOneAndUpdate(
      filter,
      { $set: { ...patch, updatedAt: now, ...(options.markSaved ? { savedAt: now } : {}) }, $inc: inc },
      { returnDocument: "after" },
    );
    if (updated) return { ok: true, doc: updated };
    const current = await col.findOne({ _id });
    if (!current) return { ok: false, reason: "missing", doc: null };
    return { ok: false, reason: !options.allowClosed && current.closed ? "closed" : "conflict", doc: current };
  },

  async setClosed(year, code, closed) {
    const now = new Date().toISOString();
    return (await departments()).findOneAndUpdate(
      { _id: `${year}:${code}` },
      { $set: { closed, closedAt: closed ? now : null, updatedAt: now } },
      { returnDocument: "after" },
    );
  },

  async listAttachments(year, deptCode) {
    const rows = await (await attachments())
      .find({ year, ...(deptCode ? { deptCode } : {}) }, { projection: { data: 0 } })
      .sort({ uploadedAt: 1 })
      .toArray();
    return rows.map(toMeta);
  },

  async getAttachment(id) {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await attachments()).findOne({ _id: new ObjectId(id) });
    if (!doc) return null;
    return { meta: toMeta(doc), data: Buffer.from(doc.data.buffer) };
  },

  async addAttachment(meta, data) {
    const doc: AttachmentDoc = { _id: new ObjectId(), ...meta, data: new Binary(data) };
    await (await attachments()).insertOne(doc);
    return toMeta(doc);
  },

  async deleteAttachment(id) {
    if (!ObjectId.isValid(id)) return false;
    const r = await (await attachments()).deleteOne({ _id: new ObjectId(id) });
    return r.deletedCount === 1;
  },

  async getRevenuePlan(year) {
    return (await plans()).findOne({ _id: String(year) });
  },

  async insertRevenuePlan(plan) {
    await (await plans()).updateOne({ _id: plan._id }, { $setOnInsert: plan }, { upsert: true });
  },

  async savePlanRows(year, expectedRevision, patch) {
    const col = await plans();
    const updated = await col.findOneAndUpdate(
      { _id: String(year), revision: expectedRevision },
      { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    if (updated) return { ok: true, plan: updated };
    return { ok: false, plan: await col.findOne({ _id: String(year) }) };
  },

  async getCache<T>(key: string) {
    const doc = await (await cache()).findOne({ _id: key });
    return doc ? { data: doc.data as T, fetchedAt: doc.fetchedAt } : null;
  },

  async setCache(key, data) {
    await (await cache()).updateOne({ _id: key }, { $set: { data, fetchedAt: new Date().toISOString() } }, { upsert: true });
  },

  async listAccounts() {
    return (await accounts()).find({}).toArray();
  },

  async getAccount(id) {
    return (await accounts()).findOne({ _id: id });
  },

  async findAccountByLoginId(loginId) {
    return (await accounts()).findOne({ loginId });
  },

  async insertAccount(doc) {
    await (await accounts()).updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  },

  async updateAccount(id, patch, bumpToken = false) {
    return (await accounts()).findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date().toISOString() }, ...(bumpToken ? { $inc: { tokenVersion: 1 } } : {}) },
      { returnDocument: "after" },
    );
  },

  async listReviews(year, deptCode) {
    return (await reviews())
      .find({ year, ...(deptCode ? { deptCode } : {}) })
      .sort({ createdAt: 1 })
      .toArray();
  },

  async getReview(id) {
    return (await reviews()).findOne({ _id: id });
  },

  async insertReview(doc) {
    await (await reviews()).insertOne(doc);
  },

  async updateReview(id, patch) {
    return (await reviews()).findOneAndUpdate({ _id: id }, { $set: { ...patch, updatedAt: new Date().toISOString() } }, { returnDocument: "after" });
  },

  async addReviewReply(id, reply) {
    return (await reviews()).findOneAndUpdate({ _id: id }, { $push: { replies: reply }, $set: { updatedAt: reply.createdAt } }, { returnDocument: "after" });
  },

  async deleteReview(id) {
    return (await (await reviews()).deleteOne({ _id: id })).deletedCount === 1;
  },
};
