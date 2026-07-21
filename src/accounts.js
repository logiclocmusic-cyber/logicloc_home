/** 信用账户：信用卡额度与免息期管理 */
import { fmtMoney, fmtMoneySigned, fmtCount } from './format.js';
import { isValidPayAccount, matchBankBrand, accountGroupKey, accountGroupName } from './bank-brands.js';
import { downloadReminderIcs, calendarExportHint, CALENDAR_NAME } from './reminder-calendar.js';

const MANUAL_PREFIX = '__manual:';
const KIND_OPTIONS = ['借记卡', '信用卡', '支付账户'];
const CREDIT_CARD_GROUPS = [
  { id: 'huhan', name: '胡晗' },
  { id: 'chencheng', name: '陈橙' }
];

const DEFAULT_CASH_ACCOUNTS = [
  '工商银行9859', '招商银行2758', '工商银行6616', '天府银行7592', '平安银行3949',
  '建设银行1891', '民生银行0258', '中国银行0135', '微信-胡晗', '支付宝-胡晗'
];

const DEFAULT_LIFE_ACCOUNTS = [
  { name: '旌湖上境电费', accountNo: '5101152527201' }
];

const DEFAULT_LONG_REMINDERS = [
  { name: 'W-8 表格', expiry: '2030-01-01' }
];

let getAllRows = () => [];
let onPersist = () => {};
let persistNowFn = null;
let registryNeedsPersist = false;

let accountCardFaces = {};
let accountRegistry = { overrides: {}, hidden: [], manual: [], merges: {}, creditHidden: [], creditPools: [], creditGroups: {}, cashAccounts: [], expenseBudgets: [], webAccounts: { columns: [], rows: [] }, lifeAccounts: [], longReminders: [] };
let creditCardEditMode = false;
let cashAccountEditMode = false;
let budgetEditMode = false;
let webAccountEditMode = false;
let lifeAccountEditMode = false;
let longReminderEditMode = false;

const CORP_MARKS = {
  WECHAT: { bg: '#07c160', icon: 'ti-brand-wechat' },
  ALIPAY: { bg: '#1677ff', icon: 'ti-brand-alipay' },
  UPOP: { bg: '#e21836', icon: 'ti-credit-card' }
};

export function initAccounts(deps) {
  getAllRows = deps.getAllRows || getAllRows;
  onPersist = deps.onPersist || onPersist;
  persistNowFn = deps.persistNow || null;
}

function registryStorageKey(payKey) {
  if (!payKey || isManualKey(payKey)) return payKey;
  return accountGroupKey(payKey);
}

function mergeOverride(a, b) {
  const out = { ...a, ...b };
  if (a?.credit || b?.credit) out.credit = { ...(a?.credit || {}), ...(b?.credit || {}) };
  return out;
}

function migrateRegistry(raw) {
  const r = {
    overrides: raw?.overrides && typeof raw.overrides === 'object' ? { ...raw.overrides } : {},
    hidden: Array.isArray(raw?.hidden) ? [...raw.hidden] : [],
    manual: Array.isArray(raw?.manual) ? raw.manual.map(m => ({ ...m })) : [],
    merges: raw?.merges && typeof raw.merges === 'object' ? { ...raw.merges } : {},
    creditHidden: Array.isArray(raw?.creditHidden) ? [...raw.creditHidden] : [],
    creditPools: Array.isArray(raw?.creditPools) ? raw.creditPools.map(p => ({ ...p, cards: [...(p.cards || [])] })) : [],
    creditGroups: raw?.creditGroups && typeof raw.creditGroups === 'object' ? { ...raw.creditGroups } : {},
    cashAccounts: Array.isArray(raw?.cashAccounts)
      ? raw.cashAccounts.map(a => ({
        id: String(a?.id || ''),
        name: String(a?.name || ''),
        balance: Number(a?.balance) || 0,
        initial: Number(a?.initial) || 0
      })).filter(a => a.id && a.name)
      : [],
    expenseBudgets: Array.isArray(raw?.expenseBudgets)
      ? raw.expenseBudgets.map(b => {
        const id = String(b?.id || '');
        const date = normalizeBudgetDateIso(b?.date);
        return {
          id,
          name: String(b?.name || ''),
          date,
          amount: Number(b?.amount) || 0
        };
      }).filter(b => b.id)
      : []
  };
  r.webAccounts = normalizeWebAccounts(raw?.webAccounts);
  r.lifeAccounts = Array.isArray(raw?.lifeAccounts)
    ? raw.lifeAccounts.map(a => ({
      id: String(a?.id || ''),
      name: String(a?.name || ''),
      accountNo: String(a?.accountNo || a?.account || '')
    })).filter(a => a.id)
    : [];
  r.longReminders = Array.isArray(raw?.longReminders)
    ? raw.longReminders.map(item => ({
      id: String(item?.id || ''),
      name: String(item?.name || ''),
      expiry: normalizeBudgetDateIso(item?.expiry || item?.date || '')
    })).filter(item => item.id)
    : [];
  let migrated = false;

  const newOverrides = {};
  for (const [k, v] of Object.entries(r.overrides)) {
    const nk = registryStorageKey(k);
    if (nk !== k) migrated = true;
    newOverrides[nk] = newOverrides[nk] ? mergeOverride(newOverrides[nk], v) : { ...v };
  }
  r.overrides = newOverrides;

  const migrateKeys = arr => {
    const src = arr || [];
    const out = [...new Set(src.map(registryStorageKey))];
    if (out.length !== src.length || out.some((k, i) => k !== src[i])) migrated = true;
    return out;
  };
  r.hidden = migrateKeys(r.hidden);
  r.creditHidden = migrateKeys(r.creditHidden);

  const newMerges = {};
  for (const [src, tgt] of Object.entries(r.merges)) {
    const ns = registryStorageKey(src);
    const nt = registryStorageKey(tgt);
    if (ns !== src || nt !== tgt) migrated = true;
    newMerges[ns] = nt;
  }
  r.merges = newMerges;

  const newCreditGroups = {};
  for (const [k, v] of Object.entries(r.creditGroups)) {
    const nk = registryStorageKey(k);
    if (nk !== k) migrated = true;
    if (CREDIT_CARD_GROUPS.some(g => g.id === v)) newCreditGroups[nk] = v;
  }
  r.creditGroups = newCreditGroups;

  r.manual.forEach(m => {
    const digits = onlyDigits(m.digits);
    if (m.kind !== '信用卡' || !digits.endsWith('6802')) return;
    const sample = `${m.label || ''} ${digits}`;
    if (!/建设|建行|CCB/i.test(sample)) return;
    const key = manualKey(m.id);
    if (r.creditGroups[key] !== 'chencheng') {
      r.creditGroups[key] = 'chencheng';
      migrated = true;
    }
  });

  return { registry: r, migrated };
}

