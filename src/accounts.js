/** 资金账户：按支付方式（银行卡/账户）查看流水 */
import { fmtMoney, fmtMoneySigned, fmtCount } from './format.js';
import { assetUrl } from './apiBase.js';
import { isValidPayAccount, matchBankBrand, accountGroupKey, accountGroupName } from './bank-brands.js';

const CARD_GRADIENTS = [
  ['#5b5bd6', '#7c3aed'],
  ['#1570ef', '#2e90fa'],
  ['#099250', '#12b76a'],
  ['#b54708', '#f79009'],
  ['#c11574', '#ee46bc'],
  ['#0e7090', '#06aed4'],
  ['#363f72', '#4e5ba6'],
  ['#b42318', '#f04438']
];

const MANUAL_PREFIX = '__manual:';
const KIND_OPTIONS = ['借记卡', '信用卡', '支付账户'];

let getAllRows = () => [];
let formatDayHeader = d => d;
let formatTimeShort = t => t;
let srcBadgeHtml = s => s;
let rowTitleFn = () => '—';
let onPersist = () => {};

let accountCardFaces = {};
let accountRegistry = { overrides: {}, hidden: [], manual: [] };
let activeAccount = null;
const revealedCardNums = new Set();

const CORP_MARKS = {
  WECHAT: { bg: '#07c160', icon: 'ti-brand-wechat' },
  ALIPAY: { bg: '#1677ff', icon: 'ti-brand-alipay' },
  UPOP: { bg: '#e21836', icon: 'ti-credit-card' }
};

export function initAccounts(deps) {
  getAllRows = deps.getAllRows || getAllRows;
  formatDayHeader = deps.formatDayHeader || formatDayHeader;
  formatTimeShort = deps.formatTimeShort || formatTimeShort;
  srcBadgeHtml = deps.srcBadgeHtml || srcBadgeHtml;
  rowTitleFn = deps.rowTitle || rowTitleFn;
  onPersist = deps.onPersist || onPersist;
}

function normalizeRegistry(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    overrides: r.overrides && typeof r.overrides === 'object' ? { ...r.overrides } : {},
    hidden: Array.isArray(r.hidden) ? [...r.hidden] : [],
    manual: Array.isArray(r.manual) ? r.manual.map(m => ({ ...m })) : []
  };
}

