/** 信用账户：信用卡额度与免息期管理 */
import { fmtMoney, fmtCount } from './format.js';
import { isValidPayAccount, matchBankBrand, accountGroupKey, accountGroupName } from './bank-brands.js';

const MANUAL_PREFIX = '__manual:';
const KIND_OPTIONS = ['借记卡', '信用卡', '支付账户'];
const CREDIT_CARD_GROUPS = [
  { id: 'huhan', name: '胡晗' },
  { id: 'chencheng', name: '陈橙' }
];

let getAllRows = () => [];
let onPersist = () => {};
let persistNowFn = null;
let registryNeedsPersist = false;

let accountCardFaces = {};
let accountRegistry = { overrides: {}, hidden: [], manual: [], merges: {}, creditHidden: [], creditPools: [], creditGroups: {} };
let creditCardEditMode = false;

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
    creditGroups: raw?.creditGroups && typeof raw.creditGroups === 'object' ? { ...raw.creditGroups } : {}
  };
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
  const { registry, migrated } = migrateRegistry(state?.accountRegistry);
  accountRegistry = registry;
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
    return manual.credit ? { ...fields, credit: { ...manual.credit } } : fields;
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
  const fields = buildCardFields(label, digits, kind, full, full);
  return credit ? { ...fields, credit } : fields;
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

function applyCreditCardMeta(payKey, { label, digits }) {
  if (isManualKey(payKey)) {
    const entry = getManualEntry(payKey);
    if (!entry) return false;
    entry.kind = '信用卡';
    if (label) entry.label = label;
    if (digits) entry.digits = digits;
    return true;
  }
  const prev = accountRegistry.overrides[payKey] || {};
  accountRegistry.overrides[payKey] = { ...prev, kind: '信用卡' };
  if (label) accountRegistry.overrides[payKey].label = label;
  if (digits) accountRegistry.overrides[payKey].digits = digits;
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
      const pool = creditPoolForCard(r.key);
      const acc = { pay: r.key, label, last4, digits };
      return {
        pay: r.key,
        label,
        last4,
        digits,
        displayName: creditCardDisplayName(acc),
        credit: getEffectiveCreditInfo(r.key) || {},
        poolId: pool?.id || null,
        count: r.count
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

function creditNameCell(payKey, labelVal = '', { isNew = false } = {}) {
  const logo = isNew
    ? '<span class="fund-brand-mark fund-brand-mark--fb accounts-credit-logo-ph" style="width:24px;height:24px"><i class="ti ti-credit-card" style="font-size:12px"></i></span>'
    : accountBrandMarkHtml(payKey, 24);
  const labelAttr = isNew
    ? 'placeholder="银行名称 *"'
    : `value="${esc(labelVal)}" placeholder="银行名称"`;
  return `<div class="accounts-credit-name-cell">${logo}<input type="text" class="accounts-credit-label" ${labelAttr}></div>`;
}

function creditNameDisplayCell(acc) {
  const displayName = acc.displayName || creditCardDisplayName(acc);
  return `<div class="accounts-credit-name-cell">${accountBrandMarkHtml(acc.pay, 24)}<span class="accounts-credit-val accounts-credit-val--name">${esc(displayName)}</span></div>`;
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
    const limitCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.limit);
    const availCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.available);
    const debtCell = pooled
      ? '<span class="accounts-credit-pool-shared">共享</span>'
      : formatCreditBrowseAmount(c.debt);
    return `<tr data-credit-key="${esc(acc.pay)}"${pooled ? ' class="accounts-credit-pool-card"' : ''}>
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
      <td>${creditNameCell('', '', { isNew: true })}</td>
      <td>${creditDigitsInput(null, { isNew: true })}</td>
      <td>${fields.limit}</td>
      <td>${fields.available}</td>
      <td>${fields.debt}</td>
      <td>${fields.billDay}</td>
      <td>${fields.dueDay}</td>
      <td class="accounts-credit-actions">
        <button type="button" class="btn btn-sm" data-cancel-credit-new title="取消"><i class="ti ti-x"></i></button>
        <button type="button" class="btn btn-sm btn-p" data-save-credit-new title="保存"><i class="ti ti-check"></i></button>
      </td>
    </tr>`;
  }

  const unbindBtn = pooled
    ? `<button type="button" class="btn btn-sm" data-unbind-credit="${esc(acc.pay)}" title="移出共享额度"><i class="ti ti-unlink"></i></button>`
    : '';
  return `<tr data-credit-key="${esc(acc.pay)}"${pooled ? ' class="accounts-credit-pool-card"' : ''}>
    ${bindTd}
    <td>${creditNameDisplayCell(acc)}</td>
    <td>${creditDigitsInput(acc)}</td>
    <td>${fields.limit}</td>
    <td>${fields.available}</td>
    <td>${fields.debt}</td>
    <td>${fields.billDay}</td>
    <td>${fields.dueDay}</td>
    <td class="accounts-credit-actions">
      ${unbindBtn}
      <button type="button" class="btn btn-sm btn-a" data-delete-credit="${esc(acc.pay)}" title="删除"><i class="ti ti-trash"></i></button>
    </td>
  </tr>`;
}