function nextCashAccountId() {
  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeWebAccounts(raw) {
  const columns = Array.isArray(raw?.columns)
    ? raw.columns.map(c => ({
      id: String(c?.id || ''),
      title: String(c?.title || '')
    })).filter(c => c.id)
    : [];
  const rows = Array.isArray(raw?.rows)
    ? raw.rows.map(r => ({
      id: String(r?.id || ''),
      phone: String(r?.phone || ''),
      cells: r?.cells && typeof r.cells === 'object' ? { ...r.cells } : {}
    })).filter(r => r.id)
    : [];
  return { columns, rows };
}

function ensureWebAccounts() {
  if (!accountRegistry.webAccounts || typeof accountRegistry.webAccounts !== 'object') {
    accountRegistry.webAccounts = { columns: [], rows: [] };
  }
  accountRegistry.webAccounts = normalizeWebAccounts(accountRegistry.webAccounts);
}

function nextWebColId() {
  return `webcol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextWebRowId() {
  return `webrow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function webCellValue(row, colId) {
  return String(row?.cells?.[colId] || '');
}

function setWebCellValue(row, colId, value) {
  if (!row.cells || typeof row.cells !== 'object') row.cells = {};
  const v = String(value || '').trim();
  if (v) row.cells[colId] = v;
  else delete row.cells[colId];
}

function nextLifeAccountId() {
  return `life-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function lifeAccountsList() {
  return Array.isArray(accountRegistry.lifeAccounts) ? accountRegistry.lifeAccounts : [];
}

function ensureLifeAccounts() {
  if (!Array.isArray(accountRegistry.lifeAccounts)) accountRegistry.lifeAccounts = [];
}

function ensureDefaultLifeAccounts() {
  ensureLifeAccounts();
  if (accountRegistry.lifeAccounts.length) return false;
  accountRegistry.lifeAccounts = DEFAULT_LIFE_ACCOUNTS.map(item => ({
    id: nextLifeAccountId(),
    name: item.name,
    accountNo: item.accountNo
  }));
  return true;
}

function nextLongReminderId() {
  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function longRemindersList() {
  return Array.isArray(accountRegistry.longReminders) ? accountRegistry.longReminders : [];
}

function ensureLongReminders() {
  if (!Array.isArray(accountRegistry.longReminders)) accountRegistry.longReminders = [];
}

function ensureDefaultLongReminders() {
  ensureLongReminders();
  if (accountRegistry.longReminders.length) return false;
  accountRegistry.longReminders = DEFAULT_LONG_REMINDERS.map(item => ({
    id: nextLongReminderId(),
    name: item.name,
    expiry: item.expiry
  }));
  return true;
}

function ensureDefaultCashAccounts() {
  if (!Array.isArray(accountRegistry.cashAccounts)) accountRegistry.cashAccounts = [];
  if (accountRegistry.cashAccounts.length) return false;
  accountRegistry.cashAccounts = DEFAULT_CASH_ACCOUNTS.map(name => ({
    id: nextCashAccountId(),
    name,
    balance: 0,
    initial: 0
  }));
  return true;
}

function normalizeRegistry(raw) {
  return migrateRegistry(raw).registry;
}

export function consumeRegistryMigrationPersist() {
  const flag = registryNeedsPersist;
  registryNeedsPersist = false;
  return flag;
}

async function flushAccountPersist() {
  if (persistNowFn) return persistNowFn();
  onPersist();
}

export function loadAccountsState(state) {
  accountCardFaces = state?.accountCardFaces || {};
  let { registry, migrated } = migrateRegistry(state?.accountRegistry);
  accountRegistry = registry;
  ensureWebAccounts();
  if (ensureDefaultCashAccounts()) migrated = true;
  if (ensureDefaultLifeAccounts()) migrated = true;
  if (ensureDefaultLongReminders()) migrated = true;
  if (migrated) registryNeedsPersist = true;
}

export function getAccountsState() {
  return { accountCardFaces, accountRegistry };
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function isManualKey(payKey) {
  return String(payKey || '').startsWith(MANUAL_PREFIX);
}

function manualKey(id) {
  return `${MANUAL_PREFIX}${id}`;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function inferKind(text, fallback = '支付账户') {
  if (/信用卡|贷记|信用/.test(text)) return '信用卡';
  if (/储蓄|借记|储蓄卡|借记卡/.test(text)) return '借记卡';
  return fallback;
}

function getManualEntry(payKey) {
  if (!isManualKey(payKey)) return null;
  const id = payKey.slice(MANUAL_PREFIX.length);
  return accountRegistry.manual.find(m => m.id === id) || null;
}

function getOverride(payKey) {
  if (accountRegistry.overrides[payKey]) return accountRegistry.overrides[payKey];
  const canon = registryStorageKey(payKey);
  if (canon !== payKey && accountRegistry.overrides[canon]) return accountRegistry.overrides[canon];
  for (const [k, v] of Object.entries(accountRegistry.overrides)) {
    if (registryStorageKey(k) === canon) return v;
  }
  return null;
}

function isCreditCancelled(payKey) {
  const manual = getManualEntry(payKey);
  if (manual) return !!manual.cancelled;
  return !!getOverride(payKey)?.cancelled;
}

function setCreditCancelled(payKey, cancelled) {
  const manual = getManualEntry(payKey);
  if (manual) {
    if (cancelled) manual.cancelled = true;
    else delete manual.cancelled;
    return;
  }
  const key = registryStorageKey(canonicalAccountKey(payKey));
  const prev = getOverride(payKey) || accountRegistry.overrides[key] || {};
  accountRegistry.overrides[key] = { ...prev };
  if (cancelled) accountRegistry.overrides[key].cancelled = true;
  else delete accountRegistry.overrides[key].cancelled;
}

export function toggleCreditCancelled(payKey) {
  if (!payKey) return;
  setCreditCancelled(payKey, !isCreditCancelled(payKey));
  flushAccountPersist();
  renderAccountsPage();
}

function canonicalAccountKey(payKey) {
  let k = payKey;
  const seen = new Set();
  while (accountRegistry.merges?.[k] && !seen.has(k)) {
    seen.add(k);
    k = accountRegistry.merges[k];
  }
  return k;
}

function accountKeyForPay(pay) {
  return canonicalAccountKey(accountGroupKey(pay));
}

function isMergedAway(payKey) {
  return !!accountRegistry.merges?.[payKey];
}

function getCreditInfo(payKey) {
  return getRawCreditInfo(payKey);
}

function getRawCreditInfo(payKey) {
  const manual = getManualEntry(payKey);
  if (manual?.credit) return { ...manual.credit };
  const ov = getOverride(payKey);
  if (ov?.credit) return { ...ov.credit };
  return null;
}

function ensureCreditPools() {
  if (!Array.isArray(accountRegistry.creditPools)) accountRegistry.creditPools = [];
}

function normalizePoolCardKey(payKey) {
  return registryStorageKey(canonicalAccountKey(payKey));
}

function findCreditPoolById(poolId) {
  ensureCreditPools();
  return accountRegistry.creditPools.find(p => p.id === poolId) || null;
}

function creditPoolForCard(payKey) {
  const key = normalizePoolCardKey(payKey);
  ensureCreditPools();
  return accountRegistry.creditPools.find(p => (p.cards || []).some(k => normalizePoolCardKey(k) === key)) || null;
}

function getEffectiveCreditInfo(payKey) {
  const raw = getRawCreditInfo(payKey) || {};
  const pool = creditPoolForCard(payKey);
  if (!pool) return Object.keys(raw).length ? raw : null;
  return {
    ...raw,
    limit: pool.limit,
    available: pool.available,
    debt: pool.debt,
    poolId: pool.id,
    poolName: pool.name
  };
}

function mergePoolCredit(target, source) {
  if (target.limit == null && source.limit != null) {
    target.limit = source.limit;
    target.available = source.available;
    target.debt = source.debt;
  }
}

function removeCreditPool(poolId) {
  ensureCreditPools();
  accountRegistry.creditPools = accountRegistry.creditPools.filter(p => p.id !== poolId);
}

function stripCardPoolCredit(payKey) {
  const credit = getRawCreditInfo(payKey);
  if (!credit) return;
  const { billDay, dueDay } = credit;
  const stripped = billDay != null || dueDay != null ? { billDay, dueDay } : null;
  applyCreditToAccount(payKey, stripped);
}

function createCreditPool(cardKeys, name = '共享额度') {
  ensureCreditPools();
  const pool = {
    id: `cp${Date.now()}`,
    name,
    limit: null,
    available: null,
    debt: null,
    cards: [...new Set(cardKeys.map(normalizePoolCardKey))]
  };
  accountRegistry.creditPools.push(pool);
  return pool;
}

function bindCreditCards(keys) {
  ensureCreditPools();
  const canonKeys = [...new Set(keys.map(normalizePoolCardKey))];
  if (canonKeys.length < 2) return false;

  const pools = new Map();
  canonKeys.forEach(k => {
    const p = creditPoolForCard(k);
    if (p) pools.set(p.id, p);
  });

  let pool;
  if (pools.size === 0) {
    const brand = matchBankBrand(parsePayAccount(canonKeys[0]).label || canonKeys[0]);
    pool = createCreditPool(canonKeys, brand?.name || '共享额度');
  } else {
    pool = [...pools.values()][0];
    [...pools.values()].slice(1).forEach(p => {
      pool.cards.push(...p.cards.filter(k => !pool.cards.includes(normalizePoolCardKey(k))));
      mergePoolCredit(pool, p);
      removeCreditPool(p.id);
    });
    canonKeys.forEach(k => {
      const nk = normalizePoolCardKey(k);
      if (!pool.cards.includes(nk)) pool.cards.push(nk);
    });
  }

  if (pool.limit == null) {
    for (const k of canonKeys) {
      const raw = getRawCreditInfo(k);
      if (raw?.limit != null) {
        pool.limit = raw.limit;
        pool.available = raw.available;
        pool.debt = raw.debt;
        break;
      }
    }
  }

  canonKeys.forEach(stripCardPoolCredit);
  return true;
}

function unbindCreditCard(payKey) {
  const key = normalizePoolCardKey(payKey);
  const pool = creditPoolForCard(payKey);
  if (!pool) return;
  pool.cards = pool.cards.filter(k => normalizePoolCardKey(k) !== key);
  if (pool.cards.length < 2) dissolveCreditPool(pool.id, { restoreTo: pool.cards[0] });
}

function dissolveCreditPool(poolId, { restoreTo } = {}) {
  const pool = findCreditPoolById(poolId);
  if (!pool) return;
  if (restoreTo) {
    const credit = {
      limit: pool.limit,
      available: pool.available,
      debt: pool.debt
    };
    if ([credit.limit, credit.available, credit.debt].some(v => v != null)) {
      const prev = getRawCreditInfo(restoreTo) || {};
      applyCreditToAccount(restoreTo, { ...credit, billDay: prev.billDay, dueDay: prev.dueDay });
    }
  }
  removeCreditPool(poolId);
}

function removeCardFromCreditPools(payKey) {
  const key = normalizePoolCardKey(payKey);
  ensureCreditPools();
  accountRegistry.creditPools.forEach(pool => {
    pool.cards = pool.cards.filter(k => normalizePoolCardKey(k) !== key);
  });
  const singles = accountRegistry.creditPools.filter(p => p.cards.length === 1);
  singles.forEach(pool => dissolveCreditPool(pool.id, { restoreTo: pool.cards[0] }));
  accountRegistry.creditPools = accountRegistry.creditPools.filter(p => p.cards.length >= 2);
}

function parseCreditAmount(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseCreditDay(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
}

function formatCreditSummary(credit) {
  if (!credit) return '';
  const parts = [];
  if (credit.poolName) parts.push(`与${credit.poolName}共享额度`);
  if (credit.limit != null) parts.push(`额度 ${fmtMoney(credit.limit)}`);
  if (credit.available != null) parts.push(`可用 ${fmtMoney(credit.available)}`);
  if (credit.debt != null) parts.push(`欠款 ${fmtMoney(credit.debt)}`);
  if (credit.billDay) parts.push(`账单日 ${credit.billDay}日`);
  if (credit.dueDay) parts.push(`还款日 ${credit.dueDay}日`);
  return parts.join(' · ');
}

function creditFieldsFromInputs() {
  const limit = parseCreditAmount(document.getElementById('acctMgrCreditLimit')?.value);
  const available = parseCreditAmount(document.getElementById('acctMgrCreditAvail')?.value);
  const debt = parseCreditAmount(document.getElementById('acctMgrCreditDebt')?.value);
  const dueDay = parseCreditDay(document.getElementById('acctMgrDueDay')?.value);
  const billDay = parseCreditDay(document.getElementById('acctMgrBillDay')?.value);
  if ([limit, available, debt, dueDay, billDay].every(v => v == null)) return null;
  return { limit, available, debt, dueDay, billDay };
}

function syncAccountsMgrCreditFields() {
  const kind = document.getElementById('acctMgrKind')?.value || '';
  const panel = document.getElementById('acctMgrCreditFields');
  if (panel) panel.classList.toggle('hide', kind !== '信用卡');
}

function accountDigits(payKey) {
  const manual = getManualEntry(payKey);
  if (manual) return onlyDigits(manual.digits);
  const ov = getOverride(payKey);
  if (ov?.digits) return onlyDigits(ov.digits);
  const m = String(payKey || '').match(/\(([^)]+)\)/);
  return m ? onlyDigits(m[1]) : '';
}

function formatCardDigits(digits) {
  const d = onlyDigits(digits);
  if (!d) return '';
  const parts = [];
  for (let i = 0; i < d.length; i += 4) parts.push(d.slice(i, i + 4));
  return parts.join(' ');
}

function maskCardDigits(digits) {
  const d = onlyDigits(digits);
  if (!d) return '**** **** **** ****';
  const last4 = d.slice(-4);
  const groups = Math.max(4, Math.ceil(d.length / 4));
  return [...Array(groups - 1).fill('****'), last4].join(' ');
}

function buildCardFields(label, digits, kind, full, brandSource) {
  const d = onlyDigits(digits);
  const last4 = d ? d.slice(-4).padStart(4, '0') : '';
  const cardNumMasked = d ? maskCardDigits(d) : '**** **** **** ****';
  const cardNumFull = d ? formatCardDigits(d) : cardNumMasked;
  const brand = matchBankBrand(brandSource || label || full);
  return {
    full,
    label: label || full,
    last4,
    cardNumMasked,
    cardNumFull,
    hasCardNum: !!d,
    kind: kind || '支付账户',
    brand
  };
}

function parsePayAccount(payKey) {
  const mergedName = accountGroupName(payKey);
  if (mergedName) {
    const brand = matchBankBrand(mergedName);
    return {
      full: payKey,
      label: mergedName,
      last4: '',
      cardNumMasked: '聚合账户',
      cardNumFull: '聚合账户',
      hasCardNum: false,
      kind: '支付账户',
      brand
    };
  }

  const manual = getManualEntry(payKey);
  if (manual) {
    const fields = buildCardFields(
      manual.label,
      manual.digits,
      manual.kind || '支付账户',
      payKey,
      manual.label
    );
    const tag = manual.tag ? String(manual.tag).trim() : '';
    return manual.credit ? { ...fields, credit: { ...manual.credit }, tag } : { ...fields, tag };
  }

  const full = (payKey || '').trim();
  const paren = full.match(/^(.+?)\(([^)]+)\)?$/);
  let label = paren ? paren[1].trim() : full;
  let digits = paren ? onlyDigits(paren[2]) : '';
  let kind = inferKind(full);

  const ov = getOverride(payKey);
  if (ov?.label) label = ov.label.trim() || label;
  if (ov?.digits) digits = onlyDigits(ov.digits);
  if (ov?.kind) kind = ov.kind;

  const credit = getEffectiveCreditInfo(payKey);
  const tag = ov?.tag ? String(ov.tag).trim() : '';
  const fields = buildCardFields(label, digits, kind, full, full);
  const out = credit ? { ...fields, credit } : fields;
  return tag ? { ...out, tag } : out;
}

function isHidden(payKey) {
  const canon = registryStorageKey(payKey);
  return (accountRegistry.hidden || []).some(k => registryStorageKey(k) === canon);
}

function accountList() {
  const map = new Map();
  getAllRows().forEach(r => {
    const pay = (r['支付方式'] || '').trim();
    if (!isValidPayAccount(pay)) return;
    const key = accountKeyForPay(pay);
    if (isHidden(key)) return;
    if (!map.has(key)) map.set(key, { pay: key, count: 0, exp: 0, inc: 0, manual: false });
    const a = map.get(key);
    a.count += 1;
    if (r['收支'] === '收入') a.inc += r['金额'];
    else a.exp += r['金额'];
  });

  accountRegistry.manual.forEach(m => {
    const key = canonicalAccountKey(manualKey(m.id));
    if (isHidden(key) || isMergedAway(manualKey(m.id))) return;
    if (!map.has(key)) map.set(key, { pay: key, count: 0, exp: 0, inc: 0, manual: true });
  });

  return [...map.values()].sort((a, b) => b.count - a.count || b.exp - a.exp);
}

function accountBrandMarkHtml(payKey, size = 22) {
  const parsed = parsePayAccount(payKey);
  const sample = accountGroupName(payKey) || parsed.label || payKey;
  const brand = matchBankBrand(sample);
  const { label } = parsed;
  const logoUrl = brand?.logoUrl || null;
  if (logoUrl) {
    return `<img class="fund-brand-logo" src="${esc(logoUrl)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.display='none'">`;
  }
  const corp = brand && CORP_MARKS[brand.logoType || brand.code];
  if (corp) {
    const iconSize = Math.max(11, Math.round(size * 0.5));
    return `<span class="fund-brand-mark" style="width:${size}px;height:${size}px;background:${corp.bg}"><i class="ti ${corp.icon}" style="font-size:${iconSize}px"></i></span>`;
  }
  const letter = (label || '?').trim()[0] || '?';
  return `<span class="fund-brand-mark fund-brand-mark--fb" style="width:${size}px;height:${size}px">${esc(letter)}</span>`;
}

function creditInputVal(v) {
  return v != null && v !== '' ? String(v) : '';
}

function roundCreditAmount(n) {
  return Math.round(n * 100) / 100;
}

function isCreditHidden(payKey) {
  const canon = registryStorageKey(payKey);
  return (accountRegistry.creditHidden || []).some(k => registryStorageKey(k) === canon);
}

function creditRowInput(row, field) {
  return row?.querySelector(`[data-credit-field="${field}"]`);
}

function syncCreditDerived(row, changedField) {
  const limitInp = creditRowInput(row, 'limit');
  const availInp = creditRowInput(row, 'available');
  const debtInp = creditRowInput(row, 'debt');
  const limit = parseCreditAmount(limitInp?.value);
  if (limit == null) return;

  if (changedField === 'available') {
    if (availInp?.value === '') return;
    const available = parseCreditAmount(availInp?.value);
    if (available != null && debtInp && document.activeElement !== debtInp) {
      debtInp.value = creditInputVal(roundCreditAmount(Math.max(0, limit - available)));
    }
  } else if (changedField === 'debt') {
    if (debtInp?.value === '') return;
    const debt = parseCreditAmount(debtInp?.value);
    if (debt != null && availInp && document.activeElement !== availInp) {
      availInp.value = creditInputVal(roundCreditAmount(Math.max(0, limit - debt)));
    }
  } else if (changedField === 'limit') {
    const from = row.dataset.creditCalcFrom || 'available';
    if (from === 'debt' && debtInp?.value !== '') syncCreditDerived(row, 'debt');
    else if (availInp?.value !== '') syncCreditDerived(row, 'available');
    else if (debtInp?.value !== '') syncCreditDerived(row, 'debt');
  }
}

function creditFromRowInputs(row, { pooled = false } = {}) {
  const get = field => row.querySelector(`[data-credit-field="${field}"]`)?.value;
  const dueDay = parseCreditDay(get('dueDay'));
  const billDay = parseCreditDay(get('billDay'));
  if (pooled) {
    if ([dueDay, billDay].every(v => v == null)) return null;
    return { dueDay, billDay };
  }
  const limit = parseCreditAmount(get('limit'));
  const available = parseCreditAmount(get('available'));
  const debt = parseCreditAmount(get('debt'));
  if ([limit, available, debt, dueDay, billDay].every(v => v == null)) return null;
  return { limit, available, debt, dueDay, billDay };
}

function creditFromPoolRowInputs(row) {
  const get = field => row.querySelector(`[data-credit-field="${field}"]`)?.value;
  const limit = parseCreditAmount(get('limit'));
  const available = parseCreditAmount(get('available'));
  const debt = parseCreditAmount(get('debt'));
  if ([limit, available, debt].every(v => v == null)) return null;
  return { limit, available, debt };
}

function applyCreditToAccount(payKey, credit) {
  if (isManualKey(payKey)) {
    const entry = getManualEntry(payKey);
    if (!entry) return false;
    entry.kind = '信用卡';
    if (credit) entry.credit = credit;
    else delete entry.credit;
  } else {
    const prev = accountRegistry.overrides[payKey] || {};
    accountRegistry.overrides[payKey] = { ...prev, kind: '信用卡' };
    if (credit) accountRegistry.overrides[payKey].credit = credit;
    else delete accountRegistry.overrides[payKey].credit;
  }
  return true;
}

function getAccountTag(payKey) {
  const manual = getManualEntry(payKey);
  if (manual?.tag) return String(manual.tag).trim();
  const ov = getOverride(payKey);
  if (ov?.tag) return String(ov.tag).trim();
  return '';
}

function applyCreditCardMeta(payKey, { label, digits, tag }) {
  const applyTag = (entry) => {
    if (tag === undefined) return;
    const t = String(tag || '').trim();
    if (t) entry.tag = t;
    else delete entry.tag;
  };
  if (isManualKey(payKey)) {
    const entry = getManualEntry(payKey);
    if (!entry) return false;
    entry.kind = '信用卡';
    if (label) entry.label = label;
    if (digits) entry.digits = digits;
    applyTag(entry);
    return true;
  }
  const prev = accountRegistry.overrides[payKey] || {};
  accountRegistry.overrides[payKey] = { ...prev, kind: '信用卡' };
  if (label) accountRegistry.overrides[payKey].label = label;
  if (digits) accountRegistry.overrides[payKey].digits = digits;
  applyTag(accountRegistry.overrides[payKey]);
  return true;
}

function defaultCreditCardGroupId(acc) {
  const last4 = onlyDigits(acc.last4).slice(-4);
  if (last4 !== '6803') return 'huhan';
  const sample = `${acc.label || ''} ${acc.pay || ''}`;
  if (/中信银行|中信/.test(sample)) return 'chencheng';
  const brand = matchBankBrand(sample);
  return brand?.code === 'CITIC' ? 'chencheng' : 'huhan';
}

function creditCardGroupId(acc) {
  const key = registryStorageKey(canonicalAccountKey(acc.pay));
  const assigned = accountRegistry.creditGroups?.[key];
  if (assigned && CREDIT_CARD_GROUPS.some(g => g.id === assigned)) return assigned;
  return defaultCreditCardGroupId(acc);
}

function groupCreditCardAccounts(cards) {
  const map = Object.fromEntries(CREDIT_CARD_GROUPS.map(g => [g.id, []]));
  cards.forEach(c => {
    const gid = creditCardGroupId(c);
    if (map[gid]) map[gid].push(c);
  });
  return CREDIT_CARD_GROUPS.map(g => ({ ...g, cards: map[g.id] }));
}

function creditCardBankName(pay, label = '') {
  const brand = matchBankBrand(pay) || matchBankBrand(label);
  if (brand?.name) return brand.name;
  const s = (label || '').trim();
  if (!s) return '信用卡';
  return s.replace(/信用卡$/, '').trim() || s;
}

function creditCardDisplayName({ pay, label, last4, digits }) {
  const tail = last4
    ? String(last4).slice(-4).padStart(4, '0')
    : digits
      ? onlyDigits(digits).slice(-4).padStart(4, '0')
      : '';
  const bank = creditCardBankName(pay, label);
  return tail ? `${bank} ${tail}` : bank;
}

function creditCardAccounts() {
  return mgrAccountRows()
    .filter(r => r.kind === '信用卡' && !isCreditHidden(r.key))
    .map(r => {
      const parsed = parsePayAccount(r.key);
      const digits = accountDigits(r.key);
      const last4 = digits ? digits.slice(-4) : parsed.last4;
      const label = r.label || parsed.label;
      const tag = getAccountTag(r.key);
      const pool = creditPoolForCard(r.key);
      const acc = { pay: r.key, label, last4, digits, tag };
      return {
        pay: r.key,
        label,
        last4,
        digits,
        tag,
        displayName: creditCardDisplayName(acc),
        credit: getEffectiveCreditInfo(r.key) || {},
        poolId: pool?.id || null,
        count: r.count,
        cancelled: isCreditCancelled(r.key)
      };
    });
}

function organizeGroupCards(cards) {
  const poolMap = new Map();
  const standalone = [];
  cards.forEach(c => {
    if (c.poolId) {
      if (!poolMap.has(c.poolId)) {
        poolMap.set(c.poolId, { pool: findCreditPoolById(c.poolId), cards: [] });
      }
      poolMap.get(c.poolId).cards.push(c);
    } else {
      standalone.push(c);
    }
  });
  const blocks = [...poolMap.values()]
    .filter(b => b.pool)
    .map(b => ({ type: 'pool', pool: b.pool, cards: b.cards }));
  if (standalone.length) blocks.push({ type: 'standalone', cards: standalone });
  return blocks;
}

function creditFieldInputs(c, extra = '', { pooled = false } = {}) {
  const inp = (field, val, attrs = '') =>
    `<input type="number" class="accounts-credit-inp" data-credit-field="${field}" value="${creditInputVal(val)}" ${attrs} ${extra}>`;
  if (pooled) {
    return {
      limit: '<span class="accounts-credit-pool-shared">共享</span>',
      available: '<span class="accounts-credit-pool-shared">共享</span>',
      debt: '<span class="accounts-credit-pool-shared">共享</span>',
      billDay: inp('billDay', c.billDay, 'min="1" max="31" step="1" placeholder="—"'),
      dueDay: inp('dueDay', c.dueDay, 'min="1" max="31" step="1" placeholder="—"')
    };
  }
  return {
    limit: inp('limit', c.limit, 'min="0" step="0.01" placeholder="—"'),
    available: inp('available', c.available, 'min="0" step="0.01" placeholder="—"'),
    debt: inp('debt', c.debt, 'min="0" step="0.01" placeholder="—"'),
    billDay: inp('billDay', c.billDay, 'min="1" max="31" step="1" placeholder="—"'),
    dueDay: inp('dueDay', c.dueDay, 'min="1" max="31" step="1" placeholder="—"')
  };
}

function formatCreditBrowseAmount(v) {
  return v != null && v !== '' ? fmtMoney(v) : '—';
}

function formatCreditBrowseDay(v) {
  return v ? `${v}日` : '—';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

function dayNum(d) {
  return Math.floor(startOfDay(d).getTime() / 86400000);
}

function mkMonthDay(year, month, day) {
  const dim = new Date(year, month + 1, 0).getDate();
  return startOfDay(new Date(year, month, Math.min(day, dim)));
}

function fmtTimelineDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function dueDateForBill(billDate, dueDay) {
  const billDay = billDate.getDate();
  let due = mkMonthDay(billDate.getFullYear(), billDate.getMonth(), dueDay);
  if (dueDay <= billDay) due = mkMonthDay(billDate.getFullYear(), billDate.getMonth() + 1, dueDay);
  if (due < billDate) due = mkMonthDay(billDate.getFullYear(), billDate.getMonth() + 1, dueDay);
  return due;
}

function recentBillDate(billDay, ref = new Date()) {
  const today = startOfDay(ref);
  let bill = mkMonthDay(today.getFullYear(), today.getMonth(), billDay);
  if (today < bill) bill = mkMonthDay(today.getFullYear(), today.getMonth() - 1, billDay);
  return bill;
}

function creditInterestFreeSpan(billDay, dueDay, ref = new Date()) {
  if (!billDay || !dueDay) return null;
  const today = startOfDay(ref);
  const bill = recentBillDate(billDay, today);
  const freeStart = addDays(bill, 1);
  const thisMonthBill = mkMonthDay(today.getFullYear(), today.getMonth(), billDay);
  const nextBill = today < thisMonthBill
    ? thisMonthBill
    : mkMonthDay(bill.getFullYear(), bill.getMonth() + 1, billDay);
  const freeEnd = dueDateForBill(nextBill, dueDay);
  const currentDue = dueDateForBill(bill, dueDay);
  return {
    bill,
    currentDue,
    nextBill,
    freeStart,
    freeEnd,
    daysRemaining: Math.max(0, dayNum(freeEnd) - dayNum(today))
  };
}

function pctInRange(date, rangeStart, rangeEnd) {
  const total = dayNum(rangeEnd) - dayNum(rangeStart);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((dayNum(date) - dayNum(rangeStart)) / total) * 100));
}

function creditBillDueMarksInRange(billDay, dueDay, rangeStart, rangeEnd) {
  if (!billDay || !dueDay) return { bills: [], dues: [] };
  const rs = dayNum(rangeStart);
  const re = dayNum(rangeEnd);
  const bills = [];
  const dues = [];
  const dueSeen = new Set();

  let y = rangeStart.getFullYear();
  let m = rangeStart.getMonth() - 1;
  for (let i = 0; i < 18; i++) {
    if (m < 0) { m = 11; y--; }
    const bill = mkMonthDay(y, m, billDay);
    const due = dueDateForBill(bill, dueDay);
    const bn = dayNum(bill);
    const dn = dayNum(due);

    if (bn >= rs && bn <= re) bills.push({ date: bill });
    if (dn >= rs && dn <= re && !dueSeen.has(dn)) {
      dueSeen.add(dn);
      dues.push({ date: due });
    }

    m++;
    if (m > 11) { m = 0; y++; }
    if (bn > re + 35 && dn > re + 35) break;
  }
  return { bills, dues };
}

function renderCreditTimelineMarks(marks, rangeStart, rangeEnd, span) {
  const billHtml = marks.bills.map(b => {
    const left = pctInRange(b.date, rangeStart, rangeEnd);
    const cur = span && dayNum(b.date) === dayNum(span.bill);
    return `<span class="credit-tl-mark credit-tl-mark--bill${cur ? ' credit-tl-mark--cur' : ''}" style="left:${left.toFixed(2)}%" title="账单日 ${fmtTimelineDate(b.date)}"></span>`;
  }).join('');
  const dueHtml = marks.dues.map(d => {
    const left = pctInRange(d.date, rangeStart, rangeEnd);
    const cur = span && dayNum(d.date) === dayNum(span.freeEnd);
    return `<span class="credit-tl-mark credit-tl-mark--due${cur ? ' credit-tl-mark--cur' : ''}" style="left:${left.toFixed(2)}%" title="还款日 ${fmtTimelineDate(d.date)}"></span>`;
  }).join('');
  return billHtml + dueHtml;
}

function creditCardPriorityList(cards) {
  return cards
    .filter(acc => !acc.cancelled)
    .map(acc => {
      const { billDay, dueDay } = acc.credit || {};
      const span = creditInterestFreeSpan(billDay, dueDay);
      return {
        acc,
        span,
        daysRemaining: span?.daysRemaining ?? null,
        owner: CREDIT_CARD_GROUPS.find(g => g.id === creditCardGroupId(acc))?.name || '',
        hasSchedule: !!(billDay && dueDay)
      };
    })
    .sort((a, b) => {
      if (a.hasSchedule !== b.hasSchedule) return a.hasSchedule ? -1 : 1;
      if (a.daysRemaining == null && b.daysRemaining == null) {
        return (a.acc.displayName || '').localeCompare(b.acc.displayName || '', 'zh');
      }
      if (a.daysRemaining == null) return 1;
      if (b.daysRemaining == null) return -1;
      if (b.daysRemaining !== a.daysRemaining) return b.daysRemaining - a.daysRemaining;
      return (a.acc.displayName || '').localeCompare(b.acc.displayName || '', 'zh');
    });
}

function creditTimelinePhase(span, today) {
  const tn = dayNum(today);
  const fs = dayNum(span.freeStart);
  const fe = dayNum(span.freeEnd);
  if (tn < fs) return { phase: 'before', label: `${fs - tn} 天后开始` };
  if (tn <= fe) return { phase: 'during', label: `剩 ${span.daysRemaining} 天` };
  return { phase: 'after', label: '已过还款日' };
}

function cardInterestFreeRange(acc) {
  const { billDay, dueDay } = acc.credit || {};
  const span = creditInterestFreeSpan(billDay, dueDay);
  if (!span) return null;
  const today = startOfDay(new Date());
  const halfSpan = 18;
  return {
    start: addDays(today, -halfSpan),
    end: addDays(today, halfSpan),
    today,
    todayPct: 50,
    span,
    phase: creditTimelinePhase(span, today)
  };
}

function clipBarPct(left, width) {
  const right = left + width;
  const clippedLeft = Math.max(0, left);
  const clippedRight = Math.min(100, right);
  return {
    left: clippedLeft,
    width: Math.max(0, clippedRight - clippedLeft)
  };
}

function renderInlineCreditTimeline(acc) {
  const range = cardInterestFreeRange(acc);
  if (!range) return '<span class="accounts-credit-tl-missing">—</span>';
  const { start, end, span, phase, todayPct } = range;
  const rawLeft = pctInRange(span.freeStart, start, end);
  const rawWidth = Math.max(1.5, pctInRange(span.freeEnd, start, end) - rawLeft);
  const bar = clipBarPct(rawLeft, rawWidth);
  const marks = creditBillDueMarksInRange(acc.credit.billDay, acc.credit.dueDay, start, end);
  const markHtml = renderCreditTimelineMarks(marks, start, end, span);
  const phaseClass = phase.phase === 'during' ? ' accounts-credit-tl--during'
    : phase.phase === 'before' ? ' accounts-credit-tl--before' : ' accounts-credit-tl--after';
  const barHtml = bar.width > 0
    ? `<div class="accounts-credit-tl-bar" style="left:${bar.left.toFixed(2)}%;width:${bar.width.toFixed(2)}%">
        <span class="accounts-credit-tl-bar-fill"></span>
      </div>`
    : '';
  return `<div class="accounts-credit-tl${phaseClass}" title="免息 ${fmtTimelineDate(span.freeStart)} — ${fmtTimelineDate(span.freeEnd)}">
    <div class="accounts-credit-tl-track">
      ${barHtml}
      ${markHtml}
      <span class="accounts-credit-tl-today" style="left:${todayPct}%"></span>
    </div>
    <span class="accounts-credit-tl-days">${phase.label}</span>
  </div>`;
}

function renderCreditPriorityHtml(cards) {
  if (!cards.length) return '';
  const ranked = creditCardPriorityList(cards).filter(r => r.hasSchedule);
  if (!ranked.length) return '';

  const items = ranked.map((row, i) => {
    const name = row.acc.displayName || creditCardDisplayName(row.acc);
    const top = i === 0 ? ' accounts-credit-priority-chip--top' : '';
    return `<li class="accounts-credit-priority-chip${top}" title="还款 ${fmtTimelineDate(row.span.freeEnd)}">
      <span class="accounts-credit-priority-rank">${i + 1}</span>
      ${accountBrandMarkHtml(row.acc.pay, 20)}
      <span class="accounts-credit-priority-name">${esc(name)}</span>
      <span class="accounts-credit-priority-days">${row.daysRemaining}天</span>
    </li>`;
  }).join('');

  return `<div class="accounts-credit-priority-bar">
    <div class="accounts-credit-priority-bar-label"><i class="ti ti-list-numbers"></i> 今日优先</div>
    <ol class="accounts-credit-priority-strip">${items}</ol>
  </div>`;
}

function creditNameCell(payKey, labelVal = '', { isNew = false, tagVal = '' } = {}) {
  const logo = isNew
    ? '<span class="fund-brand-mark fund-brand-mark--fb accounts-credit-logo-ph" style="width:24px;height:24px"><i class="ti ti-credit-card" style="font-size:12px"></i></span>'
    : accountBrandMarkHtml(payKey, 24);
  if (isNew) {
    return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">
      ${logo}
      <input type="text" class="accounts-credit-label" placeholder="银行名称 *">
      <input type="text" class="accounts-credit-tag" placeholder="标签，如 VISA双币">
    </div>`;
  }
  const labelAttr = `value="${esc(labelVal)}" placeholder="银行名称"`;
  return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">${logo}<input type="text" class="accounts-credit-label" ${labelAttr}><input type="text" class="accounts-credit-tag" value="${esc(tagVal)}" placeholder="标签，如 VISA双币"></div>`;
}

function creditBrandMarkHtml(payKey, size = 24, { cancelled = false } = {}) {
  const mark = accountBrandMarkHtml(payKey, size);
  if (!cancelled) return mark;
  return `<span class="accounts-credit-logo-wrap is-cancelled">${mark}<span class="accounts-credit-cancelled-badge">销</span></span>`;
}

function creditCancelActionHtml(payKey, cancelled) {
  return cancelled
    ? `<button type="button" class="btn btn-sm accounts-credit-icon-btn accounts-credit-uncancel-btn" data-uncancel-credit="${esc(payKey)}" title="撤回注销"><i class="ti ti-arrow-back-up"></i></button>`
    : `<button type="button" class="btn btn-sm accounts-credit-icon-btn accounts-credit-cancel-btn" data-cancel-credit="${esc(payKey)}" title="标记已注销"><i class="ti ti-ban"></i></button>`;
}

function creditNameDisplayCell(acc) {
  const displayName = acc.displayName || creditCardDisplayName(acc);
  const tag = (acc.tag || '').trim();
  const tagHtml = tag ? `<span class="accounts-credit-tag-badge">${esc(tag)}</span>` : '';
  return `<div class="accounts-credit-name-cell">${creditBrandMarkHtml(acc.pay, 24, { cancelled: !!acc.cancelled })}<span class="accounts-credit-val accounts-credit-val--name">${esc(displayName)}</span>${tagHtml}</div>`;
}

function creditNameEditCell(acc) {
  const displayName = acc.displayName || creditCardDisplayName(acc);
  const tagVal = acc.tag || '';
  return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">
    ${creditBrandMarkHtml(acc.pay, 24, { cancelled: !!acc.cancelled })}
    <span class="accounts-credit-val accounts-credit-val--name">${esc(displayName)}</span>
    <input type="text" class="accounts-credit-tag" value="${esc(tagVal)}" placeholder="标签，如 VISA双币">
  </div>`;
}

function creditDigitsInput(acc, { isNew = false } = {}) {
  if (isNew) {
    return '<input type="text" class="accounts-credit-digits accounts-credit-digits--full" placeholder="完整卡号" inputmode="numeric" maxlength="23">';
  }
  const formatted = acc.digits ? formatCardDigits(acc.digits) : '';
  return `<input type="text" class="accounts-credit-digits accounts-credit-digits--full" value="${esc(formatted)}" placeholder="完整卡号" inputmode="numeric" maxlength="23">`;
}

function renderCreditCardRow(acc, { isNew = false, editing = false, pooled = false } = {}) {
  const c = acc?.credit || {};
  const last4 = acc?.last4 ? String(acc.last4).padStart(4, '0') : '';
  const bindTd = editing && !isNew
    ? `<td class="accounts-credit-bind-td"><input type="checkbox" class="accounts-credit-bind-cb" title="选择绑定"></td>`
    : editing ? '<td class="accounts-credit-bind-td"></td>' : '';

  if (!editing && !isNew) {
    const cancelled = !!acc.cancelled;
    const limitCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.limit);
    const availCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.available);
    const debtCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.debt);
    const rowCls = [
      pooled ? 'accounts-credit-pool-card' : '',
      cancelled ? 'is-cancelled' : ''
    ].filter(Boolean).join(' ');
    return `<tr data-credit-key="${esc(acc.pay)}"${rowCls ? ` class="${rowCls}"` : ''}>
      <td>${creditNameDisplayCell(acc)}</td>
      <td><span class="accounts-credit-val">${esc(last4 || '—')}</span></td>
      <td><span class="accounts-credit-val">${limitCell}</span></td>
      <td><span class="accounts-credit-val">${availCell}</span></td>
      <td><span class="accounts-credit-val">${debtCell}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.billDay)}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.dueDay)}</span></td>
      <td class="accounts-credit-tl-td">${renderInlineCreditTimeline(acc)}</td>
    </tr>`;
  }

  const fields = creditFieldInputs(c, '', { pooled });
  if (isNew) {
    return `<tr data-credit-new="1">
      ${bindTd}
      <td class="accounts-credit-td-account">${creditNameCell('', '', { isNew: true })}</td>
      <td class="accounts-credit-td-cardno">${creditDigitsInput(null, { isNew: true })}</td>
      <td class="accounts-credit-td-amt">${fields.limit}</td>
      <td class="accounts-credit-td-amt">${fields.available}</td>
      <td class="accounts-credit-td-amt">${fields.debt}</td>
      <td class="accounts-credit-td-day">${fields.billDay}</td>
      <td class="accounts-credit-td-day">${fields.dueDay}</td>
      <td class="accounts-credit-td-actions"><div class="accounts-credit-actions">
        <button type="button" class="btn btn-sm" data-cancel-credit-new title="取消"><i class="ti ti-x"></i></button>
        <button type="button" class="btn btn-sm btn-p" data-save-credit-new title="保存"><i class="ti ti-check"></i></button>
      </div></td>
    </tr>`;
  }

  const unbindBtn = pooled
    ? `<button type="button" class="btn btn-sm accounts-credit-icon-btn" data-unbind-credit="${esc(acc.pay)}" title="移出共享额度"><i class="ti ti-unlink"></i></button>`
    : '';
  const cancelBtn = creditCancelActionHtml(acc.pay, !!acc.cancelled);
  const rowCls = [
    pooled ? 'accounts-credit-pool-card' : '',
    acc.cancelled ? 'is-cancelled' : ''
  ].filter(Boolean).join(' ');
  return `<tr data-credit-key="${esc(acc.pay)}"${rowCls ? ` class="${rowCls}"` : ''}>
    ${bindTd}
    <td class="accounts-credit-td-account">${creditNameEditCell(acc)}</td>
    <td class="accounts-credit-td-cardno">${creditDigitsInput(acc)}</td>
    <td class="accounts-credit-td-amt">${fields.limit}</td>
    <td class="accounts-credit-td-amt">${fields.available}</td>
    <td class="accounts-credit-td-amt">${fields.debt}</td>
    <td class="accounts-credit-td-day">${fields.billDay}</td>
    <td class="accounts-credit-td-day">${fields.dueDay}</td>
    <td class="accounts-credit-td-actions"><div class="accounts-credit-actions">
      ${cancelBtn}
      ${unbindBtn}
      <button type="button" class="btn btn-sm btn-a accounts-credit-icon-btn" data-delete-credit="${esc(acc.pay)}" title="删除"><i class="ti ti-trash"></i></button>
    </div></td>
  </tr>`;
}

function sumCreditGroupTotals(cards) {
  let limit = 0;
  let available = 0;
  let debt = 0;
  let hasLimit = false;
  let hasAvailable = false;
  let hasDebt = false;
  organizeGroupCards(cards).forEach(block => {
    if (block.type === 'pool') {
      const c = block.pool || {};
      if (c.limit != null && c.limit !== '') {
        limit += Number(c.limit) || 0;
        hasLimit = true;
      }
      if (c.available != null && c.available !== '') {
        available += Number(c.available) || 0;
        hasAvailable = true;
      }
      if (c.debt != null && c.debt !== '') {
        debt += Number(c.debt) || 0;
        hasDebt = true;
      }
      return;
    }
    block.cards.forEach(acc => {
      const c = acc.credit || {};
      if (c.limit != null && c.limit !== '') {
        limit += Number(c.limit) || 0;
        hasLimit = true;
      }
      if (c.available != null && c.available !== '') {
        available += Number(c.available) || 0;
        hasAvailable = true;
      }
      if (c.debt != null && c.debt !== '') {
        debt += Number(c.debt) || 0;
        hasDebt = true;
      }
    });
  });
  return {
    limit: hasLimit ? limit : null,
    available: hasAvailable ? available : null,
    debt: hasDebt ? debt : null
  };
}

function renderCreditGroupSummaryRow(group, editing) {
  const totals = sumCreditGroupTotals(group.cards);
  const bindTd = editing ? '<td class="accounts-credit-bind-td"></td>' : '';
  const actionTd = editing ? '<td class="accounts-credit-td-actions"></td>' : '';
  return `<tr class="accounts-credit-sum-row">
    ${bindTd}
    <td colspan="2"><span class="accounts-credit-sum-label">合计</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.limit)}</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.available)}</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.debt)}</span></td>
    ${editing ? '<td colspan="2"></td>' : '<td colspan="3"></td>'}
    ${actionTd}
  </tr>`;
}

function renderCreditPoolAmountCells(pool, rowSpan, editing) {
  const c = { limit: pool.limit, available: pool.available, debt: pool.debt };
  if (editing) {
    const fields = creditFieldInputs(c);
    return `<td rowspan="${rowSpan}" class="accounts-credit-pool-amt accounts-credit-td-amt">${fields.limit}</td>
      <td rowspan="${rowSpan}" class="accounts-credit-pool-amt accounts-credit-td-amt">${fields.available}</td>
      <td rowspan="${rowSpan}" class="accounts-credit-pool-amt accounts-credit-td-amt">${fields.debt}</td>`;
  }
  return `<td rowspan="${rowSpan}" class="accounts-credit-pool-amt"><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.limit)}</span></td>
    <td rowspan="${rowSpan}" class="accounts-credit-pool-amt"><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.available)}</span></td>
    <td rowspan="${rowSpan}" class="accounts-credit-pool-amt"><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.debt)}</span></td>`;
}

function renderCreditPoolAccountTd(acc, pool, editing, isFirst) {
  const sharedIc = '<i class="ti ti-link accounts-credit-pool-shared-ic" title="共享额度"></i>';
  const poolNameInp = editing && isFirst
    ? `<input type="hidden" class="accounts-credit-pool-name" value="${esc(pool.name)}">`
    : '';
  const nameCell = editing ? creditNameEditCell(acc) : creditNameDisplayCell(acc);
  return `<td class="accounts-credit-td-account"><div class="accounts-credit-pool-name-wrap">${nameCell}${sharedIc}${poolNameInp}</div></td>`;
}

function renderCreditPoolViewRows(pool, cards) {
  const n = cards.length;
  return cards.map((acc, i) => {
    const c = acc.credit || {};
    const last4 = acc.last4 ? String(acc.last4).padStart(4, '0') : '';
    const amtCells = i === 0 ? renderCreditPoolAmountCells(pool, n, false) : '';
    const cancelled = !!acc.cancelled;
    const rowCls = [
      'accounts-credit-pool-card',
      i === 0 ? 'accounts-credit-pool-card--first' : '',
      cancelled ? 'is-cancelled' : ''
    ].filter(Boolean).join(' ');
    return `<tr data-credit-key="${esc(acc.pay)}" class="${rowCls}" data-credit-pool="${esc(pool.id)}">
      ${renderCreditPoolAccountTd(acc, pool, false, i === 0)}
      <td><span class="accounts-credit-val">${esc(last4 || '—')}</span></td>
      ${amtCells}
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.billDay)}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.dueDay)}</span></td>
      <td class="accounts-credit-tl-td">${renderInlineCreditTimeline(acc)}</td>
    </tr>`;
  }).join('');
}

function renderCreditPoolEditRows(pool, cards) {
  const n = cards.length;
  return cards.map((acc, i) => {
    const fields = creditFieldInputs(acc.credit || {}, '', { pooled: true });
    const bindTd = `<td class="accounts-credit-bind-td"><input type="checkbox" class="accounts-credit-bind-cb" title="选择绑定"></td>`;
    const amtCells = i === 0 ? renderCreditPoolAmountCells(pool, n, true) : '';
    const isLast = i === n - 1;
    const dissolveBtn = isLast
      ? `<button type="button" class="btn btn-sm accounts-credit-icon-btn" data-dissolve-pool="${esc(pool.id)}" title="解散额度池"><i class="ti ti-unlink"></i></button>`
      : '';
    const unbindBtn = `<button type="button" class="btn btn-sm accounts-credit-icon-btn" data-unbind-credit="${esc(acc.pay)}" title="移出共享额度"><i class="ti ti-unlink"></i></button>`;
    const cancelBtn = creditCancelActionHtml(acc.pay, !!acc.cancelled);
    const rowCls = [
      'accounts-credit-pool-card',
      i === 0 ? 'accounts-credit-pool-card--first' : '',
      acc.cancelled ? 'is-cancelled' : ''
    ].filter(Boolean).join(' ');
    return `<tr data-credit-key="${esc(acc.pay)}" class="${rowCls}" data-credit-pool="${esc(pool.id)}">
      ${bindTd}
      ${renderCreditPoolAccountTd(acc, pool, true, i === 0)}
      <td class="accounts-credit-td-cardno">${creditDigitsInput(acc)}</td>
      ${amtCells}
      <td class="accounts-credit-td-day">${fields.billDay}</td>
      <td class="accounts-credit-td-day">${fields.dueDay}</td>
      <td class="accounts-credit-td-actions"><div class="accounts-credit-actions">
        ${cancelBtn}
        ${unbindBtn}
        ${dissolveBtn}
        <button type="button" class="btn btn-sm btn-a accounts-credit-icon-btn" data-delete-credit="${esc(acc.pay)}" title="删除"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderCreditPoolBlock(pool, cards, editing) {
  if (cards.length < 2) {
    return cards.map(c => renderCreditCardRow(c, { editing, pooled: false })).join('');
  }
  return editing ? renderCreditPoolEditRows(pool, cards) : renderCreditPoolViewRows(pool, cards);
}