export function loadAccountsState(state) {
  accountCardFaces = state?.accountCardFaces || {};
  accountRegistry = normalizeRegistry(state?.accountRegistry);
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

function hashIdx(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % CARD_GRADIENTS.length;
}

function cardFaceSrc(payKey) {
  const raw = accountCardFaces[payKey];
  if (!raw) return '';
  return assetUrl(raw);
}

function getManualEntry(payKey) {
  if (!isManualKey(payKey)) return null;
  const id = payKey.slice(MANUAL_PREFIX.length);
  return accountRegistry.manual.find(m => m.id === id) || null;
}

function getOverride(payKey) {
  return accountRegistry.overrides[payKey] || null;
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
    return buildCardFields(
      manual.label,
      manual.digits,
      manual.kind || '支付账户',
      payKey,
      manual.label
    );
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

  return buildCardFields(label, digits, kind, full, full);
}

function accountPaysForKey(payKey) {
  if (isManualKey(payKey)) return [];
  const pays = new Set();
  getAllRows().forEach(r => {
    const pay = (r['支付方式'] || '').trim();
    if (!isValidPayAccount(pay)) return;
    if (accountGroupKey(pay) === payKey) pays.add(pay);
  });
  return [...pays];
}

function isHidden(payKey) {
  return accountRegistry.hidden.includes(payKey);
}

function accountList() {
  const map = new Map();
  getAllRows().forEach(r => {
    const pay = (r['支付方式'] || '').trim();
    if (!isValidPayAccount(pay)) return;
    const key = accountGroupKey(pay);
    if (isHidden(key)) return;
    if (!map.has(key)) map.set(key, { pay: key, count: 0, exp: 0, inc: 0, manual: false });
    const a = map.get(key);
    a.count += 1;
    if (r['收支'] === '收入') a.inc += r['金额'];
    else a.exp += r['金额'];
  });

  accountRegistry.manual.forEach(m => {
    const key = manualKey(m.id);
    if (isHidden(key)) return;
    if (!map.has(key)) map.set(key, { pay: key, count: 0, exp: 0, inc: 0, manual: true });
  });

  return [...map.values()].sort((a, b) => b.count - a.count || b.exp - a.exp);
}

function accountRows(payKey) {
  const pays = accountPaysForKey(payKey);
  return getAllRows()
    .filter(r => pays.includes((r['支付方式'] || '').trim()))
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
}

function accountStats(rows) {
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  return { exp, inc, net: inc - exp, count: rows.length };
}

function cardStyleVars(acc) {
  const parsed = parsePayAccount(acc.pay);
  const face = cardFaceSrc(acc.pay);
  if (face) return { face, c1: '', c2: '', hasFace: true };
  const colors = parsed.brand?.colors || CARD_GRADIENTS[hashIdx(acc.pay)];
  return { face: '', c1: colors[0], c2: colors[1], hasFace: false };
}

function accountBrandMarkHtml(payKey, size = 22) {
  const sample = accountGroupName(payKey) || payKey;
  const brand = matchBankBrand(sample);
  const { label } = parsePayAccount(payKey);
  const logoUrl = matchBankBrand(sample)?.logoUrl || null;
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

function renderBankCard(acc, active) {
  const parsed = parsePayAccount(acc.pay);
  const { cardNumMasked, cardNumFull, hasCardNum, kind, brand } = parsed;
  const revealed = revealedCardNums.has(acc.pay);
  const style = cardStyleVars(acc);
  const net = acc.inc - acc.exp;
  const displayName = accountGroupName(acc.pay) || brand?.name || parsed.label;
  const bgStyle = style.hasFace
    ? `background-image:url('${style.face}')`
    : `background:linear-gradient(135deg,${style.c1} 0%,${style.c2} 100%)`;
  const numDisplay = hasCardNum ? (revealed ? cardNumFull : cardNumMasked) : cardNumMasked;
  const eyeBtn = hasCardNum
    ? `<button type="button" class="fund-card-num-toggle" data-account="${esc(acc.pay)}" title="${revealed ? '隐藏卡号' : '显示卡号'}" aria-label="${revealed ? '隐藏卡号' : '显示卡号'}"><i class="ti ${revealed ? 'ti-eye-off' : 'ti-eye'}"></i></button>`
    : '';
  return `<div class="fund-card${active ? ' on' : ''}${style.hasFace ? ' has-face' : ''}" role="button" tabindex="0" data-account="${esc(acc.pay)}" title="点击查看流水">
    <div class="fund-card-bg" style="${bgStyle}"></div>
    <div class="fund-card-shade"></div>
    <div class="fund-card-body">
      <div class="fund-card-top">
        <span class="fund-card-kind">${esc(kind)}</span>
        <span class="fund-card-cnt">${fmtCount(acc.count)} 笔</span>
      </div>
      <div class="fund-card-num-row">
        <span class="fund-card-num" data-masked="${esc(cardNumMasked)}" data-full="${esc(cardNumFull)}">${esc(numDisplay)}</span>
        ${eyeBtn}
      </div>
      <div class="fund-card-foot">
        <div class="fund-card-bank">${accountBrandMarkHtml(acc.pay)}<span class="fund-card-bank-name">${esc(displayName)}</span></div>
        <div class="fund-card-net">${fmtMoneySigned(net)}</div>
      </div>
    </div>
  </div>`;
}

function renderTxnRow(row) {
  const isInc = row['收支'] === '收入';
  const title = rowTitleFn(row);
  const desc = (row['商品说明'] || '').trim();
  const showDesc = desc && desc !== '/' && desc !== title;
  const cat = row['子分类'] ? `${row['分类']} · ${row['子分类']}` : row['分类'];
  const isRf = row['退款状态'] === 'refunded';
  return `<div class="fund-txn">
    <div class="fund-txn-icon">${isInc ? '<i class="ti ti-arrow-down-left"></i>' : '<i class="ti ti-arrow-up-right"></i>'}</div>
    <div class="fund-txn-main">
      <div class="fund-txn-title">${esc(title)}${isRf ? '<span class="fund-txn-rf">退</span>' : ''}</div>
      <div class="fund-txn-sub">${esc(cat)}${showDesc ? ` · ${esc(desc)}` : ''}</div>
    </div>
    <div class="fund-txn-meta">
      <div class="fund-txn-time">${formatTimeShort(row['时间']) || '—'}</div>
      <div class="fund-txn-src">${srcBadgeHtml(row['来源'])}</div>
    </div>
    <div class="fund-txn-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
  </div>`;
}

function renderAccountDetail(payKey) {
  const rows = accountRows(payKey);
  const { exp, inc, net } = accountStats(rows);
  const parsed = parsePayAccount(payKey);
  const displayName = accountGroupName(payKey) || parsed.brand?.name || parsed.label;
  const subPays = accountPaysForKey(payKey);
  const head = document.getElementById('accountsHead');
  if (head) {
    const subHint = subPays.length > 1
      ? ` · 含 ${subPays.map(p => esc(p)).join('、')}`
      : (subPays[0] && subPays[0] !== payKey ? ` · ${esc(subPays[0])}` : '');
    head.innerHTML = `
      <div class="accounts-head-name">${accountBrandMarkHtml(payKey, 28)}<span>${esc(displayName)}</span></div>
      <div class="accounts-head-sub">${esc(parsed.kind)}${parsed.last4 ? ` · 尾号 ${parsed.last4}` : ''} · 共 ${fmtCount(rows.length)} 笔${subHint}</div>`;
  }

  const kpi = document.getElementById('accountsKpi');
  if (kpi) {
    kpi.innerHTML = `
      <div class="accounts-kpi-card">
        <div class="accounts-kpi-label"><i class="ti ti-arrow-up-right"></i>支出</div>
        <div class="accounts-kpi-value c-red">${fmtMoney(exp)}</div>
      </div>
      <div class="accounts-kpi-card">
        <div class="accounts-kpi-label"><i class="ti ti-arrow-down-left"></i>收入</div>
        <div class="accounts-kpi-value c-grn">${fmtMoney(inc)}</div>
      </div>
      <div class="accounts-kpi-card">
        <div class="accounts-kpi-label"><i class="ti ti-scale"></i>净额</div>
        <div class="accounts-kpi-value ${net >= 0 ? 'c-grn' : 'c-red'}">${fmtMoneySigned(net)}</div>
      </div>`;
  }

  const list = document.getElementById('accountsList');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="accounts-empty">暂无流水</div>';
    return;
  }

  const dayMap = new Map();
  rows.forEach(r => {
    const d = r['日期'];
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d).push(r);
  });

  list.innerHTML = [...dayMap.entries()].map(([date, dayRows]) => {
    const dayInc = dayRows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
    const dayExp = dayRows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
    return `<section class="fund-day">
      <header class="fund-day-head">
        <span>${formatDayHeader(date)}</span>
        <span class="fund-day-sum">
          ${dayInc ? `<span class="inc">+${fmtMoney(dayInc)}</span>` : ''}
          ${dayExp ? `<span class="exp">-${fmtMoney(dayExp)}</span>` : ''}
        </span>
      </header>
      <div class="fund-day-rows">${dayRows.map(renderTxnRow).join('')}</div>
    </section>`;
  }).join('');
}

