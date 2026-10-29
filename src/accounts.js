/** 信用账户：信用卡额度与免息期管理 */
import { fmtMoney, fmtMoneySigned, fmtCount, normalizeCurrency, amountInCny, DEFAULT_HKD_CNY } from './format.js';
import { isValidPayAccount, matchBankBrand, accountGroupKey, accountGroupName } from './bank-brands.js';
import { webPlatformMarkHtml, groupWebPlatformsByCategory } from './web-platform-logos.js';
const MANUAL_PREFIX = '__manual:';
const KIND_OPTIONS = ['借记卡', '信用卡', '支付账户'];
const CREDIT_CARD_GROUPS = [
  { id: 'huhan', name: '胡晗' },
  { id: 'chencheng', name: '陈橙' }
];

const CASH_ACCOUNT_GROUPS = [
  { id: 'huhan', name: '胡晗' },
  { id: 'chencheng', name: '陈橙' },
  { id: 'company', name: '公司' }
];
const DEFAULT_CASH_GROUP_ID = 'huhan';

const DEFAULT_CASH_ACCOUNTS = [
  '工商银行9859', '招商银行2758', '工商银行6616', '天府银行7592', '平安银行3949',
  '建设银行1891', '民生银行0258', '中国银行0135', '微信-胡晗', '支付宝-胡晗'
];

const DEFAULT_LIFE_GROUPS = [
  { id: 'jinghu', name: '旌湖上境' },
  { id: 'shidai', name: '时代嘉玺' }
];
const DEFAULT_LIFE_GROUP_ID = 'jinghu';

const DEFAULT_LIFE_ACCOUNTS = [
  { name: '旌湖上境电费', accountNo: '5101152527201' }
];

const REMINDER_CATEGORIES = ['生活', '账号', '金融'];

const DEFAULT_LONG_REMINDERS = [
  { name: 'W-8 表格', expiry: '2030-01-01', category: '金融' }
];

let getAllRows = () => [];
let onPersist = () => {};
let persistNowFn = null;
let bindScrollRevealFn = () => {};
let registryNeedsPersist = false;

let accountCardFaces = {};
let accountLogos = {};
let accountRegistry = { overrides: {}, hidden: [], manual: [], merges: {}, creditHidden: [], creditPools: [], creditGroups: {}, cashAccounts: [], expenseBudgets: [], webAccounts: { platforms: [] }, lifeGroups: [], lifeAccounts: [], longReminders: [] };
const webPassRevealedIds = new Set();
const webUShieldRevealedIds = new Set();
const webExpandedIds = new Set();
let creditCardEditMode = false;
let editingCashId = null;
let editingCashCardId = null;
let budgetEditMode = false;
let editingWebEntryId = null;
let editingWebPlatformId = null;
let lifeAccountEditMode = false;
let editingReminderId = null;
let accountsActiveTab = 'credit';

const ACCOUNTS_TABS = [
  { id: 'credit', label: '信用卡', icon: 'ti-credit-card', count: () => creditCardAccounts().length },
  { id: 'cash', label: '现金', icon: 'ti-wallet', count: () => cashAccountsList().length },
  { id: 'life', label: '生活', icon: 'ti-home-2', count: () => lifeAccountsList().length },
  { id: 'budget', label: '预算', icon: 'ti-calendar-event', count: () => expenseBudgetsList().length },
  { id: 'web', label: '网站', icon: 'ti-world', count: () => webAccountsEntryCount() },
];

const CORP_MARKS = {
  WECHAT: { bg: '#07c160', icon: 'ti-brand-wechat' },
  ALIPAY: { bg: '#1677ff', icon: 'ti-brand-alipay' },
  UPOP: { bg: '#e21836', icon: 'ti-credit-card' }
};

export function initAccounts(deps) {
  getAllRows = deps.getAllRows || getAllRows;
  onPersist = deps.onPersist || onPersist;
  persistNowFn = deps.persistNow || null;
  bindScrollRevealFn = deps.bindScrollReveal || bindScrollRevealFn;
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
        initial: Number(a?.initial) || 0,
        groupId: normalizeCashGroupId(a?.groupId, a?.name),
        cardNumber: String(a?.cardNumber ?? ''),
        currency: normalizeCurrency(a?.currency)
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
  let migrated = false;
  r.webAccounts = normalizeWebAccounts(raw?.webAccounts);
  if (Array.isArray(raw?.webAccounts?.columns) || Array.isArray(raw?.webAccounts?.rows)) {
    migrated = true;
  }
  r.lifeGroups = Array.isArray(raw?.lifeGroups)
    ? raw.lifeGroups.map(g => ({
      id: String(g?.id || ''),
      name: String(g?.name || '').trim()
    })).filter(g => g.id && g.name)
    : [];
  r.lifeAccounts = Array.isArray(raw?.lifeAccounts)
    ? raw.lifeAccounts.map(a => ({
      id: String(a?.id || ''),
      name: String(a?.name || ''),
      accountNo: String(a?.accountNo || a?.account || ''),
      groupId: String(a?.groupId || '')
    })).filter(a => a.id)
    : [];
  r.longReminders = Array.isArray(raw?.longReminders)
    ? raw.longReminders.map(item => {
      const source = item?.source === 'credit-repay' ? 'credit-repay' : '';
      const category = normalizeReminderCategory(item?.category, source);
      if (category !== item?.category) migrated = true;
      const out = {
        id: String(item?.id || ''),
        name: String(item?.name || ''),
        expiry: normalizeBudgetDateIso(item?.expiry || item?.date || ''),
        category,
        done: !!item?.done
      };
      const amountNum = Number(item?.amount);
      if (Number.isFinite(amountNum) && amountNum >= 0) out.amount = amountNum;
      if (item?.nameLocked) out.nameLocked = true;
      if (item?.expiryLocked) out.expiryLocked = true;
      if (item?.amountLocked) out.amountLocked = true;
      if (source) {
        out.source = source;
        out.sourceKey = String(item?.sourceKey || '');
        const settledExpiry = normalizeBudgetDateIso(item?.settledExpiry || '');
        if (settledExpiry) out.settledExpiry = settledExpiry;
      }
      return out;
    }).filter(item => item.id)
    : [];

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

  // 港币兑人民币：可配置；缺省沿用出行模块中间价
  const rate = Number(raw?.hkdRate);
  r.hkdRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_HKD_CNY;
  const rateDate = String(raw?.hkdRateDate || '').trim();
  r.hkdRateDate = /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? rateDate : '';
  if (!Number.isFinite(Number(raw?.hkdRate)) || Number(raw?.hkdRate) <= 0) migrated = true;

  return { registry: r, migrated };
}