function renderCreditCardGroupTableBody(group, editing) {
  const blocks = organizeGroupCards(group.cards);
  const colSpan = editing ? 10 : 8;
  if (!blocks.length) {
    return `<tr><td colspan="${colSpan}" class="accounts-credit-group-empty">暂无卡片</td></tr>`;
  }
  return blocks.map(block => {
    if (block.type === 'pool') {
      return renderCreditPoolBlock(block.pool, block.cards, editing);
    }
    return block.cards.map(c => renderCreditCardRow(c, { editing, pooled: false })).join('');
  }).join('');
}

function renderCreditCardGroupTable(group, editing) {
  const bindTh = editing ? '<th class="accounts-credit-bind-th" title="选择绑定"></th>' : '';
  const actionTh = editing ? '<th class="accounts-credit-th-actions">操作</th>' : '';
  const addBtn = editing
    ? `<button type="button" class="btn btn-sm btn-p" onclick="addCreditCardRow('${group.id}')"><i class="ti ti-plus"></i> 新增</button>`
    : '';
  const bindBtn = editing
    ? `<button type="button" class="btn btn-sm" data-bind-credit-group="${group.id}" title="将选中的卡绑定为共享额度"><i class="ti ti-link"></i> 绑定共享额度</button>`
    : '';
  const tlTh = editing ? '' : '<th class="accounts-credit-col-tl">免息期</th>';
  const colgroup = editing
    ? `<colgroup>
        <col class="accounts-credit-col-bind">
        <col class="accounts-credit-col-name">
        <col class="accounts-credit-col-cardno">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-actions">
      </colgroup>`
    : `<colgroup>
        <col class="accounts-credit-col-name">
        <col class="accounts-credit-col-tail">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-tl">
      </colgroup>`;
  const body = group.cards.length
    ? `${renderCreditCardGroupTableBody(group, editing)}${renderCreditGroupSummaryRow(group, editing)}`
    : (() => {
        const colSpan = editing ? 10 : 8;
        return `<tr><td colspan="${colSpan}" class="accounts-credit-group-empty">暂无卡片</td></tr>`;
      })();
  const digitTh = editing ? '<th class="accounts-credit-th-cardno">卡号</th>' : '<th class="accounts-credit-th-tail">尾号</th>';
  return `<section class="accounts-credit-group" data-credit-group="${group.id}">
    <div class="accounts-credit-group-head">
      <h4 class="accounts-credit-group-title">${esc(group.name)} <span class="accounts-credit-group-cnt">${group.cards.length} 张</span></h4>
      <div class="accounts-credit-group-actions">${bindBtn}${addBtn}</div>
    </div>
    <div class="accounts-credit-table-wrap">
      <table class="report-table accounts-credit-table${editing ? ' is-editing' : ' is-viewing'}">
        ${colgroup}
        <thead><tr>
          ${bindTh}<th class="accounts-credit-th-account">账户</th>${digitTh}<th class="accounts-credit-th-amt">额度</th><th class="accounts-credit-th-amt">可用</th><th class="accounts-credit-th-amt">欠款</th><th class="accounts-credit-th-day">账单日</th><th class="accounts-credit-th-day">还款日</th>${tlTh}${actionTh}
        </tr></thead>
        <tbody id="accountsCreditTbody-${group.id}">${body}</tbody>
      </table>
    </div>
  </section>`;
}