function mgrAccountRows() {
  const rows = [];
  const seen = new Set();
  const countMap = new Map(accountList().map(a => [a.pay, a.count]));

  getAllRows().forEach(r => {
    const pay = (r['支付方式'] || '').trim();
    if (!isValidPayAccount(pay)) return;
    const key = accountGroupKey(pay);
    if (seen.has(key) || isHidden(key)) return;
    seen.add(key);
    const parsed = parsePayAccount(key);
    rows.push({
      key,
      label: parsed.label,
      digits: accountDigits(key),
      kind: parsed.kind,
      manual: false,
      count: countMap.get(key) || 0
    });
  });

  accountRegistry.manual.forEach(m => {
    const key = manualKey(m.id);
    if (isHidden(key)) return;
    rows.push({
      key,
      label: m.label || '账户',
      digits: onlyDigits(m.digits),
      kind: m.kind || '支付账户',
      manual: true,
      count: 0
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
    return `<div class="acct-mgr-row">
      <div class="acct-mgr-main">
        <div class="acct-mgr-name">${esc(row.label)} ${tag}</div>
        <div class="acct-mgr-meta">${esc(row.kind)} · ${esc(digits)}${row.count ? ` · ${fmtCount(row.count)} 笔` : ''}</div>
      </div>
      <div class="acct-mgr-actions">
        <button type="button" class="btn btn-sm" data-edit-account="${esc(row.key)}" title="编辑"><i class="ti ti-edit"></i></button>
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
    if (titleEl) titleEl.textContent = '新增账户';
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
  if (titleEl) titleEl.textContent = isManualKey(payKey) ? '编辑手动账户' : '编辑账户';
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

  if (payKey) {
    if (isManualKey(payKey)) {
      const entry = getManualEntry(payKey);
      if (entry) {
        entry.label = label;
        entry.digits = digits;
        entry.kind = kind;
      }
    } else {
      accountRegistry.overrides[payKey] = { label, digits, kind };
    }
  } else {
    accountRegistry.manual.push({
      id: `m${Date.now()}`,
      label,
      digits,
      kind
    });
  }

  onPersist();
  renderAccountsMgrList();
  resetAccountsMgrForm();
  renderAccountsPage();
}

export function editAccountsMgr(payKey) {
  fillAccountsMgrForm(payKey);
  document.getElementById('acctMgrForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function deleteAccountsMgr(payKey) {
  if (!payKey) return;
  const parsed = parsePayAccount(payKey);
  const name = parsed.label || payKey;
  if (!confirm(`确定删除账户「${name}」？\n仅从资金账户页隐藏，不会删除账目流水。`)) return;

  if (isManualKey(payKey)) {
    const id = payKey.slice(MANUAL_PREFIX.length);
    accountRegistry.manual = accountRegistry.manual.filter(m => m.id !== id);
  } else if (!accountRegistry.hidden.includes(payKey)) {
    accountRegistry.hidden.push(payKey);
  }

  delete accountRegistry.overrides[payKey];
  revealedCardNums.delete(payKey);
  if (activeAccount === payKey) activeAccount = null;

  onPersist();
  renderAccountsMgrList();
  if (document.getElementById('acctMgrKey')?.value === payKey) resetAccountsMgrForm();
  renderAccountsPage();
}

export function selectFundAccount(pay) {
  activeAccount = pay;
  renderAccountsPage();
}

export function setupAccountsEvents() {
  const cards = document.getElementById('accountsCards');
  if (cards && !cards._bound) {
    cards._bound = true;
    cards.addEventListener('click', e => {
      const toggle = e.target.closest('.fund-card-num-toggle');
      if (toggle) {
        e.stopPropagation();
        e.preventDefault();
        const pay = toggle.dataset.account;
        if (!pay) return;
        if (revealedCardNums.has(pay)) revealedCardNums.delete(pay);
        else revealedCardNums.add(pay);
        const card = toggle.closest('.fund-card');
        const numEl = card?.querySelector('.fund-card-num');
        const icon = toggle.querySelector('i');
        const show = revealedCardNums.has(pay);
        if (numEl) numEl.textContent = show ? numEl.dataset.full : numEl.dataset.masked;
        if (icon) icon.className = `ti ${show ? 'ti-eye-off' : 'ti-eye'}`;
        toggle.title = show ? '隐藏卡号' : '显示卡号';
        toggle.setAttribute('aria-label', toggle.title);
        return;
      }
      const card = e.target.closest('.fund-card[data-account]');
      if (!card) return;
      selectFundAccount(card.dataset.account);
    });
    cards.addEventListener('keydown', e => {
      const card = e.target.closest('.fund-card[data-account]');
      if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      selectFundAccount(card.dataset.account);
    });
  }

  const mgrList = document.getElementById('acctMgrList');
  if (mgrList && !mgrList._bound) {
    mgrList._bound = true;
    mgrList.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit-account]');
      if (editBtn) {
        editAccountsMgr(editBtn.dataset.editAccount);
        return;
      }
      const delBtn = e.target.closest('[data-del-account]');
      if (delBtn) deleteAccountsMgr(delBtn.dataset.delAccount);
    });
  }
}

export function renderAccountsPage() {
  const cardsEl = document.getElementById('accountsCards');
  const panelEl = document.getElementById('accountsPanel');
  if (!cardsEl) return;

  const accounts = accountList();
  if (!accounts.length) {
    cardsEl.innerHTML = '<div class="accounts-empty accounts-empty--full"><i class="ti ti-credit-card-off"></i>暂无资金账户。导入账单后会自动收录，或点击右上角设置手动添加。</div>';
    panelEl?.classList.add('hide');
    return;
  }

  if (!activeAccount || !accounts.some(a => a.pay === activeAccount)) {
    activeAccount = accounts[0].pay;
  }

  cardsEl.innerHTML = accounts.map(a => renderBankCard(a, a.pay === activeAccount)).join('');
  panelEl?.classList.remove('hide');
  renderAccountDetail(activeAccount);
}
