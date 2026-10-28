import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getStore } from "./store";
import type { ActualsResult } from "./types";

// onlineData MCP 서버(cloudtype, 무상태 JSON) — 매출 실적은 여기서만 가져온다.
// 토큰은 서버 환경 변수로만 쓰고 브라우저로 내보내지 않는다.
const DEFAULT_URL = "https://port-0-yogibo-onmcp-lzgmwhc4d9883c97.sel4.cloudtype.app/mcp";

export function onlineDataConfig() {
  return {
    url: process.env.ONLINEDATA_MCP_URL?.trim() || DEFAULT_URL,
    token: process.env.ONLINEDATA_MCP_TOKEN?.trim() || "",
  };
}

export async function callOnlineDataTool<T>(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  const { url, token } = onlineDataConfig();
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  const client = new Client({ name: "yogico-budget", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) throw new Error(text.replace(/^ERROR:\s*/, "") || `${name} 호출 실패`);
    return JSON.parse(text) as T;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/401|unauthorized/i.test(message)) {
      throw new Error(
        "onlineData MCP 가 토큰을 거절했습니다 — cloudtype onlineData MCP 서비스의 MCP_TOKENS 에 이 앱 토큰(yogico-budget:…:read)을 등록하고 재배포했는지 확인해 주세요. 등록 전이면 이 안내가 정상입니다.",
      );
    }
    throw new Error(`onlineData MCP 오류: ${message}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

// 한국 시간 기준 날짜(YYYY-MM-DD)
const kstDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

interface OnOffCompare {
  start: string;
  end: string;
  일별: { date: string; 온라인: number; 오프라인: number }[];
  주의?: string;
}

/**
 * 연도별 월 매출 실적(온라인·오프라인) — onlineData MCP `online_offline_compare`.
 *   온라인 = 이카운트 출고 기준(자사몰+스마트스토어+외부채널, 공동구매 제외), 오프라인 = 매장 주문서(off.orders).
 *   올해는 어제까지. 결과는 저장소 캐시에 두고(올해 3시간·지난해 24시간) refresh 로 즉시 다시 받는다.
 */
export async function getActuals(year: number, { refresh = false } = {}): Promise<ActualsResult> {
  const { token } = onlineDataConfig();
  const empty: ActualsResult = {
    configured: Boolean(token),
    year,
    online: Array(12).fill(null),
    offline: Array(12).fill(null),
    start: null,
    end: null,
    lastDate: null,
    fetchedAt: null,
  };
  if (!token) return { ...empty, error: "onlineData MCP 토큰이 설정되지 않았습니다(.local/.env 의 ONLINEDATA_MCP_TOKEN)." };

  const start = `${year}-01-01`;
  const yesterday = kstDate(-1);
  const end = `${year}-12-31` < yesterday ? `${year}-12-31` : yesterday;
  if (start > end) return { ...empty, start, end: null, note: `${year}년 실적이 아직 없습니다.` };

  const store = getStore();
  const key = `actuals:online_offline:${year}`;
  const cached = await store.getCache<ActualsResult>(key).catch(() => null);
  const ttlHours = end < yesterday ? 24 : Number(process.env.ACTUALS_CACHE_HOURS || 3);
  const fresh = cached && cached.data.end === end && Date.now() - Date.parse(cached.fetchedAt) < ttlHours * 3600e3;
  if (cached && fresh && !refresh) return { ...cached.data, fetchedAt: cached.fetchedAt, source: "cache" };

  try {
    const data = await callOnlineDataTool<OnOffCompare>("online_offline_compare", { start, end });
    const online: (number | null)[] = Array(12).fill(null);
    const offline: (number | null)[] = Array(12).fill(null);
    const endMonth = Number(end.slice(5, 7)) - 1;
    for (let m = 0; m <= endMonth; m++) {
      online[m] = 0;
      offline[m] = 0;
    }
    let lastDate: string | null = null;
    for (const day of data.일별 ?? []) {
      const m = Number(day.date.slice(5, 7)) - 1;
      if (m < 0 || m > endMonth) continue;
      online[m] = (online[m] ?? 0) + (day.온라인 || 0);
      offline[m] = (offline[m] ?? 0) + (day.오프라인 || 0);
      if ((day.온라인 || day.오프라인) && (!lastDate || day.date > lastDate)) lastDate = day.date;
    }
    const result: ActualsResult = { configured: true, year, online, offline, start, end, lastDate, fetchedAt: new Date().toISOString(), note: data.주의 };
    await store.setCache(key, result).catch(() => undefined);
    return { ...result, source: "live" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (cached) return { ...cached.data, fetchedAt: cached.fetchedAt, source: "cache", error: `최신 조회 실패 — 저장해 둔 값을 보여 줍니다. (${message})` };
    return { ...empty, start, end, error: message };
  }
}