function renderCreditCardSection() {
  const el = document.getElementById('accountsCreditSection');
  if (!el) return;
  const cards = creditCardAccounts();
  const groups = groupCreditCardAccounts(cards);
  const editing = creditCardEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const priorityHtml = renderCreditPriorityHtml(cards);
  el.innerHTML = `<div class="cc full accounts-credit-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-credit-head">
      <div class="accounts-credit-head-top">
        <div class="ct"><i class="ti ti-credit-card"></i> 信用卡管理 <span class="accounts-credit-cnt">${cards.length} 张</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleCreditCardEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
      ${priorityHtml ? `<div class="accounts-credit-priority-wrap">${priorityHtml}</div>` : ''}
    </div>
    <div class="accounts-credit-groups">${groups.map(g => renderCreditCardGroupTable(g, editing)).join('')}</div>
    ${cards.length ? '' : `<div class="accounts-credit-empty">暂无信用卡${editing ? '，可在各分组下新增卡片' : ''}，或在账户管理中将账户设为信用卡。</div>`}
  </div>`;
}

export function toggleCreditCardEditMode() {
  creditCardEditMode = !creditCardEditMode;
  renderCreditCardSection();
}

function parseCashMoneyInput(v) {
  const s = String(v ?? '').replace(/[,，\s¥￥]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function cashAccountsList() {
  return Array.isArray(accountRegistry.cashAccounts) ? accountRegistry.cashAccounts : [];
}

function sumCashField(field) {
  return cashAccountsList().reduce((s, a) => s + (Number(a[field]) || 0), 0);
}

function sumCashBalance() {
  return sumCashField('balance');
}

function sumAllCreditDebt() {
  const totals = sumCreditGroupTotals(creditCardAccounts());
  return totals.debt != null ? totals.debt : 0;
}

function renderAccountsStatusSection() {
  const el = document.getElementById('accountsStatusSection');
  if (!el) return;
  const cashBalance = sumCashBalance();
  const creditDebt = sumAllCreditDebt();
  const budgetTotal = sumBudgetAmount();
  const net = cashBalance - creditDebt;
  const netCls = net >= 0 ? 'accounts-status-item--net-pos' : 'accounts-status-item--net-neg';
  el.innerHTML = `<div class="accounts-status-bar">
    <div class="accounts-status-item accounts-status-item--budget">
      <span class="accounts-status-label"><i class="ti ti-calendar-event"></i> 预算支出</span>
      <span class="accounts-status-val">${fmtMoney(budgetTotal)}</span>
    </div>
    <div class="accounts-status-item accounts-status-item--cash">
      <span class="accounts-status-label"><i class="ti ti-wallet"></i> 余额</span>
      <span class="accounts-status-val">${fmtMoney(cashBalance)}</span>
    </div>
    <div class="accounts-status-item accounts-status-item--debt">
      <span class="accounts-status-label"><i class="ti ti-credit-card"></i> 欠款</span>
      <span class="accounts-status-val">${fmtMoney(creditDebt)}</span>
    </div>
    <div class="accounts-status-item ${netCls}">
      <span class="accounts-status-label"><i class="ti ti-scale"></i> 差值</span>
      <span class="accounts-status-val">${fmtMoneySigned(net)}</span>
    </div>
  </div>`;
}

function cashAccountBrandMarkHtml(name, size = 22) {
  const brand = matchBankBrand(name || '');
  const logoUrl = brand?.logoUrl || null;
  if (logoUrl) {
    return `<img class="fund-brand-logo" src="${esc(logoUrl)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.display='none'">`;
  }
  const corp = brand && CORP_MARKS[brand.logoType || brand.code];
  if (corp) {
    const iconSize = Math.max(11, Math.round(size * 0.5));
    return `<span class="fund-brand-mark" style="width:${size}px;height:${size}px;background:${corp.bg}"><i class="ti ${corp.icon}" style="font-size:${iconSize}px"></i></span>`;
  }
  const letter = (name || '?').trim()[0] || '?';
  const bg = brand?.colors?.[0];
  const style = bg
    ? `width:${size}px;height:${size}px;background:${bg};color:#fff`
    : `width:${size}px;height:${size}px`;
  return `<span class="fund-brand-mark fund-brand-mark--fb" style="${style}">${esc(letter)}</span>`;
}

function cashAccountNameCell(acc, editing) {
  const logo = cashAccountBrandMarkHtml(acc.name, 22);
  if (editing) {
    return `<div class="accounts-cash-name-cell">${logo}<input type="text" class="accounts-cash-inp accounts-cash-name" value="${esc(acc.name)}" placeholder="账户名称"></div>`;
  }
  return `<div class="accounts-cash-name-cell">${logo}<span class="accounts-cash-val accounts-cash-val--name">${esc(acc.name)}</span></div>`;
}

function renderCashAccountCard(acc, editing) {
  if (editing) {
    return `<section class="accounts-cash-item is-editing" data-cash-id="${esc(acc.id)}">
      <div class="accounts-cash-item-row">
        ${cashAccountNameCell(acc, true)}
        <input type="text" class="accounts-cash-inp accounts-cash-amt" inputmode="decimal" value="${creditInputVal(acc.balance)}" placeholder="0.00">
        <button type="button" class="btn btn-sm btn-a accounts-cash-del" data-delete-cash="${esc(acc.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </div>
    </section>`;
  }
  return `<section class="accounts-cash-item" data-cash-id="${esc(acc.id)}">
    <div class="accounts-cash-item-row">
      ${cashAccountNameCell(acc, false)}
      <span class="accounts-cash-val accounts-cash-val--bal">${fmtMoney(acc.balance)}</span>
    </div>
  </section>`;
}

function renderCashAccountsSection() {
  const el = document.getElementById('accountsCashSection');
  if (!el) return;
  const accounts = cashAccountsList();
  const editing = cashAccountEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const cards = accounts.map(acc => renderCashAccountCard(acc, editing)).join('');
  const sumItem = accounts.length
    ? `<div class="accounts-cash-sum-item" aria-label="合计">
        <div class="accounts-cash-item-row">
          <span class="accounts-cash-sum-label">合计</span>
          <span class="accounts-cash-val accounts-cash-val--sum">${fmtMoney(sumCashBalance())}</span>
        </div>
      </div>`
    : '';
  const addRow = editing
    ? `<div class="accounts-cash-foot"><button type="button" class="btn btn-sm" onclick="addCashAccountRow()"><i class="ti ti-plus"></i> 新增账户</button></div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-cash-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-cash-head">
      <div class="accounts-cash-head-top">
        <div class="ct"><i class="ti ti-wallet"></i> 现金账户登记 <span class="accounts-credit-cnt">${accounts.length} 个</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleCashAccountEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
    </div>
    <div class="accounts-cash-grid-wrap">
      <div class="accounts-cash-grid${editing ? ' is-editing' : ''}">
        ${cards}
        ${sumItem}
      </div>
    </div>
    ${accounts.length ? '' : `<div class="accounts-credit-empty">暂无现金账户${editing ? '，可点击下方新增' : ''}。</div>`}
    ${addRow}
  </div>`;
}

export function toggleCashAccountEditMode() {
  cashAccountEditMode = !cashAccountEditMode;
  renderCashAccountsSection();
}

function saveCashAccountRow(row) {
  const id = row?.dataset?.cashId;
  if (!id) return;
  const acc = accountRegistry.cashAccounts.find(a => a.id === id);
  if (!acc) return;
  const name = row.querySelector('.accounts-cash-name')?.value?.trim();
  if (!name) {
    alert('请填写账户名称');
    row.querySelector('.accounts-cash-name')?.focus();
    return;
  }
  const inputs = row.querySelectorAll('.accounts-cash-amt');
  acc.name = name;
  acc.balance = parseCashMoneyInput(inputs[0]?.value);
  flushAccountPersist();
  renderAccountsPage();
}

export function addCashAccountRow() {
  if (!cashAccountEditMode) cashAccountEditMode = true;
  if (!Array.isArray(accountRegistry.cashAccounts)) accountRegistry.cashAccounts = [];
  accountRegistry.cashAccounts.push({
    id: nextCashAccountId(),
    name: '',
    balance: 0,
    initial: 0
  });
  renderCashAccountsSection();
  const items = document.querySelectorAll('#accountsCashSection [data-cash-id]');
  const last = items?.length ? items[items.length - 1] : null;
  last?.querySelector('.accounts-cash-name')?.focus();
}

export function deleteCashAccount(id) {
  if (!id) return;
  const acc = accountRegistry.cashAccounts.find(a => a.id === id);
  if (!acc) return;
  if (!confirm(`确定删除现金账户「${acc.name || '未命名'}」？`)) return;
  accountRegistry.cashAccounts = accountRegistry.cashAccounts.filter(a => a.id !== id);
  flushAccountPersist();
  renderAccountsPage();
}

function nextBudgetId() {
  return `budget-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeBudgetDateIso(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ymd = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${pad2(ymd[2])}-${pad2(ymd[3])}`;
  const cnFull = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnFull) return `${cnFull[1]}-${pad2(cnFull[2])}-${pad2(cnFull[3])}`;
  const cn = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cn) {
    const y = new Date().getFullYear();
    return `${y}-${pad2(cn[1])}-${pad2(cn[2])}`;
  }
  const md = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (md) {
    const y = new Date().getFullYear();
    return `${y}-${pad2(md[1])}-${pad2(md[2])}`;
  }
  return '';
}

