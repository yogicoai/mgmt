import "server-only";
import ExcelJS from "exceljs";
import { MONTHS, calculate, rowTotal, sum } from "./budget";
import type { BudgetAccount, BudgetRow } from "./types";

// 엑셀 업로드 — 이 앱에서 내려받은 엑셀(부서 전체의 '상세 내역' 시트 또는 계정 하나 파일)을 고쳐 올리면
// 계정과목·구분·상세설명으로 행을 찾아 금액·계산식·메모를 반영한다. 파일에만 있는 행은 새 행으로 추가.

export interface UploadRow {
  account: string;
  item: string;
  desc: string;
  values: number[];
  formulas: Record<number, string>;
  memos: Record<number, string>;
}

export interface UploadSummary {
  changed: number;
  added: number;
  unchanged: number;
  lockedSkipped: number; // 팀 계정이 올린 파일의 '경영지원 입력' 줄 변경은 건너뜀
  unknownAccounts: string[]; // 이 부서에 없는 계정과목
  details: { account: string; item: string; desc: string; before: number; after: number; added?: boolean }[];
}

const SAFE_FORMULA = /^[0-9+\-*/().]+$/;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
// 상세설명은 엑셀에 "- 항목" 줄로 들어가 있으니 같은 규칙으로 맞춰 비교
const normDesc = (s: string) =>
  String(s || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•·]\s*/, "").trim())
    .filter((line) => line && !/^[-—–ㅡ_]+$/.test(line))
    .join("\n");

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return String(value.result ?? "");
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function noteOf(cell: ExcelJS.Cell): string {
  const note = cell.note as string | { texts?: { text: string }[] } | undefined;
  if (!note) return "";
  return (typeof note === "string" ? note : (note.texts ?? []).map((t) => t.text).join("")).trim();
}

// 금액 칸 → 값 + (숫자·사칙연산뿐인) 계산식
function amountOf(cell: ExcelJS.Cell): { value: number; formula?: string } | null {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return { value: 0 };
  if (typeof v === "number") return { value: v };
  if (typeof v === "string") {
    try {
      const value = calculate(v);
      return { value, formula: v.trim().startsWith("=") ? v.trim() : undefined };
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && "formula" in v && typeof v.formula === "string") {
    const expr = v.formula.replace(/\s/g, "");
    const safe = SAFE_FORMULA.test(expr);
    let value = typeof v.result === "number" ? v.result : NaN;
    if (Number.isNaN(value) && safe) value = calculate(`=${expr}`);
    return Number.isNaN(value) ? null : { value, formula: safe ? `=${expr}` : undefined };
  }
  if (typeof v === "object" && "result" in v && typeof v.result === "number") return { value: v.result };
  return null;
}

/** 시트마다 머리행(구분·상세설명·1월~12월)을 찾아 행을 읽는다. 요약 시트(계정과목+월만)는 건너뜀 */
export async function readBudgetWorkbook(data: ArrayBuffer): Promise<{ rows: UploadRow[]; problems: string[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new Error("엑셀 파일(.xlsx)을 읽지 못했습니다. 이 화면에서 내려받은 파일을 고쳐서 올려 주세요.");
  }
  const rows: UploadRow[] = [];
  const problems: string[] = [];

  wb.eachSheet((ws) => {
    let headerRow = 0;
    const col: { account?: number; item?: number; desc?: number; months: number[] } = { months: [] };
    for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
      const labels = new Map<string, number>();
      ws.getRow(r).eachCell((cell, c) => labels.set(norm(textOf(cell.value)), c));
      if (labels.has("구분") && labels.has("상세설명") && MONTHS.every((m) => labels.has(m))) {
        headerRow = r;
        col.account = labels.get("계정과목");
        col.item = labels.get("구분");
        col.desc = labels.get("상세설명");
        col.months = MONTHS.map((m) => labels.get(m)!);
      }
    }
    if (!headerRow) return;
    // 계정 하나 파일: 제목 "부서 · 계정 · 상세 예산" 의 가운데가 계정과목(없으면 시트 이름)
    const titleParts = textOf(ws.getCell(1, 1).value).split("·").map((s) => s.trim());
    const sheetAccount = titleParts.length >= 3 ? titleParts[1] : ws.name;

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const account = norm(col.account ? textOf(ws.getCell(r, col.account).value) : sheetAccount);
      const item = norm(textOf(ws.getCell(r, col.item!).value));
      const desc = normDesc(textOf(ws.getCell(r, col.desc!).value));
      // 합계 행(라벨 칸을 합쳐 "○○ 합계")은 건너뜀
      if (item.endsWith("합계") && normDesc(item) === desc) continue;
      if (!account && !item && !desc) continue;
      const values: number[] = [];
      const formulas: Record<number, string> = {};
      const memos: Record<number, string> = {};
      let bad = false;
      col.months.forEach((c, m) => {
        const cell = ws.getCell(r, c);
        const amount = amountOf(cell);
        if (!amount) {
          bad = true;
          values.push(0);
        } else {
          values.push(Math.round(amount.value));
          if (amount.formula) formulas[m] = amount.formula;
        }
        const note = noteOf(cell);
        if (note) memos[m] = note;
      });
      if (bad) problems.push(`${ws.name} ${r}행(${item || account}): 금액을 읽지 못한 칸은 0으로 봅니다`);
      if (!item && values.every((v) => v === 0)) continue;
      rows.push({ account, item, desc, values, formulas, memos });
    }
  });
  if (!rows.length) throw new Error("읽을 행이 없습니다. ‘구분·상세설명·1월~12월’ 머리행이 있는 엑셀(이 화면에서 내려받은 파일)을 올려 주세요.");
  return { rows, problems };
}

