import "server-only";
import ExcelJS from "exceljs";
import { MONTHS, accountMonths, sum } from "./budget";
import type { BudgetAccount, BudgetRow } from "./types";

// 엑셀 내려받기 — 화면의 상세 예산 표와 같은 모양(노란 머리행·구분 칸 합치기·합계 행 색),
// 메모는 엑셀 메모(빨간 삼각형)로, 계산식(=10000*4)은 엑셀 수식으로, 합계는 SUM 수식으로 넣는다.

const COLOR = {
  title: "FF102A54",
  text: "FF1F2937",
  muted: "FF64748B",
  headerFill: "FFFFF3CC",
  headerBorder: "FFE6DFC0",
  border: "FFD9E2EC",
  itemFill: "FFFBFCFE",
  accountFill: "FFF1F5F9",
  subtotalFill: "FFF8FAFC",
  totalFill: "FFEAF6FA",
};
const MONEY = "#,##0;[Red]-#,##0";

const font = (opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Pretendard", size: 10, color: { argb: COLOR.text }, ...opts });
const side = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });
const box = (argb = COLOR.border): Partial<ExcelJS.Borders> => ({ top: side(argb), left: side(argb), bottom: side(argb), right: side(argb) });
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

// 화면 계산식은 숫자·사칙연산·괄호뿐이라 엑셀 수식으로 그대로 옮길 수 있다
const SAFE_FORMULA = /^[0-9+\-*/().]+$/;

function setMoney(cell: ExcelJS.Cell, value: number, formula?: string) {
  const expr = formula?.trim().replace(/^=/, "").replace(/[,\s]/g, "");
  cell.value = expr && SAFE_FORMULA.test(expr) ? { formula: expr, result: value } : value;
  cell.numFmt = MONEY;
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.font = font();
  cell.border = box();
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number, bold = false) {
  cell.value = { formula, result };
  cell.numFmt = MONEY;
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.font = font({ bold });
  cell.border = box();
}

// 상세설명 여러 줄 → "- 항목" (화면과 같은 규칙)
function descText(desc: string) {
  const value = String(desc || "").trim();
  if (!value || /^[-—–ㅡ_]+$/.test(value)) return "";
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•·]\s*/, ""))
    .filter((line) => line && !/^[-—–ㅡ_]+$/.test(line))
    .map((line) => `- ${line}`)
    .join("\n");
}

// 줄바꿈되는 칸의 줄 수 어림 — 한글·전각은 1.75칸, 나머지 1칸으로 세어 열 너비로 나눈다
function wrappedLines(text: string, width: number) {
  const perLine = Math.max(4, width - 1);
  return String(text || "")
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil([...line].reduce((w, ch) => w + (/[ᄀ-ￜ]/.test(ch) ? 1.75 : 1), 0) / perLine)), 0);
}

function itemSpans(rows: BudgetRow[]) {
  return rows.map((row, i) => {
    if (i > 0 && rows[i - 1].item === row.item) return 0;
    let n = 1;
    while (i + n < rows.length && rows[i + n].item === row.item) n++;
    return n;
  });
}

const letter = (col: number) => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

function titleRows(ws: ExcelJS.Worksheet, title: string, subtitle: string, lastCol: number) {
  ws.mergeCells(1, 1, 1, lastCol);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = font({ size: 14, bold: true, color: { argb: COLOR.title } });
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, lastCol);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = font({ size: 9, color: { argb: COLOR.muted } });
}

function headerRow(ws: ExcelJS.Worksheet, rowNo: number, labels: string[]) {
  labels.forEach((label, i) => {
    const c = ws.getCell(rowNo, i + 1);
    c.value = label;
    c.font = font({ bold: true, color: { argb: COLOR.title } });
    c.fill = fill(COLOR.headerFill);
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = box(COLOR.headerBorder);
  });
  ws.getRow(rowNo).height = 22;
}

