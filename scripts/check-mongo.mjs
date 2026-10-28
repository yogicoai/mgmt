// MongoDB 연결 점검 — .local/.env 의 MONGODB_URI 로 접속·읽기·쓰기 권한까지 확인한다.
//   npm run check:mongo
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.local', '.env');
if (fs.existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
}
const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB || 'yogico_budget';
if (!uri) {
  console.log('✗ .local/.env 의 MONGODB_URI 가 비어 있습니다.');
  process.exit(1);
}
// 비밀번호는 어떤 출력에도 남기지 않는다(드라이버 오류 문구에 주소 전체가 들어가는 경우가 있음)
const secret = uri.match(/^mongodb(?:\+srv)?:\/\/[^:/]+:(.*)@[^@]*$/)?.[1] ?? '';
const hide = (text) => {
  let out = String(text).replace(/(mongodb(?:\+srv)?:\/\/[^:/]+:)[^\s"']*@/g, '$1****@');
  if (secret) out = out.split(secret).join('****');
  return out;
};
const masked = hide(uri);
console.log(`주소: ${masked}\nDB:   ${dbName}`);
if (uri.includes('<') || uri.includes('>')) {
  console.log('✗ 주소에 < > 가 남아 있습니다 — <db_password> 자리를 실제 비밀번호로 바꾸고 꺾쇠도 지워 주세요.');
  process.exit(1);
}
if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
  console.log('✗ 주소는 mongodb+srv:// 로 시작해야 합니다 — "MONGODB_URI=" 를 두 번 붙여넣었거나 앞에 다른 글자가 있는지 확인해 주세요.');
  process.exit(1);
}

function explain(message) {
  if (/bad auth|Authentication failed|auth failed/i.test(message)) return '아이디 또는 비밀번호가 틀립니다. Database Users 의 계정·비밀번호를 확인하고, 비밀번호에 @ : / ? # % 가 있으면 다른 비밀번호로 바꾸는 편이 쉽습니다.';
  if (/querySrv|ENOTFOUND|ENODATA|getaddrinfo/i.test(message)) return '주소(클러스터 이름)를 찾지 못했습니다. Connect → Drivers 에서 주소를 다시 복사해 주세요.';
  if (/Server selection timed out|ReplicaSetNoPrimary|ECONNRESET|ETIMEDOUT|tlsv1 alert|SSL/i.test(message)) return '서버에 닿지 않습니다 — 대개 IP 허용 문제입니다. Network Access → IP Access List → Add Current IP Address 로 이 PC 를 추가해 주세요(적용까지 1분 정도).';
  if (/not authorized|Unauthorized/i.test(message)) return `계정 권한이 부족합니다. Database Users → 계정 Edit → 권한에 readWrite @ ${dbName} 를 추가해 주세요.`;
  if (/MongoParseError|Invalid scheme|URI/i.test(message)) return '주소 형식이 올바르지 않습니다. mongodb+srv:// 로 시작하는 주소 전체를 그대로 붙여넣어 주세요(비밀번호 특수문자도 확인).';
  return null;
}

let client;
let step = '접속';
try {
  client = new MongoClient(uri, { appName: 'yogico-budget-check', serverSelectionTimeoutMS: 12_000, connectTimeoutMS: 12_000 });
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  console.log('✓ 접속·로그인');
  step = '읽기';
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log(`✓ 읽기 — 현재 컬렉션: ${collections.map((c) => c.name).join(', ') || '(아직 없음 — 첫 저장 때 생김)'}`);
  step = '쓰기';
  const probe = db.collection('_connection_check');
  const { insertedId } = await probe.insertOne({ at: new Date().toISOString() });
  await probe.deleteOne({ _id: insertedId });
  await probe.drop().catch(() => undefined);
  console.log('✓ 쓰기(시험용 문서 쓰고 바로 지움)');
  console.log('\n연결 정상 — 개발 서버를 다시 켜면 MongoDB 를 씁니다.');
} catch (e) {
  const message = hide(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  console.log(`✗ ${step} 실패 — ${message}`);
  const hint = explain(message);
  if (hint) console.log(`→ ${hint}`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => undefined);
}