function nextCashAccountId() {
  return `cash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeCashGroupId(groupId, name = '') {
  if (CASH_ACCOUNT_GROUPS.some(g => g.id === groupId)) return groupId;
  return inferCashGroupId(name);
}

function inferCashGroupId(name = '') {
  const s = String(name || '');
  if (/公司|小河帮|乐极客|对公|公户/.test(s)) return 'company';
  if (/陈橙/.test(s)) return 'chencheng';
  if (/胡晗/.test(s)) return 'huhan';
  return DEFAULT_CASH_GROUP_ID;
}

function ensureCashAccountGroups() {
  if (!Array.isArray(accountRegistry.cashAccounts)) return false;
  let changed = false;
  accountRegistry.cashAccounts.forEach(acc => {
    const gid = normalizeCashGroupId(acc.groupId, acc.name);
    if (acc.groupId !== gid) {
      acc.groupId = gid;
      changed = true;
    }
  });
  return changed;
}

function normalizeWebEntry(raw, fallback = {}) {
  return {
    id: String(raw?.id || fallback.id || ''),
    account: String(raw?.account ?? fallback.account ?? ''),
    username: String(raw?.username ?? fallback.username ?? ''),
    password: String(raw?.password ?? fallback.password ?? ''),
    enterprise: String(raw?.enterprise ?? raw?.company ?? fallback.enterprise ?? ''),
    uShieldPassword: String(raw?.uShieldPassword ?? raw?.ushieldPassword ?? raw?.uShield ?? fallback.uShieldPassword ?? ''),
    mastercardNumber: String(raw?.mastercardNumber ?? raw?.masterCardNumber ?? raw?.mastercard ?? fallback.mastercardNumber ?? ''),
    note: String(raw?.note ?? fallback.note ?? '')
  };
}

function shortEnterpriseName(name = '') {
  const s = String(name || '').trim();
  if (!s) return '';
  return s.replace(/^成都/, '').trim() || s;
}


function entryHasEnterprise(entry) {
  return Boolean(String(entry?.enterprise || '').trim());
}

function entryHasUShield(entry) {
  return Boolean(String(entry?.uShieldPassword || '').trim());
}

/** 乐极客等公司平台默认展示 U 盾列；其它平台有值才显示（同「企业」按需模式） */
function platformWantsUShieldColumn(platform, entries = []) {
  if ((entries || []).some(entryHasUShield)) return true;
  return /乐极客/.test(String(platform?.title || ''));
}

function entryHasMastercard(entry) {
  return Boolean(String(entry?.mastercardNumber || '').trim());
}

/** 汇丰香港 / 中银香港默认展示万事达卡号列；其它平台有值才显示 */
function platformWantsMastercardColumn(platform, entries = []) {
  if ((entries || []).some(entryHasMastercard)) return true;
  const t = String(platform?.title || '');
  return /汇丰|中银香港|中银|hsbc|bochk|bankofchinahongkong/i.test(t);
}

function webEntrySubtitle(entry) {
  return shortEnterpriseName(entry?.enterprise) || '';
}

function webPlatformInitial(title = '') {
  const s = String(title || '').trim();
  if (!s) return '?';
  return Array.from(s)[0];
}

function webPlatformAccent(title = '') {
  const palette = ['#e11d48', '#ea580c', '#d97706', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#0891b2', '#4f46e5'];
  const s = String(title || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function migrateLegacyWebAccounts(raw) {
  const columns = Array.isArray(raw?.columns) ? raw.columns : [];
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  if (!columns.length && !rows.length) return null;
  return columns.map(col => {
    const colId = String(col?.id || '');
    const entries = rows.map(row => {
      const phone = String(row?.phone || '').trim();
      const value = String(row?.cells?.[colId] || '').trim();
      if (!phone && !value) return null;
      return normalizeWebEntry({
        id: `webentry-${colId}-${row?.id || Math.random().toString(36).slice(2, 7)}`,
        account: phone,
        username: value,
        password: ''
      });
    }).filter(Boolean);
    return {
      id: colId || nextWebPlatformId(),
      title: String(col?.title || ''),
      entries
    };
  }).filter(p => p.id);
}

function normalizeWebAccounts(raw) {
  if (Array.isArray(raw?.platforms)) {
    return {
      platforms: raw.platforms.map(p => ({
        id: String(p?.id || ''),
        title: String(p?.title || ''),
        entries: Array.isArray(p?.entries)
          ? p.entries.map(e => normalizeWebEntry(e)).filter(e => e.id)
          : []
      })).filter(p => p.id)
    };
  }
  const migrated = migrateLegacyWebAccounts(raw);
  if (migrated) return { platforms: migrated };
  return { platforms: [] };
}

function ensureWebAccounts() {
  if (!accountRegistry.webAccounts || typeof accountRegistry.webAccounts !== 'object') {
    accountRegistry.webAccounts = { platforms: [] };
  }
  accountRegistry.webAccounts = normalizeWebAccounts(accountRegistry.webAccounts);
}

function webPlatformsList() {
  ensureWebAccounts();
  return accountRegistry.webAccounts.platforms || [];
}

function webAccountsEntryCount() {
  return webPlatformsList().reduce((n, p) => n + (p.entries?.length || 0), 0);
}

function nextWebPlatformId() {
  return `webplat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextWebEntryId() {
  return `webentry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function findWebEntry(entryId) {
  for (const platform of webPlatformsList()) {
    const entry = platform.entries.find(e => e.id === entryId);
    if (entry) return { platform, entry };
  }
  return null;
}

function maskWebPassword(password) {
  const s = String(password || '');
  if (!s) return '—';
  return '•'.repeat(Math.min(Math.max(s.length, 6), 12));
}

function nextLifeAccountId() {
  return `life-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextLifeGroupId() {
  return `lifeg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function lifeAccountsList() {
  return Array.isArray(accountRegistry.lifeAccounts) ? accountRegistry.lifeAccounts : [];
}

function lifeGroupsList() {
  return Array.isArray(accountRegistry.lifeGroups) ? accountRegistry.lifeGroups : [];
}

function ensureLifeAccounts() {
  if (!Array.isArray(accountRegistry.lifeAccounts)) accountRegistry.lifeAccounts = [];
}

function ensureLifeGroups() {
  if (!Array.isArray(accountRegistry.lifeGroups)) accountRegistry.lifeGroups = [];
  if (accountRegistry.lifeGroups.length) return false;
  accountRegistry.lifeGroups = DEFAULT_LIFE_GROUPS.map(g => ({ ...g }));
  return true;
}

function inferLifeGroupId(name = '') {
  const s = String(name || '');
  if (/时代嘉玺/.test(s)) return 'shidai';
  if (/旌湖上境|旌湖/.test(s)) return 'jinghu';
  for (const g of lifeGroupsList()) {
    if (g.name && s.includes(g.name)) return g.id;
  }
  return lifeGroupsList()[0]?.id || DEFAULT_LIFE_GROUP_ID;
}

function normalizeLifeGroupId(groupId, name = '') {
  if (lifeGroupsList().some(g => g.id === groupId)) return groupId;
  return inferLifeGroupId(name);
}

function ensureLifeAccountGroups() {
  let changed = ensureLifeGroups();
  ensureLifeAccounts();
  lifeAccountsList().forEach(acc => {
    const gid = normalizeLifeGroupId(acc.groupId, acc.name);
    if (acc.groupId !== gid) {
      acc.groupId = gid;
      changed = true;
    }
  });
  return changed;
}

function groupLifeAccounts(items) {
  ensureLifeAccountGroups();
  const groups = lifeGroupsList();
  const map = Object.fromEntries(groups.map(g => [g.id, []]));
  const fallback = groups[0]?.id || DEFAULT_LIFE_GROUP_ID;
  items.forEach(item => {
    const gid = normalizeLifeGroupId(item.groupId, item.name);
    (map[gid] || map[fallback] || []).push(item);
  });
  return groups.map(g => ({ ...g, items: map[g.id] || [] }));
}

function ensureDefaultLifeAccounts() {
  ensureLifeAccounts();
  if (accountRegistry.lifeAccounts.length) return ensureLifeAccountGroups();
  ensureLifeGroups();
  accountRegistry.lifeAccounts = DEFAULT_LIFE_ACCOUNTS.map(item => ({
    id: nextLifeAccountId(),
    name: item.name,
    accountNo: item.accountNo,
    groupId: inferLifeGroupId(item.name)
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
    expiry: item.expiry,
    category: item.category,
    done: false
  }));
  return true;
}

function ensureDefaultCashAccounts() {
  if (!Array.isArray(accountRegistry.cashAccounts)) accountRegistry.cashAccounts = [];
  if (accountRegistry.cashAccounts.length) return ensureCashAccountGroups();
  accountRegistry.cashAccounts = DEFAULT_CASH_ACCOUNTS.map(name => ({
    id: nextCashAccountId(),
    name,
    balance: 0,
    initial: 0,
    groupId: inferCashGroupId(name),
    cardNumber: '',
    currency: 'CNY'
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
  accountLogos = state?.accountLogos || {};
  let { registry, migrated } = migrateRegistry(state?.accountRegistry);
  accountRegistry = registry;
  ensureWebAccounts();
  if (ensureDefaultCashAccounts()) migrated = true;
  if (ensureCashAccountGroups()) migrated = true;
  if (ensureDefaultLifeAccounts()) migrated = true;
  if (ensureLifeAccountGroups()) migrated = true;
  if (ensureDefaultLongReminders()) migrated = true;
  if (syncCreditRepayReminders()) migrated = true;
  if (migrated) registryNeedsPersist = true;
}

export function getAccountsState() {
  return { accountCardFaces, accountLogos, accountRegistry };
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
  stampAccountUpdatedAt(payKey);
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

function stampAccountUpdatedAt(payKey) {
  const iso = new Date().toISOString();
  if (isManualKey(payKey)) {
    const entry = getManualEntry(payKey);
    if (entry) entry.updatedAt = iso;
  } else {
    const prev = accountRegistry.overrides[payKey] || {};
    accountRegistry.overrides[payKey] = { ...prev, updatedAt: iso };
  }
  return iso;
}

function getAccountUpdatedAt(payKey) {
  const manual = getManualEntry(payKey);
  if (manual?.updatedAt) return String(manual.updatedAt);
  const ov = getOverride(payKey);
  if (ov?.updatedAt) return String(ov.updatedAt);
  const credit = getRawCreditInfo(payKey);
  return credit?.updatedAt ? String(credit.updatedAt) : null;
}

function resolveCardUpdatedAt(payKey) {
  const cardAt = getAccountUpdatedAt(payKey);
  const pool = creditPoolForCard(payKey);
  const poolAt = pool?.updatedAt ? String(pool.updatedAt) : null;
  if (!cardAt) return poolAt;
  if (!poolAt) return cardAt;
  return new Date(cardAt) >= new Date(poolAt) ? cardAt : poolAt;
}

function isEditedToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function formatCreditEditedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (isEditedToday(iso)) return `今天 ${hh}:${mm}`;
  if (d.getFullYear() === now.getFullYear()) return `${mo}-${day} ${hh}:${mm}`;
  return `${d.getFullYear()}-${mo}-${day}`;
}

function creditEditedAtCell(iso) {
  const text = formatCreditEditedAt(iso);
  const today = isEditedToday(iso);
  return `<span class="accounts-credit-edited${today ? ' is-today' : ''}"${iso ? ` title="${esc(iso)}"` : ''}>${esc(text)}</span>`;
}

function creditRowEditedClass(iso, extra = []) {
  return [
    ...extra,
    isEditedToday(iso) ? 'is-edited-today' : ''
  ].filter(Boolean).join(' ');
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
  stampAccountUpdatedAt(payKey);
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
    stampAccountUpdatedAt(payKey);
    return true;
  }
  const prev = accountRegistry.overrides[payKey] || {};
  accountRegistry.overrides[payKey] = { ...prev, kind: '信用卡' };
  if (label) accountRegistry.overrides[payKey].label = label;
  if (digits) accountRegistry.overrides[payKey].digits = digits;
  applyTag(accountRegistry.overrides[payKey]);
  stampAccountUpdatedAt(payKey);
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
        updatedAt: resolveCardUpdatedAt(r.key),
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

function homeCreditTipPhaseLabel(row) {
  if (!row?.span) return '';
  const phase = creditTimelinePhase(row.span, startOfDay(new Date()));
  if (phase.phase === 'during') return `免息还剩 ${row.daysRemaining} 天`;
  if (phase.phase === 'before') return phase.label;
  return '已过还款日';
}

function renderHomeMobileRemindersHtml() {
  ensureLongReminders();
  const items = activeLongReminders();
  if (!items.length) {
    return `<section class="home-insight-card">
      <div class="home-insight-head">
        <h3 class="home-insight-title"><i class="ti ti-bell-ringing"></i> 提醒事项</h3>
        <button type="button" class="btn btn-sm" onclick="sw('reminders',document.querySelector('.ni[title=\\'提醒事项\\']'))">管理</button>
      </div>
      <p class="home-insight-empty">暂无待办提醒</p>
    </section>`;
  }
  const rows = items.slice(0, 6).map(item => {
    const remaining = reminderRemainingInfo(item.expiry);
    const autoTag = item.source === 'credit-repay'
      ? '<span class="accounts-reminder-auto-tag" title="由信用卡欠款自动生成">自动</span>'
      : '';
    return `<div class="home-insight-reminder">
      <button type="button" class="accounts-reminder-done-btn" data-toggle-reminder-done="${esc(item.id)}" title="标为已完成" aria-label="标为已完成">
        <i class="ti ti-circle"></i>
      </button>
      <div class="home-insight-reminder-main">
        <span class="home-insight-reminder-name">${esc(item.name)}${autoTag}</span>
        <span class="home-insight-reminder-meta">
          <span>${formatBudgetDateLabel(item.expiry)}</span>
          <span class="home-insight-reminder-remain is-${remaining.status}">${esc(remaining.label)}</span>
        </span>
      </div>
    </div>`;
  }).join('');
  const more = items.length > 6
    ? `<button type="button" class="home-insight-more" onclick="sw('reminders',document.querySelector('.ni[title=\\'提醒事项\\']'))">还有 ${items.length - 6} 项…</button>`
    : '';
  return `<section class="home-insight-card">
    <div class="home-insight-head">
      <h3 class="home-insight-title"><i class="ti ti-bell-ringing"></i> 提醒事项 <span class="home-insight-cnt">${items.length}</span></h3>
      <button type="button" class="btn btn-sm" onclick="sw('reminders',document.querySelector('.ni[title=\\'提醒事项\\']'))">全部</button>
    </div>
    <div class="home-insight-reminder-list">${rows}</div>
    ${more}
  </section>`;
}

function renderHomeMobileCreditTipsHtml() {
  const ranked = creditCardPriorityList(creditCardAccounts()).filter(r => r.hasSchedule);
  if (!ranked.length) {
    return `<section class="home-insight-card home-insight-card--credit">
      <div class="home-insight-credit-row">
        <span class="home-insight-credit-label"><i class="ti ti-sparkles"></i> 今日优先</span>
        <p class="home-insight-empty home-insight-empty--inline">完善账单日/还款日后显示推荐卡</p>
      </div>
    </section>`;
  }
  const items = ranked.map((row, i) => {
    const name = row.acc.displayName || creditCardDisplayName(row.acc);
    const phase = creditTimelinePhase(row.span, startOfDay(new Date()));
    const topCls = i === 0 ? ' is-top' : '';
    const title = `${name} · ${homeCreditTipPhaseLabel(row)} · 还款 ${fmtTimelineDate(row.span.freeEnd)}`;
    return `<li class="home-insight-credit-chip${topCls}" title="${esc(title)}">
      ${i === 0 ? '<span class="home-insight-credit-badge">推荐</span>' : `<span class="home-insight-credit-rank">${i + 1}</span>`}
      ${accountBrandMarkHtml(row.acc.pay, 18)}
      <span class="home-insight-credit-name">${esc(name)}</span>
      <span class="home-insight-credit-days is-${phase.phase}">${row.daysRemaining}天</span>
    </li>`;
  }).join('');
  return `<section class="home-insight-card home-insight-card--credit">
    <div class="home-insight-credit-row">
      <span class="home-insight-credit-label"><i class="ti ti-sparkles"></i> 今日优先</span>
      <ol class="home-insight-credit-strip">${items}</ol>
    </div>
  </section>`;
}

export function renderHomeMobileInsights() {
  const el = document.getElementById('homeMobileInsights');
  if (!el) return;
  el.innerHTML = `${renderHomeMobileCreditTipsHtml()}${renderHomeMobileRemindersHtml()}`;
  if (!el._doneToggleBound) {
    el._doneToggleBound = true;
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-toggle-reminder-done]');
      if (!btn?.dataset.toggleReminderDone) return;
      e.preventDefault();
      toggleLongReminderDone(btn.dataset.toggleReminderDone);
    });
  }
}

function creditNameCell(payKey, labelVal = '', { isNew = false } = {}) {
  const logo = isNew
    ? '<span class="fund-brand-mark fund-brand-mark--fb accounts-credit-logo-ph" style="width:24px;height:24px"><i class="ti ti-credit-card" style="font-size:12px"></i></span>'
    : accountBrandMarkHtml(payKey, 24);
  if (isNew) {
    return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">
      ${logo}
      <input type="text" class="accounts-credit-label" placeholder="银行名称 *">
    </div>`;
  }
  const labelAttr = `value="${esc(labelVal)}" placeholder="银行名称"`;
  return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">${logo}<input type="text" class="accounts-credit-label" ${labelAttr}></div>`;
}

function creditTagDisplayCell(acc) {
  const tag = (acc.tag || '').trim();
  if (!tag) return '<span class="accounts-credit-val accounts-credit-val--muted">—</span>';
  return `<span class="accounts-credit-tag-badge">${esc(tag)}</span>`;
}

function creditTagEditCell(acc, { isNew = false } = {}) {
  const tagVal = isNew ? '' : (acc?.tag || '');
  return `<input type="text" class="accounts-credit-tag" value="${esc(tagVal)}" placeholder="如 VISA双币">`;
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
  return `<div class="accounts-credit-name-cell">${creditBrandMarkHtml(acc.pay, 24, { cancelled: !!acc.cancelled })}<span class="accounts-credit-val accounts-credit-val--name">${esc(displayName)}</span></div>`;
}

function creditNameEditCell(acc) {
  const displayName = acc.displayName || creditCardDisplayName(acc);
  return `<div class="accounts-credit-name-cell accounts-credit-name-cell--edit">
    ${creditBrandMarkHtml(acc.pay, 24, { cancelled: !!acc.cancelled })}
    <span class="accounts-credit-val accounts-credit-val--name">${esc(displayName)}</span>
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
  const updatedAt = acc?.updatedAt || null;
  const bindTd = editing && !isNew
    ? `<td class="accounts-credit-bind-td"><input type="checkbox" class="accounts-credit-bind-cb" title="选择绑定"></td>`
    : editing ? '<td class="accounts-credit-bind-td"></td>' : '';
  const editedTd = editing
    ? `<td class="accounts-credit-td-edited">${isNew ? '<span class="accounts-credit-edited">—</span>' : creditEditedAtCell(updatedAt)}</td>`
    : '';

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
    const rowCls = creditRowEditedClass(updatedAt, [
      pooled ? 'accounts-credit-pool-card' : '',
      cancelled ? 'is-cancelled' : ''
    ]);
    return `<tr data-credit-key="${esc(acc.pay)}"${rowCls ? ` class="${rowCls}"` : ''}>
      <td>${creditNameDisplayCell(acc)}</td>
      <td class="accounts-credit-td-tag">${creditTagDisplayCell(acc)}</td>
      <td><span class="accounts-credit-val">${esc(last4 || '—')}</span></td>
      <td><span class="accounts-credit-val">${limitCell}</span></td>
      <td><span class="accounts-credit-val">${availCell}</span></td>
      <td><span class="accounts-credit-val">${debtCell}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.billDay)}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.dueDay)}</span></td>
      <td class="accounts-credit-td-edited">${creditEditedAtCell(updatedAt)}</td>
      <td class="accounts-credit-tl-td">${renderInlineCreditTimeline(acc)}</td>
    </tr>`;
  }

  const fields = creditFieldInputs(c, '', { pooled });
  if (isNew) {
    return `<tr data-credit-new="1">
      ${bindTd}
      <td class="accounts-credit-td-account">${creditNameCell('', '', { isNew: true })}</td>
      <td class="accounts-credit-td-tag">${creditTagEditCell(null, { isNew: true })}</td>
      <td class="accounts-credit-td-cardno">${creditDigitsInput(null, { isNew: true })}</td>
      <td class="accounts-credit-td-amt">${fields.limit}</td>
      <td class="accounts-credit-td-amt">${fields.available}</td>
      <td class="accounts-credit-td-amt">${fields.debt}</td>
      <td class="accounts-credit-td-day">${fields.billDay}</td>
      <td class="accounts-credit-td-day">${fields.dueDay}</td>
      ${editedTd}
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
  const rowCls = creditRowEditedClass(updatedAt, [
    pooled ? 'accounts-credit-pool-card' : '',
    acc.cancelled ? 'is-cancelled' : ''
  ]);
  return `<tr data-credit-key="${esc(acc.pay)}"${rowCls ? ` class="${rowCls}"` : ''}>
    ${bindTd}
    <td class="accounts-credit-td-account">${creditNameEditCell(acc)}</td>
    <td class="accounts-credit-td-tag">${creditTagEditCell(acc)}</td>
    <td class="accounts-credit-td-cardno">${creditDigitsInput(acc)}</td>
    <td class="accounts-credit-td-amt">${fields.limit}</td>
    <td class="accounts-credit-td-amt">${fields.available}</td>
    <td class="accounts-credit-td-amt">${fields.debt}</td>
    <td class="accounts-credit-td-day">${fields.billDay}</td>
    <td class="accounts-credit-td-day">${fields.dueDay}</td>
    ${editedTd}
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
  const editedTd = '<td class="accounts-credit-td-edited"></td>';
  return `<tr class="accounts-credit-sum-row">
    ${bindTd}
    <td colspan="3"><span class="accounts-credit-sum-label">合计</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.limit)}</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.available)}</span></td>
    <td class="accounts-credit-td-amt"><span class="accounts-credit-val accounts-credit-val--sum">${formatCreditBrowseAmount(totals.debt)}</span></td>
    ${editing ? '<td colspan="2"></td>' : '<td colspan="2"></td>'}
    ${editedTd}
    ${editing ? '' : '<td></td>'}
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
    const updatedAt = acc.updatedAt || null;
    const rowCls = creditRowEditedClass(updatedAt, [
      'accounts-credit-pool-card',
      i === 0 ? 'accounts-credit-pool-card--first' : '',
      cancelled ? 'is-cancelled' : ''
    ]);
    return `<tr data-credit-key="${esc(acc.pay)}" class="${rowCls}" data-credit-pool="${esc(pool.id)}">
      ${renderCreditPoolAccountTd(acc, pool, false, i === 0)}
      <td class="accounts-credit-td-tag">${creditTagDisplayCell(acc)}</td>
      <td><span class="accounts-credit-val">${esc(last4 || '—')}</span></td>
      ${amtCells}
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.billDay)}</span></td>
      <td><span class="accounts-credit-val">${formatCreditBrowseDay(c.dueDay)}</span></td>
      <td class="accounts-credit-td-edited">${creditEditedAtCell(updatedAt)}</td>
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
    const updatedAt = acc.updatedAt || null;
    const rowCls = creditRowEditedClass(updatedAt, [
      'accounts-credit-pool-card',
      i === 0 ? 'accounts-credit-pool-card--first' : '',
      acc.cancelled ? 'is-cancelled' : ''
    ]);
    return `<tr data-credit-key="${esc(acc.pay)}" class="${rowCls}" data-credit-pool="${esc(pool.id)}">
      ${bindTd}
      ${renderCreditPoolAccountTd(acc, pool, true, i === 0)}
      <td class="accounts-credit-td-tag">${creditTagEditCell(acc)}</td>
      <td class="accounts-credit-td-cardno">${creditDigitsInput(acc)}</td>
      ${amtCells}
      <td class="accounts-credit-td-day">${fields.billDay}</td>
      <td class="accounts-credit-td-day">${fields.dueDay}</td>
      <td class="accounts-credit-td-edited">${creditEditedAtCell(updatedAt)}</td>
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
  const colSpan = editing ? 11 : 10;
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
    ? `<button type="button" class="btn btn-sm btn-p" data-bind-credit-group="${group.id}" title="将选中的卡绑定为共享额度"><i class="ti ti-link"></i> 绑定共享额度</button>`
    : '';
  const tlTh = editing ? '' : '<th class="accounts-credit-col-tl">免息期</th>';
  const editedTh = '<th class="accounts-credit-col-edited">编辑时间</th>';
  const colgroup = editing
    ? `<colgroup>
        <col class="accounts-credit-col-bind">
        <col class="accounts-credit-col-name">
        <col class="accounts-credit-col-tag">
        <col class="accounts-credit-col-cardno">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-edited">
        <col class="accounts-credit-col-actions">
      </colgroup>`
    : `<colgroup>
        <col class="accounts-credit-col-name">
        <col class="accounts-credit-col-tag">
        <col class="accounts-credit-col-tail">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-amt">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-day">
        <col class="accounts-credit-col-edited">
        <col class="accounts-credit-col-tl">
      </colgroup>`;
  const body = group.cards.length
    ? `${renderCreditCardGroupTableBody(group, editing)}${renderCreditGroupSummaryRow(group, editing)}`
    : (() => {
        const colSpan = editing ? 11 : 10;
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
          ${bindTh}<th class="accounts-credit-th-account">账户</th><th class="accounts-credit-th-tag">标签</th>${digitTh}<th class="accounts-credit-th-amt">额度</th><th class="accounts-credit-th-amt">可用</th><th class="accounts-credit-th-amt">欠款</th><th class="accounts-credit-th-day">账单日</th><th class="accounts-credit-th-day">还款日</th>${editedTh}${tlTh}${actionTh}
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
  el.querySelectorAll('.accounts-credit-priority-wrap, .accounts-credit-priority-strip').forEach(bindScrollRevealFn);
}

export function toggleCreditCardEditMode() {
  creditCardEditMode = !creditCardEditMode;
  renderCreditCardSection();
}

function parseCashMoneyInput(v) {
  const s = String(v ?? '').replace(/^(HK\$?|HKD|港币|港元)\s*/i, '').replace(/[,，\s¥￥]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function cashFxRate() {
  const rate = Number(accountRegistry?.hkdRate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_HKD_CNY;
}

function cashAccountCurrency(acc) {
  return normalizeCurrency(acc?.currency);
}

function cashBalanceInCny(acc) {
  return amountInCny(acc?.balance, cashAccountCurrency(acc), cashFxRate());
}

function cashAccountsList() {
  return Array.isArray(accountRegistry.cashAccounts) ? accountRegistry.cashAccounts : [];
}

function sumCashField(field) {
  return cashAccountsList().reduce((s, a) => s + (Number(a[field]) || 0), 0);
}

/** 现金总额按人民币折合（港币账户用 hkdRate） */
function sumCashBalance() {
  return cashAccountsList().reduce((s, a) => s + cashBalanceInCny(a), 0);
}

function sumAllCreditDebt() {
  const totals = sumCreditGroupTotals(creditCardAccounts());
  return totals.debt != null ? totals.debt : 0;
}

function sumAllCreditLimit() {
  const totals = sumCreditGroupTotals(creditCardAccounts());
  return totals.limit != null ? totals.limit : 0;
}

function renderAccountsStatusSection() {
  const el = document.getElementById('accountsStatusSection');
  if (!el) return;
  const cashBalance = sumCashBalance();
  const creditLimit = sumAllCreditLimit();
  const creditDebt = sumAllCreditDebt();
  const budgetTotal = sumBudgetAmount();
  const net = cashBalance - creditDebt;
  const netCls = net >= 0 ? 'accounts-status-item--net-pos' : 'accounts-status-item--net-neg';
  const hasHkd = cashAccountsList().some(a => cashAccountCurrency(a) === 'HKD');
  const cashLabel = hasHkd
    ? `<i class="ti ti-wallet"></i> 现金总额 <span class="accounts-status-fx" title="港币按 1 HKD = ¥${cashFxRate()} 折合">折合¥</span>`
    : `<i class="ti ti-wallet"></i> 现金总额`;
  el.innerHTML = `<div class="accounts-status-bar">
    <div class="accounts-status-item accounts-status-item--budget">
      <span class="accounts-status-label"><i class="ti ti-calendar-event"></i> 预算支出</span>
      <span class="accounts-status-val">${fmtMoney(budgetTotal)}</span>
    </div>
    <div class="accounts-status-item accounts-status-item--cash">
      <span class="accounts-status-label">${cashLabel}</span>
      <span class="accounts-status-val">${fmtMoney(cashBalance)}</span>
    </div>
    <div class="accounts-status-item accounts-status-item--limit">
      <span class="accounts-status-label"><i class="ti ti-credit-card"></i> 信用卡额度</span>
      <span class="accounts-status-val">${fmtMoney(creditLimit)}</span>
    </div>
    <div class="accounts-status-item accounts-status-item--debt">
      <span class="accounts-status-label"><i class="ti ti-receipt-2"></i> 信用卡欠款</span>
      <span class="accounts-status-val">${fmtMoney(creditDebt)}</span>
    </div>
    <div class="accounts-status-item ${netCls}">
      <span class="accounts-status-label"><i class="ti ti-scale"></i> 收支平衡度</span>
      <span class="accounts-status-val">${fmtMoneySigned(net)}</span>
    </div>
  </div>`;
}

function cashAccountBrandMarkHtml(name, size = 22, accountId = '') {
  const custom = accountId ? accountLogos[accountId] : null;
  if (custom) {
    return `<img class="fund-brand-logo" src="${esc(custom)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.style.display='none'">`;
  }
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

function cashAccountCardNumberHtml(acc) {
  const editingCard = editingCashCardId === acc.id;
  const num = String(acc.cardNumber || '');
  if (editingCard) {
    return `<input type="text" class="accounts-cash-inp accounts-cash-card" value="${esc(num)}" placeholder="卡号" autocomplete="off" inputmode="numeric" data-cash-card-input="${esc(acc.id)}">`;
  }
  if (num) {
    return `<span class="accounts-cash-card-num" data-cash-card="${esc(acc.id)}" title="双击编辑卡号">${esc(num)}</span>`;
  }
  return `<span class="accounts-cash-card-num is-empty" data-cash-card="${esc(acc.id)}" title="双击添加卡号">双击添加卡号</span>`;
}

function cashAccountNameCell(acc, editing) {
  const logo = cashAccountBrandMarkHtml(acc.name, 22, acc.id);
  if (editing) {
    return `<div class="accounts-cash-name-cell">${logo}<div class="accounts-cash-name-stack"><input type="text" class="accounts-cash-inp accounts-cash-name" value="${esc(acc.name)}" placeholder="账户名称">${cashAccountCardNumberHtml(acc)}</div></div>`;
  }
  return `<div class="accounts-cash-name-cell">${logo}<div class="accounts-cash-name-stack"><span class="accounts-cash-val accounts-cash-val--name">${esc(acc.name)}</span>${cashAccountCardNumberHtml(acc)}</div></div>`;
}

function groupCashAccounts(accounts) {
  const map = Object.fromEntries(CASH_ACCOUNT_GROUPS.map(g => [g.id, []]));
  accounts.forEach(a => {
    const gid = normalizeCashGroupId(a.groupId, a.name);
    (map[gid] || map[DEFAULT_CASH_GROUP_ID]).push(a);
  });
  return CASH_ACCOUNT_GROUPS.map(g => ({
    ...g,
    accounts: map[g.id],
    sum: map[g.id].reduce((s, a) => s + cashBalanceInCny(a), 0),
    allHkd: map[g.id].length > 0 && map[g.id].every(a => cashAccountCurrency(a) === 'HKD'),
    nativeSum: map[g.id].reduce((s, a) => s + (Number(a.balance) || 0), 0)
  }));
}

function cashDragHandleHtml() {
  return `<span class="accounts-cash-drag" draggable="true" title="拖到其他分组" aria-label="拖到其他分组"><i class="ti ti-grip-vertical"></i></span>`;
}

function renderCashAccountCard(acc) {
  const editing = editingCashId === acc.id;
  const cur = cashAccountCurrency(acc);
  const hkdCls = cur === 'HKD' ? ' is-hkd' : '';
  if (editing) {
    return `<section class="accounts-cash-item is-editing" data-cash-id="${esc(acc.id)}" data-cash-group-id="${esc(normalizeCashGroupId(acc.groupId, acc.name))}">
      <div class="accounts-cash-item-row">
        ${cashDragHandleHtml()}
        ${cashAccountNameCell(acc, true)}
        <select class="accounts-cash-inp accounts-cash-currency" aria-label="币种" title="币种">
          <option value="CNY"${cur === 'CNY' ? ' selected' : ''}>¥</option>
          <option value="HKD"${cur === 'HKD' ? ' selected' : ''}>HK$</option>
        </select>
        <input type="text" class="accounts-cash-inp accounts-cash-amt" inputmode="decimal" value="${creditInputVal(acc.balance)}" placeholder="0.00">
        <button type="button" class="btn btn-sm btn-a accounts-cash-del" data-delete-cash="${esc(acc.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </div>
    </section>`;
  }
  return `<section class="accounts-cash-item" data-cash-id="${esc(acc.id)}" data-cash-group-id="${esc(normalizeCashGroupId(acc.groupId, acc.name))}" title="双击编辑">
    <div class="accounts-cash-item-row">
      ${cashDragHandleHtml()}
      ${cashAccountNameCell(acc, false)}
      <span class="accounts-cash-val accounts-cash-val--bal${hkdCls}">${fmtMoney(acc.balance, { currency: cur })}</span>
    </div>
  </section>`;
}

function renderCashGroupSection(group) {
  const cards = group.accounts.map(acc => renderCashAccountCard(acc)).join('');
  const hasHkd = group.accounts.some(a => cashAccountCurrency(a) === 'HKD');
  const sumLabel = hasHkd ? '合计（折合¥）' : '合计';
  const sumItem = group.accounts.length
    ? `<div class="accounts-cash-sum-item" aria-label="${esc(group.name)}合计">
        <div class="accounts-cash-item-row">
          <span class="accounts-cash-sum-label">${sumLabel}</span>
          <span class="accounts-cash-val accounts-cash-val--sum">${fmtMoney(group.sum)}</span>
        </div>
      </div>`
    : '';
  const empty = group.accounts.length
    ? ''
    : `<div class="accounts-cash-group-empty">暂无账户，可从其他组拖入</div>`;
  return `<section class="accounts-cash-group" data-cash-group="${esc(group.id)}">
    <div class="accounts-cash-group-head">
      <h4 class="accounts-cash-group-title">${esc(group.name)} <span class="accounts-cash-group-cnt">${group.accounts.length} 个</span></h4>
    </div>
    <div class="accounts-cash-grid" data-cash-dropzone="${esc(group.id)}">
      ${cards}
      ${sumItem}
      ${empty}
    </div>
  </section>`;
}

function renderCashAccountsSection() {
  const el = document.getElementById('accountsCashSection');
  if (!el) return;
  ensureCashAccountGroups();
  const accounts = cashAccountsList();
  const groups = groupCashAccounts(accounts);
  el.innerHTML = `<div class="cc full accounts-cash-card">
    <div class="accounts-cash-head">
      <div class="accounts-cash-head-top">
        <div class="ct"><i class="ti ti-wallet"></i> 现金账户登记 <span class="accounts-credit-cnt">${accounts.length} 个</span></div>
        <button type="button" class="btn btn-sm accounts-cash-add" onclick="addCashAccountRow()" title="新增现金账户" aria-label="新增现金账户"><i class="ti ti-plus"></i></button>
      </div>
      <p class="accounts-cash-hint">双击账户可修改名称、币种（¥ / HK$）与余额；按住左侧图标可拖到「胡晗 / 陈橙 / 公司」分组。港币在汇总时按账户登记汇率折合人民币。</p>
    </div>
    <div class="accounts-cash-groups">
      ${groups.map(g => renderCashGroupSection(g)).join('')}
    </div>
  </div>`;
  if (editingCashId) {
    el.querySelector(`[data-cash-id="${CSS.escape(editingCashId)}"] .accounts-cash-name`)?.focus();
  } else if (editingCashCardId) {
    el.querySelector(`[data-cash-card-input="${CSS.escape(editingCashCardId)}"]`)?.focus();
  }
}

export function toggleCashAccountEditMode() {
  const first = cashAccountsList()[0];
  if (first) beginCashEdit(first.id);
}

function beginCashEdit(id) {
  if (!id || editingCashId === id) return;
  if (!cashAccountsList().some(acc => acc.id === id)) return;
  if (editingCashCardId) {
    const prevCard = document.querySelector(`#accountsCashSection [data-cash-card-input="${CSS.escape(editingCashCardId)}"]`);
    if (prevCard) saveCashCardNumber(prevCard);
  }
  if (editingCashId) {
    const prev = document.querySelector(`#accountsCashSection [data-cash-id="${CSS.escape(editingCashId)}"]`);
    if (prev && !saveCashAccountRow(prev)) return;
  }
  editingCashId = id;
  editingCashCardId = null;
  renderCashAccountsSection();
}

function beginCashCardEdit(id) {
  if (!id || editingCashCardId === id) return;
  if (!cashAccountsList().some(acc => acc.id === id)) return;
  if (editingCashId) {
    const prev = document.querySelector(`#accountsCashSection [data-cash-id="${CSS.escape(editingCashId)}"]`);
    if (prev && !saveCashAccountRow(prev)) return;
  }
  if (editingCashCardId) {
    const prevCard = document.querySelector(`#accountsCashSection [data-cash-card-input="${CSS.escape(editingCashCardId)}"]`);
    if (prevCard) saveCashCardNumber(prevCard);
  }
  editingCashCardId = id;
  renderCashAccountsSection();
}

function saveCashCardNumber(input) {
  const id = input?.dataset?.cashCardInput || editingCashCardId;
  if (!id) return false;
  const acc = accountRegistry.cashAccounts.find(a => a.id === id);
  if (!acc) return false;
  acc.cardNumber = String(input?.value ?? '').trim();
  if (editingCashCardId === id) editingCashCardId = null;
  flushAccountPersist();
  renderCashAccountsSection();
  return true;
}

function saveCashAccountRow(row) {
  const id = row?.dataset?.cashId;
  if (!id) return false;
  const acc = accountRegistry.cashAccounts.find(a => a.id === id);
  if (!acc) return false;
  const nameInput = row.querySelector('.accounts-cash-name');
  if (!nameInput) return false;
  const name = nameInput.value.trim();
  if (!name) {
    alert('请填写账户名称');
    nameInput.focus();
    return false;
  }
  const inputs = row.querySelectorAll('.accounts-cash-amt');
  const currencySel = row.querySelector('.accounts-cash-currency');
  acc.name = name;
  acc.balance = parseCashMoneyInput(inputs[0]?.value);
  acc.currency = normalizeCurrency(currencySel?.value || acc.currency);
  if (editingCashId === id) editingCashId = null;
  flushAccountPersist();
  renderAccountsPage();
  return true;
}

export function moveCashAccountToGroup(cashId, groupId) {
  if (!cashId) return false;
  const gid = normalizeCashGroupId(groupId);
  if (!Array.isArray(accountRegistry.cashAccounts)) return false;
  const list = accountRegistry.cashAccounts;
  const idx = list.findIndex(a => a.id === cashId);
  if (idx < 0) return false;
  const acc = list[idx];
  const prev = normalizeCashGroupId(acc.groupId, acc.name);
  if (prev === gid) return false;
  list.splice(idx, 1);
  acc.groupId = gid;
  let insertAt = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (normalizeCashGroupId(list[i].groupId, list[i].name) === gid) {
      insertAt = i + 1;
      break;
    }
  }
  list.splice(insertAt, 0, acc);
  flushAccountPersist();
  return true;
}

export function addCashAccountRow(groupId = DEFAULT_CASH_GROUP_ID) {
  if (editingCashId) {
    const prev = document.querySelector(`#accountsCashSection [data-cash-id="${CSS.escape(editingCashId)}"]`);
    if (prev && !saveCashAccountRow(prev)) return;
  }
  if (!Array.isArray(accountRegistry.cashAccounts)) accountRegistry.cashAccounts = [];
  const gid = normalizeCashGroupId(groupId);
  const id = nextCashAccountId();
  const acc = {
    id,
    name: '',
    balance: 0,
    initial: 0,
    groupId: gid,
    cardNumber: '',
    currency: 'CNY'
  };
  let insertAt = accountRegistry.cashAccounts.length;
  for (let i = accountRegistry.cashAccounts.length - 1; i >= 0; i--) {
    if (normalizeCashGroupId(accountRegistry.cashAccounts[i].groupId, accountRegistry.cashAccounts[i].name) === gid) {
      insertAt = i + 1;
      break;
    }
  }
  accountRegistry.cashAccounts.splice(insertAt, 0, acc);
  editingCashId = id;
  renderCashAccountsSection();
}

export function deleteCashAccount(id) {
  if (!id) return;
  const acc = accountRegistry.cashAccounts.find(a => a.id === id);
  if (!acc) return;
  if (!confirm(`确定删除现金账户「${acc.name || '未命名'}」？`)) return;
  if (editingCashId === id) editingCashId = null;
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

function dateToIsoLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function billDateForDue(billDay, dueDay, dueDate) {
  const bill = parseCreditDay(billDay);
  const due = parseCreditDay(dueDay);
  if (!bill || !due || !(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) return null;
  const due0 = startOfDay(dueDate);
  const sameMonth = mkMonthDay(due0.getFullYear(), due0.getMonth(), bill);
  const prevMonth = mkMonthDay(due0.getFullYear(), due0.getMonth() - 1, bill);
  return [due > bill ? sameMonth : prevMonth, sameMonth, prevMonth]
    .find(candidate => dayNum(dueDateForBill(candidate, due)) === dayNum(due0)) || null;
}

function parseIsoLocalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return startOfDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** 这一期账单已经出、还款日还没到，才重新打开已完成的还款提醒 */
function creditStatementOpen(billDay, dueDay, expiryIso, today = new Date()) {
  const dueDate = parseIsoLocalDate(expiryIso);
  if (!dueDate) return false;
  const today0 = startOfDay(today);
  if (dayNum(dueDate) <= dayNum(today0)) return false;
  const billDate = billDateForDue(billDay, dueDay, dueDate);
  if (!billDate) return false;
  return dayNum(today0) >= dayNum(billDate);
}

function nextCreditRepaymentDate(billDay, dueDay, ref = new Date()) {
  const day = parseCreditDay(dueDay);
  if (!day) return null;
  const bill = parseCreditDay(billDay);
  if (bill) {
    const span = creditInterestFreeSpan(bill, day, ref);
    if (!span) return null;
    const today = startOfDay(ref);
    return dayNum(span.currentDue) >= dayNum(today) ? span.currentDue : span.freeEnd;
  }
  const today = startOfDay(ref);
  let due = mkMonthDay(today.getFullYear(), today.getMonth(), day);
  if (due < today) due = mkMonthDay(today.getFullYear(), today.getMonth() + 1, day);
  return due;
}

function creditRepayReminderSourceKey(payKey) {
  return registryStorageKey(canonicalAccountKey(payKey) || payKey);
}

function creditRepayReminderId(sourceKey) {
  const safe = String(sourceKey || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return `cc-repay-${safe || 'unknown'}`;
}

function creditRepayReminderName(cardName, amount) {
  return `信用卡还款 · ${cardName} · ${fmtMoney(amount)}`;
}

function clearCreditRepayReminderLocks(item) {
  if (!item) return;
  delete item.nameLocked;
  delete item.expiryLocked;
  delete item.amountLocked;
}

function reminderCreditCardName(sourceKey) {
  if (!sourceKey) return '';
  try {
    const card = creditCardAccounts().find(c => creditRepayReminderSourceKey(c.pay) === sourceKey);
    if (card) return card.displayName || creditCardDisplayName(card) || '';
  } catch (_) { /* ignore */ }
  return '';
}

function reminderDisplayAmount(item) {
  const n = Number(item?.amount);
  if (Number.isFinite(n) && n >= 0) return n;
  if (item?.source === 'credit-repay' && item.sourceKey) {
    try {
      const credit = getEffectiveCreditInfo(item.sourceKey);
      const debt = Number(credit?.debt);
      if (Number.isFinite(debt) && debt >= 0) return debt;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/** 把提醒里改的还款金额写回对应信用卡/共享额度欠款 */
function applyReminderAmountToCredit(item, amount) {
  if (!item?.sourceKey || !(amount >= 0)) return false;
  const payKey = item.sourceKey;
  const pool = creditPoolForCard(payKey);
  if (pool) {
    pool.debt = amount;
    if (pool.limit != null) {
      pool.available = roundCreditAmount(Math.max(0, Number(pool.limit) - amount));
    }
    stampAccountUpdatedAt(payKey);
    return true;
  }
  const prev = getRawCreditInfo(payKey) || {};
  const next = { ...prev, debt: amount };
  if (prev.limit != null) {
    next.available = roundCreditAmount(Math.max(0, Number(prev.limit) - amount));
  }
  return applyCreditToAccount(payKey, next);
}

/** 有欠款的信用卡：把下一还款日同步进长期提醒。新一期账单出来后，重新打开上一期已完成的提醒。欠款清零则移除。 */
function syncCreditRepayReminders() {
  ensureLongReminders();
  let cards = [];
  try {
    cards = creditCardAccounts().filter(c => !c.cancelled);
  } catch (_) {
    return false;
  }

  const wanted = new Map();
  cards.forEach(card => {
    const debt = Number(card.credit?.debt);
    if (!(debt > 0)) return;
    const dueDate = nextCreditRepaymentDate(card.credit?.billDay, card.credit?.dueDay);
    if (!dueDate) return;
    const sourceKey = creditRepayReminderSourceKey(card.pay);
    const cardName = card.displayName || creditCardDisplayName(card);
    wanted.set(sourceKey, {
      cardName,
      amount: debt,
      name: creditRepayReminderName(cardName, debt),
      expiry: dateToIsoLocal(dueDate),
      billDay: card.credit?.billDay,
      dueDay: card.credit?.dueDay
    });
  });

  const list = accountRegistry.longReminders;
  let changed = false;

  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (item.source !== 'credit-repay') continue;
    const next = wanted.get(item.sourceKey);
    if (!next) {
      list.splice(i, 1);
      changed = true;
      continue;
    }
    const reopen = item.done
      && item.settledExpiry !== next.expiry
      && creditStatementOpen(next.billDay, next.dueDay, next.expiry);
    if (reopen) {
      item.name = next.name;
      item.amount = next.amount;
      item.expiry = next.expiry;
      item.category = '金融';
      item.done = false;
      delete item.settledExpiry;
      clearCreditRepayReminderLocks(item);
      changed = true;
      wanted.delete(item.sourceKey);
      continue;
    }

    let did = false;
    if (item.category !== '金融') {
      item.category = '金融';
      did = true;
    }

    const useAmount = item.amountLocked && Number.isFinite(Number(item.amount))
      ? Number(item.amount)
      : next.amount;
    if (!item.amountLocked && item.amount !== next.amount) {
      item.amount = next.amount;
      did = true;
    }

    const autoName = creditRepayReminderName(next.cardName, useAmount);
    if (!item.nameLocked && item.name !== autoName) {
      item.name = autoName;
      did = true;
    }
    if (!item.expiryLocked && item.expiry !== next.expiry) {
      item.expiry = next.expiry;
      did = true;
    }
    if (did) changed = true;
    wanted.delete(item.sourceKey);
  }

  for (const [sourceKey, next] of wanted) {
    list.push({
      id: creditRepayReminderId(sourceKey),
      name: next.name,
      amount: next.amount,
      expiry: next.expiry,
      category: '金融',
      source: 'credit-repay',
      sourceKey
    });
    changed = true;
  }

  return changed;
}

async function syncCreditRepayRemindersAndPersist() {
  if (!syncCreditRepayReminders()) return false;
  await flushAccountPersist();
  return true;
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
    const daDone = a.done ? 1 : 0;
    const dbDone = b.done ? 1 : 0;
    if (daDone !== dbDone) return daDone - dbDone;
    const da = normalizeBudgetDateIso(a.expiry) || '9999-99-99';
    const db = normalizeBudgetDateIso(b.expiry) || '9999-99-99';
    return da.localeCompare(db) || a.name.localeCompare(b.name, 'zh-CN');
  });
}

function activeLongReminders() {
  return sortedLongReminders().filter(item => !item.done);
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

function lifeDragHandleHtml() {
  return `<span class="accounts-life-drag" draggable="true" title="拖到其他分组" aria-label="拖到其他分组"><i class="ti ti-grip-vertical"></i></span>`;
}

function renderLifeAccountRow(item, editing) {
  const gid = normalizeLifeGroupId(item.groupId, item.name);
  if (editing) {
    return `<tr data-life-id="${esc(item.id)}" data-life-group-id="${esc(gid)}">
      <td class="accounts-life-drag-cell">${lifeDragHandleHtml()}</td>
      <td><div class="accounts-life-name-cell">${lifeAccountIconHtml(item.name)}<input type="text" class="accounts-life-inp accounts-life-name" value="${esc(item.name)}" placeholder="如：旌湖上境电费"></div></td>
      <td><input type="text" class="accounts-life-inp accounts-life-account" value="${esc(item.accountNo)}" placeholder="账号 / 户号" inputmode="numeric" autocomplete="off"></td>
      <td class="accounts-life-actions">
        <button type="button" class="btn btn-sm btn-a" data-delete-life="${esc(item.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }
  return `<tr data-life-id="${esc(item.id)}" data-life-group-id="${esc(gid)}">
    <td class="accounts-life-drag-cell">${lifeDragHandleHtml()}</td>
    <td><div class="accounts-life-name-cell">${lifeAccountIconHtml(item.name)}<span class="accounts-life-val accounts-life-val--name">${esc(item.name)}</span></div></td>
    <td><span class="accounts-life-val accounts-life-val--account">${item.accountNo ? esc(item.accountNo) : '—'}</span></td>
  </tr>`;
}

function renderLifeGroupSection(group, editing) {
  const actionCol = editing ? `<col class="accounts-life-col-actions">` : '';
  const actionTh = editing ? '<th class="accounts-life-col-actions"></th>' : '';
  const body = group.items.length
    ? group.items.map(item => renderLifeAccountRow(item, editing)).join('')
    : `<tr class="accounts-life-group-empty-row"><td colspan="${editing ? 4 : 3}" class="accounts-life-group-empty">暂无账户${editing ? '，可新增或从其他组拖入' : ''}</td></tr>`;
  const title = editing
    ? `<input type="text" class="accounts-life-group-name" data-life-group-name="${esc(group.id)}" value="${esc(group.name)}" placeholder="分组名称">`
    : `<h4 class="accounts-life-group-title">${esc(group.name)} <span class="accounts-life-group-cnt">${group.items.length} 项</span></h4>`;
  const addBtn = editing
    ? `<button type="button" class="btn btn-sm" onclick="addLifeAccountRow('${esc(group.id)}')" title="新增账户"><i class="ti ti-plus"></i></button>`
    : '';
  const delBtn = editing
    ? `<button type="button" class="btn btn-sm btn-a" data-delete-life-group="${esc(group.id)}" title="删除分组"><i class="ti ti-trash"></i></button>`
    : '';
  return `<section class="accounts-life-group" data-life-group="${esc(group.id)}">
    <div class="accounts-life-group-head">
      <div class="accounts-life-group-title-wrap">${title}</div>
      <div class="accounts-life-group-actions">${addBtn}${delBtn}</div>
    </div>
    <div class="accounts-life-table-wrap" data-life-dropzone="${esc(group.id)}">
      <table class="report-table accounts-life-table${editing ? ' is-editing' : ' is-viewing'}">
        <colgroup>
          <col class="accounts-life-col-drag">
          <col class="accounts-life-col-name">
          <col class="accounts-life-col-account">
          ${actionCol}
        </colgroup>
        <thead><tr><th class="accounts-life-col-drag"></th><th>名称</th><th>账号</th>${actionTh}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

function renderLifeAccountsSection() {
  const el = document.getElementById('accountsLifeSection');
  if (!el) return;
  ensureLifeAccountGroups();
  const items = lifeAccountsList();
  const groups = groupLifeAccounts(items);
  const editing = lifeAccountEditMode;
  const editTitle = editing ? '退出编辑' : '编辑';
  const addGroup = editing
    ? `<div class="accounts-life-foot"><button type="button" class="btn btn-sm" onclick="addLifeGroup()"><i class="ti ti-folder-plus"></i> 新增分组</button></div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-life-card${editing ? ' is-editing' : ' is-viewing'}">
    <div class="accounts-life-head">
      <div class="accounts-life-head-top">
        <div class="ct"><i class="ti ti-home-2"></i> 生活账户 <span class="accounts-credit-cnt">${items.length} 项</span></div>
        <button type="button" class="btn btn-sm accounts-credit-edit-btn${editing ? ' on' : ''}" onclick="toggleLifeAccountEditMode()" title="${editTitle}" aria-label="${editTitle}"><i class="ti ${editing ? 'ti-pencil-off' : 'ti-pencil'}"></i></button>
      </div>
      <p class="accounts-life-hint">默认「旌湖上境 / 时代嘉玺」，可拖动账户换组；编辑模式下可新增自定义分组</p>
    </div>
    <div class="accounts-life-groups">
      ${groups.map(g => renderLifeGroupSection(g, editing)).join('')}
    </div>
    ${addGroup}
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

function saveLifeGroupName(inp) {
  const id = inp?.dataset?.lifeGroupName;
  if (!id) return;
  ensureLifeGroups();
  const group = accountRegistry.lifeGroups.find(g => g.id === id);
  if (!group) return;
  const name = String(inp.value || '').trim();
  if (!name) {
    alert('请填写分组名称');
    inp.value = group.name;
    inp.focus();
    return;
  }
  if (group.name === name) return;
  group.name = name;
  flushAccountPersist();
  renderLifeAccountsSection();
}

export function moveLifeAccountToGroup(lifeId, groupId) {
  if (!lifeId) return false;
  ensureLifeAccountGroups();
  const gid = normalizeLifeGroupId(groupId);
  const list = accountRegistry.lifeAccounts;
  const idx = list.findIndex(a => a.id === lifeId);
  if (idx < 0) return false;
  const item = list[idx];
  const prev = normalizeLifeGroupId(item.groupId, item.name);
  if (prev === gid) return false;
  list.splice(idx, 1);
  item.groupId = gid;
  let insertAt = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (normalizeLifeGroupId(list[i].groupId, list[i].name) === gid) {
      insertAt = i + 1;
      break;
    }
  }
  list.splice(insertAt, 0, item);
  flushAccountPersist();
  return true;
}

export function addLifeGroup() {
  if (!lifeAccountEditMode) lifeAccountEditMode = true;
  ensureLifeGroups();
  const id = nextLifeGroupId();
  accountRegistry.lifeGroups.push({ id, name: '新分组' });
  flushAccountPersist();
  renderLifeAccountsSection();
  const inp = document.querySelector(`#accountsLifeSection [data-life-group-name="${CSS.escape(id)}"]`);
  inp?.focus();
  inp?.select?.();
}

export function deleteLifeGroup(id) {
  if (!id) return;
  ensureLifeAccountGroups();
  const groups = lifeGroupsList();
  if (groups.length <= 1) {
    alert('至少保留一个分组');
    return;
  }
  const group = groups.find(g => g.id === id);
  if (!group) return;
  const count = lifeAccountsList().filter(a => normalizeLifeGroupId(a.groupId, a.name) === id).length;
  if (count) {
    if (!confirm(`分组「${group.name}」下有 ${count} 个账户，删除后将移到其他分组。确定？`)) return;
  } else if (!confirm(`确定删除分组「${group.name}」？`)) {
    return;
  }
  const fallback = groups.find(g => g.id !== id)?.id;
  accountRegistry.lifeAccounts.forEach(a => {
    if (normalizeLifeGroupId(a.groupId, a.name) === id) a.groupId = fallback;
  });
  accountRegistry.lifeGroups = groups.filter(g => g.id !== id);
  flushAccountPersist();
  renderLifeAccountsSection();
}

export function addLifeAccountRow(groupId) {
  if (!lifeAccountEditMode) lifeAccountEditMode = true;
  ensureLifeAccountGroups();
  const gid = normalizeLifeGroupId(groupId || lifeGroupsList()[0]?.id);
  const id = nextLifeAccountId();
  const item = {
    id,
    name: '',
    accountNo: '',
    groupId: gid
  };
  let insertAt = accountRegistry.lifeAccounts.length;
  for (let i = accountRegistry.lifeAccounts.length - 1; i >= 0; i--) {
    if (normalizeLifeGroupId(accountRegistry.lifeAccounts[i].groupId, accountRegistry.lifeAccounts[i].name) === gid) {
      insertAt = i + 1;
      break;
    }
  }
  accountRegistry.lifeAccounts.splice(insertAt, 0, item);
  renderLifeAccountsSection();
  document.querySelector(`#accountsLifeSection tr[data-life-id="${CSS.escape(id)}"] .accounts-life-name`)?.focus();
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

function normalizeReminderCategory(raw, source) {
  const value = String(raw || '').trim();
  if (REMINDER_CATEGORIES.includes(value)) return value;
  return source === 'credit-repay' ? '金融' : '生活';
}

function reminderCategoryClass(category) {
  if (category === '账号') return 'is-account';
  if (category === '金融') return 'is-finance';
  return 'is-life';
}

function reminderCategoryHtml(category) {
  const cat = normalizeReminderCategory(category);
  return `<span class="accounts-reminder-cat ${reminderCategoryClass(cat)}">${esc(cat)}</span>`;
}

function reminderCategorySelect(category) {
  const current = normalizeReminderCategory(category);
  const options = REMINDER_CATEGORIES.map(cat =>
    `<option value="${esc(cat)}"${cat === current ? ' selected' : ''}>${esc(cat)}</option>`
  ).join('');
  return `<select class="accounts-reminder-inp accounts-reminder-category">${options}</select>`;
}

function reminderDoneBtnHtml(item) {
  const done = !!item.done;
  const title = done ? '标为未完成' : '标为已完成';
  return `<button type="button" class="accounts-reminder-done-btn${done ? ' is-done' : ''}" data-toggle-reminder-done="${esc(item.id)}" title="${title}" aria-label="${title}" aria-pressed="${done ? 'true' : 'false'}">
    <i class="ti ${done ? 'ti-circle-check' : 'ti-circle'}"></i>
  </button>`;
}

function renderLongReminderRow(item) {
  const remaining = reminderRemainingInfo(item.expiry);
  const isAuto = item.source === 'credit-repay';
  const done = !!item.done;
  const editing = editingReminderId === item.id;
  const autoTag = isAuto ? '<span class="accounts-reminder-auto-tag" title="由信用卡欠款自动生成，可双击修改">自动</span>' : '';
  const doneTag = done ? '<span class="accounts-reminder-done-tag">已完成</span>' : '';
  const rowCls = [
    'accounts-reminder-item',
    isAuto ? 'is-auto-credit' : '',
    done ? 'is-done' : '',
    editing ? 'is-editing' : ''
  ].filter(Boolean).join(' ');
  const category = normalizeReminderCategory(item.category, item.source);
  if (editing) {
    const amountVal = reminderDisplayAmount(item);
    const amountCell = isAuto
      ? `<div data-label="金额"><input type="text" class="accounts-reminder-inp accounts-reminder-amount" inputmode="decimal" value="${esc(creditInputVal(amountVal))}" placeholder="还款金额" title="还款金额"></div>`
      : `<div data-label="分类">${reminderCategorySelect(category)}</div>`;
    const actionCell = isAuto
      ? `<div class="accounts-reminder-actions" data-label="分类">${reminderCategorySelect(category)}</div>`
      : `<div class="accounts-reminder-actions" data-label="操作">
        <button type="button" class="btn btn-sm btn-a" data-delete-reminder="${esc(item.id)}" title="删除"><i class="ti ti-trash"></i></button>
      </div>`;
    return `<div data-reminder-id="${esc(item.id)}" class="${rowCls}">
      <div class="accounts-reminder-done-cell">${reminderDoneBtnHtml(item)}</div>
      <div data-label="事项"><input type="text" class="accounts-reminder-inp accounts-reminder-name" value="${esc(item.name)}" placeholder="如：W-8 表格"></div>
      ${amountCell}
      <div data-label="有效期"><input type="date" class="accounts-reminder-inp accounts-reminder-expiry" value="${esc(item.expiry || '')}"></div>
      ${actionCell}
    </div>`;
  }
  const remainLabel = done ? '已完成' : remaining.label;
  const remainStatus = done ? 'done' : remaining.status;
  const editHint = ' title="双击编辑"';
  return `<div data-reminder-id="${esc(item.id)}" class="${rowCls}"${editHint}>
    <div class="accounts-reminder-done-cell">${reminderDoneBtnHtml(item)}</div>
    <div data-label="事项"><span class="accounts-reminder-val accounts-reminder-val--name">${esc(item.name)}${autoTag}${doneTag}</span></div>
    <div data-label="分类">${reminderCategoryHtml(category)}</div>
    <div data-label="有效期"><span class="accounts-reminder-val accounts-reminder-val--expiry">${formatBudgetDateLabel(item.expiry)}</span></div>
    <div data-label="剩余"><span class="accounts-reminder-val accounts-reminder-val--remaining is-${remainStatus}">${esc(remainLabel)}</span></div>
  </div>`;
}

function addCalendarMonths(date, months) {
  const d = startOfDay(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, dim));
  return d;
}

function isLongTermReminder(item, today = new Date()) {
  const iso = normalizeBudgetDateIso(item?.expiry);
  if (!iso) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  return exp > addCalendarMonths(today, 6);
}

function reminderCountLabel(rows) {
  const open = rows.filter(item => !item.done).length;
  return rows.some(item => item.done) ? `${open}/${rows.length} 项` : `${rows.length} 项`;
}

function reminderColumns(rows) {
  const open = rows.filter(item => !item.done);
  const done = rows.filter(item => item.done);
  return `<div class="accounts-reminder-cols">${reminderColumn('未完成', open, '暂无未完成提醒')}${reminderColumn('已完成', done, '暂无已完成提醒')}</div>`;
}

function reminderColumn(title, rows, emptyText) {
  const body = rows.length
    ? rows.map(item => renderLongReminderRow(item)).join('')
    : `<div class="accounts-reminder-col-empty">${emptyText}</div>`;
  return `<section class="accounts-reminder-col">
    <h4 class="accounts-reminder-col-title">${title}<span>${rows.length}</span></h4>
    ${body}
  </section>`;
}

function renderLongRemindersSection() {
  const el = document.getElementById('accountsReminderSection');
  if (!el) return;
  ensureLongReminders();
  const items = sortedLongReminders();
  const near = items.filter(item => !isLongTermReminder(item));
  const far = items.filter(item => isLongTermReminder(item));
  const nearBody = items.length
    ? reminderColumns(near)
    : `<div class="accounts-credit-empty">暂无提醒，可点击右上角加号新增。</div>`;
  const farBody = far.length
    ? `<div class="cc full accounts-reminder-card accounts-reminder-long">
      <div class="accounts-reminder-head">
        <div class="accounts-reminder-head-top">
          <div class="ct"><i class="ti ti-hourglass"></i> 长期提醒 <span class="accounts-credit-cnt">${reminderCountLabel(far)}</span></div>
        </div>
      </div>
      ${reminderColumns(far)}
    </div>`
    : '';
  el.innerHTML = `<div class="cc full accounts-reminder-card">
    <div class="accounts-reminder-head">
      <div class="accounts-reminder-head-top">
        <div class="ct"><i class="ti ti-bell-ringing"></i> 提醒 <span class="accounts-credit-cnt">${reminderCountLabel(near)}</span></div>
        <button type="button" class="btn btn-sm accounts-reminder-add" onclick="addLongReminderRow()" title="新增提醒" aria-label="新增提醒"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    ${nearBody}
  </div>${farBody}`;
  renderHomeLongRemindersSection();
  if (editingReminderId) {
    const row = el.querySelector(`[data-reminder-id="${CSS.escape(editingReminderId)}"]`);
    const amountInp = row?.querySelector('.accounts-reminder-amount');
    (amountInp || row?.querySelector('.accounts-reminder-name'))?.focus();
    if (amountInp) amountInp.select?.();
  }
}
let topbarRemindersOpen = false;

export function closeTopbarReminders() {
  topbarRemindersOpen = false;
  const wrap = document.getElementById('topbarReminder');
  wrap?.classList.remove('is-open');
  wrap?.querySelector('.topbar-reminder-btn')?.setAttribute('aria-expanded', 'false');
}

export function toggleTopbarReminders(force) {
  topbarRemindersOpen = typeof force === 'boolean' ? force : !topbarRemindersOpen;
  const wrap = document.getElementById('topbarReminder');
  if (!wrap) return;
  wrap.classList.toggle('is-open', topbarRemindersOpen);
  wrap.querySelector('.topbar-reminder-btn')?.setAttribute('aria-expanded', topbarRemindersOpen ? 'true' : 'false');
}

function ensureTopbarReminderOutsideClose() {
  if (document.documentElement._topbarReminderOutside) return;
  document.documentElement._topbarReminderOutside = true;
  document.addEventListener('click', (e) => {
    if (!topbarRemindersOpen) return;
    const wrap = document.getElementById('topbarReminder');
    if (!wrap || wrap.contains(e.target)) return;
    closeTopbarReminders();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && topbarRemindersOpen) closeTopbarReminders();
  });
}

export function renderHomeLongRemindersSection() {
  const el = document.getElementById('topbarReminder');
  if (!el) {
    renderHomeMobileInsights();
    return;
  }
  ensureLongReminders();
  syncCreditRepayRemindersAndPersist();
  ensureTopbarReminderOutsideClose();
  const items = activeLongReminders();
  const urgentCount = items.filter(item => {
    const s = reminderRemainingInfo(item.expiry).status;
    return s === 'expired' || s === 'urgent' || s === 'soon';
  }).length;
  const badge = items.length
    ? `<span class="topbar-reminder-badge${urgentCount ? ' is-alert' : ''}">${items.length}</span>`
    : '';
  const rows = items.length
    ? items.map(item => {
      const remaining = reminderRemainingInfo(item.expiry);
      const autoTag = item.source === 'credit-repay'
        ? '<span class="accounts-reminder-auto-tag" title="由信用卡欠款自动生成">自动</span>'
        : '';
      return `<div class="topbar-reminder-item">
        <button type="button" class="accounts-reminder-done-btn topbar-reminder-done" data-toggle-reminder-done="${esc(item.id)}" title="标为已完成" aria-label="标为已完成">
          <i class="ti ti-circle"></i>
        </button>
        <div class="topbar-reminder-item-main">
          <span class="topbar-reminder-name" title="${esc(item.name)}">${esc(item.name)}${autoTag}</span>
          <span class="topbar-reminder-expiry">${formatBudgetDateLabel(item.expiry)}</span>
          <span class="topbar-reminder-remain is-${remaining.status}">${esc(remaining.label)}</span>
        </div>
      </div>`;
    }).join('')
    : `<div class="topbar-reminder-empty">暂无待办提醒</div>`;

  el.innerHTML = `
    <button type="button" class="topbar-reminder-btn" onclick="event.stopPropagation();toggleTopbarReminders()" title="长期提醒" aria-label="长期提醒" aria-expanded="${topbarRemindersOpen ? 'true' : 'false'}" aria-haspopup="true">
      <i class="ti ti-bell-ringing"></i>
      ${badge}
    </button>
    <div class="topbar-reminder-pop" role="dialog" aria-label="长期提醒">
      <div class="topbar-reminder-pop-head">
        <h3 class="topbar-reminder-pop-title"><i class="ti ti-bell-ringing"></i> 长期提醒</h3>
        <div class="topbar-reminder-pop-actions">
          <button type="button" class="btn btn-sm" onclick="closeTopbarReminders();sw('reminders', document.querySelector('.ni[title=\\'提醒事项\\']'))" title="打开提醒页"><i class="ti ti-arrow-right"></i></button>
          <button type="button" class="btn btn-sm" onclick="closeTopbarReminders()" title="关闭" aria-label="关闭"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <div class="topbar-reminder-list">${rows}</div>
    </div>`;
  el.classList.toggle('is-open', topbarRemindersOpen);
  if (!el._doneToggleBound) {
    el._doneToggleBound = true;
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-toggle-reminder-done]');
      if (!btn?.dataset.toggleReminderDone) return;
      e.stopPropagation();
      toggleLongReminderDone(btn.dataset.toggleReminderDone);
    });
  }
  renderHomeMobileInsights();
}

export function toggleLongReminderEditMode() {
  const item = longRemindersList().find(row => row.source !== 'credit-repay');
  if (!item) return;
  beginReminderEdit(item.id);
}

function reminderRowById(id) {
  if (!id) return null;
  return document.querySelector(`#accountsReminderSection .accounts-reminder-item[data-reminder-id="${CSS.escape(id)}"]`);
}

function beginReminderEdit(id) {
  if (!id || editingReminderId === id) return;
  const item = longRemindersList().find(row => row.id === id);
  if (!item) return;
  if (editingReminderId) {
    const prev = reminderRowById(editingReminderId);
    if (prev && !saveLongReminderRow(prev, { close: true })) return;
  }
  editingReminderId = id;
  renderLongRemindersSection();
}

function saveLongReminderRow(row, { close = false, rerender = true } = {}) {
  const id = row?.dataset?.reminderId;
  if (!id) return false;
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return false;
  const nameInput = row.querySelector('.accounts-reminder-name');
  if (!nameInput) return false;
  const name = nameInput.value.trim();
  const expiry = normalizeBudgetDateIso(row.querySelector('.accounts-reminder-expiry')?.value);
  const category = normalizeReminderCategory(
    row.querySelector('.accounts-reminder-category')?.value,
    item.source
  );
  if (!name || !expiry) {
    if (!close) return false;
    if (!name) {
      alert('请填写事项名称');
      nameInput.focus();
    } else {
      alert('请填写有效期');
      row.querySelector('.accounts-reminder-expiry')?.focus();
    }
    return false;
  }

  if (item.source === 'credit-repay') {
    const amountInput = row.querySelector('.accounts-reminder-amount');
    const amountRaw = amountInput?.value;
    const amount = parseCreditAmount(amountRaw);
    if (amountRaw != null && String(amountRaw).trim() !== '' && amount == null) {
      if (!close) return false;
      alert('请填写有效的还款金额');
      amountInput?.focus();
      return false;
    }

    const prevAmount = reminderDisplayAmount(item);
    const prevExpiry = item.expiry;
    const prevName = item.name;
    const cardName = reminderCreditCardName(item.sourceKey) || '';
    let nextAmount = amount != null ? amount : prevAmount;
    if (amount != null) {
      const amountChanged = prevAmount == null || Math.abs(amount - prevAmount) > 0.001;
      item.amount = amount;
      nextAmount = amount;
      if (amountChanged) {
        item.amountLocked = true;
        applyReminderAmountToCredit(item, amount);
      }
    }

    const autoName = cardName && nextAmount != null
      ? creditRepayReminderName(cardName, nextAmount)
      : '';
    // 若标题仍是旧自动文案（或用户未改标题），保存后跟金额对齐
    const prevAutoName = cardName && prevAmount != null
      ? creditRepayReminderName(cardName, prevAmount)
      : '';
    const useAutoName = autoName && (!name || name === prevName || name === prevAutoName || name === autoName);
    item.name = useAutoName ? autoName : name;
    item.expiry = expiry;
    item.category = category || '金融';
    if (!autoName || item.name !== autoName) item.nameLocked = true;
    else delete item.nameLocked;
    if (expiry !== prevExpiry) item.expiryLocked = true;
    if (close && editingReminderId === id) editingReminderId = null;
    flushAccountPersist();
    if (rerender) {
      renderLongRemindersSection();
      try { renderCreditCardSection(); } catch (_) { /* ignore */ }
    }
    return true;
  }

  item.name = name;
  item.expiry = expiry;
  item.category = category;
  if (close && editingReminderId === id) editingReminderId = null;
  flushAccountPersist();
  if (rerender) renderLongRemindersSection();
  return true;
}

export function addLongReminderRow() {
  if (editingReminderId) {
    const prev = reminderRowById(editingReminderId);
    if (prev && !saveLongReminderRow(prev, { close: true })) return;
  }
  ensureLongReminders();
  const id = nextLongReminderId();
  accountRegistry.longReminders.push({
    id,
    name: '',
    expiry: dateToIsoLocal(new Date()),
    category: '生活',
    done: false
  });
  editingReminderId = id;
  renderLongRemindersSection();
}

export function toggleLongReminderDone(id) {
  if (!id) return;
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return;
  item.done = !item.done;
  if (item.source === 'credit-repay') {
    if (item.done) item.settledExpiry = normalizeBudgetDateIso(item.expiry) || item.expiry;
    else delete item.settledExpiry;
  }
  flushAccountPersist();
  renderLongRemindersSection();
}

export function deleteLongReminder(id) {
  if (!id) return;
  ensureLongReminders();
  const item = accountRegistry.longReminders.find(a => a.id === id);
  if (!item) return;
  if (item.source === 'credit-repay') {
    alert('信用卡还款提醒由欠款自动生成，请将对应信用卡欠款改为 0 后自动移除。');
    return;
  }
  if (!confirm(`确定删除提醒「${item.name || '未命名'}」？`)) return;
  if (editingReminderId === id) editingReminderId = null;
  if (!Array.isArray(accountRegistry.longReminderTombstones)) accountRegistry.longReminderTombstones = [];
  if (!accountRegistry.longReminderTombstones.includes(id)) accountRegistry.longReminderTombstones.push(id);
  accountRegistry.longReminders = accountRegistry.longReminders.filter(a => a.id !== id);
  flushAccountPersist();
  renderAccountsPage();
}

function renderWebSecretCell(entry, {
  editing = false,
  value = '',
  revealed = false,
  inputClass = 'accounts-web-password',
  viewClass = 'accounts-web-platform-password',
  toggleAttr = 'data-toggle-web-pass',
  placeholder = '密码',
  emptyLabel = '—'
} = {}) {
  if (editing) {
    return `<div class="accounts-web-pass-field">
      <input type="${revealed ? 'text' : 'password'}" class="accounts-web-inp ${inputClass}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="new-password" spellcheck="false">
      <button type="button" class="accounts-web-pass-toggle" ${toggleAttr}="${esc(entry.id)}" title="${revealed ? '隐藏' + placeholder : '显示' + placeholder}" aria-label="${revealed ? '隐藏' + placeholder : '显示' + placeholder}">
        <i class="ti ${revealed ? 'ti-eye-off' : 'ti-eye'}"></i>
      </button>
    </div>`;
  }
  if (!value) {
    return `<span class="${viewClass} is-empty">${esc(emptyLabel)}</span>`;
  }
  return `<div class="accounts-web-pass-field is-view">
    <span class="${viewClass}">${revealed ? esc(value) : maskWebPassword(value)}</span>
    <button type="button" class="accounts-web-pass-toggle" ${toggleAttr}="${esc(entry.id)}" title="${revealed ? '隐藏' + placeholder : '显示' + placeholder}" aria-label="${revealed ? '隐藏' + placeholder : '显示' + placeholder}">
      <i class="ti ${revealed ? 'ti-eye-off' : 'ti-eye'}"></i>
    </button>
  </div>`;
}

function renderWebPasswordCell(entry, { editing = false } = {}) {
  return renderWebSecretCell(entry, {
    editing,
    value: entry.password || '',
    revealed: webPassRevealedIds.has(entry.id),
    inputClass: 'accounts-web-password',
    viewClass: 'accounts-web-platform-password',
    toggleAttr: 'data-toggle-web-pass',
    placeholder: '密码'
  });
}

function renderWebUShieldCell(entry, { editing = false } = {}) {
  return renderWebSecretCell(entry, {
    editing,
    value: entry.uShieldPassword || '',
    revealed: webUShieldRevealedIds.has(entry.id),
    inputClass: 'accounts-web-ushield',
    viewClass: 'accounts-web-platform-ushield',
    toggleAttr: 'data-toggle-web-ushield',
    placeholder: 'U盾密码'
  });
}

/** 万事达卡号：明文展示，便于查看/复制（不做密码遮罩） */
function renderWebMastercardCell(entry, { editing = false } = {}) {
  const value = entry.mastercardNumber || '';
  if (editing) {
    return `<input type="text" class="accounts-web-inp accounts-web-mastercard" value="${esc(value)}" placeholder="万事达卡号" autocomplete="off" spellcheck="false" inputmode="numeric">`;
  }
  if (!value) {
    return `<span class="accounts-web-platform-mastercard is-empty">—</span>`;
  }
  return `<span class="accounts-web-platform-mastercard" title="双击编辑">${esc(value)}</span>`;
}

function renderWebAccountEntry(entry, platformId, editing, { platformHasEnterprise = false, platformHasUShield = false, platformHasMastercard = false } = {}) {
  const rowMods = `${platformHasEnterprise ? ' has-enterprise' : ''}${platformHasUShield ? ' has-ushield' : ''}${platformHasMastercard ? ' has-mastercard' : ''}`;
  if (editing) {
    const hasEnt = entryHasEnterprise(entry);
    // Keep enterprise input only when this entry already has enterprise (view/edit symmetry).
    // U盾/万事达列在平台启用时始终可编辑，便于空值填写。
    return `<li class="accounts-web-platform-item is-editing${hasEnt ? ' has-enterprise' : ''}${platformHasUShield ? ' has-ushield' : ''}${platformHasMastercard ? ' has-mastercard' : ''}" data-web-entry-id="${esc(entry.id)}" data-web-platform-id="${esc(platformId)}">
      <input type="text" class="accounts-web-inp accounts-web-account" value="${esc(entry.account)}" placeholder="账号" autocomplete="off">
      <input type="text" class="accounts-web-inp accounts-web-username" value="${esc(entry.username)}" placeholder="用户名" autocomplete="off">
      ${hasEnt ? `<input type="text" class="accounts-web-inp accounts-web-enterprise" value="${esc(entry.enterprise || '')}" placeholder="企业" autocomplete="off">` : ''}
      ${renderWebPasswordCell(entry, { editing: true })}
      ${platformHasUShield ? renderWebUShieldCell(entry, { editing: true }) : ''}
      ${platformHasMastercard ? renderWebMastercardCell(entry, { editing: true }) : ''}
      <button type="button" class="btn btn-sm btn-a accounts-web-entry-del" data-delete-web-entry="${esc(entry.id)}" title="删除账号"><i class="ti ti-trash"></i></button>
    </li>`;
  }
  const hasEnt = entryHasEnterprise(entry);
  const entCell = platformHasEnterprise
    ? `<span class="accounts-web-platform-enterprise">${hasEnt ? esc(entry.enterprise) : '—'}</span>`
    : '';
  const uShieldCell = platformHasUShield ? renderWebUShieldCell(entry) : '';
  const mastercardCell = platformHasMastercard ? renderWebMastercardCell(entry) : '';
  return `<li class="accounts-web-platform-item${rowMods}" data-web-entry-id="${esc(entry.id)}" data-web-platform-id="${esc(platformId)}" title="双击编辑">
    <span class="accounts-web-platform-account">${entry.account ? esc(entry.account) : '—'}</span>
    <span class="accounts-web-platform-username">${entry.username ? esc(entry.username) : '—'}</span>
    ${entCell}
    ${renderWebPasswordCell(entry)}
    ${uShieldCell}
    ${mastercardCell}
  </li>`;
}

function webEntryIsVisible(entry) {
  if (!entry) return false;
  if (editingWebEntryId && entry.id === editingWebEntryId) return true;
  return Boolean(entry.account || entry.username || entry.password || entry.enterprise || entry.uShieldPassword || entry.mastercardNumber);
}

function webPlatformIsVisible(platform) {
  if (!platform) return false;
  if (editingWebPlatformId && platform.id === editingWebPlatformId) return true;
  if ((platform.entries || []).some(e => e.id === editingWebEntryId)) return true;
  return (platform.entries || []).some(webEntryIsVisible);
}

function renderWebBrowsePlatformCard(platform) {
  const title = (platform.title || '未命名平台').trim() || '未命名平台';
  const allEntries = platform.entries || [];
  const entries = allEntries.filter(webEntryIsVisible);
  const expanded = webExpandedIds.has(platform.id) || editingWebEntryId && entries.some(e => e.id === editingWebEntryId) || editingWebPlatformId === platform.id;
  if (expanded) webExpandedIds.add(platform.id);
  const count = entries.length;
  const previewBits = entries.filter(e => e.id !== editingWebEntryId || e.account || e.username).slice(0, 3).map(e => {
    const label = e.username || e.account || shortEnterpriseName(e.enterprise) || '未命名';
    return label;
  });
  const preview = previewBits.length
    ? (previewBits.join(' · ') + (count > 3 ? ` 等 ${count} 个` : ''))
    : '暂无账号';
  const platformHasEnterprise = entries.some(entryHasEnterprise);
  const platformHasUShield = platformWantsUShieldColumn(platform, entries);
  const platformHasMastercard = platformWantsMastercardColumn(platform, entries);
  const editingTitle = editingWebPlatformId === platform.id;
  const summaryTitle = editingTitle
    ? `<input type="text" class="accounts-web-inp accounts-web-platform-title-inp" data-web-platform-title="${esc(platform.id)}" value="${esc(platform.title)}" placeholder="平台名称" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">`
    : `<div class="accounts-web-entry-card-title" data-web-platform-label="${esc(platform.id)}" title="双击修改平台名">${esc(title)}</div>`;
  const colsMods = `${platformHasEnterprise ? ' has-enterprise' : ''}${platformHasUShield ? ' has-ushield' : ''}${platformHasMastercard ? ' has-mastercard' : ''}`;

  const colsHead = entries.length
    ? `<div class="accounts-web-platform-cols${colsMods}" aria-hidden="true">
        <span>账号</span><span>用户名</span>${platformHasEnterprise ? '<span>企业</span>' : ''}<span>密码</span>${platformHasUShield ? '<span>U盾密码</span>' : ''}${platformHasMastercard ? '<span>万事达卡号</span>' : ''}
      </div>`
    : '';

  const entriesHtml = entries.length
    ? `<ul class="accounts-web-platform-list">
        ${entries.map(e => renderWebAccountEntry(e, platform.id, editingWebEntryId === e.id, { platformHasEnterprise, platformHasUShield, platformHasMastercard })).join('')}
      </ul>`
    : `<div class="accounts-web-platform-empty">暂无账号，点击下方添加</div>`;

  const detailActions = `<div class="accounts-web-card-actions">
      <button type="button" class="btn btn-sm" data-add-web-entry="${esc(platform.id)}"><i class="ti ti-plus"></i> 添加账号</button>
      <button type="button" class="btn btn-sm btn-a" data-delete-web-platform="${esc(platform.id)}" title="删除平台"><i class="ti ti-trash"></i> 删除平台</button>
      <button type="button" class="btn btn-sm accounts-web-collapse-btn" data-toggle-web-expand="${esc(platform.id)}"><i class="ti ti-chevron-up"></i> 收起</button>
    </div>`;

  return `<article class="accounts-web-entry-card${expanded ? ' is-expanded' : ''}" data-web-platform-id="${esc(platform.id)}">
    <button type="button" class="accounts-web-entry-card-summary" data-toggle-web-expand="${esc(platform.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
      <div class="accounts-web-entry-card-left">
        ${webPlatformMarkHtml(title, { size: 40 })}
        <div class="accounts-web-entry-card-titles">
          ${summaryTitle}
          ${editingTitle ? '' : `<div class="accounts-web-entry-card-sub">${esc(preview)}</div>`}
        </div>
      </div>
      <div class="accounts-web-entry-card-right">
        <div class="accounts-web-entry-card-meta">${count} 个账号</div>
      </div>
      <i class="ti ti-chevron-down accounts-web-entry-card-chevron" aria-hidden="true"></i>
    </button>
    <div class="accounts-web-entry-card-detail"${expanded ? '' : ' hidden'}>
      ${colsHead}
      ${entriesHtml}
      ${detailActions}
    </div>
  </article>`;
}

function renderWebAccountsSection() {
  const el = document.getElementById('accountsWebSection');
  if (!el) return;
  ensureWebAccounts();
  const platforms = webPlatformsList();
  const entryCount = platforms.reduce((n, p) => n + (p.entries?.length || 0), 0);
  const visiblePlatforms = platforms.filter(webPlatformIsVisible);

  let bodyHtml = '';
  if (!platforms.length) {
    bodyHtml = `<div class="accounts-credit-empty">暂无平台，可点击右上角 + 新增（如小红书、微信）。</div>`;
  } else if (!visiblePlatforms.length) {
    bodyHtml = `<div class="accounts-credit-empty">暂无登记账号，双击条目可编辑，或点击 + 新增平台。</div>`;
  } else {
    const groups = groupWebPlatformsByCategory(visiblePlatforms);
    bodyHtml = `<div class="accounts-web-groups">${groups.map(g => {
      const cards = g.platforms.map(p => renderWebBrowsePlatformCard(p)).join('');
      const cnt = g.platforms.length;
      return `<section class="accounts-web-group" data-web-group="${esc(g.id)}">
        <header class="accounts-web-group-head">
          <div class="accounts-web-group-title"><i class="ti ${esc(g.icon)}"></i><span>${esc(g.label)}</span></div>
          <span class="accounts-web-group-cnt">${cnt} 个平台</span>
        </header>
        <div class="accounts-web-cards">${cards}</div>
      </section>`;
    }).join('')}</div>`;
  }

  el.innerHTML = `<div class="cc full accounts-web-card is-viewing">
    <div class="accounts-web-head">
      <div class="accounts-web-head-top">
        <div class="ct"><i class="ti ti-world"></i> 网站账号登记 <span class="accounts-credit-cnt">${platforms.length} 个平台 · ${entryCount} 个账号</span></div>
        <button type="button" class="btn btn-sm accounts-cash-add" onclick="addWebAccountPlatform()" title="新增平台" aria-label="新增平台"><i class="ti ti-plus"></i></button>
      </div>
      <p class="accounts-web-hint">按类别分组展示。单击平台卡片展开/收起；双击账号行修改内容，双击平台名可改名。离开输入框或按 Enter 保存，Esc 取消。</p>
    </div>
    ${bodyHtml}
  </div>`;

  if (editingWebEntryId) {
    const row = el.querySelector(`[data-web-entry-id="${CSS.escape(editingWebEntryId)}"]`);
    const focusEl = row?.querySelector('.accounts-web-account, .accounts-web-inp');
    focusEl?.focus();
    focusEl?.select?.();
  } else if (editingWebPlatformId) {
    el.querySelector(`[data-web-platform-title="${CSS.escape(editingWebPlatformId)}"]`)?.focus();
  }
}

/** @deprecated kept for older onclick bindings; now a no-op tip path via add */
export function toggleWebAccountEditMode() {
  // Unified edit mode removed: editing is per-entry via double-click.
  if (editingWebEntryId || editingWebPlatformId) {
    commitWebEdits();
    editingWebEntryId = null;
    editingWebPlatformId = null;
    renderWebAccountsSection();
  }
}

export function toggleWebAccountExpand(platformId) {
  if (!platformId) return;
  if (editingWebEntryId || editingWebPlatformId) {
    if (!commitWebEdits()) return;
    editingWebEntryId = null;
    editingWebPlatformId = null;
  }
  if (webExpandedIds.has(platformId)) webExpandedIds.delete(platformId);
  else webExpandedIds.add(platformId);
  renderWebAccountsSection();
}

function commitWebEdits() {
  const root = document.getElementById('accountsWebSection');
  if (!root) return true;
  if (editingWebEntryId) {
    const row = root.querySelector(`[data-web-entry-id="${CSS.escape(editingWebEntryId)}"]`);
    if (row) saveWebAccountEntryEl(row);
  }
  if (editingWebPlatformId) {
    const inp = root.querySelector(`[data-web-platform-title="${CSS.escape(editingWebPlatformId)}"]`);
    if (inp) saveWebPlatformTitleEl(inp);
  }
  return true;
}

function beginWebEntryEdit(entryId) {
  if (!entryId) return;
  const found = findWebEntry(entryId);
  if (!found) return;
  if (editingWebEntryId === entryId) return;
  if (!commitWebEdits()) return;
  editingWebPlatformId = null;
  editingWebEntryId = entryId;
  webExpandedIds.add(found.platform.id);
  renderWebAccountsSection();
}

function beginWebPlatformEdit(platformId) {
  if (!platformId) return;
  ensureWebAccounts();
  if (!accountRegistry.webAccounts.platforms.some(p => p.id === platformId)) return;
  if (editingWebPlatformId === platformId) return;
  if (!commitWebEdits()) return;
  editingWebEntryId = null;
  editingWebPlatformId = platformId;
  webExpandedIds.add(platformId);
  renderWebAccountsSection();
}

function cancelWebEntryEdit() {
  const id = editingWebEntryId;
  editingWebEntryId = null;
  if (id) {
    const found = findWebEntry(id);
    if (found && !webEntryIsVisible(found.entry)) {
      // drop brand-new empty draft on cancel
      found.platform.entries = found.platform.entries.filter(e => e.id !== id);
      webPassRevealedIds.delete(id);
      webUShieldRevealedIds.delete(id);
    }
  }
  renderWebAccountsSection();
}

function cancelWebPlatformEdit() {
  const id = editingWebPlatformId;
  editingWebPlatformId = null;
  if (id) {
    ensureWebAccounts();
    const platform = accountRegistry.webAccounts.platforms.find(p => p.id === id);
    if (platform && !String(platform.title || '').trim() && !(platform.entries || []).some(webEntryIsVisible)) {
      accountRegistry.webAccounts.platforms = accountRegistry.webAccounts.platforms.filter(p => p.id !== id);
      webExpandedIds.delete(id);
    }
  }
  renderWebAccountsSection();
}

export function toggleWebPasswordReveal(entryId) {
  toggleWebSecretReveal(entryId, {
    revealedIds: webPassRevealedIds,
    toggleSelector: '[data-toggle-web-pass]',
    inputSelector: '.accounts-web-password',
    viewSelector: '.accounts-web-platform-password',
    valueOf: entry => entry.password,
    label: '密码'
  });
}

export function toggleWebUShieldReveal(entryId) {
  toggleWebSecretReveal(entryId, {
    revealedIds: webUShieldRevealedIds,
    toggleSelector: '[data-toggle-web-ushield]',
    inputSelector: '.accounts-web-ushield',
    viewSelector: '.accounts-web-platform-ushield',
    valueOf: entry => entry.uShieldPassword,
    label: 'U盾密码'
  });
}

function toggleWebSecretReveal(entryId, {
  revealedIds,
  toggleSelector,
  inputSelector,
  viewSelector,
  valueOf,
  label
}) {
  if (!entryId) return;
  if (revealedIds.has(entryId)) revealedIds.delete(entryId);
  else revealedIds.add(entryId);
  const revealed = revealedIds.has(entryId);
  const row = document.querySelector(`#accountsWebSection [data-web-entry-id="${CSS.escape(entryId)}"]`);
  if (!row) {
    renderWebAccountsSection();
    return;
  }
  const btn = row.querySelector(toggleSelector);
  const icon = btn?.querySelector('i');
  if (btn) {
    btn.title = revealed ? `隐藏${label}` : `显示${label}`;
    btn.setAttribute('aria-label', revealed ? `隐藏${label}` : `显示${label}`);
  }
  if (icon) icon.className = `ti ${revealed ? 'ti-eye-off' : 'ti-eye'}`;
  const inp = row.querySelector(inputSelector);
  if (inp) {
    inp.type = revealed ? 'text' : 'password';
    return;
  }
  const found = findWebEntry(entryId);
  const textEl = row.querySelector(viewSelector);
  const value = found?.entry ? valueOf(found.entry) : '';
  if (textEl && value) {
    textEl.textContent = revealed ? value : maskWebPassword(value);
  }
}

function saveWebAccountEntryEl(row) {
  const id = row?.dataset?.webEntryId;
  if (!id) return;
  const found = findWebEntry(id);
  if (!found) return;
  const { entry } = found;
  entry.account = row.querySelector('.accounts-web-account')?.value?.trim() || '';
  entry.username = row.querySelector('.accounts-web-username')?.value?.trim() || '';
  entry.password = row.querySelector('.accounts-web-password')?.value || '';
  const uShieldInput = row.querySelector('.accounts-web-ushield');
  if (uShieldInput) entry.uShieldPassword = uShieldInput.value || '';
  const mastercardInput = row.querySelector('.accounts-web-mastercard');
  if (mastercardInput) entry.mastercardNumber = mastercardInput.value?.trim() || '';
  const entInput = row.querySelector('.accounts-web-enterprise');
  if (entInput) entry.enterprise = entInput.value?.trim() || '';
  flushAccountPersist();
}

function saveWebPlatformTitleEl(inp) {
  const platformId = inp?.dataset?.webPlatformTitle;
  if (!platformId) return;
  ensureWebAccounts();
  const platform = accountRegistry.webAccounts.platforms.find(p => p.id === platformId);
  if (!platform) return;
  const title = inp.value?.trim() || '';
  if (!title) return;
  if (platform.title === title) return;
  platform.title = title;
  flushAccountPersist();
}

export function addWebAccountPlatform() {
  ensureWebAccounts();
  commitWebEdits();
  editingWebEntryId = null;
  const id = nextWebPlatformId();
  accountRegistry.webAccounts.platforms.push({
    id,
    title: '',
    entries: []
  });
  editingWebPlatformId = id;
  webExpandedIds.add(id);
  flushAccountPersist();
  renderWebAccountsSection();
  document.querySelector(`#accountsWebSection [data-web-platform-title="${CSS.escape(id)}"]`)?.focus();
}

/** @deprecated alias kept for older onclick bindings */
export function addWebAccountColumn() {
  addWebAccountPlatform();
}

export function addWebAccountEntry(platformId) {
  if (!platformId) return;
  ensureWebAccounts();
  const platform = accountRegistry.webAccounts.platforms.find(p => p.id === platformId);
  if (!platform) return;
  commitWebEdits();
  editingWebPlatformId = null;
  const id = nextWebEntryId();
  platform.entries.push({ id, account: '', username: '', password: '', enterprise: '', uShieldPassword: '', mastercardNumber: '', note: '' });
  editingWebEntryId = id;
  webExpandedIds.add(platformId);
  flushAccountPersist();
  renderWebAccountsSection();
  document.querySelector(`#accountsWebSection [data-web-entry-id="${CSS.escape(id)}"] .accounts-web-account`)?.focus();
}

/** @deprecated alias */
export function addWebAccountRow() {
  const platforms = webPlatformsList();
  if (!platforms.length) {
    addWebAccountPlatform();
    return;
  }
  addWebAccountEntry(platforms[platforms.length - 1].id);
}

export function deleteWebAccountPlatform(platformId) {
  if (!platformId) return;
  ensureWebAccounts();
  const platform = accountRegistry.webAccounts.platforms.find(p => p.id === platformId);
  if (!platform) return;
  const label = platform.title || '未命名';
  const n = platform.entries?.length || 0;
  if (!confirm(`确定删除平台「${label}」${n ? `及其 ${n} 个账号` : ''}？`)) return;
  accountRegistry.webAccounts.platforms = accountRegistry.webAccounts.platforms.filter(p => p.id !== platformId);
  platform.entries?.forEach(e => {
    webPassRevealedIds.delete(e.id);
    webUShieldRevealedIds.delete(e.id);
    if (editingWebEntryId === e.id) editingWebEntryId = null;
  });
  webExpandedIds.delete(platformId);
  if (editingWebPlatformId === platformId) editingWebPlatformId = null;
  flushAccountPersist();
  renderAccountsPage();
}

/** @deprecated alias */
export function deleteWebAccountColumn(colId) {
  deleteWebAccountPlatform(colId);
}

export function deleteWebAccountEntry(entryId) {
  if (!entryId) return;
  ensureWebAccounts();
  const found = findWebEntry(entryId);
  if (!found) return;
  const label = found.entry.account || found.entry.username || '未填写';
  if (!confirm(`确定删除账号「${label}」？`)) return;
  found.platform.entries = found.platform.entries.filter(e => e.id !== entryId);
  webPassRevealedIds.delete(entryId);
  webUShieldRevealedIds.delete(entryId);
  if (editingWebEntryId === entryId) editingWebEntryId = null;
  flushAccountPersist();
  renderAccountsPage();
}

/** @deprecated alias */
export function deleteWebAccountRow(rowId) {
  deleteWebAccountEntry(rowId);
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
  pool.updatedAt = new Date().toISOString();
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
  const entry = { id: `m${Date.now()}`, label, digits, kind: '信用卡', updatedAt: new Date().toISOString() };
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

  if (kind === '信用卡' && payKey) {
    stampAccountUpdatedAt(payKey);
    if (pool) pool.updatedAt = new Date().toISOString();
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
      if (editingCashCardId && e.target.matches('.accounts-cash-card')) {
        const input = e.target;
        setTimeout(() => {
          if (editingCashCardId !== input.dataset.cashCardInput) return;
          if (document.activeElement === input) return;
          saveCashCardNumber(input);
        }, 0);
        return;
      }
      if (!editingCashId) return;
      const row = e.target.closest('.accounts-cash-item[data-cash-id]');
      if (!row || row.dataset.cashId !== editingCashId) return;
      if (!e.target.matches('.accounts-cash-inp')) return;
      setTimeout(() => {
        if (editingCashId !== row.dataset.cashId) return;
        const active = document.activeElement;
        const activeRow = active?.closest('.accounts-cash-item[data-cash-id]');
        if (activeRow === row && active.matches('.accounts-cash-inp')) return;
        saveCashAccountRow(row);
      }, 0);
    });
    cashSec.addEventListener('keydown', e => {
      if (editingCashCardId && e.target.matches('.accounts-cash-card')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          editingCashCardId = null;
          renderCashAccountsSection();
        }
        return;
      }
      if (!editingCashId) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-cash-inp')) {
        e.preventDefault();
        e.target.blur();
      }
      if (e.key === 'Escape' && e.target.matches('.accounts-cash-inp')) {
        const row = e.target.closest('.accounts-cash-item[data-cash-id]');
        const acc = cashAccountsList().find(a => a.id === row?.dataset.cashId);
        editingCashId = null;
        if (acc && !acc.name) {
          accountRegistry.cashAccounts = accountRegistry.cashAccounts.filter(a => a.id !== acc.id);
        }
        renderCashAccountsSection();
        renderAccountsStatusSection();
      }
    });
    cashSec.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, .accounts-cash-drag')) return;
      const cardEl = e.target.closest('[data-cash-card]');
      if (cardEl?.dataset.cashCard) {
        e.stopPropagation();
        beginCashCardEdit(cardEl.dataset.cashCard);
        return;
      }
      const row = e.target.closest('.accounts-cash-item[data-cash-id]');
      if (!row) return;
      beginCashEdit(row.dataset.cashId);
    });
    cashSec.addEventListener('click', e => {
      const delBtn = e.target.closest('[data-delete-cash]');
      if (delBtn?.dataset.deleteCash) deleteCashAccount(delBtn.dataset.deleteCash);
    });
    cashSec.addEventListener('dragstart', e => {
      const handle = e.target.closest('.accounts-cash-drag');
      if (!handle) return;
      const item = handle.closest('.accounts-cash-item[data-cash-id]');
      if (!item) return;
      const id = item.dataset.cashId;
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('application/x-cash-account-id', id); } catch (_) { /* ignore */ }
      item.classList.add('is-dragging');
      cashSec._dragCashId = id;
    });
    cashSec.addEventListener('dragend', () => {
      cashSec.querySelectorAll('.accounts-cash-item.is-dragging').forEach(el => el.classList.remove('is-dragging'));
      cashSec.querySelectorAll('.accounts-cash-group.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
      cashSec._dragCashId = null;
    });
    cashSec.addEventListener('dragover', e => {
      const zone = e.target.closest('[data-cash-dropzone]');
      if (!zone || !cashSec._dragCashId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const group = zone.closest('.accounts-cash-group');
      cashSec.querySelectorAll('.accounts-cash-group.is-drag-over').forEach(el => {
        if (el !== group) el.classList.remove('is-drag-over');
      });
      group?.classList.add('is-drag-over');
    });
    cashSec.addEventListener('dragleave', e => {
      const group = e.target.closest('.accounts-cash-group');
      if (!group) return;
      if (e.relatedTarget && group.contains(e.relatedTarget)) return;
      group.classList.remove('is-drag-over');
    });
    cashSec.addEventListener('drop', e => {
      const zone = e.target.closest('[data-cash-dropzone]');
      if (!zone) return;
      e.preventDefault();
      const group = zone.closest('.accounts-cash-group');
      group?.classList.remove('is-drag-over');
      let id = '';
      try { id = e.dataTransfer.getData('application/x-cash-account-id'); } catch (_) { /* ignore */ }
      if (!id) id = e.dataTransfer.getData('text/plain') || cashSec._dragCashId || '';
      const gid = zone.dataset.cashDropzone;
      if (id && moveCashAccountToGroup(id, gid)) {
        renderCashAccountsSection();
        renderAccountsStatusSection();
      }
      cashSec._dragCashId = null;
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
      const titleInp = e.target.closest('.accounts-web-platform-title-inp');
      if (titleInp) {
        setTimeout(() => {
          if (document.activeElement === titleInp) return;
          const pid = titleInp.dataset.webPlatformTitle;
          const title = titleInp.value?.trim() || '';
          if (!title) {
            cancelWebPlatformEdit();
            return;
          }
          saveWebPlatformTitleEl(titleInp);
          if (editingWebPlatformId === pid) {
            editingWebPlatformId = null;
            renderWebAccountsSection();
          }
        }, 0);
        return;
      }
      const row = e.target.closest('[data-web-entry-id]');
      if (!row) return;
      if (!e.target.matches('.accounts-web-inp')) return;
      if (row.dataset.webEntryId !== editingWebEntryId) return;
      setTimeout(() => {
        const active = document.activeElement;
        const activeRow = active?.closest('[data-web-entry-id]');
        if (activeRow === row && active.matches('.accounts-web-inp')) return;
        saveWebAccountEntryEl(row);
        if (editingWebEntryId === row.dataset.webEntryId) {
          editingWebEntryId = null;
          renderWebAccountsSection();
        }
      }, 0);
    });
    webSec.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('.accounts-web-inp') && !e.target.matches('textarea')) {
        e.preventDefault();
        e.target.blur();
        return;
      }
      if (e.key === 'Escape') {
        if (e.target.matches('.accounts-web-platform-title-inp')) {
          e.preventDefault();
          cancelWebPlatformEdit();
          return;
        }
        if (e.target.matches('.accounts-web-inp') || e.target.closest('[data-web-entry-id].is-editing')) {
          e.preventDefault();
          cancelWebEntryEdit();
        }
      }
    });
    webSec.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, textarea, .accounts-web-pass-toggle')) return;
      const titleEl = e.target.closest('[data-web-platform-label]');
      if (titleEl?.dataset.webPlatformLabel) {
        e.preventDefault();
        e.stopPropagation();
        beginWebPlatformEdit(titleEl.dataset.webPlatformLabel);
        return;
      }
      const row = e.target.closest('.accounts-web-platform-item[data-web-entry-id]');
      if (!row || row.classList.contains('is-editing')) return;
      e.preventDefault();
      beginWebEntryEdit(row.dataset.webEntryId);
    });
    webSec.addEventListener('click', e => {
      const passBtn = e.target.closest('[data-toggle-web-pass]');
      if (passBtn?.dataset.toggleWebPass) {
        e.preventDefault();
        e.stopPropagation();
        toggleWebPasswordReveal(passBtn.dataset.toggleWebPass);
        return;
      }
      const uShieldBtn = e.target.closest('[data-toggle-web-ushield]');
      if (uShieldBtn?.dataset.toggleWebUshield) {
        e.preventDefault();
        e.stopPropagation();
        toggleWebUShieldReveal(uShieldBtn.dataset.toggleWebUshield);
        return;
      }
      const expandBtn = e.target.closest('[data-toggle-web-expand]');
      if (expandBtn?.dataset.toggleWebExpand) {
        // Ignore expand when interacting with title input inside summary
        if (e.target.closest('.accounts-web-platform-title-inp')) return;
        e.preventDefault();
        toggleWebAccountExpand(expandBtn.dataset.toggleWebExpand);
        return;
      }
      const addEntry = e.target.closest('[data-add-web-entry]');
      if (addEntry?.dataset.addWebEntry) {
        addWebAccountEntry(addEntry.dataset.addWebEntry);
        return;
      }
      const delPlat = e.target.closest('[data-delete-web-platform]');
      if (delPlat?.dataset.deleteWebPlatform) {
        deleteWebAccountPlatform(delPlat.dataset.deleteWebPlatform);
        return;
      }
      const delEntry = e.target.closest('[data-delete-web-entry]');
      if (delEntry?.dataset.deleteWebEntry) deleteWebAccountEntry(delEntry.dataset.deleteWebEntry);
    });
  }

  const lifeSec = document.getElementById('accountsLifeSection');
  if (lifeSec && !lifeSec._bound) {
    lifeSec._bound = true;
    lifeSec.addEventListener('focusout', e => {
      if (!lifeAccountEditMode) return;
      if (e.target.matches('.accounts-life-group-name')) {
        setTimeout(() => {
          if (document.activeElement === e.target) return;
          saveLifeGroupName(e.target);
        }, 0);
        return;
      }
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
      if (e.key === 'Enter' && e.target.matches('.accounts-life-inp, .accounts-life-group-name')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    lifeSec.addEventListener('click', e => {
      const delGroup = e.target.closest('[data-delete-life-group]');
      if (delGroup?.dataset.deleteLifeGroup) {
        deleteLifeGroup(delGroup.dataset.deleteLifeGroup);
        return;
      }
      const delBtn = e.target.closest('[data-delete-life]');
      if (delBtn?.dataset.deleteLife) deleteLifeAccount(delBtn.dataset.deleteLife);
    });
    lifeSec.addEventListener('dragstart', e => {
      const handle = e.target.closest('.accounts-life-drag');
      if (!handle) return;
      const row = handle.closest('tr[data-life-id]');
      if (!row) return;
      const id = row.dataset.lifeId;
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('application/x-life-account-id', id); } catch (_) { /* ignore */ }
      row.classList.add('is-dragging');
      lifeSec._dragLifeId = id;
    });
    lifeSec.addEventListener('dragend', () => {
      lifeSec.querySelectorAll('tr.is-dragging').forEach(el => el.classList.remove('is-dragging'));
      lifeSec.querySelectorAll('.accounts-life-group.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
      lifeSec._dragLifeId = null;
    });
    lifeSec.addEventListener('dragover', e => {
      const zone = e.target.closest('[data-life-dropzone]');
      if (!zone || !lifeSec._dragLifeId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const group = zone.closest('.accounts-life-group');
      lifeSec.querySelectorAll('.accounts-life-group.is-drag-over').forEach(el => {
        if (el !== group) el.classList.remove('is-drag-over');
      });
      group?.classList.add('is-drag-over');
    });
    lifeSec.addEventListener('dragleave', e => {
      const group = e.target.closest('.accounts-life-group');
      if (!group) return;
      if (e.relatedTarget && group.contains(e.relatedTarget)) return;
      group.classList.remove('is-drag-over');
    });
    lifeSec.addEventListener('drop', e => {
      const zone = e.target.closest('[data-life-dropzone]');
      if (!zone) return;
      e.preventDefault();
      zone.closest('.accounts-life-group')?.classList.remove('is-drag-over');
      let id = '';
      try { id = e.dataTransfer.getData('application/x-life-account-id'); } catch (_) { /* ignore */ }
      if (!id) id = e.dataTransfer.getData('text/plain') || lifeSec._dragLifeId || '';
      const gid = zone.dataset.lifeDropzone;
      if (id && moveLifeAccountToGroup(id, gid)) renderLifeAccountsSection();
      lifeSec._dragLifeId = null;
    });
  }

  const reminderSec = document.getElementById('accountsReminderSection');
  if (reminderSec && !reminderSec._bound) {
    reminderSec._bound = true;
    reminderSec.addEventListener('focusout', e => {
      if (!editingReminderId) return;
      const row = e.target.closest('.accounts-reminder-item[data-reminder-id]');
      if (!row || row.dataset.reminderId !== editingReminderId) return;
      if (!e.target.matches('.accounts-reminder-inp')) return;
      setTimeout(() => {
        if (editingReminderId !== row.dataset.reminderId) return;
        const active = document.activeElement;
        const activeRow = active?.closest('.accounts-reminder-item[data-reminder-id]');
        if (activeRow === row && active.matches('.accounts-reminder-inp')) return;
        saveLongReminderRow(row, { close: true });
      }, 0);
    });
    reminderSec.addEventListener('keydown', e => {
      if (!editingReminderId) return;
      if (e.key === 'Enter' && e.target.matches('.accounts-reminder-inp')) {
        e.preventDefault();
        e.target.blur();
      }
      if (e.key === 'Escape' && e.target.matches('.accounts-reminder-inp')) {
        const row = e.target.closest('.accounts-reminder-item[data-reminder-id]');
        const item = longRemindersList().find(a => a.id === row?.dataset.reminderId);
        if (item && !item.name) {
          editingReminderId = null;
          accountRegistry.longReminders = accountRegistry.longReminders.filter(a => a.id !== item.id);
          renderLongRemindersSection();
          return;
        }
        editingReminderId = null;
        renderLongRemindersSection();
      }
    });
    reminderSec.addEventListener('change', e => {
      if (!editingReminderId) return;
      if (!e.target.matches('.accounts-reminder-expiry, .accounts-reminder-category, .accounts-reminder-amount')) return;
      const row = e.target.closest('.accounts-reminder-item[data-reminder-id]');
      if (row) saveLongReminderRow(row, { close: false, rerender: false });
    });
    reminderSec.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, select, option')) return;
      const row = e.target.closest('.accounts-reminder-item[data-reminder-id]');
      if (!row) return;
      beginReminderEdit(row.dataset.reminderId);
    });
    reminderSec.addEventListener('click', e => {
      const doneBtn = e.target.closest('[data-toggle-reminder-done]');
      if (doneBtn?.dataset.toggleReminderDone) {
        if (editingReminderId) {
          const editingRow = reminderRowById(editingReminderId);
          if (editingRow && !saveLongReminderRow(editingRow, { close: false, rerender: false })) return;
        }
        toggleLongReminderDone(doneBtn.dataset.toggleReminderDone);
        return;
      }
      const delBtn = e.target.closest('[data-delete-reminder]');
      if (delBtn?.dataset.deleteReminder) deleteLongReminder(delBtn.dataset.deleteReminder);
    });
  }
}

export function renderRemindersPage() {
  syncCreditRepayRemindersAndPersist();
  renderLongRemindersSection();
}

export function renderAccountsPage() {
  syncCreditRepayRemindersAndPersist();
  renderAccountsStatusSection();
  renderAccountsTabs();
  renderCreditCardSection();
  renderCashAccountsSection();
  renderLifeAccountsSection();
  renderExpenseBudgetsSection();
  renderLongRemindersSection();
  renderWebAccountsSection();
  syncAccountsTabPanels();
}

export function selectAccountsTab(tabId) {
  if (!ACCOUNTS_TABS.some(t => t.id === tabId)) return;
  accountsActiveTab = tabId;
  renderAccountsTabs();
  syncAccountsTabPanels();
}

function renderAccountsTabs() {
  const el = document.getElementById('accountsTabs');
  if (!el) return;
  el.innerHTML = ACCOUNTS_TABS.map(tab => {
    const on = tab.id === accountsActiveTab ? ' on' : '';
    const cnt = tab.count();
    return `<button type="button" class="accounts-tab${on}" data-tab="${tab.id}" onclick="selectAccountsTab('${tab.id}')">
      <i class="ti ${tab.icon}"></i>
      <span class="accounts-tab-label">${tab.label}</span>
      <span class="accounts-tab-count">${cnt}</span>
    </button>`;
  }).join('');
}

function syncAccountsTabPanels() {
  document.querySelectorAll('.accounts-tab-panel').forEach(panel => {
    panel.classList.toggle('on', panel.dataset.tab === accountsActiveTab);
  });
}
