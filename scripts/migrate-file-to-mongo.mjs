// 로컬 파일 저장소(.local/dev-db)에 시험으로 넣은 자료를 MongoDB 로 옮긴다.
//   npm run migrate:file-to-mongo            → Mongo 에 아직 없는 부서·매출 수수료만 넣는다(기존 값 보존)
//   npm run migrate:file-to-mongo -- --force → Mongo 의 같은 부서 문서를 파일 내용으로 덮어쓴다
// MONGODB_URI / MONGODB_DB 는 .local/.env 에서 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Binary, MongoClient, ObjectId } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.local', '.env');
if (fs.existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
}
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('.local/.env 의 MONGODB_URI 가 비어 있습니다.');
const dir = path.join(root, '.local', 'dev-db');
const read = (name) => {
  const file = path.join(dir, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};
const force = process.argv.includes('--force');

const client = await new MongoClient(uri, { appName: 'yogico-budget-migrate', serverSelectionTimeoutMS: 10_000 }).connect();
try {
  const db = client.db(process.env.MONGODB_DB || 'yogico_budget');
  let depts = 0, plans = 0, files = 0;
  for (const doc of Object.values(read('departments'))) {
    const exists = await db.collection('departments').findOne({ _id: doc._id }, { projection: { _id: 1 } });
    if (exists && !force) continue;
    await db.collection('departments').replaceOne({ _id: doc._id }, doc, { upsert: true });
    depts++;
  }
  for (const plan of Object.values(read('plans'))) {
    const exists = await db.collection('revenue_plans').findOne({ _id: plan._id }, { projection: { _id: 1 } });
    if (exists && !force) continue;
    await db.collection('revenue_plans').replaceOne({ _id: plan._id }, plan, { upsert: true });
    plans++;
  }
  for (const meta of Object.values(read('attachments'))) {
    const same = await db.collection('attachments').findOne({ year: meta.year, deptCode: meta.deptCode, kind: meta.kind, name: meta.name, size: meta.size }, { projection: { _id: 1 } });
    if (same) continue;
    const { id, ...rest } = meta;
    const data = fs.readFileSync(path.join(dir, 'attachments', `${id}.bin`));
    await db.collection('attachments').insertOne({ _id: new ObjectId(), ...rest, data: new Binary(data) });
    files++;
  }
  console.log(`옮김: 부서 ${depts}개 · 매출 수수료 ${plans}개 · 첨부 ${files}개${force ? ' (덮어쓰기)' : ''}`);
} finally {
  await client.close();
}
