// 기존 HTML 대시보드(통합 1개 + 부서별 7개)에서 템플릿 데이터를 뽑아 src/data/*.json 으로 저장한다.
//   node scripts/extract-from-html.mjs [원본 폴더=..]
// 원본 HTML 을 고쳤을 때만 다시 돌리면 된다. 이미 DB 에 만들어진 부서 문서는 바뀌지 않는다(처음 만들 때만 템플릿 사용).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.resolve(root, process.argv[2] || '..');
const deptDir = path.join(sourceDir, '2027년_부서별_예산_대시보드');
const unifiedFile = fs.readdirSync(sourceDir).find((f) => f.includes('통합예산') && f.endsWith('.html'));
if (!unifiedFile) throw new Error(`통합예산 HTML 을 찾지 못했습니다: ${sourceDir}`);

const BACKSLASH = String.fromCharCode(92);

// `const NAME=` 뒤의 JSON 리터럴을 괄호 짝으로 잘라 파싱 (원본 통합 대시보드의 extractJsonConstant 와 같은 방식)
function extractJsonConstant(text, name, keyword = 'const') {
  const marker = `${keyword} ${name}=`;
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
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (--depth === 0) return { source: text.slice(start, i + 1), end: i + 1 };
    }
  }
  throw new Error(`${name} 데이터 끝을 찾지 못했습니다.`);
}
const jsonConstant = (text, name) => {
  const found = extractJsonConstant(text, name);
  return found ? JSON.parse(found.source) : null;
};
// 마케팅 파일처럼 JSON 이 아닌 JS 식(Array(12).fill(...))으로 적힌 값은 격리된 vm 에서 계산
const jsConstant = (text, name, keyword) => {
  const found = extractJsonConstant(text, name, keyword);
  return found ? vm.runInNewContext(`(${found.source})`, {}, { timeout: 1000 }) : null;
};
const savedJson = (text, id) => {
  const m = text.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
};
const quotedList = (source) => [...source.matchAll(/'([^']*)'/g)].map((m) => m[1]);
const norm = (s) => String(s ?? '').replace(/\s/g, '');

// 경영지원(인사·회계)이 일괄 입력하는 줄 — 코드설명표의 @인사부·@경영지원·@회계부 표시를 2027 템플릿 줄에 맞춘 것.
// 팀 화면에서는 잠기고 경영지원만 넣는다(경영지원이 상세 창에서 줄마다 켜고 끌 수 있음)
const ADMIN_ACCOUNTS = new Set(['직원급여', '퇴직급여', '세금과공과금']);
const ADMIN_WELFARE = new Set(['건강보험 회사분', 'employee day', '워크샵', 'cinema day', '자사몰 포인트']);
function isAdminRow(dept, account, row) {
  if (ADMIN_ACCOUNTS.has(account)) return true;
  const item = row.item.trim().toLowerCase();
  if (account === '복리후생비' && ADMIN_WELFARE.has(item)) return true;
  if (account === '보험료' && (item.startsWith('고용') || item === '화재보험료')) return true;
  if (account === '보험료' && item === '보증보험료' && dept !== '마케팅') return true; // 마케팅은 자기 보증보험을 직접
  return false;
}

