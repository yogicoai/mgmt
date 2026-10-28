import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// 비밀값은 Dropbox 동기화 제외 폴더(.local/.env)에 둔다(팀 Dropbox 폴더라서).
// 호스팅(Vercel 등)에 이미 설정된 환경 변수는 덮어쓰지 않는다.
const localEnvFile = path.join(__dirname, ".local", ".env");
if (fs.existsSync(localEnvFile)) {
  const parsed = parseEnv(fs.readFileSync(localEnvFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

const nextConfig: NextConfig = {
  // 상위 폴더(C:\Users\Yogibo Design)에 다른 package-lock.json 이 있어 워크스페이스 루트를 잘못 잡지 않게 고정
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["@modelcontextprotocol/sdk", "exceljs"],
  devIndicators: false,
};

export default nextConfig;
