import "server-only";
import { MONTHS, zeros } from "./budget";
import { findDeptByName, findDeptMeta } from "./templates";
import type { BudgetAccount, BudgetRow, FeeRow, PersonRow, SalesRow } from "./types";

// 기존 HTML 작성본(부서별 "작성본/마감본" 또는 통합 작성본)을 읽어 DB 에 넣을 모양으로 바꾼다.
// 원본 통합 대시보드의 parseImported / readImportedPersonnel / readImportedSales / readImportedAttachments 이식.

export interface ImportedAttachment {
  name: string;
  type: string;
  size: number;
  data: Buffer;
}

export interface ImportedDepartment {
  code: string;
  name: string;
  accounts: BudgetAccount[] | null;
  personnel: PersonRow[] | null;
  salesForecastRows: SalesRow[] | null;
  attachments: { sales: ImportedAttachment[]; expenses: ImportedAttachment[] };
}

export interface ImportResult {
  kind: "department" | "unified";
  departments: ImportedDepartment[];
  fees: FeeRow[] | null;
  skipped: string[];
}

const BACKSLASH = String.fromCharCode(92);
const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");
const isMonths = (v: unknown, check = (n: number) => Number.isFinite(n)): v is number[] =>
  Array.isArray(v) && v.length === 12 && v.every((n) => typeof n === "number" && check(n));

function extractJsonConstant(text: string, name: string) {
  const marker = `const ${name}=`;
  let start = text.indexOf(marker);
  if (start < 0) return null;
  start += marker.length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === BACKSLASH) escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("파일의 원장 데이터를 확인해 주세요.");
}

function savedJson(text: string, id: string) {
  const m = text.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  if (!m) return null;
  return JSON.parse(m[1].replace(/\\u003c/g, "<"));
}

function cleanRow(r: Partial<BudgetRow> & { values: number[] }): BudgetRow {
  const formulas = Object.fromEntries(Object.entries(r.formulas ?? {}).filter(([k, v]) => /^(?:[0-9]|1[01])$/.test(k) && typeof v === "string" && v.trim()));
  const memos = Object.fromEntries(Object.entries(r.memos ?? {}).filter(([k, v]) => /^(?:[0-9]|1[01])$/.test(k) && typeof v === "string" && v.trim()));
  return { item: String(r.item || "기타"), desc: String(r.desc || ""), values: r.values.map(Number), formulas, memos };
}

function readAttachments(value: unknown) {
  const out: ImportedDepartment["attachments"] = { sales: [], expenses: [] };
  const v = (value ?? {}) as Record<string, unknown>;
  for (const kind of ["sales", "expenses"] as const) {
    const list = v[kind];
    if (list == null) continue;
    if (!Array.isArray(list)) throw new Error("첨부파일 목록 형식을 확인해 주세요.");
    for (const f of list as { name?: unknown; data?: unknown; type?: unknown }[]) {
      const m = typeof f.data === "string" ? f.data.match(/^data:([^,]*?);base64,(.*)$/s) : null;
      if (typeof f.name !== "string" || !m) throw new Error("첨부파일 데이터를 확인해 주세요.");
      const data = Buffer.from(m[2], "base64");
      out[kind].push({ name: f.name, type: typeof f.type === "string" && f.type ? f.type : m[1] || "application/octet-stream", size: data.length, data });
    }
  }
  return out;
}

function readPersonnel(rows: unknown, code: string, dept: string): PersonRow[] | null {
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => {
    if (typeof r.name !== "string" || typeof r.position !== "string" || !isMonths(r.values, (n) => Number.isInteger(n) && n >= 0)) {
      throw new Error("인원정보 형식을 확인해 주세요.");
    }
    return { code, dept, ...(typeof r.store === "string" ? { store: r.store } : {}), position: r.position, name: r.name, values: r.values.slice() };
  });
}

function readSales(plan: Record<string, unknown>, deptName: string): SalesRow[] | null {
  let rows = plan.salesForecastRows as { kind?: unknown; values?: unknown }[] | undefined;
  if (!Array.isArray(rows)) {
    if (!isMonths(plan.salesForecast)) return null;
    rows = [{ kind: deptName === "영업" ? "오프라인" : "온라인", values: plan.salesForecast }];
  }
  return rows
    .map((r) => {
      if (!isMonths(r.values, (n) => n >= 0)) throw new Error("월별 예상매출 금액을 확인해 주세요.");
      return { kind: typeof r.kind === "string" ? r.kind.trim() : "", values: r.values.slice() };
    })
    .filter((r) => r.kind || r.values.some((v) => v));
}