// 부서 원장 → 계정별 행(구분+상세설명) 묶음. 원본 부서 대시보드 buildInitialGroups/initGroups 와 같은 규칙
//   actual = 원본 데이터의 행별 2026 실적(같은 구분·설명끼리 합산) — 상세 창 '2026 실적' 참고 칸
function accountTemplate(data, dept) {
  return data.accounts.map((account) => {
    const map = new Map();
    for (const d of data.details) {
      if (d.dept !== dept || norm(d.account) !== norm(account.name)) continue;
      if (!d.item && !d.desc) continue;
      const key = `${d.item || ''}\u0000${d.desc || ''}`;
      if (!map.has(key)) map.set(key, { item: d.item || '기타', desc: d.desc || '', actual: Array(12).fill(0) });
      (d.actual || []).forEach((v, m) => (map.get(key).actual[m] += Number(v) || 0));
    }
    let rows = [...map.values()];
    if (account.name === '지급임차료') {
      const order = ['본사 임차료', '매장 임차료', '기타'];
      const rank = (r) => (order.includes(r.item) ? order.indexOf(r.item) : 3);
      rows.sort((a, b) => rank(a) - rank(b) || (a.item === '매장 임차료' ? (a.desc ? 0 : 1) - (b.desc ? 0 : 1) : 0));
    }
    // 같은 구분끼리 붙여 둔다(상세 화면에서 구분 칸을 합쳐 보여 주므로)
    const itemOrder = [...new Set(rows.map((r) => r.item))];
    rows = rows.map((r, i) => ({ r, i })).sort((a, b) => itemOrder.indexOf(a.r.item) - itemOrder.indexOf(b.r.item) || a.i - b.i).map((x) => x.r);
    if (!rows.length) rows = [{ item: account.name, desc: '', actual: Array(12).fill(0) }];
    rows = rows.map(({ actual, ...r }) => ({
      ...r,
      ...(isAdminRow(dept, account.name, r) ? { locked: true } : {}),
      ...(actual.some((v) => v) ? { actual: actual.map((v) => Math.round(v)) } : {}),
    }));
    return { name: account.name, rows };
  });
}

function cleanSalesRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && Array.isArray(r.values) && r.values.length === 12)
    .filter((r) => String(r.kind || '').trim() || r.values.some((v) => v))
    .map((r) => ({ kind: String(r.kind || '').trim() || '기타', values: r.values.map(Number) }));
}

// ── 부서별 파일 ─────────────────────────────────────────────
const deptFiles = fs.readdirSync(deptDir).filter((f) => /_\d{4}_.+\.html$/.test(f));
const parsed = {};
let reference = null;
let logo = null;
for (const file of deptFiles) {
  const [, code, name] = file.match(/_(\d{4})_(.+)\.html$/);
  const text = fs.readFileSync(path.join(deptDir, file), 'utf8');
  const data = jsonConstant(text, 'DATA');
  const plan = savedJson(text, 'saved-budget') || {};
  const ref = jsonConstant(text, 'REFERENCE');
  const positionsSource = text.match(/personPositionSelect[\s\S]*?\.map\(position=>/);
  const positions = positionsSource ? quotedList(positionsSource[0].match(/\[('[^\]]*')\]\.map\(position=>/)[1]) : [];
  const storeSource = text.match(/k==='store'&&!\[([^\]]*)\]\.includes/);
  const salesRows = jsConstant(text, 'salesForecastRows', 'let');
  if (!reference) reference = { guide: ref.guide, codes: ref.codes, depts: ref.depts };
  else if (reference.guide !== ref.guide || JSON.stringify(reference.codes) !== JSON.stringify(ref.codes)) {
    console.warn(`! ${name}: 가이드라인/코드표가 다른 파일과 다릅니다 — 첫 파일 기준으로 저장합니다.`);
  }
  if (!logo) {
    const m = text.match(/class="header-logo" src="data:image\/png;base64,([^"]+)"/);
    if (m) logo = Buffer.from(m[1], 'base64');
  }
  const personnelSource = Array.isArray(plan.personnel) ? plan.personnel : ref.staff || [];
  parsed[name] = {
    code,
    name,
    data,
    positions,
    hasStore: text.includes("'매장명'"),
    storePositions: storeSource ? quotedList(storeSource[1]) : [],
    personnel: personnelSource.map((r) => ({
      code,
      dept: name,
      ...(text.includes("'매장명'") ? { store: String(r.store || '') } : {}),
      position: String(r.position || ''),
      name: String(r.name || ''),
      values: r.values.map((v) => Number(v) || 0),
    })),
    salesForecastRows: cleanSalesRows(salesRows || plan.salesForecastRows),
  };
}