// 상세 행 쓰기 — itemCol = 구분 열 번호(상세설명은 그 오른쪽, 이어서 1~12월·연간 합계). 마지막 행 번호를 돌려준다
function writeDetailRows(ws: ExcelJS.Worksheet, startRow: number, rows: BudgetRow[], itemCol: number, widths = { item: 16, desc: 40 }) {
  const spans = itemSpans(rows);
  const firstMonthCol = itemCol + 2;
  const totalCol = firstMonthCol + 12;
  rows.forEach((row, i) => {
    const r = startRow + i;
    const item = ws.getCell(r, itemCol);
    item.fill = fill(COLOR.itemFill);
    item.font = font({ bold: true });
    item.alignment = { vertical: "middle", wrapText: true };
    item.border = box();
    if (spans[i] > 0) {
      item.value = row.item;
      if (spans[i] > 1) ws.mergeCells(r, itemCol, r + spans[i] - 1, itemCol);
    }
    const description = descText(row.desc);
    const desc = ws.getCell(r, itemCol + 1);
    desc.value = description;
    desc.font = font({ color: { argb: "FF334155" } });
    desc.alignment = { vertical: "middle", wrapText: true };
    desc.border = box();
    row.values.forEach((v, m) => {
      const cell = ws.getCell(r, firstMonthCol + m);
      setMoney(cell, v, row.formulas?.[m]);
      const memo = row.memos?.[m]?.trim();
      if (memo) cell.note = { texts: [{ text: memo, font: { name: "Pretendard", size: 10 } }] };
    });
    setFormula(ws.getCell(r, totalCol), `SUM(${letter(firstMonthCol)}${r}:${letter(firstMonthCol + 11)}${r})`, sum(row.values), true);
    // 구분 칸은 합쳐진 경우 첫 행만 보면 됨(합친 높이가 충분)
    const lines = Math.max(wrappedLines(description, widths.desc), spans[i] === 1 ? wrappedLines(row.item, widths.item) : 1);
    ws.getRow(r).height = Math.max(20, lines * 14 + 6);
  });
  return startRow + rows.length - 1;
}

// 합계 행 — label 칸은 fromCol..toCol 합침, 값 칸은 1~12월·연간 합계
function sumRow(ws: ExcelJS.Worksheet, r: number, label: string, labelFrom: number, labelTo: number, firstRow: number, lastRow: number, results: number[], fn: "SUM" | "SUBTOTAL", color: string) {
  if (labelTo > labelFrom) ws.mergeCells(r, labelFrom, r, labelTo);
  for (let c = labelFrom; c <= labelTo; c++) {
    const cell = ws.getCell(r, c);
    cell.fill = fill(color);
    cell.border = box();
  }
  const l = ws.getCell(r, labelFrom);
  l.value = label;
  l.font = font({ bold: true });
  l.alignment = { vertical: "middle" };
  for (let m = 0; m <= 12; m++) {
    const col = labelTo + 1 + m;
    const range = `${letter(col)}${firstRow}:${letter(col)}${lastRow}`;
    const cell = ws.getCell(r, col);
    setFormula(cell, fn === "SUBTOTAL" ? `SUBTOTAL(9,${range})` : `SUM(${range})`, results[m], true);
    cell.fill = fill(color);
  }
  ws.getRow(r).height = 22;
}