function formatBudgetDateLabel(iso) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y === new Date().getFullYear()) return `${mo}月${d}日`;
  return `${y}年${mo}月${d}日`;
}

function reminderRemainingInfo(expiryIso) {
  const iso = normalizeBudgetDateIso(expiryIso);
  if (!iso) return { label: '—', status: 'unknown' };
  const [y, m, d] = iso.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(y, m - 1, d);
  const totalDays = Math.round((exp - today) / 86400000);

  if (totalDays < 0) {
    return { label: `已过期 ${Math.abs(totalDays)} 天`, status: 'expired' };
  }
  if (totalDays === 0) return { label: '今天到期', status: 'urgent' };
  if (totalDays === 1) return { label: '明天到期', status: 'urgent' };
  if (totalDays <= 30) return { label: `还剩 ${totalDays} 天`, status: 'urgent' };
  if (totalDays <= 90) return { label: `还剩 ${totalDays} 天`, status: 'soon' };

  let years = exp.getFullYear() - today.getFullYear();
  let months = exp.getMonth() - today.getMonth();
  let days = exp.getDate() - today.getDate();
  if (days < 0) {
    months--;
    days += new Date(exp.getFullYear(), exp.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }

  const parts = [];
  if (years > 0) parts.push(`${years} 年`);
  if (months > 0) parts.push(`${months} 个月`);
  if (!parts.length) parts.push(`${totalDays} 天`);
  else if (years === 0 && days > 0) parts.push(`${days} 天`);

  return { label: `还剩 ${parts.join('')}`, status: 'ok' };
}

function sortedLongReminders() {
  return [...longRemindersList()].sort((a, b) => {
    const da = normalizeBudgetDateIso(a.expiry) || '9999-99-99';
    const db = normalizeBudgetDateIso(b.expiry) || '9999-99-99';
    return da.localeCompare(db) || a.name.localeCompare(b.name, 'zh-CN');
  });
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function expenseBudgetsList() {
  return Array.isArray(accountRegistry.expenseBudgets) ? accountRegistry.expenseBudgets : [];
}

function budgetSortKey(dateStr) {
  const iso = normalizeBudgetDateIso(dateStr);
  return iso || '9999-99-99';
}

function sortedExpenseBudgets() {
  return [...expenseBudgetsList()].sort((a, b) =>
    budgetSortKey(a.date).localeCompare(budgetSortKey(b.date)) || a.name.localeCompare(b.name, 'zh-CN')
  );
}

function sumBudgetAmount() {
  return expenseBudgetsList().reduce((s, b) => s + (Number(b.amount) || 0), 0);
}

function renderBudgetRow(item, editing) {
  if (editing) {
    return `<tr data-budget-id="${esc(item.id)}">
      <td><input type="text" class="accounts-budget-inp accounts-budget-name" value="${esc(item.name)}" placeholder="项目名称"></td>
      <td><input type="date" class="accounts-budget-inp accounts-budget-date" value="${esc(item.date || '')}"></td>
      <td><input type="text" class="accounts-budget-inp accounts-budget-amt" inputmode="decimal" value="${creditInputVal(item.amount)}" placeholder="0.00"></td>
      <td class="accounts-budget-actions">
        <button type="button" class="btn btn-sm btn-a" data-delete-budget="${esc(item.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }
  return `<tr data-budget-id="${esc(item.id)}">
    <td><span class="accounts-budget-val accounts-budget-val--name">${esc(item.name)}</span></td>
    <td><span class="accounts-budget-val">${formatBudgetDateLabel(item.date)}</span></td>
    <td><span class="accounts-budget-val accounts-budget-val--amt">${fmtMoney(item.amount)}</span></td>
    <td></td>
  </tr>`;
}

function renderExpenseBudgetsSection() {
  const el = document.getElementById('accountsBudgetSection');
  if (!el) return;
  const items = sortedExpenseBudgets();
  const editing = budgetEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const actionTh = '<th class="accounts-budget-col-actions"></th>';
  const body = items.map(item => renderBudgetRow(item, editing)).join('');
  const sumRow = items.length
    ? `<tr class="accounts-budget-sum-row">
      <td colspan="2"><span class="accounts-budget-sum-label">合计</span></td>
      <td><span class="accounts-budget-val accounts-budget-val--sum">${fmtMoney(sumBudgetAmount())}</span></td>
      <td></td>
    </tr>`
    : '';
  const addRow = editing
    ? `<div class="accounts-budget-foot"><button type="button" class="btn btn-sm" onclick="addBudgetRow()"><i class="ti ti-plus"></i> 新增预算</button></div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-budget-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-budget-head">
      <div class="accounts-budget-head-top">
        <div class="ct"><i class="ti ti-calendar-event"></i> 支出预算 <span class="accounts-credit-cnt">${items.length} 项</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleBudgetEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
    </div>
    <div class="accounts-budget-table-wrap">
      <table class="report-table accounts-budget-table${editing ? ' is-editing' : ' is-viewing'}">
        <colgroup>
          <col class="accounts-budget-col-name">
          <col class="accounts-budget-col-date">
          <col class="accounts-budget-col-amt">
          <col class="accounts-budget-col-actions">
        </colgroup>
        <thead><tr><th>项目名称</th><th>日期</th><th>金额</th>${actionTh}</tr></thead>
        <tbody>${body}${sumRow}</tbody>
      </table>
    </div>
    ${items.length ? '' : `<div class="accounts-credit-empty">暂无支出预算${editing ? '，可点击下方新增' : ''}。</div>`}
    ${addRow}
  </div>`;
}

export function toggleBudgetEditMode() {
  budgetEditMode = !budgetEditMode;
  renderAccountsPage();
}

function saveBudgetRow(row) {
  const id = row?.dataset?.budgetId;
  if (!id) return;
  const item = accountRegistry.expenseBudgets.find(b => b.id === id);
  if (!item) return;
  const name = row.querySelector('.accounts-budget-name')?.value?.trim();
  const date = row.querySelector('.accounts-budget-date')?.value?.trim();
  if (!name) {
    alert('请填写项目名称');
    row.querySelector('.accounts-budget-name')?.focus();
    return;
  }
  if (!date) {
    alert('请填写日期');
    row.querySelector('.accounts-budget-date')?.focus();
    return;
  }
  item.name = name;
  item.date = date;
  item.amount = parseCashMoneyInput(row.querySelector('.accounts-budget-amt')?.value);
  flushAccountPersist();
  renderAccountsPage();
}

export function addBudgetRow() {
  if (!budgetEditMode) budgetEditMode = true;
  if (!Array.isArray(accountRegistry.expenseBudgets)) accountRegistry.expenseBudgets = [];
  accountRegistry.expenseBudgets.push({
    id: nextBudgetId(),
    name: '',
    date: todayIsoDate(),
    amount: 0
  });
  renderExpenseBudgetsSection();
  const tbody = document.querySelector('#accountsBudgetSection tbody');
  const lastRow = tbody?.querySelector('tr[data-budget-id]:last-of-type');
  lastRow?.querySelector('.accounts-budget-name')?.focus();
}

export function deleteBudget(id) {
  if (!id) return;
  const item = accountRegistry.expenseBudgets.find(b => b.id === id);
  if (!item) return;
  if (!confirm(`确定删除预算「${item.name || '未命名'}」？`)) return;
  accountRegistry.expenseBudgets = accountRegistry.expenseBudgets.filter(b => b.id !== id);
  flushAccountPersist();
  renderAccountsPage();
}

function lifeAccountIconHtml(name) {
  const label = String(name || '').trim();
  const icon = /电/.test(label) ? 'ti-bolt'
    : /水|燃气|气/.test(label) ? 'ti-droplet'
    : /物业|房租|租/.test(label) ? 'ti-building'
    : /网|宽带/.test(label) ? 'ti-wifi'
    : 'ti-home-2';
  return `<span class="accounts-life-icon"><i class="ti ${icon}"></i></span>`;
}

function renderLifeAccountRow(item, editing) {
  if (editing) {
    return `<tr data-life-id="${esc(item.id)}">
      <td><div class="accounts-life-name-cell">${lifeAccountIconHtml(item.name)}<input type="text" class="accounts-life-inp accounts-life-name" value="${esc(item.name)}" placeholder="如：旌湖上境电费"></div></td>
      <td><input type="text" class="accounts-life-inp accounts-life-account" value="${esc(item.accountNo)}" placeholder="账号 / 户号" inputmode="numeric" autocomplete="off"></td>
      <td class="accounts-life-actions">
        <button type="button" class="btn btn-sm btn-a" data-delete-life="${esc(item.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }
  return `<tr data-life-id="${esc(item.id)}">
    <td><div class="accounts-life-name-cell">${lifeAccountIconHtml(item.name)}<span class="accounts-life-val accounts-life-val--name">${esc(item.name)}</span></div></td>
    <td><span class="accounts-life-val accounts-life-val--account">${item.accountNo ? esc(item.accountNo) : '—'}</span></td>
  </tr>`;
}

function renderLifeAccountsSection() {
  const el = document.getElementById('accountsLifeSection');
  if (!el) return;
  ensureLifeAccounts();
  const items = lifeAccountsList();
  const editing = lifeAccountEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const actionCol = editing
    ? `<col class="accounts-life-col-actions">`
    : '';
  const actionTh = editing ? '<th class="accounts-life-col-actions"></th>' : '';
  const body = items.map(item => renderLifeAccountRow(item, editing)).join('');
  const addRow = editing
    ? `<div class="accounts-life-foot"><button type="button" class="btn btn-sm" onclick="addLifeAccountRow()"><i class="ti ti-plus"></i> 新增生活账户</button></div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-life-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-life-head">
      <div class="accounts-life-head-top">
        <div class="ct"><i class="ti ti-home-2"></i> 生活账户 <span class="accounts-credit-cnt">${items.length} 项</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleLifeAccountEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
    </div>
    <div class="accounts-life-table-wrap">
      <table class="report-table accounts-life-table${editing ? ' is-editing' : ' is-viewing'}">
        <colgroup>
          <col class="accounts-life-col-name">
          <col class="accounts-life-col-account">
          ${actionCol}
        </colgroup>
        <thead><tr><th>名称</th><th>账号</th>${actionTh}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${items.length ? '' : `<div class="accounts-credit-empty">暂无生活账户${editing ? '，可点击下方新增（如电费、水费户号）' : ''}。</div>`}
    ${addRow}
  </div>`;
}

export function toggleLifeAccountEditMode() {
  lifeAccountEditMode = !lifeAccountEditMode;
  renderAccountsPage();
}

function saveLifeAccountRow(row) {
  const id = row?.dataset?.lifeId;
  if (!id) return;
  ensureLifeAccounts();
  const item = accountRegistry.lifeAccounts.find(a => a.id === id);
  if (!item) return;
  const name = row.querySelector('.accounts-life-name')?.value?.trim();
  const accountNo = row.querySelector('.accounts-life-account')?.value?.trim() || '';
  if (!name) {
    alert('请填写名称');
    row.querySelector('.accounts-life-name')?.focus();
    return;
  }
  item.name = name;
  item.accountNo = accountNo;
  flushAccountPersist();
  renderLifeAccountsSection();
}

export function addLifeAccountRow() {
  if (!lifeAccountEditMode) lifeAccountEditMode = true;
  ensureLifeAccounts();
  accountRegistry.lifeAccounts.push({
    id: nextLifeAccountId(),
    name: '',
    accountNo: ''
  });
  renderLifeAccountsSection();
  const rows = document.querySelectorAll('#accountsLifeSection tr[data-life-id]');
  rows[rows.length - 1]?.querySelector('.accounts-life-name')?.focus();
}

export function deleteLifeAccount(id) {
  if (!id) return;
  ensureLifeAccounts();
  const item = accountRegistry.lifeAccounts.find(a => a.id === id);
  if (!item) return;
  if (!confirm(`确定删除生活账户「${item.name || '未命名'}」？`)) return;
  accountRegistry.lifeAccounts = accountRegistry.lifeAccounts.filter(a => a.id !== id);
  flushAccountPersist();
  renderAccountsPage();
}

function reminderCalendarBtnHtml(id, compact = false) {
  const cls = compact ? 'btn btn-sm home-reminder-cal-btn' : 'btn btn-sm accounts-reminder-cal-btn';
  const title = calendarExportHint();
  return `<button type="button" class="${cls}" onclick="addLongReminderToCalendar('${esc(id)}')" title="${esc(title)}" aria-label="加入日历"><i class="ti ti-calendar-plus"></i></button>`;
}

function renderLongReminderRow(item, editing) {
  const remaining = reminderRemainingInfo(item.expiry);
  if (editing) {
    return `<tr data-reminder-id="${esc(item.id)}">
      <td><input type="text" class="accounts-reminder-inp accounts-reminder-name" value="${esc(item.name)}" placeholder="如：W-8 表格"></td>
      <td><input type="date" class="accounts-reminder-inp accounts-reminder-expiry" value="${esc(item.expiry || '')}"></td>
      <td class="accounts-reminder-actions">
        <button type="button" class="btn btn-sm btn-a" data-delete-reminder="${esc(item.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }
  return `<tr data-reminder-id="${esc(item.id)}">
    <td><span class="accounts-reminder-val accounts-reminder-val--name">${esc(item.name)}</span></td>
    <td><span class="accounts-reminder-val accounts-reminder-val--expiry">${formatBudgetDateLabel(item.expiry)}</span></td>
    <td><span class="accounts-reminder-val accounts-reminder-val--remaining is-${remaining.status}">${esc(remaining.label)}</span></td>
    <td class="accounts-reminder-cal-cell">${reminderCalendarBtnHtml(item.id)}</td>
  </tr>`;
}

function renderLongRemindersSection() {
  const el = document.getElementById('accountsReminderSection');
  if (!el) return;
  ensureLongReminders();
  const items = sortedLongReminders();
  const editing = longReminderEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const actionCol = editing ? '<col class="accounts-reminder-col-actions">' : '';
  const actionTh = editing ? '<th class="accounts-reminder-col-actions"></th>' : '';
  const remainTh = editing ? '' : '<th>剩余时间</th>';
  const calCol = editing ? '' : '<col class="accounts-reminder-col-cal">';
  const calTh = editing ? '' : '<th class="accounts-reminder-col-cal"></th>';
  const body = items.map(item => renderLongReminderRow(item, editing)).join('');
  const addRow = editing
    ? `<div class="accounts-reminder-foot"><button type="button" class="btn btn-sm" onclick="addLongReminderRow()"><i class="ti ti-plus"></i> 新增长期提醒</button></div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-reminder-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-reminder-head">
      <div class="accounts-reminder-head-top">
        <div class="ct"><i class="ti ti-bell-ringing"></i> 长期提醒 <span class="accounts-credit-cnt">${items.length} 项</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleLongReminderEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
    </div>
    <div class="accounts-reminder-table-wrap">
      <table class="report-table accounts-reminder-table${editing ? ' is-editing' : ' is-viewing'}">
        <colgroup>
          <col class="accounts-reminder-col-name">
          <col class="accounts-reminder-col-expiry">
          ${editing ? actionCol : '<col class="accounts-reminder-col-remaining">'}
          ${calCol}
        </colgroup>
        <thead><tr><th>事项</th><th>有效期</th>${remainTh}${calTh}${actionTh}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${items.length ? '' : `<div class="accounts-credit-empty">暂无长期提醒${editing ? '，可点击下方新增（如证件、表格续期）' : ''}。</div>`}
    ${addRow}
  </div>`;
  renderHomeLongRemindersSection();
}

export function renderHomeLongRemindersSection() {
  const el = document.getElementById('homeReminderSection');
  if (!el) return;
  ensureLongReminders();
  const items = sortedLongReminders();
  if (!items.length) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const rows = items.map(item => {
    const remaining = reminderRemainingInfo(item.expiry);
    return `<div class="home-reminder-item">
      <span class="home-reminder-name">${esc(item.name)}</span>
      <span class="home-reminder-expiry">${formatBudgetDateLabel(item.expiry)}</span>
      <span class="home-reminder-tail">
        <span class="home-reminder-remain is-${remaining.status}">${esc(remaining.label)}</span>
        ${reminderCalendarBtnHtml(item.id, true)}
      </span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="home-reminder-card">
    <div class="home-reminder-head">
      <h3 class="home-reminder-title"><i class="ti ti-bell-ringing"></i> 长期提醒</h3>
      <button type="button" class="btn btn-sm home-reminder-link" onclick="sw('accounts', document.querySelector('.ni[title=\\'信用账户\\']'))" title="在账户页管理"><i class="ti ti-arrow-right"></i></button>
    </div>
    <div class="home-reminder-list">${rows}</div>
  </div>`;
}

export function toggleLongReminderEditMode() {
  longReminderEditMode = !longReminderEditMode;
  renderAccountsPage();
}

function saveLongReminderRow(row) {
  const id = row?.dataset?.reminderId;
  if (!id) return;
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return;
  const name = row.querySelector('.accounts-reminder-name')?.value?.trim();
  const expiry = normalizeBudgetDateIso(row.querySelector('.accounts-reminder-expiry')?.value);
  if (!name) {
    alert('请填写事项名称');
    row.querySelector('.accounts-reminder-name')?.focus();
    return;
  }
  if (!expiry) {
    alert('请填写有效期');
    row.querySelector('.accounts-reminder-expiry')?.focus();
    return;
  }
  item.name = name;
  item.expiry = expiry;
  flushAccountPersist();
  renderLongRemindersSection();
}

export function addLongReminderRow() {
  if (!longReminderEditMode) longReminderEditMode = true;
  ensureLongReminders();
  accountRegistry.longReminders.push({
    id: nextLongReminderId(),
    name: '',
    expiry: ''
  });
  renderLongRemindersSection();
  const rows = document.querySelectorAll('#accountsReminderSection tr[data-reminder-id]');
  rows[rows.length - 1]?.querySelector('.accounts-reminder-name')?.focus();
}

export function deleteLongReminder(id) {
  if (!id) return;
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return;
  if (!confirm(`确定删除长期提醒「${item.name || '未命名'}」？`)) return;
  accountRegistry.longReminders = accountRegistry.longReminders.filter(a => a.id !== id);
  flushAccountPersist();
  renderAccountsPage();
}

export async function addLongReminderToCalendar(id) {
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return;
  const expiry = normalizeBudgetDateIso(item.expiry);
  if (!expiry) {
    alert('请先填写有效期');
    return;
  }
  const payload = { id: item.id, name: item.name, expiry };
  if (window.electronAPI?.addReminderToCalendar) {
    try {
      const result = await window.electronAPI.addReminderToCalendar(payload);
      if (result?.mode === 'ics') {
        alert(`无法直接写入日历，已打开日历文件。\n请在日历中确认添加「${item.name}」（含到期前 90/30/7/1 天提醒）。`);
      } else {
        alert(`已加入 Mac 日历「${CALENDAR_NAME}」：${item.name}\n已设置到期前 30/7/1 天提醒。`);
      }
      return;
    } catch (err) {
      alert(`加入日历失败：${err.message || err}`);
      return;
    }
  }
  if (!downloadReminderIcs(payload)) {
    alert('生成日历文件失败');
    return;
  }
  alert(`已下载「${item.name}.ics」\n双击文件即可加入 Mac 日历（含到期前 90/30/7/1 天提醒）。`);
}

function renderWebAccountHeaderCells(editing) {
  ensureWebAccounts();
  const { columns } = accountRegistry.webAccounts;
  if (!columns.length && !editing) return '';
  return columns.map(col => {
    if (editing) {
      return `<th class="accounts-web-col-th">
        <div class="accounts-web-col-head">
          <input type="text" class="accounts-web-inp accounts-web-col-title" data-web-col-id="${esc(col.id)}" value="${esc(col.title)}" placeholder="平台名称">
          <button type="button" class="btn btn-sm accounts-web-col-del" data-delete-web-col="${esc(col.id)}" title="删除列"><i class="ti ti-x"></i></button>
        </div>
      </th>`;
    }
    return `<th class="accounts-web-col-th"><span class="accounts-web-col-label">${esc(col.title || '—')}</span></th>`;
  }).join('');
}

function renderWebAccountRow(row, columns, editing) {
  const cells = columns.map(col => {
    const val = webCellValue(row, col.id);
    if (editing) {
      return `<td><input type="text" class="accounts-web-inp accounts-web-cell" data-web-col-id="${esc(col.id)}" value="${esc(val)}" placeholder="账号 / 备注"></td>`;
    }
    return `<td><span class="accounts-web-val">${val ? esc(val) : '—'}</span></td>`;
  }).join('');
  const actionTd = editing
    ? `<td class="accounts-web-actions"><button type="button" class="btn btn-sm btn-a" data-delete-web-row="${esc(row.id)}" title="删除行"><i class="ti ti-trash"></i></button></td>`
    : '';
  if (editing) {
    return `<tr data-web-row-id="${esc(row.id)}">
      <td class="accounts-web-phone-td"><input type="text" class="accounts-web-inp accounts-web-phone" value="${esc(row.phone)}" placeholder="手机号" inputmode="tel" autocomplete="off"></td>
      ${cells}
      ${actionTd}
    </tr>`;
  }
  return `<tr data-web-row-id="${esc(row.id)}">
    <td class="accounts-web-phone-td"><span class="accounts-web-val accounts-web-val--phone">${row.phone ? esc(row.phone) : '—'}</span></td>
    ${cells}
  </tr>`;
}

function renderWebAccountsSection() {
  const el = document.getElementById('accountsWebSection');
  if (!el) return;
  ensureWebAccounts();
  const { columns, rows } = accountRegistry.webAccounts;
  const editing = webAccountEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const colHeaders = renderWebAccountHeaderCells(editing);
  const actionTh = editing
    ? `<th class="accounts-web-col-actions"><button type="button" class="btn btn-sm accounts-web-add-col-btn" onclick="addWebAccountColumn()" title="新增平台列"><i class="ti ti-plus"></i></button></th>`
    : '';
  const body = rows.map(row => renderWebAccountRow(row, columns, editing)).join('');
  const addRow = editing
    ? `<div class="accounts-web-foot"><button type="button" class="btn btn-sm" onclick="addWebAccountRow()"><i class="ti ti-plus"></i> 新增手机号</button></div>`
    : '';
  const emptyHint = !columns.length
    ? `<div class="accounts-credit-empty">暂无平台列${editing ? '，请先点击表头右侧 + 添加（如小红书、微信）' : '，进入编辑后可添加'}。</div>`
    : (!rows.length ? `<div class="accounts-credit-empty">暂无登记${editing ? '，可点击下方新增手机号' : ''}。</div>` : '');
  el.innerHTML = `<div class="cc full accounts-web-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-web-head">
      <div class="accounts-web-head-top">
        <div class="ct"><i class="ti ti-world"></i> 网站账号登记 <span class="accounts-credit-cnt">${rows.length} 个手机号 · ${columns.length} 个平台</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleWebAccountEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
    </div>
    <div class="accounts-web-table-wrap">
      <table class="report-table accounts-web-table${editing ? ' is-editing' : ' is-viewing'}">
        <thead><tr>
          <th class="accounts-web-phone-th">手机号</th>
          ${colHeaders}
          ${actionTh}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${emptyHint}
    ${addRow}
  </div>`;
}

export function toggleWebAccountEditMode() {
  webAccountEditMode = !webAccountEditMode;
  renderAccountsPage();
}

function saveWebAccountRowEl(row) {
  const id = row?.dataset?.webRowId;
  if (!id) return;
  ensureWebAccounts();
  const item = accountRegistry.webAccounts.rows.find(r => r.id === id);
  if (!item) return;
  const phone = row.querySelector('.accounts-web-phone')?.value?.trim() || '';
  if (!phone) return;
  item.phone = phone;
  row.querySelectorAll('.accounts-web-cell').forEach(inp => {
    const colId = inp.dataset.webColId;
    if (colId) setWebCellValue(item, colId, inp.value || '');
  });
  flushAccountPersist();
  renderWebAccountsSection();
}

function saveWebAccountColumnEl(inp) {
  const colId = inp?.dataset?.webColId;
  if (!colId) return;
  ensureWebAccounts();
  const col = accountRegistry.webAccounts.columns.find(c => c.id === colId);
  if (!col) return;
  const title = inp.value?.trim() || '';
  if (!title) return;
  if (col.title === title) return;
  col.title = title;
  flushAccountPersist();
  renderWebAccountsSection();
}

export function addWebAccountColumn() {
  if (!webAccountEditMode) webAccountEditMode = true;
  ensureWebAccounts();
  accountRegistry.webAccounts.columns.push({ id: nextWebColId(), title: '' });
  renderWebAccountsSection();
  const inputs = document.querySelectorAll('#accountsWebSection .accounts-web-col-title');
  inputs[inputs.length - 1]?.focus();
}

export function addWebAccountRow() {
  if (!webAccountEditMode) webAccountEditMode = true;
  ensureWebAccounts();
  if (!accountRegistry.webAccounts.columns.length) {
    alert('请先添加平台列（如小红书、微信）');
    return;
  }
  accountRegistry.webAccounts.rows.push({ id: nextWebRowId(), phone: '', cells: {} });
  renderWebAccountsSection();
  const rows = document.querySelectorAll('#accountsWebSection tr[data-web-row-id]');
  rows[rows.length - 1]?.querySelector('.accounts-web-phone')?.focus();
}

export function deleteWebAccountColumn(colId) {
  if (!colId) return;
  ensureWebAccounts();
  const col = accountRegistry.webAccounts.columns.find(c => c.id === colId);
  if (!col) return;
  if (!confirm(`确定删除平台列「${col.title || '未命名'}」？`)) return;
  accountRegistry.webAccounts.columns = accountRegistry.webAccounts.columns.filter(c => c.id !== colId);
  accountRegistry.webAccounts.rows.forEach(row => {
    if (row.cells) delete row.cells[colId];
  });
  flushAccountPersist();
  renderAccountsPage();
}

export function deleteWebAccountRow(rowId) {
  if (!rowId) return;
  ensureWebAccounts();
  const row = accountRegistry.webAccounts.rows.find(r => r.id === rowId);
  if (!row) return;
  if (!confirm(`确定删除手机号「${row.phone || '未填写'}」的登记？`)) return;
  accountRegistry.webAccounts.rows = accountRegistry.webAccounts.rows.filter(r => r.id !== rowId);
  flushAccountPersist();
  renderAccountsPage();
}

function saveCreditCardRow(row) {
  const payKey = row?.dataset?.creditKey;
  if (!payKey) return;
  const labelInp = row.querySelector('.accounts-credit-label');
  const parsed = parsePayAccount(payKey);
  const label = labelInp?.value?.trim() || creditCardBankName(payKey, parsed.label);
  const digits = onlyDigits(row.querySelector('.accounts-credit-digits')?.value);
  const tag = row.querySelector('.accounts-credit-tag')?.value?.trim() || '';
  if (labelInp && !label) {
    alert('请填写银行名称');
    labelInp.focus();
    return;
  }
  const pooled = !!creditPoolForCard(payKey);
  const credit = creditFromRowInputs(row, { pooled });
  if (!applyCreditCardMeta(payKey, { label, digits, tag })) return;
  if (pooled) {
    const prev = getRawCreditInfo(payKey) || {};
    applyCreditToAccount(payKey, credit ? { ...prev, ...credit } : prev.billDay != null || prev.dueDay != null ? { billDay: prev.billDay, dueDay: prev.dueDay } : null);
  } else {
    applyCreditToAccount(payKey, credit);
  }
  flushAccountPersist();
  renderAccountsPage();
}

function saveCreditPoolRow(row) {
  const poolId = row?.dataset?.creditPool;
  if (!poolId) return;
  const pool = findCreditPoolById(poolId);
  if (!pool) return;
  const tbody = row.closest('tbody');
  const firstRow = tbody?.querySelector(`tr[data-credit-pool="${poolId}"]`);
  const nameInp = tbody?.querySelector(`tr[data-credit-pool="${poolId}"] .accounts-credit-pool-name`);
  if (nameInp?.value?.trim()) pool.name = nameInp.value.trim();
  const credit = firstRow ? creditFromPoolRowInputs(firstRow) : null;
  if (credit) {
    pool.limit = credit.limit;
    pool.available = credit.available;
    pool.debt = credit.debt;
  }
  flushAccountPersist();
  renderAccountsPage();
}

export function bindSelectedCreditCards(groupId) {
  const tbody = document.getElementById(`accountsCreditTbody-${groupId}`);
  if (!tbody) return;
  const keys = [...tbody.querySelectorAll('tr[data-credit-key] .accounts-credit-bind-cb:checked')]
    .map(cb => cb.closest('tr')?.dataset?.creditKey)
    .filter(Boolean);
  if (keys.length < 2) {
    alert('请至少勾选 2 张信用卡');
    return;
  }
  if (!bindCreditCards(keys)) return;
  flushAccountPersist();
  renderAccountsPage();
}

export function unbindCreditCardFromPool(payKey) {
  if (!payKey) return;
  const pool = creditPoolForCard(payKey);
  if (!pool) return;
  const name = parsePayAccount(payKey).label || payKey;
  if (!confirm(`将「${name}」移出「${pool.name}」共享额度？`)) return;
  unbindCreditCard(payKey);
  flushAccountPersist();
  renderAccountsPage();
}

export function dissolveCreditPoolById(poolId) {
  const pool = findCreditPoolById(poolId);
  if (!pool) return;
  if (!confirm(`解散「${pool.name}」共享额度？\n额度信息将保留在其中一张卡上。`)) return;
  dissolveCreditPool(poolId, { restoreTo: pool.cards[0] });
  flushAccountPersist();
  renderAccountsPage();
}

function saveNewCreditCardRow(row) {
  const label = row.querySelector('.accounts-credit-label')?.value?.trim();
  if (!label) {
    alert('请填写银行名称');
    row.querySelector('.accounts-credit-label')?.focus();
    return;
  }
  const digits = onlyDigits(row.querySelector('.accounts-credit-digits')?.value);
  const tag = row.querySelector('.accounts-credit-tag')?.value?.trim() || '';
  const credit = creditFromRowInputs(row);
  const entry = { id: `m${Date.now()}`, label, digits, kind: '信用卡' };
  if (tag) entry.tag = tag;
  if (credit) entry.credit = credit;
  accountRegistry.manual.push(entry);
  flushAccountPersist();
  renderAccountsPage();
}

export function addCreditCardRow(groupId = 'huhan') {
  if (!creditCardEditMode) {
    creditCardEditMode = true;
    renderCreditCardSection();
  }
  const tbody = document.getElementById(`accountsCreditTbody-${groupId}`);
  if (!tbody) {
    renderCreditCardSection();
    addCreditCardRow(groupId);
    return;
  }
  const existing = document.querySelector('[data-credit-new]');
  if (existing) {
    existing.querySelector('.accounts-credit-label')?.focus();
    return;
  }
  tbody.insertAdjacentHTML('beforeend', renderCreditCardRow(null, { isNew: true, editing: true }));
  tbody.querySelector('[data-credit-new] .accounts-credit-label')?.focus();
}

export function deleteCreditCard(payKey) {
  if (!payKey) return;
  const parsed = parsePayAccount(payKey);
  const name = parsed.label || payKey;
  if (!confirm(`确定从信用卡列表移除「${name}」？\n手动添加的卡片将彻底删除；账单账户仅从此列表隐藏。`)) return;

  if (isManualKey(payKey)) {
    const id = payKey.slice(MANUAL_PREFIX.length);
    accountRegistry.manual = accountRegistry.manual.filter(m => m.id !== id);
  } else if (!isCreditHidden(payKey)) {
    if (!accountRegistry.creditHidden) accountRegistry.creditHidden = [];
    accountRegistry.creditHidden.push(registryStorageKey(payKey));
  }

  removeCardFromCreditPools(payKey);
  flushAccountPersist();
  renderAccountsPage();
}

function cancelNewCreditCardRow(row) {
  row?.remove();
}

function mgrAccountRows() {
  const rows = [];
  const seen = new Set();
  const countMap = new Map(accountList().map(a => [a.pay, a.count]));

  getAllRows().forEach(r => {
    const pay = (r['支付方式'] || '').trim();
    if (!isValidPayAccount(pay)) return;
    const key = accountKeyForPay(pay);
    if (seen.has(key) || isHidden(key) || isMergedAway(key)) return;
    seen.add(key);
    const parsed = parsePayAccount(key);
    rows.push({
      key,
      label: parsed.label,
      digits: accountDigits(key),
      kind: parsed.kind,
      manual: false,
      count: countMap.get(key) || 0,
      mergedCount: Object.values(accountRegistry.merges || {}).filter(t => t === key).length
    });
  });

  accountRegistry.manual.forEach(m => {
    const rawKey = manualKey(m.id);
    const key = canonicalAccountKey(rawKey);
    if (isHidden(key) || isMergedAway(rawKey)) return;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key,
      label: m.label || '账户',
      digits: onlyDigits(m.digits),
      kind: m.kind || '支付账户',
      manual: true,
      count: 0,
      mergedCount: Object.values(accountRegistry.merges || {}).filter(t => t === key).length
    });
  });

  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

function renderAccountsMgrList() {
  const list = document.getElementById('acctMgrList');
  if (!list) return;
  const rows = mgrAccountRows();
  if (!rows.length) {
    list.innerHTML = '<div class="acct-mgr-empty">暂无账户。可在下方表单手动新增。</div>';
    return;
  }
  list.innerHTML = rows.map(row => {
    const digits = row.digits ? maskCardDigits(row.digits) : '未填写';
    const tag = row.manual
      ? '<span class="acct-mgr-tag manual">手动</span>'
      : '<span class="acct-mgr-tag auto">账单</span>';
    const mergedTag = row.mergedCount
      ? `<span class="acct-mgr-tag merged">已合并 ${row.mergedCount}</span>`
      : '';
    return `<div class="acct-mgr-row">
      <div class="acct-mgr-main">
        <div class="acct-mgr-name">${esc(row.label)} ${tag}${mergedTag}</div>
        <div class="acct-mgr-meta">${esc(row.kind)} · ${esc(digits)}${row.count ? ` · ${fmtCount(row.count)} 笔` : ''}</div>
      </div>
      <div class="acct-mgr-actions">
        <button type="button" class="btn btn-sm" data-edit-account="${esc(row.key)}" title="编辑"><i class="ti ti-edit"></i></button>
        <button type="button" class="btn btn-sm" data-merge-account="${esc(row.key)}" title="合并到其他账户"><i class="ti ti-arrows-join"></i></button>
        <button type="button" class="btn btn-sm btn-a" data-del-account="${esc(row.key)}" title="删除"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function fillAccountsMgrForm(payKey) {
  const keyInp = document.getElementById('acctMgrKey');
  const labelInp = document.getElementById('acctMgrLabel');
  const digitsInp = document.getElementById('acctMgrDigits');
  const kindInp = document.getElementById('acctMgrKind');
  const titleEl = document.getElementById('acctMgrFormTitle');
  if (!keyInp || !labelInp || !digitsInp || !kindInp) return;

  if (!payKey) {
    keyInp.value = '';
    labelInp.value = '';
    const tagInp = document.getElementById('acctMgrTag');
    if (tagInp) tagInp.value = '';
    digitsInp.value = '';
    kindInp.value = '借记卡';
    fillCreditForm(null);
    if (titleEl) titleEl.textContent = '新增账户';
    hideAccountMergePanel();
    syncAccountsMgrCreditFields();
    return;
  }

  const parsed = parsePayAccount(payKey);
  const manual = getManualEntry(payKey);
  const ov = getOverride(payKey);
  const rawDigits = accountDigits(payKey);
  keyInp.value = payKey;
  labelInp.value = manual?.label || ov?.label || parsed.label;
  const tagInp = document.getElementById('acctMgrTag');
  if (tagInp) tagInp.value = manual?.tag || ov?.tag || parsed.tag || '';
  digitsInp.value = formatCardDigits(rawDigits);
  kindInp.value = manual?.kind || ov?.kind || parsed.kind || '支付账户';
  fillCreditForm(getEffectiveCreditInfo(payKey));
  if (titleEl) titleEl.textContent = isManualKey(payKey) ? '编辑手动账户' : '编辑账户';
  hideAccountMergePanel();
  syncAccountsMgrCreditFields();
}

function fillCreditForm(credit) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val != null && val !== '' ? String(val) : '';
  };
  set('acctMgrCreditLimit', credit?.limit);
  set('acctMgrCreditAvail', credit?.available);
  set('acctMgrCreditDebt', credit?.debt);
  set('acctMgrDueDay', credit?.dueDay);
  set('acctMgrBillDay', credit?.billDay);
}

function hideAccountMergePanel() {
  const panel = document.getElementById('acctMgrMerge');
  if (panel) panel.classList.add('hide');
  const srcInp = document.getElementById('acctMgrMergeSource');
  if (srcInp) srcInp.value = '';
}

function showAccountMergePanel(sourceKey) {
  const panel = document.getElementById('acctMgrMerge');
  const srcInp = document.getElementById('acctMgrMergeSource');
  const targetSel = document.getElementById('acctMgrMergeTarget');
  const nameEl = document.getElementById('acctMergeSourceName');
  if (!panel || !srcInp || !targetSel) return;

  const parsed = parsePayAccount(sourceKey);
  const options = mgrAccountRows()
    .filter(r => r.key !== sourceKey && canonicalAccountKey(r.key) !== canonicalAccountKey(sourceKey))
    .map(r => `<option value="${esc(r.key)}">${esc(r.label)}（${esc(r.kind)}）</option>`)
    .join('');

  if (!options) {
    alert('没有其他可合并的账户');
    return;
  }

  srcInp.value = sourceKey;
  if (nameEl) nameEl.textContent = parsed.label || sourceKey;
  targetSel.innerHTML = options;
  panel.classList.remove('hide');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function openAccountsMgr() {
  resetAccountsMgrForm();
  renderAccountsMgrList();
  document.getElementById('moAccounts')?.classList.remove('hide');
}

export function closeAccountsMgr() {
  document.getElementById('moAccounts')?.classList.add('hide');
}

export function resetAccountsMgrForm() {
  fillAccountsMgrForm('');
}

export function saveAccountsMgr() {
  const payKey = document.getElementById('acctMgrKey')?.value?.trim() || '';
  const label = document.getElementById('acctMgrLabel')?.value?.trim() || '';
  const digits = onlyDigits(document.getElementById('acctMgrDigits')?.value);
  const kind = document.getElementById('acctMgrKind')?.value || '支付账户';
  const tag = document.getElementById('acctMgrTag')?.value?.trim() || '';

  if (!label) {
    alert('请填写账户名称');
    return;
  }
  if (!KIND_OPTIONS.includes(kind)) {
    alert('请选择有效的账户类型');
    return;
  }

  const credit = kind === '信用卡' ? creditFieldsFromInputs() : null;
  const pool = payKey ? creditPoolForCard(payKey) : null;
  const applyTag = (entry) => {
    if (kind !== '信用卡') {
      delete entry.tag;
      return;
    }
    if (tag) entry.tag = tag;
    else delete entry.tag;
  };

  if (payKey) {
    if (isManualKey(payKey)) {
      const entry = getManualEntry(payKey);
      if (entry) {
        entry.label = label;
        entry.digits = digits;
        entry.kind = kind;
        applyTag(entry);
        if (pool && credit) {
          pool.limit = credit.limit;
          pool.available = credit.available;
          pool.debt = credit.debt;
          const prev = getRawCreditInfo(payKey) || {};
          entry.credit = credit.billDay != null || credit.dueDay != null
            ? { billDay: credit.billDay ?? prev.billDay, dueDay: credit.dueDay ?? prev.dueDay }
            : prev.billDay != null || prev.dueDay != null ? { billDay: prev.billDay, dueDay: prev.dueDay } : undefined;
          if (!entry.credit) delete entry.credit;
        } else if (credit) entry.credit = credit;
        else delete entry.credit;
      }
    } else {
      const prev = accountRegistry.overrides[payKey] || {};
      accountRegistry.overrides[payKey] = { ...prev, label, digits, kind };
      applyTag(accountRegistry.overrides[payKey]);
      if (pool && credit) {
        pool.limit = credit.limit;
        pool.available = credit.available;
        pool.debt = credit.debt;
        const prevCredit = getRawCreditInfo(payKey) || {};
        const cardCredit = credit.billDay != null || credit.dueDay != null
          ? { billDay: credit.billDay ?? prevCredit.billDay, dueDay: credit.dueDay ?? prevCredit.dueDay }
          : prevCredit.billDay != null || prevCredit.dueDay != null
            ? { billDay: prevCredit.billDay, dueDay: prevCredit.dueDay }
            : null;
        if (cardCredit) accountRegistry.overrides[payKey].credit = cardCredit;
        else delete accountRegistry.overrides[payKey].credit;
      } else if (credit) accountRegistry.overrides[payKey].credit = credit;
      else delete accountRegistry.overrides[payKey].credit;
    }
  } else {
    const entry = { id: `m${Date.now()}`, label, digits, kind };
    applyTag(entry);
    if (credit) entry.credit = credit;
    accountRegistry.manual.push(entry);
  }

  if (kind === '信用卡' && payKey && accountRegistry.creditHidden?.length) {
    const canon = canonicalAccountKey(payKey);
    accountRegistry.creditHidden = accountRegistry.creditHidden.filter(k => canonicalAccountKey(k) !== canon);
  }

  flushAccountPersist();
  renderAccountsMgrList();
  resetAccountsMgrForm();
  renderAccountsPage();
}

export function editAccountsMgr(payKey) {
  fillAccountsMgrForm(payKey);
  document.getElementById('acctMgrForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function startAccountMerge(payKey) {
  showAccountMergePanel(payKey);
}

export function cancelAccountMerge() {
  hideAccountMergePanel();
}

export function confirmAccountMerge() {
  const sourceKey = document.getElementById('acctMgrMergeSource')?.value?.trim() || '';
  const targetKey = document.getElementById('acctMgrMergeTarget')?.value?.trim() || '';
  if (!sourceKey || !targetKey) {
    alert('请选择要合并到的账户');
    return;
  }

  const src = canonicalAccountKey(sourceKey);
  const tgt = canonicalAccountKey(targetKey);
  if (src === tgt) {
    alert('不能合并到自身');
    return;
  }

  const srcName = parsePayAccount(sourceKey).label || sourceKey;
  const tgtName = parsePayAccount(targetKey).label || targetKey;
  if (!confirm(`将「${srcName}」合并到「${tgtName}」？\n合并后流水会汇总显示，原账户将从列表隐藏。`)) return;

  Object.keys(accountRegistry.merges).forEach(k => {
    if (accountRegistry.merges[k] === src || accountRegistry.merges[k] === sourceKey) {
      accountRegistry.merges[k] = tgt;
    }
  });
  accountRegistry.merges[src] = tgt;

  hideAccountMergePanel();
  flushAccountPersist();
  renderAccountsMgrList();
  if (document.getElementById('acctMgrKey')?.value === sourceKey) resetAccountsMgrForm();
  renderAccountsPage();
}

export function deleteAccountsMgr(payKey) {
  if (!payKey) return;
  const parsed = parsePayAccount(payKey);
  const name = parsed.label || payKey;
  if (!confirm(`确定删除账户「${name}」？\n仅从信用账户页隐藏，不会删除账目流水。`)) return;

  if (isManualKey(payKey)) {
    const id = payKey.slice(MANUAL_PREFIX.length);
    accountRegistry.manual = accountRegistry.manual.filter(m => m.id !== id);
  } else if (!accountRegistry.hidden.includes(payKey)) {
    accountRegistry.hidden.push(payKey);
  }

  delete accountRegistry.overrides[payKey];
  delete accountRegistry.merges[payKey];
  if (accountRegistry.creditHidden) {
    accountRegistry.creditHidden = accountRegistry.creditHidden.filter(k => k !== payKey);
  }
  Object.keys(accountRegistry.merges).forEach(k => {
    if (accountRegistry.merges[k] === payKey) delete accountRegistry.merges[k];
  });

  flushAccountPersist();
  renderAccountsMgrList();
  if (document.getElementById('acctMgrKey')?.value === payKey) resetAccountsMgrForm();
  renderAccountsPage();
}

export function setupAccountsEvents() {
  const mgrList = document.getElementById('acctMgrList');
  if (mgrList && !mgrList._bound) {
    mgrList._bound = true;
    mgrList.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit-account]');
      if (editBtn) {
        editAccountsMgr(editBtn.dataset.editAccount);
        return;
      }
      const mergeBtn = e.target.closest('[data-merge-account]');
      if (mergeBtn) {
        startAccountMerge(mergeBtn.dataset.mergeAccount);
        return;
      }
      const delBtn = e.target.closest('[data-del-account]');
      if (delBtn) deleteAccountsMgr(delBtn.dataset.delAccount);
    });
  }

  const kindSel = document.getElementById('acctMgrKind');
  if (kindSel && !kindSel._bound) {
    kindSel._bound = true;
    kindSel.addEventListener('change', syncAccountsMgrCreditFields);
  }

  const creditSec = document.getElementById('accountsCreditSection');
  if (creditSec && !creditSec._bound) {
    creditSec._bound = true;
    creditSec.addEventListener('input', e => {
      if (!creditCardEditMode) return;
      const inp = e.target;
      if (!inp.matches('[data-credit-field]')) return;
      const row = inp.closest('tr[data-credit-key], tr[data-credit-new], tr[data-credit-pool]');
      if (!row) return;
      const field = inp.dataset.creditField;
      if (field === 'available' || field === 'debt') row.dataset.creditCalcFrom = field;
      if (['limit', 'available', 'debt'].includes(field)) syncCreditDerived(row, field);
    });
    creditSec.addEventListener('focusout', e => {
      if (!creditCardEditMode) return;
      const poolRow = e.target.closest('tr[data-credit-pool]');
      if (poolRow && e.target.matches('.accounts-credit-inp, .accounts-credit-pool-name')) {
        setTimeout(() => {
          const active = document.activeElement;
          const activePoolRow = active?.closest('tr[data-credit-pool]');
          if (activePoolRow === poolRow && active.matches('.accounts-credit-inp, .accounts-credit-pool-name')) return;
          saveCreditPoolRow(poolRow);
        }, 0);
        return;
      }
      const row = e.target.closest('tr[data-credit-key]');
      if (!row) return;
      if (!e.target.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits, .accounts-credit-tag')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-credit-key]');
        if (activeRow === row && active.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits, .accounts-credit-tag')) return;
        saveCreditCardRow(row);
      }, 0);
    });
    creditSec.addEventListener('keydown', e => {
      if (!creditCardEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits, .accounts-credit-tag')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    creditSec.addEventListener('click', e => {
      const cancelBtn = e.target.closest('[data-cancel-credit]');
      if (cancelBtn?.dataset.cancelCredit) {
        toggleCreditCancelled(cancelBtn.dataset.cancelCredit);
        return;
      }
      const uncancelBtn = e.target.closest('[data-uncancel-credit]');
      if (uncancelBtn?.dataset.uncancelCredit) {
        toggleCreditCancelled(uncancelBtn.dataset.uncancelCredit);
        return;
      }
      if (!creditCardEditMode) return;
      const bindBtn = e.target.closest('[data-bind-credit-group]');
      if (bindBtn) {
        bindSelectedCreditCards(bindBtn.dataset.bindCreditGroup);
        return;
      }
      const unbindBtn = e.target.closest('[data-unbind-credit]');
      if (unbindBtn?.dataset.unbindCredit) {
        unbindCreditCardFromPool(unbindBtn.dataset.unbindCredit);
        return;
      }
      const dissolveBtn = e.target.closest('[data-dissolve-pool]');
      if (dissolveBtn?.dataset.dissolvePool) {
        dissolveCreditPoolById(dissolveBtn.dataset.dissolvePool);
        return;
      }
      const saveBtn = e.target.closest('[data-save-credit-new]');
      if (saveBtn) {
        const row = saveBtn.closest('tr[data-credit-new]');
        if (row) saveNewCreditCardRow(row);
        return;
      }
      const cancelNewBtn = e.target.closest('[data-cancel-credit-new]');
      if (cancelNewBtn) {
        cancelNewCreditCardRow(cancelNewBtn.closest('tr[data-credit-new]'));
        return;
      }
      const delBtn = e.target.closest('[data-delete-credit]');
      if (delBtn?.dataset.deleteCredit) deleteCreditCard(delBtn.dataset.deleteCredit);
    });
  }

  const cashSec = document.getElementById('accountsCashSection');
  if (cashSec && !cashSec._bound) {
    cashSec._bound = true;
    cashSec.addEventListener('focusout', e => {
      if (!cashAccountEditMode) return;
      const row = e.target.closest('.accounts-cash-item[data-cash-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-cash-inp')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('.accounts-cash-item[data-cash-id]');
        if (activeRow === row && active.matches('.accounts-cash-inp')) return;
        saveCashAccountRow(row);
      }, 0);
    });
    cashSec.addEventListener('keydown', e => {
      if (!cashAccountEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-cash-inp')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    cashSec.addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-cash]');
      if (delBtn?.dataset.deleteCash) deleteCashAccount(delBtn.dataset.deleteCash);
    });
  }

  const budgetSec = document.getElementById('accountsBudgetSection');
  if (budgetSec && !budgetSec._bound) {
    budgetSec._bound = true;
    budgetSec.addEventListener('focusout', e => {
      if (!budgetEditMode) return;
      const row = e.target.closest('tr[data-budget-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-budget-inp')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-budget-id]');
        if (activeRow === row && active.matches('.accounts-budget-inp')) return;
        saveBudgetRow(row);
      }, 0);
    });
    budgetSec.addEventListener('keydown', e => {
      if (!budgetEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-budget-inp')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    budgetSec.addEventListener('change', e => {
      if (!budgetEditMode) return;
      if (!e.target.matches('.accounts-budget-date')) return;
      const row = e.target.closest('tr[data-budget-id]');
      if (row) saveBudgetRow(row);
    });
    budgetSec.addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-budget]');
      if (delBtn?.dataset.deleteBudget) deleteBudget(delBtn.dataset.deleteBudget);
    });
  }

  const webSec = document.getElementById('accountsWebSection');
  if (webSec && !webSec._bound) {
    webSec._bound = true;
    webSec.addEventListener('focusout', e => {
      if (!webAccountEditMode) return;
      const colInp = e.target.closest('.accounts-web-col-title');
      if (colInp) {
        setTimeout(() => {
          const active = document.activeElement;
          if (active === colInp) return;
          saveWebAccountColumnEl(colInp);
        }, 0);
        return;
      }
      const row = e.target.closest('tr[data-web-row-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-web-inp')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-web-row-id]');
        if (activeRow === row && active.matches('.accounts-web-inp')) return;
        saveWebAccountRowEl(row);
      }, 0);
    });
    webSec.addEventListener('keydown', e => {
      if (!webAccountEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-web-inp')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    webSec.addEventListener('click', e => {
      const delCol = e.target.closest('[data-delete-web-col]');
      if (delCol?.dataset.deleteWebCol) {
        deleteWebAccountColumn(delCol.dataset.deleteWebCol);
        return;
      }
      const delRow = e.target.closest('[data-delete-web-row]');
      if (delRow?.dataset.deleteWebRow) deleteWebAccountRow(delRow.dataset.deleteWebRow);
    });
  }

  const lifeSec = document.getElementById('accountsLifeSection');
  if (lifeSec && !lifeSec._bound) {
    lifeSec._bound = true;
    lifeSec.addEventListener('focusout', e => {
      if (!lifeAccountEditMode) return;
      const row = e.target.closest('tr[data-life-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-life-inp')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-life-id]');
        if (activeRow === row && active.matches('.accounts-life-inp')) return;
        saveLifeAccountRow(row);
      }, 0);
    });
    lifeSec.addEventListener('keydown', e => {
      if (!lifeAccountEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-life-inp')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    lifeSec.addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-life]');
      if (delBtn?.dataset.deleteLife) deleteLifeAccount(delBtn.dataset.deleteLife);
    });
  }

  const reminderSec = document.getElementById('accountsReminderSection');
  if (reminderSec && !reminderSec._bound) {
    reminderSec._bound = true;
    reminderSec.addEventListener('focusout', e => {
      if (!longReminderEditMode) return;
      const row = e.target.closest('tr[data-reminder-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-reminder-inp')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-reminder-id]');
        if (activeRow === row && active.matches('.accounts-reminder-inp')) return;
        saveLongReminderRow(row);
      }, 0);
    });
    reminderSec.addEventListener('keydown', e => {
      if (!longReminderEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-reminder-inp')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    reminderSec.addEventListener('change', e => {
      if (!longReminderEditMode) return;
      if (!e.target.matches('.accounts-reminder-expiry')) return;
      const row = e.target.closest('tr[data-reminder-id]');
      if (row) saveLongReminderRow(row);
    });
    reminderSec.addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-reminder]');
      if (delBtn?.dataset.deleteReminder) deleteLongReminder(delBtn.dataset.deleteReminder);
    });
  }
}

export function renderAccountsPage() {
  renderAccountsStatusSection();
  renderCreditCardSection();
  renderCashAccountsSection();
  renderLifeAccountsSection();
  renderExpenseBudgetsSection();
  renderLongRemindersSection();
  renderWebAccountsSection();
}