// ── 부서 목록: 코드설명표의 부서코드 순서 ─────────────────────
// 원본에 없는 직급(경영지원 요청) — 물류 부장, 영업 매장 '중간관리'(매장 직급 맨 앞)
const EXTRA_POSITIONS = { 물류: ['부장'] };
const EXTRA_STORE_POSITIONS = { 영업: ['중간관리'] };
const withExtra = (list, extra = []) => [...extra.filter((p) => !list.includes(p)), ...list];
// 매장 직급은 전체 직급 목록에서도 첫 매장 직급 바로 앞에 끼운다
const withStoreExtra = (list, store, extra = []) => {
  const add = extra.filter((p) => !list.includes(p));
  const at = list.findIndex((p) => store.includes(p));
  return at < 0 ? [...list, ...add] : [...list.slice(0, at), ...add, ...list.slice(at)];
};
const departments = reference.depts.map(([code, name, category, note]) => {
  const own = Object.values(parsed).find((p) => p.code === code);
  // 물류는 부서 파일이 없어 마케팅 파일 안의 '물류센터' 원장을 쓴다(통합 대시보드 SEED 와 같은 출처)
  const sourceName = own ? name : name === '물류' ? '물류센터' : name;
  const sourceData = own ? own.data : parsed['마케팅'].data;
  const hasRows = sourceData.details.some((d) => d.dept === sourceName);
  if (!hasRows) console.warn(`! ${name}: 원장 원본이 없어 계정 이름만으로 만듭니다.`);
  return {
    code,
    name,
    category: category || name,
    note: note || '',
    positions: withStoreExtra(withExtra(own?.positions.length ? own.positions : ['차장', '과장', '대리', '주임'], EXTRA_POSITIONS[name]), own?.storePositions || [], EXTRA_STORE_POSITIONS[name]),
    hasStore: own?.hasStore || false,
    storePositions: withExtra(own?.storePositions || [], EXTRA_STORE_POSITIONS[name]),
    accounts: accountTemplate(sourceData, sourceName),
    personnel: own?.personnel || [],
    salesForecastRows: own?.salesForecastRows || [],
  };
});

// ── 통합 파일: 2026 매출 참고값 + 2027 매출 예산안(채널·수수료) ──
const unified = fs.readFileSync(path.join(sourceDir, unifiedFile), 'utf8');
const revenue2026 = jsonConstant(unified, 'REVENUE_2026');
const revenue2027 = jsonConstant(unified, 'REVENUE_2027');
const revenue = {
  rows2026: revenue2026,
  channels: revenue2027.channels.map((c) => ({ key: c.key, label: c.label })),
  fees: revenue2027.fees.map((f) => ({ key: f.key, label: f.label, values: f.values })),
  // 원본 손익표의 '전년(prior)' 값 — 모든 부서 파일에 같은 값. 통합 화면 손익 탭의 2026 비교 기준
  pnlPrior: parsed['영업'].data.pnl.map((p) => ({ name: p.name, prior: Math.round(p.prior) })),
};

const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'templates.json'), JSON.stringify({ year: 2027, departments }, null, 1));
fs.writeFileSync(path.join(outDir, 'reference.json'), JSON.stringify(reference, null, 1));
fs.writeFileSync(path.join(outDir, 'revenue.json'), JSON.stringify(revenue, null, 1));
if (logo) {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'logo.png'), logo);
}

for (const d of departments) {
  const rows = d.accounts.reduce((n, a) => n + a.rows.length, 0);
  console.log(`${d.code} ${d.name}: 계정 ${d.accounts.length} · 행 ${rows} · 인원 ${d.personnel.length} · 목표매출 ${d.salesForecastRows.map((r) => r.kind).join(',') || '-'} · 직급 ${d.positions.join('/')}${d.hasStore ? ' · 매장명' : ''}`);
}
console.log(`코드설명표 ${reference.codes.length}행 · 2026 참고 ${revenue.rows2026.length}행 · 채널 ${revenue.channels.length} · 수수료 ${revenue.fees.length}`);
