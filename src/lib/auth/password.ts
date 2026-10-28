import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

// 비밀번호는 scrypt 해시로만 저장한다(원문은 어디에도 남기지 않음). 형식: scrypt$N$r$p$salt$hash
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const key = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), key.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === key.length && timingSafeEqual(got, key);
}

export function passwordProblem(password: string) {
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (password.length > 100) return "비밀번호가 너무 깁니다.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "비밀번호에 영문과 숫자를 섞어 주세요.";
  return null;
}