const tidy = (o?: Record<string | number, string>) => JSON.stringify(Object.entries(o ?? {}).filter(([, v]) => v).sort(([a], [b]) => Number(a) - Number(b)));

/** 올린 행을 지금 계정별 예산에 합친 결과(저장은 화면에서 확인 후) */
export function mergeUpload(accounts: BudgetAccount[], upload: UploadRow[], { canEditLocked, hidden = [] }: { canEditLocked: boolean; hidden?: string[] }) {
  const next: BudgetAccount[] = structuredClone(accounts);
  const used = new Set<string>();
  const unknown = new Set<string>();
  const summary: UploadSummary = { changed: 0, added: 0, unchanged: 0, lockedSkipped: 0, unknownAccounts: [], details: [] };

  for (const u of upload) {
    const ai = next.findIndex((a) => norm(a.name) === u.account && !hidden.includes(a.name)); // 이 부서에 숨긴 계정과목은 없는 것으로
    if (ai < 0) {
      unknown.add(u.account || "(계정과목 빈칸)");
      continue;
    }
    const account = next[ai];
    const ri = account.rows.findIndex((r, i) => !used.has(`${ai}:${i}`) && norm(r.item) === u.item && normDesc(r.desc) === u.desc);
    if (ri >= 0) {
      used.add(`${ai}:${ri}`);
      const row = account.rows[ri];
      const memos = { ...(row.memos ?? {}), ...u.memos };
      const same = row.values.every((v, m) => v === u.values[m]) && tidy(row.formulas) === tidy(u.formulas) && tidy(row.memos) === tidy(memos);
      if (same) {
        summary.unchanged++;
        continue;
      }
      if (row.locked && !canEditLocked) {
        summary.lockedSkipped++;
        continue;
      }
      const updated: BudgetRow = { ...row, values: u.values, formulas: { ...u.formulas }, memos };
      account.rows[ri] = updated;
      summary.changed++;
      summary.details.push({ account: account.name, item: row.item, desc: row.desc, before: rowTotal(row), after: rowTotal(updated) });
    } else {
      // 파일에만 있는 행 → 같은 구분 묶음 아래(없으면 맨 아래)에 새 행
      const last = account.rows.map((r) => norm(r.item)).lastIndexOf(u.item);
      const at = last < 0 ? account.rows.length : last + 1;
      account.rows.splice(at, 0, { item: u.item, desc: u.desc, values: u.values, formulas: { ...u.formulas }, memos: { ...u.memos }, custom: true });
      // 끼워 넣은 자리 뒤 행들의 번호가 하나씩 밀린다
      const shifted = [...used].map((key) => {
        const [a, i] = key.split(":").map(Number);
        return a === ai && i >= at ? `${a}:${i + 1}` : key;
      });
      used.clear();
      for (const key of shifted) used.add(key);
      used.add(`${ai}:${at}`);
      summary.added++;
      summary.details.push({ account: account.name, item: u.item, desc: u.desc, before: 0, after: sum(u.values), added: true });
    }
  }
  summary.unknownAccounts = [...unknown];
  return { accounts: next, summary };
}