// 부서별 대시보드 HTML 작성본
function parseDepartmentFile(text: string): ImportResult {
  const plan = (savedJson(text, "saved-budget") ?? {}) as Record<string, any>;
  const data = extractJsonConstant(text, "DATA");
  if (!data?.accounts) throw new Error("계정별 예산 자료를 찾을 수 없습니다.");
  const title = text.match(/정기 예산 설정_(.+?)\[(\d{4})\]/);
  const meta = (title && findDeptMeta(title[2])) || findDeptByName(plan.department || plan.dept || (text.includes("계정별 예산(마케팅)") ? "마케팅" : ""));
  if (!meta) throw new Error("작성본의 부서를 알 수 없습니다.");

  const detailOverride = Array.isArray(plan.details) && plan.details.length === data.details.length ? (plan.details as number[][]) : null;
  const accounts: BudgetAccount[] = data.accounts.map((a: { name: string; values: number[] }, i: number) => {
    const values: number[] = isMonths(plan.values?.[i]) ? plan.values[i] : a.values;
    let rows: BudgetRow[];
    if (Array.isArray(plan.groups?.[i])) {
      // 메모 키는 `${계정}:${행}:${월}` — 행 번호가 밀리지 않게 거르기 전에 붙인다
      rows = (plan.groups[i] as (BudgetRow & { residual?: boolean })[])
        .map((r, n) =>
          isMonths(r.values)
            ? cleanRow({
                ...r,
                memos: Object.fromEntries(MONTHS.map((_, m) => [String(m), plan.memos?.[`${i}:${n}:${m}`]]).filter(([, v]) => v)),
              })
            : null,
        )
        .filter((r): r is BudgetRow => r !== null);
    } else {
      const map = new Map<string, BudgetRow>();
      data.details.forEach((d: { dept: string; account: string; item: string; desc: string; values: number[] }, j: number) => {
        if (norm(d.account) !== norm(a.name) || (d.dept !== meta.name && !(meta.name === "물류" && d.dept === "물류센터"))) return;
        const key = `${d.item}\u0000${d.desc}`;
        if (!map.has(key)) map.set(key, { item: d.item || "기타", desc: d.desc || "", values: zeros(), formulas: {}, memos: {} });
        const source = detailOverride && isMonths(detailOverride[j]) ? detailOverride[j] : d.values;
        source.forEach((v, m) => (map.get(key)!.values[m] += v));
      });
      rows = [...map.values()];
    }
    const gap = MONTHS.map((_, m) => values[m] - rows.reduce((s, r) => s + r.values[m], 0));
    if (gap.some((v) => Math.abs(v) > 0.001) || !rows.length) {
      rows.push({ item: rows.length ? "계정 합계 조정" : a.name, desc: rows.length ? "작성본 계정 합계와 상세 내역 차액" : "", values: gap, formulas: {}, memos: {} });
    }
    // 금액·메모가 없는 '조정 / 미배분' 행은 버린다
    rows = rows.filter((r) => !/조정 \/ 미배분/.test(r.item) || r.values.some((v) => v) || Object.keys(r.memos ?? {}).length);
    return { name: a.name, rows: rows.length ? rows : [{ item: a.name, desc: "", values: zeros(), formulas: {}, memos: {} }] };
  });

  return {
    kind: "department",
    departments: [
      {
        code: meta.code,
        name: meta.name,
        accounts,
        personnel: readPersonnel(plan.personnel, meta.code, meta.name),
        salesForecastRows: readSales(plan, meta.name),
        attachments: readAttachments(plan.backdataAttachments),
      },
    ],
    fees: null,
    skipped: [],
  };
}

// 통합 대시보드 HTML 작성본 (saved-unified 안에 부서별 state 가 통째로 있음)
function parseUnifiedFile(text: string): ImportResult {
  const saved = savedJson(text, "saved-unified") as { departments?: Record<string, any> | null } | null;
  if (!saved?.departments) throw new Error("통합 작성본에 저장된 입력값이 없습니다(브라우저에만 저장된 상태일 수 있습니다).");
  const departments: ImportedDepartment[] = [];
  const skipped: string[] = [];
  let fees: FeeRow[] | null = null;
  for (const [name, state] of Object.entries(saved.departments)) {
    const meta = findDeptByName(name);
    if (!meta || !state) {
      skipped.push(name);
      continue;
    }
    const accounts: BudgetAccount[] | null = Array.isArray(state.accounts)
      ? state.accounts.map((a: { name: string; rows: BudgetRow[] }) => ({
          name: String(a.name),
          rows: (a.rows ?? []).filter((r) => isMonths(r.values)).map(cleanRow),
        }))
      : null;
    departments.push({
      code: meta.code,
      name: meta.name,
      accounts,
      personnel: readPersonnel(state.personnel, meta.code, meta.name),
      salesForecastRows: state.salesImported || Array.isArray(state.salesForecastRows) ? readSales(state, meta.name) : null,
      attachments: readAttachments(state.backdataAttachments),
    });
    const report = state.salesReport2027;
    if (report?.edited && Array.isArray(report.fees)) {
      fees = report.fees
        .filter((f: FeeRow) => isMonths(f.values))
        .map((f: FeeRow) => ({ key: String(f.key), label: String(f.label), values: f.values.slice() }));
    }
  }
  return { kind: "unified", departments, fees, skipped };
}

export function parseLegacyHtml(text: string): ImportResult {
  if (text.includes('id="saved-unified"')) return parseUnifiedFile(text);
  if (text.includes('id="saved-budget"')) return parseDepartmentFile(text);
  throw new Error("예산 대시보드 HTML 작성본이 아닙니다.");
}
