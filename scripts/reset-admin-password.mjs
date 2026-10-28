// 경영지원(mgmt) 계정 비밀번호를 잊었을 때 — 새 비밀번호를 만들어 바꾸고 화면에 한 번 보여 준다.
//   npm run admin:reset-password            → 자동 생성
//   npm run admin:reset-password -- 새비번  → 직접 지정(8자 이상, 영문+숫자)
// 기존에 로그인해 둔 경영지원 화면은 다시 로그인해야 한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.local', '.env');
if (fs.existsSync(envFile)) {
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
}

const ADMIN_ID = '0002';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const ok = (pw) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
function generate() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    if (ok(s)) return s;
  }
}
const password = process.argv[2] || generate();
if (!ok(password)) throw new Error('비밀번호는 8자 이상, 영문과 숫자를 섞어 주세요.');
// src/lib/auth/password.ts 와 같은 형식
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
const passwordHash = `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
const now = new Date().toISOString();

const uri = process.env.MONGODB_URI?.trim();
let loginId;
if (uri) {
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 12_000 }).connect();
  try {
    const col = client.db(process.env.MONGODB_DB || 'yogico_budget').collection('accounts');
    const r = await col.findOneAndUpdate(
      { _id: ADMIN_ID },
      { $set: { passwordHash, passwordUpdatedAt: now, updatedAt: now, active: true }, $inc: { tokenVersion: 1 } },
      { returnDocument: 'after' },
    );
    if (!r) throw new Error('경영지원 계정이 아직 없습니다 — 앱을 한 번 열면(로그인 화면) 만들어집니다.');
    loginId = r.loginId;
  } finally {
    await client.close();
  }
} else {
  const file = path.join(root, '.local', 'dev-db', 'accounts.json');
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!all[ADMIN_ID]) throw new Error('경영지원 계정이 아직 없습니다 — 앱을 한 번 열면(로그인 화면) 만들어집니다.');
  Object.assign(all[ADMIN_ID], { passwordHash, passwordUpdatedAt: now, updatedAt: now, active: true, tokenVersion: all[ADMIN_ID].tokenVersion + 1 });
  fs.writeFileSync(file, JSON.stringify(all));
  loginId = all[ADMIN_ID].loginId;
}
console.log(`경영지원 계정 비밀번호를 바꿨습니다.\n  아이디:   ${loginId}\n  비밀번호: ${password}`);