function setupSheet(wb: ExcelJS.Workbook, name: string, frozenCols: number) {
  return wb.addWorksheet(sheetName(name), {
    views: [{ state: "frozen", xSplit: frozenCols, ySplit: 3 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "요기코퍼레이션 예산 대시보드";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  return wb;
}

const withTotal = (values: number[]) => [...values, sum(values)];

/** 계정 하나 — 상세 예산 입력 창과 같은 표 */
export async function accountWorkbook({ year, deptName, account }: { year: number; deptName: string; account: BudgetAccount }) {
  const wb = newWorkbook();
  const ws = setupSheet(wb, account.name, 2);
  ws.columns = [{ width: 16 }, { width: 40 }, ...MONTHS.map(() => ({ width: 13 })), { width: 15 }];
  titleRows(ws, `${deptName} · ${account.name} · 상세 예산`, `${year}년 · 단위: 원 · ${stamp()} 내려받음 · 빨간 삼각형이 있는 칸은 산출근거 메모(마우스를 올리면 보임)`, 15);
  headerRow(ws, 3, ["구분", "상세설명", ...MONTHS, "연간 합계"]);
  const last = writeDetailRows(ws, 4, account.rows, 1);
  sumRow(ws, last + 1, `${account.name} 합계`, 1, 2, 4, last, withTotal(accountMonths(account)), "SUM", COLOR.totalFill);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 부서 전체 — 시트1 계정별 요약(상세 시트 소계를 수식으로 참조) + 시트2 상세 내역 */
export async function departmentWorkbook({ year, deptName, deptCode, accounts }: { year: number; deptName: string; deptCode: string; accounts: BudgetAccount[] }) {
  const wb = newWorkbook();
  const summary = setupSheet(wb, "계정별 예산", 1);
  const detail = setupSheet(wb, "상세 내역", 3);

  // 시트2: 상세 내역 — 계정마다 [상세 행들 + 소계], 맨 끝에 부서 합계(SUBTOTAL 이라 소계를 두 번 세지 않음)
  detail.columns = [{ width: 16 }, { width: 16 }, { width: 38 }, ...MONTHS.map(() => ({ width: 13 })), { width: 15 }];
  titleRows(detail, `${year} ${deptName}[${deptCode}] 상세 예산`, `단위: 원 · ${stamp()} 내려받음 · 빨간 삼각형이 있는 칸은 산출근거 메모`, 16);
  headerRow(detail, 3, ["계정과목", "구분", "상세설명", ...MONTHS, "연간 합계"]);
  let r = 4;
  const subtotalRowOf: number[] = [];
  for (const account of accounts) {
    const first = r;
    const last = writeDetailRows(detail, first, account.rows, 2, { item: 16, desc: 38 });
    for (let row = first; row <= last; row++) {
      const cell = detail.getCell(row, 1);
      cell.fill = fill(COLOR.accountFill);
      cell.border = box();
    }
    if (last > first) detail.mergeCells(first, 1, last, 1);
    const acc = detail.getCell(first, 1);
    acc.value = account.name;
    acc.font = font({ bold: true, color: { argb: COLOR.title } });
    acc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    sumRow(detail, last + 1, `${account.name} 합계`, 1, 3, first, last, withTotal(accountMonths(account)), "SUBTOTAL", COLOR.subtotalFill);
    subtotalRowOf.push(last + 1);
    r = last + 2;
  }
  const allMonths = MONTHS.map((_, m) => accounts.reduce((t, a) => t + accountMonths(a)[m], 0));
  sumRow(detail, r, `${deptName} 합계`, 1, 3, 4, r - 1, withTotal(allMonths), "SUBTOTAL", COLOR.totalFill);

  // 시트1: 계정별 요약 — 값은 상세 시트 소계를 가리키는 수식(상세를 고치면 요약도 따라 바뀜)
  summary.columns = [{ width: 18 }, ...MONTHS.map(() => ({ width: 13 })), { width: 15 }];
  titleRows(summary, `${year} ${deptName}[${deptCode}] 계정별 예산`, `단위: 원 · ${stamp()} 내려받음 · 메모가 있는 달은 빨간 삼각형(상세 내역 시트에서 행별 메모 확인)`, 14);
  headerRow(summary, 3, ["계정과목", ...MONTHS, "연간 합계"]);
  accounts.forEach((account, i) => {
    const row = 4 + i;
    const name = summary.getCell(row, 1);
    name.value = account.name;
    name.font = font({ bold: true });
    name.fill = fill(COLOR.itemFill);
    name.border = box();
    const months = accountMonths(account);
    for (let m = 0; m <= 12; m++) {
      const cell = summary.getCell(row, 2 + m);
      setFormula(cell, `'상세 내역'!${letter(4 + m)}${subtotalRowOf[i]}`, m < 12 ? months[m] : sum(months), m === 12);
      if (m < 12) {
        const notes = account.rows
          .filter((x) => x.memos?.[m]?.trim())
          .map((x) => `${[x.item, x.desc].filter(Boolean).join(" · ")}\n${x.memos![m]}`)
          .join("\n\n");
        if (notes) cell.note = { texts: [{ text: notes, font: { name: "Pretendard", size: 10 } }] };
      }
    }
    summary.getRow(row).height = 20;
  });
  sumRow(summary, 4 + accounts.length, `${deptName} 합계`, 1, 1, 4, 3 + accounts.length, withTotal(allMonths), "SUM", COLOR.totalFill);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