function renderCreditPoolHeaderRow(pool, cards, editing) {
  const c = { limit: pool.limit, available: pool.available, debt: pool.debt };
  const brand = matchBankBrand(pool.name || cards[0]?.label || '');
  const logo = brand?.logoUrl
    ? `<img class="fund-brand-logo" src="${esc(brand.logoUrl)}" alt="" width="24" height="24" loading="lazy" onerror="this.style.display='none'">`
    : accountBrandMarkHtml(cards[0]?.pay || pool.name, 24);
  const bindTd = editing ? '<td class="accounts-credit-bind-td"></td>' : '';
  const actionTd = editing
    ? `<td class="accounts-credit-actions"><button type="button" class="btn btn-sm" data-dissolve-pool="${esc(pool.id)}" title="解散额度池"><i class="ti ti-unlink"></i></button></td>`
    : '';

  if (!editing) {
    return `<tr class="accounts-credit-pool-row" data-credit-pool="${esc(pool.id)}">
      <td colspan="2"><div class="accounts-credit-pool-label">${logo}<span>${esc(pool.name)} · 共享额度</span><span class="accounts-credit-pool-cnt">${cards.length} 张</span></div></td>
      <td><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.limit)}</span></td>
      <td><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.available)}</span></td>
      <td><span class="accounts-credit-val accounts-credit-val--pool">${formatCreditBrowseAmount(c.debt)}</span></td>
      <td colspan="3"></td>
    </tr>`;
  }

  const fields = creditFieldInputs(c);
  return `<tr class="accounts-credit-pool-row" data-credit-pool="${esc(pool.id)}">
    ${bindTd}
    <td colspan="2"><div class="accounts-credit-pool-label">${logo}<input type="text" class="accounts-credit-pool-name" value="${esc(pool.name)}" placeholder="额度池名称"><span class="accounts-credit-pool-cnt">${cards.length} 张</span></div></td>
    <td>${fields.limit}</td>
    <td>${fields.available}</td>
    <td>${fields.debt}</td>
    <td colspan="3"></td>
    ${actionTd}
  </tr>`;
}

function renderCreditCardGroupTableBody(group, editing) {
  const blocks = organizeGroupCards(group.cards);
  const colSpan = editing ? 10 : 8;
  if (!blocks.length) {
    return `<tr><td colspan="${colSpan}" class="accounts-credit-group-empty">暂无卡片</td></tr>`;
  }
  return blocks.map(block => {
    if (block.type === 'pool') {
      const header = renderCreditPoolHeaderRow(block.pool, block.cards, editing);
      const rows = block.cards.map(c => renderCreditCardRow(c, { editing, pooled: true })).join('');
      return `${header}${rows}`;
    }
    return block.cards.map(c => renderCreditCardRow(c, { editing, pooled: false })).join('');
  }).join('');
}

function renderCreditCardGroupTable(group, editing) {
  const bindTh = editing ? '<th class="accounts-credit-bind-th" title="选择绑定"></th>' : '';
  const actionTh = editing ? '<th>操作</th>' : '';
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
    ? renderCreditCardGroupTableBody(group, editing)
    : (() => {
        const colSpan = editing ? 10 : 8;
        return `<tr><td colspan="${colSpan}" class="accounts-credit-group-empty">暂无卡片</td></tr>`;
      })();
  const digitTh = editing ? '<th>卡号</th>' : '<th>尾号</th>';
  return `<section class="accounts-credit-group" data-credit-group="${group.id}">
    <div class="accounts-credit-group-head">
      <h4 class="accounts-credit-group-title">${esc(group.name)} <span class="accounts-credit-group-cnt">${group.cards.length} 张</span></h4>
      <div class="accounts-credit-group-actions">${bindBtn}${addBtn}</div>
    </div>
    <div class="accounts-credit-table-wrap">
      <table class="report-table accounts-credit-table${editing ? ' is-editing' : ' is-viewing'}">
        ${colgroup}
        <thead><tr>
          ${bindTh}<th>账户</th>${digitTh}<th>额度</th><th>可用</th><th>欠款</th><th>账单日</th><th>还款日</th>${tlTh}${actionTh}
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

function saveCreditCardRow(row) {
  const payKey = row?.dataset?.creditKey;
  if (!payKey) return;
  const labelInp = row.querySelector('.accounts-credit-label');
  const parsed = parsePayAccount(payKey);
  const label = labelInp?.value?.trim() || creditCardBankName(payKey, parsed.label);
  const digits = onlyDigits(row.querySelector('.accounts-credit-digits')?.value);
  if (labelInp && !label) {
    alert('请填写银行名称');
    labelInp.focus();
    return;
  }
  const pooled = !!creditPoolForCard(payKey);
  const credit = creditFromRowInputs(row, { pooled });
  if (!applyCreditCardMeta(payKey, { label, digits })) return;
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
  const name = row.querySelector('.accounts-credit-pool-name')?.value?.trim();
  if (name) pool.name = name;
  const credit = creditFromPoolRowInputs(row);
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
  const credit = creditFromRowInputs(row);
  const entry = { id: `m${Date.now()}`, label, digits, kind: '信用卡' };
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

  if (payKey) {
    if (isManualKey(payKey)) {
      const entry = getManualEntry(payKey);
      if (entry) {
        entry.label = label;
        entry.digits = digits;
        entry.kind = kind;
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
      if (!e.target.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits')) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('tr[data-credit-key]');
        if (activeRow === row && active.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits')) return;
        saveCreditCardRow(row);
      }, 0);
    });
    creditSec.addEventListener('keydown', e => {
      if (!creditCardEditMode) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-credit-inp, .accounts-credit-label, .accounts-credit-digits')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    creditSec.addEventListener('click', e => {
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
      const cancelBtn = e.target.closest('[data-cancel-credit-new]');
      if (cancelBtn) {
        cancelNewCreditCardRow(cancelBtn.closest('tr[data-credit-new]'));
        return;
      }
      const delBtn = e.target.closest('[data-delete-credit]');
      if (delBtn?.dataset.deleteCredit) deleteCreditCard(delBtn.dataset.deleteCredit);
    });
  }
}

export function renderAccountsPage() {
  renderCreditCardSection();
}
