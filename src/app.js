// ── 主应用 ───────────────────────────────────────────────────────────────────
import { Categorizer } from './categorizer.js';
import { ImportTimeline } from './import-timeline.js';
import { Parsers } from './parsers.js';
import {
  DEFAULT_CATS, DEFAULT_EMOJIS, LEGACY_DEFAULT_EMOJIS, CAT_ICON_NAME_ALIASES, DEFAULT_SOURCES, DEFAULT_IMPORT_SOURCE, DEFAULT_SUBCATS, CAT_COLORS,
  MONITOR_CATS, EXCLUDE_CATS, DEFAULT_OFFSET_CATS, DEFAULT_CAT_STATS_EXCLUDE, MONITOR_EMOJIS, DEFAULT_INCOME_DATA_CATS, DEFAULT_INCOME_CATS
} from './config.js';
import { renderCatIcon, iconRef, isIconRef, isIconifyRef, normalizeIconRef, resolveCatIconValue } from './cat-icons.js';
import { fetchState, saveState, resetLedger, deleteImportBatchApi, changeImportBatchSourceApi, checkHealth } from './api.js';
import {
  createBatchId, stampImportBatch, deriveImportHistory,
  recordsForBatch as batchRecords, deleteConfirmMessage
} from './import-manager.js';
import { API_BASE } from './apiBase.js';
import { fmtMoney, fmtMoneySigned, fmtCount, fmtChartAxis, chartMoneyTooltip, CHART_THEME, chartDarkScalesY, chartDarkScalesXY } from './format.js';
import {
  initGear, loadGearState, getGearState, renderGearPage, migrateGearEmbeddedImages,
  openGearEdit, closeGearEdit, saveGearEdit, triggerGearUpload, setupGearUpload, submitGearImageUrl,
  selectGearTab, markGearSold, markGearUnsold, markGearSoldFromModal,
  onGearCatChange, openGearSectionAdd, closeGearSectionAdd, confirmGearSectionAdd,
  onGearSectionCatChange, onGearSectionSubChange, removeGearSection
} from './gear.js';
import {
  renderCompanyCostPage, setupCompanyCost,
  openInvoiceEdit, closeInvoiceEdit, saveInvoiceEdit, removeInvoice, triggerInvoiceUpload, triggerManualInvoiceUpload,
  toggleInvoicePrinted, downloadInvoiceFile, printInvoiceFile, openAppConfig
} from './company-cost.js';
import {
  loadFamilyEvents, setupFamilyEvents,
  initFamily,
  openFamilyCreate, openFamilyEdit, closeFamilyEdit, saveFamilyEdit,
  removeFamilyEvent, triggerFamilyUpload, onFamilySearch, clearFamilySearch, setFamilyViewMode,
  openFamilyTxnSearch, closeFamilyTxnSearch, onFamilyTxnSearch,
  pickFamilyLinkedTxn, removeFamilyLinkedTxn,
} from './family.js';
import {
  initSplits, hasSplits, expandRowForStats, rowMatchesCat, rowSearchHaystack,
  toggleSplitExpand, isSplitExpanded, openSplitEditor, closeSplitEditor, getSplitEditId,
  addSplitLine, saveSplitEditor, clearSplits, updateSplitItem,
  parentCatCellHtml, splitSubRowHtml, splitSubRowNoDateHtml
} from './splits.js';
import { initCatPicker, catCellInnerHtml, openEmojiPicker, closeEmojiPicker } from './cat-picker.js';
import { subCatSelectHtml, rowHasUnsetSub, rowMatchesSubCat, SUBCAT_UNSET_LABEL } from './subcat-ui.js';
import { srcMarkHtml, srcBrandColor } from './source-logos.js';
import {
  initCatBrowse, renderCatBrowse, selectCatBrowse,
  toggleCatBrowseGroup, toggleCatBrowseUnsetSubFilter,
  getCatBrowseSelectedKeys, clearCatBrowseSelection, updateCatBrowseBulkBar,
  toggleCatBrowseSelect, toggleCatBrowseGroupSelect, toggleCatBrowseSelectAll
} from './cat-browse.js';
import {
  loadTxnPairs, getTxnPairs, validateTxnPair, validateTxnLink, addTxnPair, addTxnLink,
  appendTxnLinkKeys, renameTxnLink, removeTxnPairByKey, removeTxnLinkById,
  findPairForKey, findLinkForKey, findLinkById, rowInLink, rowsForLinkKeys,
  computeLinkStats, linkBalanceMeta, suggestTxnLinkName
} from './txn-pairs.js';
import {
  loadTxnMerges, getTxnMerges, validateTxnMerge, addTxnMerge, removeTxnMergeById,
  findMergeForKey, findMergeById, mergedKeySet, rowInMerge, pruneTxnMerges,
  computeMergeNet, mergeStatsRow
} from './txn-merges.js';
import {
  initRenqing, loadRenqingState, getRenqingState, renderRenqingPage,
  selectRenqingPerson, goRenqingPage, triggerRenqingAvatarUpload, setupRenqingUpload,
  RENQING_CAT
} from './renqing.js';
import {
  initAccounts, loadAccountsState, getAccountsState, renderAccountsPage, renderHomeLongRemindersSection, selectAccountsTab,
  consumeRegistryMigrationPersist,
  setupAccountsEvents,
  openAccountsMgr, closeAccountsMgr, resetAccountsMgrForm, saveAccountsMgr,
  editAccountsMgr, startAccountMerge, cancelAccountMerge, confirmAccountMerge,
  addCreditCardRow, deleteCreditCard, toggleCreditCardEditMode, toggleCreditCancelled,
  toggleCashAccountEditMode, addCashAccountRow, deleteCashAccount,
  toggleBudgetEditMode, addBudgetRow, deleteBudget,
  toggleLifeAccountEditMode, addLifeAccountRow, deleteLifeAccount,
  toggleLongReminderEditMode, addLongReminderRow, deleteLongReminder, addLongReminderToCalendar,
  toggleTopbarReminders, closeTopbarReminders,
  toggleWebAccountEditMode, addWebAccountRow, addWebAccountColumn, deleteWebAccountRow, deleteWebAccountColumn,
  bindSelectedCreditCards, unbindCreditCardFromPool, dissolveCreditPoolById
} from './accounts.js';

let CATS = [...DEFAULT_CATS];
let EMOJIS = { ...DEFAULT_EMOJIS };
let SUBCATS = { ...DEFAULT_SUBCATS };
let SOURCES = JSON.parse(JSON.stringify(DEFAULT_SOURCES));
let SOURCE_CHIP_ORDER = [];
let OFFSET_CATS_SET = new Set(DEFAULT_OFFSET_CATS);
let CAT_STATS_EXCLUDE = new Set(DEFAULT_CAT_STATS_EXCLUDE);
let INCOME_CATS_SET = new Set(DEFAULT_INCOME_CATS);
let INCOME_DATA_CATS_LIST = [...DEFAULT_INCOME_DATA_CATS];
let incomeYear = null;

let allData = [], filteredData = [], curPage = 1;
let PG = 30;
let activeSrc = 'all', refunded = new Set(), excluded = new Set(), charts = {};
let filterUnsetSubOnly = false;
let filterSubCat = '';
let activeTxnLinkId = null;
let activeTxnMergeId = null;
let activeTradeLinkId = null;
let activeTradeNameEditId = null;
let tradeAddLinkId = null;
let dayNotes = {};
let detRows = [], detSort = 'a-';
let detIsIncome = false;
let detFilterUnsetSubOnly = false;
let detContext = null;
let detSelectedIds = new Set();
let nextId = 1;
let stateVersion = 0;
let pendingImport = null;
let importHistory = [];
let importActiveSource = null;

function syncImportHistory() {
  importHistory = deriveImportHistory(allData, importHistory);
}

function renderImportHistoryUI() {
  ImportTimeline.renderHistoryAll(importHistory, SOURCES.map(s => s.name));
}

function ensureCcbChenchengSource() {
  if (SOURCES.find(s => s.name === DEFAULT_IMPORT_SOURCE)) return false;
  const def = DEFAULT_SOURCES.find(s => s.name === DEFAULT_IMPORT_SOURCE);
  SOURCES.push(def ? { ...def } : { name: DEFAULT_IMPORT_SOURCE, color: '#0066b3' });
  return true;
}

function ensureCiticChenchengSource() {
  const name = '中信-陈橙';
  if (SOURCES.find(s => s.name === name)) return false;
  const def = DEFAULT_SOURCES.find(s => s.name === name);
  SOURCES.push(def ? { ...def } : { name, color: '#c41230' });
  return true;
}

function ensureCmbHuhanSource() {
  const name = '招行-胡晗';
  if (SOURCES.find(s => s.name === name)) return false;
  const def = DEFAULT_SOURCES.find(s => s.name === name);
  SOURCES.push(def ? { ...def } : { name, color: '#c41230' });
  return true;
}

function renderImportPage() {
  if (!importActiveSource && !pendingImport && SOURCES.some(s => s.name === DEFAULT_IMPORT_SOURCE)) {
    importActiveSource = DEFAULT_IMPORT_SOURCE;
  }
  populateImportSources();
  updateImportUploadState();
  syncImportHistory();
  renderImportHistoryUI();
  renderImportTimelineView();
}

function renderImportTimelineView() {
  syncImportHistory();
  ImportTimeline.render({
    containerId: 'importTimeline',
    existingData: allData,
    importHistory,
    pendingRecords: pendingImport?.records || [],
    pendingAllRecords: pendingImport?.allRecords || [],
    pendingNewRecords: pendingImport?.newRecords || pendingImport?.records || [],
    activeSource: pendingImport?.sourceName || importActiveSource || '',
    fileName: pendingImport?.fileName || ''
  });
}

const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
let pendingDayChipScroll = null;

function formatDateLabel(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDayHeader(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${WEEKDAY_LABELS[d.getDay()]}`;
}

function fmtDayAmt(n) {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

function daySumHtml(inc, exp) {
  return `<span class="ledger-day-sum">
    <span class="day-sum-item day-sum-inc"><i class="ti ti-arrow-up day-sum-ico"></i><span class="day-sum-val">${fmtDayAmt(inc)}</span></span>
    <span class="day-sum-item day-sum-exp"><i class="ti ti-arrow-down day-sum-ico"></i><span class="day-sum-val">${fmtDayAmt(exp)}</span></span>
  </span>`;
}

function computeDayTotals(data) {
  const totals = {};
  data.forEach(r => {
    const d = r['日期'];
    if (!totals[d]) totals[d] = { inc: 0, exp: 0 };
    if (r['退款状态'] === 'refunded') return;
    if (r['收支'] === '收入') totals[d].inc += r['金额'];
    else totals[d].exp += r['金额'];
  });
  return totals;
}

function renderLedgerDayRow(row) {
  const isR = row['退款状态'] === 'refunded';
  const isEx = row['统计状态'] === 'excluded';
  const isSel = selectedIds.has(row.id);
  const split = hasSplits(row);
  const catCell = split ? parentCatCellHtml(row) : catCellHtml(row);
  const typeCat = split ? (row.splits[0]?.category || row['分类']) : row['分类'];
  let html = `<div class="tr COL COL-NODATE ledger-row${split ? ' has-splits' : ''}${isR ? ' refunded' : ''}${isEx ? ' excluded' : ''}${isSel ? ' selected' : ''}" data-id="${row.id}">
    <div class="td td-check"><input type="checkbox" class="cb" ${isSel ? 'checked' : ''} onchange="toggleSelect(${row.id},this)"></div>
    ${peerDescCell(row)}
    ${amtCellHtml(row, isR)}
    ${catCell}
    <div class="td no-strike type-cell">${typeBadge(row['收支'], row['退款状态'], typeCat)}</div>
    <div class="td no-strike src-cell">${srcBadge(row['来源'])}</div>
    <div class="td no-strike td-actions">
      <button type="button" class="icon-act split${split ? ' on' : ''}" title="${split ? '编辑拆分' : '拆分账目'}" onclick="openSplitEditor(${row.id})"><i class="ti ti-arrows-split"></i></button>
      <button type="button" class="icon-act rf ${isR ? 'um' : 'mk'}" title="${isR ? '撤销退款' : '标记退款'}" onclick="toggleRf(${row.id})"><i class="ti ${isR ? 'ti-rotate-clockwise' : 'ti-receipt-refund'}"></i></button>
      <button type="button" class="icon-act ex ${isEx ? 'on' : ''}" title="${isEx ? '恢复计入统计' : '不计入统计'}" onclick="toggleExclude(${row.id})"><i class="ti ti-calculator-off"></i></button>
    </div>
  </div>`;
  if (split && isSplitExpanded(row.id)) {
    html += row.splits.map((sp, i) => splitSubRowNoDateHtml(row, sp, i)).join('');
  }
  return html;
}

function formatTimeShort(time) {
  if (!time) return '';
  const parts = String(time).trim().split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : String(time).trim();
}

function dateTimeCell(date, time) {
  const d = (date || '').trim();
  const t = formatTimeShort(time);
  const title = t ? `${d} ${time || t}` : d;
  return `<div class="td dt-cell" title="${title}">
    <div class="dt-label">${formatDateLabel(d)}</div>
    <div class="dt-value">${t || '—'}</div>
  </div>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function peerDescCell(row) {
  const product = (row['产品名称'] || '').trim();
  const peer = (row['交易对方'] || '').trim();
  const main = product || peer || '—';
  const d = (row['商品说明'] || '').trim();
  const showDesc = d && d !== '/' && d !== main && (!product || d !== peer);
  const title = showDesc ? `${main} · ${d}` : main;
  const dupTag = row._dupSuspect
    ? '<span class="ledger-dup-flag" title="疑似与其他来源账单重复，可手动删除或标记不计入"><i class="ti ti-copy"></i></span>'
    : '';
  const link = findLinkForKey(String(row.id));
  const linkTag = link
    ? `<button type="button" class="ledger-link-tag" onclick="event.stopPropagation();filterTxnLink('${escHtml(link.id)}')" title="查看关联账目并核对收支"><i class="ti ti-link"></i>${escHtml(link.name)}</button>`
    : '';
  const merge = findMergeForKey(String(row.id));
  const mergeTag = merge
    ? `<button type="button" class="ledger-merge-tag" onclick="event.stopPropagation();filterTxnMerge('${escHtml(merge.id)}')" title="查看合并统计的账目">合并</button>`
    : '';
  return `<div class="td peer-desc" title="${title}"><div class="peer-main">${dupTag}${main}${linkTag}${mergeTag}</div>${showDesc ? `<div class="peer-sub">${d}</div>` : ''}</div>`;
}

function dupReasonLabel(reason) {
  return {
    file: '文件内重复',
    existing: '与已有账目重复',
    cross: '跨来源疑似重复',
    cross_wallet: '与微信/支付宝重复（保留钱包记录）'
  }[reason] || '重复';
}

function dupMatchMeta(row) {
  if (!row._dupMatch) return '';
  const m = row._dupMatch;
  const peer = (m['交易对方'] || '—').trim();
  return ` · 匹配 ${m['来源']} ${m['日期']} ${formatTimeShort(m['时间'])} ${peer}`;
}

function findImportPreviewRecord(uid) {
  if (!pendingImport || !uid) return null;
  const pools = [pendingImport.allRecords, pendingImport.newRecords, pendingImport.duplicateRecords];
  for (const list of pools) {
    const row = (list || []).find(r => r._importUid === uid);
    if (row) return row;
  }
  return null;
}

function renderImportRecordTable(records) {
  const wrap = document.getElementById('importRecordPreview');
  const el = document.getElementById('importRecordTable');
  if (!records?.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const show = records.slice(0, 50);
  el.innerHTML = `
    <div class="th-row import-rec-cols import-rec-cols--edit">
      <div class="th">日期</div><div class="th">交易对方</div><div class="th">收支</div><div class="th">金额</div><div class="th">分类</div>
    </div>
    ${show.map(r => {
      const uid = r._importUid || '';
      const typeCls = r['收支'] === '收入' ? 'import-rec-type-inc' : 'import-rec-type-exp';
      const dupTag = r._dupReason ? `<span class="import-rec-dup-tag">重复</span>` : '';
      return `<div class="tr import-rec-cols import-rec-cols--edit">
        ${dateTimeCell(r['日期'], r['时间'])}
        ${peerDescCell(r)}
        <div class="td import-rec-type-cell">
          <button type="button" class="btn btn-sm import-rec-type-btn ${typeCls}" onclick="toggleImportRecordType('${uid}')" title="点击切换收支">${r['收支']}</button>
          ${dupTag}
        </div>
        <div class="td import-rec-amt-cell">
          <input type="text" class="import-rec-amt-inp" value="${Number(r['金额'] || 0).toFixed(2)}" inputmode="decimal"
            onchange="updateImportRecordAmount('${uid}', this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
        </div>
        <div class="td">${catLabel(r['分类'])}${r['子分类'] ? ' · ' + r['子分类'] : ''}</div>
      </div>`;
    }).join('')}
    ${records.length > show.length ? `<div class="import-rec-more">另有 ${records.length - show.length} 条未显示，确认导入后可在明细中继续修改</div>` : ''}`;
}

function toggleImportRecordType(uid) {
  const r = findImportPreviewRecord(uid);
  if (!r) return;
  r['收支'] = r['收支'] === '收入' ? '支出' : '收入';
  renderImportRecordTable(pendingImport?.allRecords || []);
}

function updateImportRecordAmount(uid, value) {
  const r = findImportPreviewRecord(uid);
  if (!r) return;
  const n = parseFloat(String(value ?? '').replace(/[,，\s¥￥]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return;
  r['金额'] = Math.abs(n);
  renderImportRecordTable(pendingImport?.allRecords || []);
}

function subcatsFor(cat) {
  return SUBCATS[cat] || [];
}

function amtCellHtml(row, isR) {
  const sign = row['收支'] === '收入' ? '+' : '-';
  const cls = isR ? ' rf' : row['收支'] === '收入' ? ' i' : ' e';
  return `<div class="td amt-cell no-strike${cls}">
    <div class="amt-val">${isR ? '<span class="amt-rf-tag">退</span>' : ''}${sign}${row['金额'].toFixed(2)}</div>
  </div>`;
}

function catCellHtml(row) {
  const cat = row['分类'];
  const sub = row['子分类'] || '';
  const subs = subcatsFor(cat);
  const subSel = subCatSelectHtml({ subs, sub, onchange: `updSubCat(${row.id},this.value)` });
  return `<div class="td no-strike cat-cell">${catCellInnerHtml(row.id, cat, subSel)}</div>`;
}

function detCatCellHtml(row) {
  return catCellHtml(row).replace('class="td no-strike cat-cell"', 'class="td no-strike cat-cell det-cat-cell"');
}

function catLabel(c) { return c; }
function catColor(c) { const i = CATS.indexOf(c); return i >= 0 ? CAT_COLORS[i] : '#98a2b3'; }

function colorLuminance(hex) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length !== 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 首页卡片：保留分类原色，仅将黑色/近黑色替换为主题紫 */
function homeCardAccent(accent) {
  const hex = String(accent || '').trim();
  if (!hex.startsWith('#') || colorLuminance(hex) < 0.12) return 'var(--primary)';
  return hex;
}
function srcColor(s) { const f = SOURCES.find(x => x.name === s); return f ? f.color : '#98a2b3'; }
function isCatExcludedFromStats(cat) {
  return CAT_STATS_EXCLUDE.has(cat);
}

function isIncomeCategory(cat) {
  return INCOME_CATS_SET.has(cat);
}

function isCountedInStats(r) {
  return r['退款状态'] !== 'refunded'
    && r['统计状态'] !== 'excluded'
    && !isCatExcludedFromStats(r['分类']);
}

function activeData() { return allData.filter(isCountedInStats); }

function activeExpanded() {
  const out = [];
  allData.filter(isCountedInStats).forEach(r => out.push(...expandRowForStats(r)));
  return out;
}

function statsExpanded() {
  const expanded = [];
  allData.filter(isCountedInStats).forEach(r => expanded.push(...expandRowForStats(r)));
  const merged = mergedKeySet();
  const kept = expanded.filter(r => {
    const parent = String(r._splitOf ?? r.id);
    return !merged.has(parent);
  });
  const virtuals = [];
  getTxnMerges().forEach(m => {
    const members = m.keys.map(k => allData.find(r => String(r.id) === String(k))).filter(Boolean);
    const counted = members.filter(isCountedInStats);
    if (!counted.length) return;
    const row = mergeStatsRow(m, counted);
    if (row) virtuals.push(row);
  });
  return [...kept, ...virtuals];
}

/** 人情往来独立页：不受统计排除分类影响，但仍隐藏已退款记录 */
function renqingExpanded() {
  const out = [];
  allData
    .filter(r => r['分类'] === RENQING_CAT && r['退款状态'] !== 'refunded')
    .forEach(r => out.push(...expandRowForStats(r)));
  return out;
}

function statsData() {
  const expanded = statsExpanded();
  const normal = expanded.filter(r => !OFFSET_CATS_SET.has(r['分类']));
  const netRows = [];
  const offsetRows = expanded.filter(r => OFFSET_CATS_SET.has(r['分类']));
  const groups = {};
  offsetRows.forEach(r => {
    const key = r['分类'] + '|' + r['日期'].slice(0, 7);
    if (!groups[key]) groups[key] = { cat: r['分类'], month: r['日期'].slice(0, 7), inc: 0, exp: 0, cnt: 0 };
    if (r['收支'] === '收入') groups[key].inc += r['金额'];
    else groups[key].exp += r['金额'];
    groups[key].cnt++;
  });
  Object.values(groups).forEach(g => {
    const net = g.inc - g.exp;
    if (net === 0) return;
    netRows.push({
      id: -1, 日期: g.month + '-01', 时间: '00:00', 来源: '统计合并',
      交易对方: g.cat, 商品说明: `${g.cat}净收益 (${g.cnt}笔)`,
      分类: g.cat, 收支: net > 0 ? '收入' : '支出',
      金额: Math.abs(net), 支付方式: '', 备注: '对冲净额', 退款状态: 'normal', 统计状态: 'normal'
    });
  });
  return [...normal, ...netRows];
}

function flash() {
  const el = document.getElementById('sv');
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 1800);
}

function buildState() {
  syncImportHistory();
  const gear = getGearState();
  return {
    transactions: allData,
    refunded: [...refunded],
    excluded: [...excluded],
    categories: { cats: CATS, emojis: EMOJIS, subcats: SUBCATS, statsExclude: [...CAT_STATS_EXCLUDE], offsetCats: [...OFFSET_CATS_SET], incomeCats: [...INCOME_CATS_SET], incomeDataCats: [...INCOME_DATA_CATS_LIST] },
    sources: SOURCES,
    sourceChipOrder: SOURCE_CHIP_ORDER,
    rules: { peerRules: Categorizer.peerRules, keywordRules: Categorizer.keywordRules },
    importHistory,
    nextId,
    stateVersion,
    gearLibrary: gear.gearLibrary,
    nextGearId: gear.nextGearId,
    gearSections: gear.gearSections || [],
    hiddenGearSectionIds: gear.hiddenGearSectionIds || [],
    renqingAvatars: getRenqingState().renqingAvatars,
    accountCardFaces: getAccountsState().accountCardFaces,
    accountRegistry: getAccountsState().accountRegistry,
    txnPairs: getTxnPairs(),
    txnMerges: getTxnMerges(),
    dayNotes: { ...dayNotes }
  };
}

let persistTimer = null;
let persistChain = Promise.resolve();
const PERSIST_MAX_RETRIES = 5;
const PERSIST_NETWORK_MAX_RETRIES = 3;

function isPersistNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || '');
  return msg === 'Failed to fetch'
    || msg.includes('网络连接失败')
    || msg.includes('保存超时')
    || msg.includes('NetworkError')
    || msg.includes('Load failed');
}

async function persistNowInner(conflictRetry = 0, networkRetry = 0) {
  try {
    const res = await saveState(buildState());
    if (res?.stateVersion != null) stateVersion = res.stateVersion;
    return true;
  } catch (err) {
    if (err.code === 'STATE_CONFLICT' && err.currentVersion != null && conflictRetry < PERSIST_MAX_RETRIES) {
      stateVersion = err.currentVersion;
      return persistNowInner(conflictRetry + 1, networkRetry);
    }
    if (err.code === 'STATE_CONFLICT') {
      await loadData();
      if (!document.getElementById('moCat')?.classList.contains('hide')) renderCatList();
      alert('保存失败：云端数据已被其他设备更新，已同步最新数据');
      return false;
    }
    if (isPersistNetworkError(err) && networkRetry < PERSIST_NETWORK_MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 2000 * (networkRetry + 1)));
      return persistNowInner(conflictRetry, networkRetry + 1);
    }
    alert('保存失败：' + err.message);
    return false;
  }
}

async function persistNow() {
  flash();
  updateSubtitle();
  clearTimeout(persistTimer);
  persistTimer = null;
  const run = persistChain.then(() => persistNowInner());
  persistChain = run.catch(() => {});
  return run;
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistNow(); }, 300);
}

function setupLedgerHeadScrollSync() {
  const headWrap = document.getElementById('ledgerHeadWrap');
  const bodyScroll = document.getElementById('ledgerBodyScroll');
  if (!headWrap || !bodyScroll) return;
  let syncing = false;
  const sync = (from, to) => {
    if (syncing) return;
    syncing = true;
    to.scrollLeft = from.scrollLeft;
    syncing = false;
  };
  headWrap.addEventListener('scroll', () => sync(headWrap, bodyScroll), { passive: true });
  bodyScroll.addEventListener('scroll', () => sync(bodyScroll, headWrap), { passive: true });
}

async function updateBackendFooter(count) {
  const tip = document.getElementById('sbFooterTip');
  const sub = document.getElementById('sbFooterSub');
  const btn = document.getElementById('sbFooterBtn');
  if (!sub || !tip) return;
  const titleEl = tip.querySelector('strong');
  if (API_BASE) {
    let host = API_BASE;
    try { host = new URL(API_BASE).hostname; } catch { /* keep raw */ }
    if (titleEl) titleEl.textContent = '云端数据库';
    sub.textContent = count != null
      ? `Railway · ${host} · ${count} 笔`
      : `Railway · ${host}`;
    btn?.setAttribute('title', `云端数据库 · Railway · ${host}${count != null ? ` · ${count} 笔` : ''}`);
  } else {
    if (titleEl) titleEl.textContent = '本地账本';
    let mobileLine = '';
    try {
      const health = await checkHealth().catch(() => null);
      const urls = health?.mobileUrls || [];
      if (urls.length) mobileLine = ` · 手机 ${urls[0].replace(/^https?:\/\//, '')}`;
    } catch { /* ignore */ }
    sub.textContent = count != null
      ? `本机 SQLite · ${count} 笔${mobileLine}`
      : `本机 SQLite${mobileLine}`;
    btn?.setAttribute('title', `本地账本 · SQLite${mobileLine}`);
  }
}

async function loadData() {
  try {
    const health = await checkHealth().catch(() => null);
    const state = await fetchState();
    stateVersion = state.stateVersion || 0;
    refunded = new Set((state.refunded || []).map(id => typeof id === 'string' ? parseInt(id, 10) : id));
    excluded = new Set((state.excluded || []).map(id => typeof id === 'string' ? parseInt(id, 10) : id));

    if (state.categories) {
      applyLoadedCategories(state.categories);
      if (migrateCatEmojisToIcons()) persist();
    }

    if (state.sources) SOURCES = state.sources;
    if (Array.isArray(state.sourceChipOrder)) SOURCE_CHIP_ORDER = [...state.sourceChipOrder];
    else SOURCE_CHIP_ORDER = [];
    if (ensureCcbChenchengSource()) await persistNow();
    if (ensureCiticChenchengSource()) await persistNow();
    if (ensureCmbHuhanSource()) await persistNow();
    allData = state.transactions || [];
    const maxId = allData.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    nextId = Math.max(Number(state.nextId) || 1, maxId + 1);
    importHistory = state.importHistory || [];
    Categorizer.applyRules(state.rules);
    loadGearState(state);
    try {
      const migrated = await migrateGearEmbeddedImages();
      if (migrated) await persistNow();
    } catch { /* ignore migration errors */ }
    loadRenqingState(state);
    loadAccountsState(state);
    if (consumeRegistryMigrationPersist()) await persistNow();
    loadTxnPairs(state);
    loadTxnMerges(state);
    dayNotes = (state.dayNotes && typeof state.dayNotes === 'object') ? { ...state.dayNotes } : {};

    allData.forEach(r => {
      if (!r['子分类']) r['子分类'] = '';
      if (!r['产品名称']) r['产品名称'] = '';
      if (refunded.has(r.id)) r['退款状态'] = 'refunded';
      else if (!r['退款状态']) r['退款状态'] = 'normal';
      if (excluded.has(r.id) || r['统计状态'] === 'excluded') {
        r['统计状态'] = 'excluded';
        excluded.add(r.id);
      } else {
        r['统计状态'] = 'normal';
      }
    });
    allData.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));

    if (pruneTxnMerges(allData.map(r => r.id))) persist();

    syncImportHistory();
    buildSrcChips();
    buildCatFilter();
    applyF();
    renderKPI();
    renderHome();
    renderMonitor();
    updateSubtitle();
    renderImportHistoryUI();
    renderGearPage();
    await updateBackendFooter(health?.count ?? allData.length);
  } catch (err) {
    await updateBackendFooter();
    const hint = API_BASE ? '请检查 Railway 后端与 VITE_API_BASE 配置' : '请确认已运行 npm run dev';
    const msg = `无法加载数据：${err.message}\n\n${hint}`;
    if (appReady) alert(msg);
    else throw new Error(msg);
  }
}

function updateSubtitle() {}

function kpiCard(label, value, sub, icon, iconCls, valCls, opts = {}) {
  const clickable = opts.kind
    ? ` role="button" tabindex="0" data-home-kpi="${opts.kind}" class="kpi-c kpi-c-click"`
    : ' class="kpi-c"';
  return `<div${clickable}>
    <div class="kpi-icon ${iconCls}"><i class="ti ${icon}"></i></div>
    <div class="kpi-body">
      <div class="kpi-l">${label}</div>
      <div class="kpi-v ${valCls || ''}">${value}</div>
      <div class="kpi-s">${sub}</div>
    </div>
  </div>`;
}

function getLastMonthYm() {
  const now = new Date();
  const mo = now.getMonth();
  const pm = mo === 0 ? 12 : mo;
  const py = mo === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${py}-${String(pm).padStart(2, '0')}`;
}

function getPrevMonthYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const HOME_EXP_CAT_HIDDEN_KEY = 'home_exp_cat_hidden';
const HOME_INC_CAT_HIDDEN_KEY = 'home_inc_cat_hidden';
let homeExpCatSettingsDraft = null;
let homeIncCatSettingsDraft = null;
let homeSelectedYm = null;

function getHomeYm() {
  return homeSelectedYm || getLastMonthYm();
}

function homeMonthsFromData() {
  const months = new Set(statsData().map(r => r['日期'].slice(0, 7)));
  months.add(getLastMonthYm());
  return [...months].sort((a, b) => b.localeCompare(a));
}

function syncHomeMonthSelect() {
  const menu = document.getElementById('homeMonthDropMenu');
  const label = document.getElementById('homeMonthDropLabel');
  if (!menu || !label) return;
  const ym = getHomeYm();
  const months = homeMonthsFromData();
  label.textContent = fmtMonthLabel(ym);
  menu.innerHTML = months.map(m =>
    `<button type="button" class="home-month-drop-item${m === ym ? ' on' : ''}" role="option" aria-selected="${m === ym ? 'true' : 'false'}" onclick="selectHomeMonth('${m}')">${fmtMonthLabel(m)}</button>`
  ).join('');
}

function closeHomeMonthDrop() {
  document.getElementById('homeMonthDropMenu')?.classList.add('hide');
  document.getElementById('homeMonthDropBtn')?.setAttribute('aria-expanded', 'false');
}

function toggleHomeMonthDrop() {
  const menu = document.getElementById('homeMonthDropMenu');
  const btn = document.getElementById('homeMonthDropBtn');
  if (!menu || !btn) return;
  menu.classList.toggle('hide');
  const isOpen = !menu.classList.contains('hide');
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) menu.querySelector('.home-month-drop-item.on')?.scrollIntoView({ block: 'nearest' });
}

function selectHomeMonth(ym) {
  closeHomeMonthDrop();
  onHomeMonthChange(ym);
}

let homeMonthDropEventsBound = false;
function ensureHomeMonthDropEvents() {
  if (homeMonthDropEventsBound) return;
  homeMonthDropEventsBound = true;
  document.addEventListener('click', e => {
    if (e.target.closest('#homeMonthDrop')) return;
    closeHomeMonthDrop();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeHomeMonthDrop();
  });
}

function onHomeMonthChange(ym) {
  homeSelectedYm = ym;
  renderHome();
}

function homeMonthKpiLabel(ym) {
  return ym === getLastMonthYm() ? '上月' : fmtMonthLabel(ym);
}

function getHomeExpCatHidden() {
  return getHomeCatHiddenSet(HOME_EXP_CAT_HIDDEN_KEY);
}

function saveHomeExpCatHiddenSet(set) {
  saveHomeCatHiddenSet(HOME_EXP_CAT_HIDDEN_KEY, set);
}

function getHomeIncCatHidden() {
  return getHomeCatHiddenSet(HOME_INC_CAT_HIDDEN_KEY);
}

function saveHomeIncCatHiddenSet(set) {
  saveHomeCatHiddenSet(HOME_INC_CAT_HIDDEN_KEY, set);
}

function getHomeCatHiddenSet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHomeCatHiddenSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function getRecentMonthsYm(anchorYm, count = 6) {
  const months = [];
  let cur = anchorYm;
  for (let i = 0; i < count; i++) {
    months.unshift(cur);
    cur = getPrevMonthYm(cur);
  }
  return months;
}

function categoryTotalInMonth(ym, cat, type) {
  return monthStatsRows(ym)
    .filter(r => r['分类'] === cat && r['收支'] === type)
    .reduce((s, r) => s + r['金额'], 0);
}

function yearMonthsThroughYm(anchorYm) {
  const [y, m] = anchorYm.split('-').map(Number);
  return Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

function categoryYearStats(cat, type, anchorYm) {
  const months = yearMonthsThroughYm(anchorYm);
  const ytd = months.reduce((s, ym) => s + categoryTotalInMonth(ym, cat, type), 0);
  const avg = months.length ? ytd / months.length : 0;
  return { ytd, avg };
}

function expenseCategoriesInYear(anchorYm) {
  const cats = new Set();
  yearMonthsThroughYm(anchorYm).forEach(ym => {
    monthStatsRows(ym)
      .filter(r => r['收支'] === '支出')
      .forEach(r => cats.add(r['分类']));
  });
  return [...cats];
}

function estimatedMonthlyExpense(anchorYm) {
  return expenseCategoriesInYear(anchorYm).reduce(
    (sum, cat) => sum + categoryYearStats(cat, '支出', anchorYm).avg,
    0
  );
}

function homeCatSubHtml(cat, type, ym) {
  const { ytd, avg } = categoryYearStats(cat, type, ym);
  return `<div class="home-cat-sub"><span>总计 ${fmtCompactMoney(ytd)}</span><span class="home-cat-sub-sep">·</span><span>月均 ${fmtCompactMoney(avg)}</span></div>`;
}

function monthlySeriesForCategory(cat, type, anchorYm, count = 6) {
  return getRecentMonthsYm(anchorYm, count).map(ym => ({
    ym,
    amount: categoryTotalInMonth(ym, cat, type),
  }));
}

function monthStatsRows(ym) {
  return statsData().filter(r => r['日期'].startsWith(ym));
}

function lastMonthStatsRows() {
  return monthStatsRows(getLastMonthYm());
}

function fmtCompactMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return `${sign}${Math.round(abs)}`;
}

function renderHomeMonthlyBars(series, accent, anchorYm, cat, type) {
  const max = Math.max(...series.map(s => s.amount), 1);
  const encCat = encodeURIComponent(cat);
  const maxPx = 48;
  return `<div class="home-cat-bars home-cat-bars-click" role="group" aria-label="近六个月趋势">${series.map(({ ym, amount }) => {
    const hPx = Math.max(8, Math.round((amount / max) * maxPx));
    const on = ym === anchorYm;
    const title = `${fmtMonthLabel(ym)} ${fmtMoney(amount)}`;
    return `<button type="button" class="home-bar${on ? ' home-bar-on' : ''}" style="height:${hPx}px;${on ? `--bar-color:${accent}` : ''}" data-ym="${ym}" data-cat="${encCat}" data-type="${type}" title="${title}" aria-label="${title}"></button>`;
  }).join('')}</div>`;
}

function homeCatDeltaHtml(delta, type) {
  const abs = Math.abs(delta);
  if (abs < 0.01) {
    return '<span class="home-cat-delta home-cat-delta-flat">持平</span>';
  }
  const up = delta > 0;
  const bad = type === '支出' ? up : !up;
  const cls = bad ? 'home-cat-delta-up' : 'home-cat-delta-down';
  const icon = up ? 'ti-trending-up' : 'ti-trending-down';
  const prefix = up ? '+' : '-';
  return `<span class="home-cat-delta ${cls}">${prefix}${fmtCompactMoney(abs)} <i class="ti ${icon}"></i></span>`;
}

function renderHomeCatCards(el, entries, prevMap, type, ym) {
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = `<div class="home-cat-empty">${fmtMonthLabel(ym)}暂无数据</div>`;
    return;
  }
  el.innerHTML = entries.map(([cat, amt]) => {
    const accent = homeCardAccent(catColor(cat));
    const prev = prevMap.get(cat) || 0;
    const delta = amt - prev;
    const amtStr = fmtCompactMoney(amt);
    const amtCls = amtStr.includes('万') || amtStr.length >= 5 ? ' home-cat-amt--sm' : '';
    const bars = renderHomeMonthlyBars(monthlySeriesForCategory(cat, type, ym), accent, ym, cat, type);
    const encCat = encodeURIComponent(cat);
    return `<article class="home-cat-card home-cat-card-click" style="--card-accent:${accent}" role="button" tabindex="0" data-ym="${ym}" data-cat="${encCat}" data-type="${type}" title="查看 ${catLabel(cat)} 明细">
      <div class="home-cat-main">
        <div class="home-cat-name">${catLabel(cat)}</div>
        <div class="home-cat-row">
          <div class="home-cat-val">
            <span class="home-cat-amt${amtCls}">${amtStr}</span>
            ${homeCatDeltaHtml(delta, type)}
          </div>
        </div>
        ${homeCatSubHtml(cat, type, ym)}
      </div>
      ${bars}
    </article>`;
  }).join('');
}

function openHomeCatDetail(ym, cat, type) {
  if (!ym || !cat) return;
  if (type === '收入') showIncomeDetail(ym, cat);
  else showDetail(ym, cat);
}

function ensureHomeCatBarClicks(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid || grid._homeBarClick) return;
  grid._homeBarClick = true;
  const openFromEl = (el) => {
    const ym = el.dataset.ym;
    const cat = decodeURIComponent(el.dataset.cat || '');
    openHomeCatDetail(ym, cat, el.dataset.type);
  };
  grid.addEventListener('click', (e) => {
    const bar = e.target.closest('.home-bar[data-ym][data-cat]');
    if (bar) {
      e.stopPropagation();
      openFromEl(bar);
      return;
    }
    const card = e.target.closest('.home-cat-card[data-ym][data-cat]');
    if (card) openFromEl(card);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.home-cat-card[data-ym][data-cat]');
    if (!card || e.target.closest('.home-bar')) return;
    e.preventDefault();
    openFromEl(card);
  });
}

function openHomeCatSettings(type) {
  const isInc = type === '收入';
  const ym = getHomeYm();
  const rows = monthStatsRows(ym);
  const entries = isInc ? homeIncomeCategoryTotals(rows) : categoryTotals(rows, type);
  const hidden = isInc ? getHomeIncCatHidden() : getHomeExpCatHidden();
  const allCats = [...new Set([...entries.map(([c]) => c), ...hidden])];
  const draft = new Set(hidden);
  if (isInc) homeIncCatSettingsDraft = draft;
  else homeExpCatSettingsDraft = draft;
  const list = document.getElementById(isInc ? 'homeIncCatSettingsList' : 'homeExpCatSettingsList');
  const emptyLabel = isInc ? `${fmtMonthLabel(ym)}暂无收入分类` : `${fmtMonthLabel(ym)}暂无支出分类`;
  const toggleFn = isInc ? 'toggleHomeIncCatSetting' : 'toggleHomeExpCatSetting';
  if (list) {
    list.innerHTML = allCats.length
      ? allCats.map(cat => {
        const visible = !draft.has(cat);
        return `<label class="home-exp-cat-setting-item"><input type="checkbox" data-cat="${encodeURIComponent(cat)}" ${visible ? 'checked' : ''} onchange="${toggleFn}(this)"><span>${catLabel(cat)}</span></label>`;
      }).join('')
      : `<p class="home-cat-empty">${emptyLabel}</p>`;
  }
  document.getElementById(isInc ? 'moHomeIncCats' : 'moHomeExpCats')?.classList.remove('hide');
}

function openHomeExpCatSettings() { openHomeCatSettings('支出'); }
function openHomeIncCatSettings() { openHomeCatSettings('收入'); }

function toggleHomeCatSetting(inp, type) {
  const cat = decodeURIComponent(inp.dataset.cat);
  const draft = type === '收入' ? homeIncCatSettingsDraft : homeExpCatSettingsDraft;
  if (!draft) return;
  if (inp.checked) draft.delete(cat);
  else draft.add(cat);
}

function toggleHomeExpCatSetting(inp) { toggleHomeCatSetting(inp, '支出'); }
function toggleHomeIncCatSetting(inp) { toggleHomeCatSetting(inp, '收入'); }

function saveHomeCatSettings(type) {
  const isInc = type === '收入';
  const draft = isInc ? homeIncCatSettingsDraft : homeExpCatSettingsDraft;
  if (draft) {
    if (isInc) saveHomeIncCatHiddenSet(draft);
    else saveHomeExpCatHiddenSet(draft);
  }
  closeHomeCatSettings(type);
  renderHome();
}

function saveHomeExpCatSettings() { saveHomeCatSettings('支出'); }
function saveHomeIncCatSettings() { saveHomeCatSettings('收入'); }

function closeHomeCatSettings(type) {
  const isInc = type === '收入';
  document.getElementById(isInc ? 'moHomeIncCats' : 'moHomeExpCats')?.classList.add('hide');
  if (isInc) homeIncCatSettingsDraft = null;
  else homeExpCatSettingsDraft = null;
}

function closeHomeExpCatSettings() { closeHomeCatSettings('支出'); }
function closeHomeIncCatSettings() { closeHomeCatSettings('收入'); }

function renderHomeCatGrid(el, entries, prevMap, type, ym, hiddenCats, openSettingsFn) {
  const visible = entries.filter(([cat]) => !hiddenCats.has(cat));
  if (visible.length) {
    renderHomeCatCards(el, visible, prevMap, type, ym);
  } else if (entries.length) {
    el.innerHTML = `<div class="home-cat-empty">分类卡片已全部隐藏 · <button type="button" class="btn btn-sm" onclick="${openSettingsFn}()">显示设置</button></div>`;
  } else {
    renderHomeCatCards(el, [], prevMap, type, ym);
  }
}

function categoryTotals(rows, type) {
  const map = {};
  rows.filter(r => r['收支'] === type).forEach(r => {
    map[r['分类']] = (map[r['分类']] || 0) + r['金额'];
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function homeIncomeCategoryTotals(rows) {
  return categoryTotals(rows, '收入').filter(([cat]) => isIncomeCategory(cat));
}

function renderHomeLegend(el, entries, colors, type, ym) {
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<span class="home-leg-empty">暂无数据</span>';
    return;
  }
  el.innerHTML = entries.map(([cat, amt], i) => {
    const amtStr = fmtMoney(amt, { integer: amt >= 10000 });
    const encCat = encodeURIComponent(cat);
    return `<button type="button" class="home-leg-item home-leg-item-click" data-ym="${ym}" data-cat="${encCat}" data-type="${type}" title="查看 ${catLabel(cat)} 明细">
      <span class="home-leg-dot" style="background:${colors[i]}"></span>
      <span class="home-leg-name">${catLabel(cat)}</span>
      <span class="home-leg-amt">${amtStr}</span>
    </button>`;
  }).join('');
}

function ensureHomeLegendClicks(legId) {
  const el = document.getElementById(legId);
  if (!el || el._homeLegClick) return;
  el._homeLegClick = true;
  el.addEventListener('click', (e) => {
    const item = e.target.closest('.home-leg-item-click[data-ym][data-cat]');
    if (!item) return;
    openHomeCatDetail(item.dataset.ym, decodeURIComponent(item.dataset.cat || ''), item.dataset.type);
  });
}

function renderHomeDonut(chartKey, canvasId, entries, colors, total, centerEl, type, ym) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (charts[chartKey]) charts[chartKey].destroy();
  if (!entries.length) {
    if (centerEl) centerEl.textContent = '—';
    charts[chartKey] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['无数据'],
        datasets: [{ data: [1], backgroundColor: ['rgba(42,40,56,.08)'], borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        cutout: '72%',
      },
    });
    return;
  }
  const keys = entries.map(e => e[0]);
  const vals = entries.map(e => +e[1].toFixed(2));
  if (centerEl) centerEl.textContent = fmtMoney(total, { integer: total >= 10000 });
  charts[chartKey] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: keys.map(catLabel),
      datasets: [{ data: vals, backgroundColor: colors, borderWidth: 3, borderColor: CHART_THEME.pieBorder }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: chartMoneyTooltip },
      cutout: '72%',
      onClick(evt, _elements, chart) {
        const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
        if (!hit.length) return;
        const cat = keys[hit[0].index];
        if (cat) openHomeCatDetail(ym, cat, type);
      },
      onHover(evt, elements) {
        if (evt?.native?.target) {
          evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        }
      },
    },
  });
}

function homeMonthTxnRows(ym, flow) {
  const rows = statsData().filter(r => r['日期'].startsWith(ym));
  if (flow === '支出') return rows.filter(r => r['收支'] === '支出');
  if (flow === '收入') {
    return rows.filter(r => r['收支'] === '收入' && isIncomeCategory(r['分类']));
  }
  return rows.filter(r =>
    r['收支'] === '支出' || (r['收支'] === '收入' && isIncomeCategory(r['分类']))
  );
}

function openHomeSummaryDetail(kind) {
  const ym = getHomeYm();
  const monthLbl = homeMonthKpiLabel(ym);
  detSort = 'a-';
  detFilterUnsetSubOnly = false;
  detSelectedIds.clear();

  if (kind === 'est') {
    detIsIncome = false;
    detContext = { type: 'home-est', month: ym };
    const months = yearMonthsThroughYm(ym);
    const cats = expenseCategoriesInYear(ym);
    const list = cats.map(cat => {
      const { ytd, avg } = categoryYearStats(cat, '支出', ym);
      return { cat, ytd, avg };
    }).sort((a, b) => b.avg - a.avg);
    const estExp = estimatedMonthlyExpense(ym);
    document.getElementById('detTitle').textContent = `预估月支出 · ${ym.slice(0, 4)}年`;
    document.getElementById('detSummary').textContent = `${cats.length} 个分类 · 本年已统计 ${months.length} 个月月均`;
    document.getElementById('detTotal').textContent = fmtMoney(estExp);
    document.getElementById('detTotal').style.color = 'var(--amb-t)';
    renderHomeEstDetailBody(list, months.length);
    updateDetBulkBar();
    syncDetModalLayout();
    syncDetFilterBar();
    document.getElementById('moDet').classList.remove('hide');
    return;
  }

  const flow = kind === 'exp' ? '支出' : kind === 'inc' ? '收入' : 'all';
  const rows = homeMonthTxnRows(ym, flow);
  detIsIncome = kind !== 'exp';
  detContext = { type: 'home-month', month: ym, flow: kind };
  detSelectedIds.clear();

  if (kind === 'exp') {
    const total = rows.reduce((s, r) => s + r['金额'], 0);
    document.getElementById('detTitle').textContent = `${monthLbl}支出明细`;
    document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔支出`;
    document.getElementById('detTotal').textContent = fmtMoney(total);
    document.getElementById('detTotal').style.color = 'var(--red-t)';
  } else if (kind === 'inc') {
    const total = rows.reduce((s, r) => s + r['金额'], 0);
    document.getElementById('detTitle').textContent = `${monthLbl}收入明细`;
    document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔收入`;
    document.getElementById('detTotal').textContent = fmtMoney(total);
    document.getElementById('detTotal').style.color = 'var(--grn-t)';
  } else {
    const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
    const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
    const net = inc - exp;
    document.getElementById('detTitle').textContent = `${monthLbl}结余明细`;
    document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔 · 收入 ${fmtMoney(inc)} · 支出 ${fmtMoney(exp)}`;
    document.getElementById('detTotal').textContent = fmtMoneySigned(net);
    document.getElementById('detTotal').style.color = net >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  }

  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  syncDetFilterBar();
  document.getElementById('moDet').classList.remove('hide');
}

function renderHomeEstDetailBody(list, monthCount) {
  const el = document.getElementById('detBody');
  detRows = [];
  if (!list.length) {
    el.innerHTML = '<div class="det-empty">暂无预估数据</div>';
    return;
  }
  el.innerHTML = `
    <div class="home-est-list">
      <div class="home-est-head">
        <span>分类</span>
        <span>本年合计</span>
        <span>月均（${monthCount}个月）</span>
      </div>
      ${list.map(item => {
        const year = String(getHomeYm()).slice(0, 4);
        const catEsc = String(item.cat).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `
        <button type="button" class="home-est-row" onclick="showDetail('${year}','${catEsc}')">
          <span class="home-est-cat"><span class="inline-cat-icon">${catIconHtml(item.cat, { size: 16 })}</span>${catLabel(item.cat)}</span>
          <span class="home-est-ytd">${fmtMoney(item.ytd)}</span>
          <span class="home-est-avg">${fmtMoney(item.avg)}</span>
        </button>`;
      }).join('')}
    </div>`;
}

function ensureHomeSummaryClicks() {
  const el = document.getElementById('homeSummary');
  if (!el || el._homeKpiClick) return;
  el._homeKpiClick = true;
  el.addEventListener('click', (e) => {
    const card = e.target.closest('[data-home-kpi]');
    if (!card) return;
    openHomeSummaryDetail(card.dataset.homeKpi);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-home-kpi]');
    if (!card) return;
    e.preventDefault();
    openHomeSummaryDetail(card.dataset.homeKpi);
  });
}

function renderHome() {
  renderHomeLongRemindersSection();

  const ym = getHomeYm();
  syncHomeMonthSelect();

  const rows = monthStatsRows(ym);
  const expEntries = categoryTotals(rows, '支出');
  const incEntries = homeIncomeCategoryTotals(rows);
  const totalExp = expEntries.reduce((s, [, v]) => s + v, 0);
  const totalInc = incEntries.reduce((s, [, v]) => s + v, 0);
  const net = totalInc - totalExp;
  const estExp = estimatedMonthlyExpense(ym);
  const estExpCats = expenseCategoriesInYear(ym).length;
  const monthCount = yearMonthsThroughYm(ym).length;
  const monthLbl = homeMonthKpiLabel(ym);

  const summaryEl = document.getElementById('homeSummary');
  if (summaryEl) {
    summaryEl.innerHTML = [
      kpiCard(`${monthLbl}支出`, fmtMoney(totalExp), `${expEntries.length} 个分类`, 'ti-arrow-down-right', 'pink', 'c-red', { kind: 'exp' }),
      kpiCard('预估月支出', fmtMoney(estExp), `${estExpCats}类月均 · 本年${monthCount}个月`, 'ti-chart-arrows', 'amber', 'c-amb', { kind: 'est' }),
      kpiCard(`${monthLbl}收入`, fmtMoney(totalInc), `${incEntries.length} 个分类`, 'ti-arrow-up-right', 'green', 'c-grn', { kind: 'inc' }),
      kpiCard(`${monthLbl}结余`, fmtMoneySigned(net), net >= 0 ? '盈余' : '超支', 'ti-scale', 'blue', net >= 0 ? 'c-blu' : 'c-red', { kind: 'net' }),
    ].join('');
  }
  ensureHomeSummaryClicks();

  const expColors = expEntries.map(([c]) => catColor(c));
  const incColors = incEntries.map(([c]) => catColor(c));

  const prevYm = getPrevMonthYm(ym);
  const prevExpMap = new Map(categoryTotals(monthStatsRows(prevYm), '支出'));
  const prevIncMap = new Map(homeIncomeCategoryTotals(monthStatsRows(prevYm)));
  const hiddenExpCats = getHomeExpCatHidden();
  const hiddenIncCats = getHomeIncCatHidden();
  renderHomeCatGrid(document.getElementById('homeExpCats'), expEntries, prevExpMap, '支出', ym, hiddenExpCats, 'openHomeExpCatSettings');
  renderHomeCatGrid(document.getElementById('homeIncCats'), incEntries, prevIncMap, '收入', ym, hiddenIncCats, 'openHomeIncCatSettings');
  ensureHomeCatBarClicks('homeExpCats');
  ensureHomeCatBarClicks('homeIncCats');

  renderHomeDonut('homeExpPie', 'homeExpPie', expEntries, expColors, totalExp, document.getElementById('homeExpCenter'), '支出', ym);
  renderHomeDonut('homeIncPie', 'homeIncPie', incEntries, incColors, totalInc, document.getElementById('homeIncCenter'), '收入', ym);
  renderHomeLegend(document.getElementById('homeExpLeg'), expEntries, expColors, '支出', ym);
  renderHomeLegend(document.getElementById('homeIncLeg'), incEntries, incColors, '收入', ym);
  ensureHomeLegendClicks('homeExpLeg');
  ensureHomeLegendClicks('homeIncLeg');
}

function renderKPI() {
  const ad = statsData();
  const exp = ad.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = ad.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const net = inc - exp;
  const rfc = allData.filter(r => r['退款状态'] === 'refunded').length;
  const pending = allData.filter(r => Categorizer.isPending(r) && isCountedInStats(r)).length;
  const manualEx = allData.filter(r => r['统计状态'] === 'excluded').length;
  const catEx = allData.filter(r => isCatExcludedFromStats(r['分类']) && r['退款状态'] !== 'refunded' && r['统计状态'] !== 'excluded').length;
  const h = [
    kpiCard('实际支出', fmtMoney(exp), `${fmtCount(ad.filter(r => r['收支'] === '支出').length)} 笔`, 'ti-arrow-down-right', 'pink', 'c-red'),
    kpiCard('总收入', fmtMoney(inc), `${fmtCount(ad.filter(r => r['收支'] === '收入').length)} 笔`, 'ti-arrow-up-right', 'green', 'c-grn'),
    kpiCard('净结余', fmtMoneySigned(net), net >= 0 ? '收入大于支出' : '支出大于收入', 'ti-scale', 'blue', net >= 0 ? 'c-blu' : 'c-red'),
    kpiCard('待确认分类', fmtCount(pending), '自动分类需复核', 'ti-tag-starred', 'amber', 'c-amb'),
    kpiCard('总笔数', fmtCount(allData.length), `已退款 ${fmtCount(rfc)} 笔 · 不计入 ${fmtCount(manualEx + catEx)} 笔`, 'ti-list-numbers', 'lav', '')
  ].join('');
  const kpi2 = document.getElementById('kpi2');
  if (kpi2) kpi2.innerHTML = h;
  updateSubtitle();
}

function syncSourceChipOrder() {
  const fromData = [...new Set(allData.map(r => r['来源']).filter(Boolean))];
  const next = [];
  SOURCE_CHIP_ORDER.forEach(s => {
    if (fromData.includes(s)) next.push(s);
  });
  SOURCES.forEach(s => {
    if (fromData.includes(s.name) && !next.includes(s.name)) next.push(s.name);
  });
  fromData.forEach(s => {
    if (!next.includes(s)) next.push(s);
  });
  SOURCE_CHIP_ORDER = next;
}

let srcChipDragFrom = null;
let srcChipDragBound = false;
let srcChipHoldTimer = null;
let srcChipHoldEl = null;
let srcChipSuppressClick = false;
const SRC_CHIP_HOLD_MS = 420;

function reorderSourceChips(fromName, toName) {
  if (!fromName || !toName || fromName === toName || fromName === 'all' || toName === 'all') return;
  syncSourceChipOrder();
  const fromIdx = SOURCE_CHIP_ORDER.indexOf(fromName);
  const toIdx = SOURCE_CHIP_ORDER.indexOf(toName);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = SOURCE_CHIP_ORDER.splice(fromIdx, 1);
  SOURCE_CHIP_ORDER.splice(toIdx, 0, moved);
  persist();
  buildSrcChips();
}

function ensureSrcChipsDrag() {
  const list = document.getElementById('srcChips');
  if (!list || srcChipDragBound) return;
  srcChipDragBound = true;

  const clearHold = () => {
    if (srcChipHoldTimer) clearTimeout(srcChipHoldTimer);
    srcChipHoldTimer = null;
    srcChipHoldEl?.classList.remove('hold-ready');
    srcChipHoldEl = null;
  };

  list.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.chip-src[data-src]');
    if (!chip || chip.dataset.src === 'all') return;
    clearHold();
    srcChipHoldEl = chip;
    srcChipHoldTimer = setTimeout(() => {
      if (!srcChipHoldEl) return;
      srcChipHoldEl.classList.add('hold-ready');
      srcChipHoldEl.setAttribute('draggable', 'true');
    }, SRC_CHIP_HOLD_MS);
  });

  list.addEventListener('pointerup', clearHold);
  list.addEventListener('pointercancel', clearHold);
  list.addEventListener('pointerleave', e => {
    if (e.target === list) clearHold();
  });

  list.addEventListener('click', e => {
    if (srcChipSuppressClick) {
      srcChipSuppressClick = false;
      return;
    }
    const chip = e.target.closest('.chip-src[data-src]');
    if (!chip) return;
    filterSrc(chip.dataset.src);
  });

  list.addEventListener('dragstart', e => {
    const chip = e.target.closest('.chip-src');
    if (!chip?.hasAttribute('draggable') || chip.dataset.src === 'all') {
      e.preventDefault();
      return;
    }
    srcChipDragFrom = chip.dataset.src;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', srcChipDragFrom);
    chip.classList.add('is-dragging');
    clearHold();
  });

  list.addEventListener('dragend', e => {
    const chip = e.target.closest('.chip-src');
    chip?.classList.remove('is-dragging', 'hold-ready');
    chip?.removeAttribute('draggable');
    srcChipDragFrom = null;
    srcChipSuppressClick = true;
    list.querySelectorAll('.chip-src').forEach(c => c.classList.remove('drag-over'));
  });

  list.addEventListener('dragover', e => {
    if (!srcChipDragFrom) return;
    const chip = e.target.closest('.chip-src[data-src]');
    if (!chip || chip.dataset.src === 'all') return;
    e.preventDefault();
    list.querySelectorAll('.chip-src').forEach(c => c.classList.remove('drag-over'));
    chip.classList.add('drag-over');
  });

  list.addEventListener('drop', e => {
    if (!srcChipDragFrom) return;
    const chip = e.target.closest('.chip-src[data-src]');
    if (!chip || chip.dataset.src === 'all') return;
    e.preventDefault();
    const toName = chip.dataset.src;
    list.querySelectorAll('.chip-src').forEach(c => c.classList.remove('drag-over'));
    if (toName !== srcChipDragFrom) reorderSourceChips(srcChipDragFrom, toName);
    srcChipDragFrom = null;
  });
}

function buildSrcChips() {
  const el = document.getElementById('srcChips');
  syncSourceChipOrder();
  const allSrcs = ['all', ...SOURCE_CHIP_ORDER];
  el.innerHTML = allSrcs.map(s => {
    const on = (s === 'all' && activeSrc === 'all') || s === activeSrc;
    const bg = s === 'all' ? '#98a2b3' : srcBrandColor(s, srcColor(s));
    const label = s === 'all' ? '全部' : s;
    const srcAttr = s.replace(/"/g, '&quot;');
    const mark = on ? '<i class="ti ti-check chip-src-mark" aria-hidden="true"></i>' : '';
    return `<div class="chip chip-src${on ? ' on' : ''}" style="--src-chip-bg:${bg}" data-src="${srcAttr}" role="button"${on ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${mark}<span class="chip-src-label">${label}</span></div>`;
  }).join('');
  ensureSrcChipsDrag();
}

function filterSrc(s) {
  activeSrc = s;
  buildSrcChips();
  applyF();
}

function currentMonthYm(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthYm(ym, delta) {
  const [y, m] = String(ym || currentMonthYm()).split('-').map(Number);
  return currentMonthYm(new Date(y, m - 1 + delta, 1));
}

function ledgerDayChipMonths() {
  const cur = currentMonthYm();
  return [shiftMonthYm(cur, -1), cur];
}

function monthDateRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    d1: `${ym}-01`,
    d2: `${ym}-${String(last).padStart(2, '0')}`,
    last,
  };
}

function todayIso() {
  const n = new Date();
  return `${currentMonthYm(n)}-${String(n.getDate()).padStart(2, '0')}`;
}

function buildLedgerDayChipMonthHtml(ym, selectedDay, d1, d2, today, daysWithTxn) {
  const range = monthDateRange(ym);
  const monthOn = !selectedDay && d1 === range.d1 && d2 === range.d2;
  const [year, month] = ym.split('-').map(Number);
  let html = `<div class="chip-day-group" data-month="${ym}">`;
  html += `<button type="button" class="chip-day chip-day-month${monthOn ? ' on' : ''}" data-month="${ym}" onclick="filterLedgerMonth('${ym}')" role="tab" aria-selected="${monthOn ? 'true' : 'false'}" title="查看${year}年${month}月全部"><span class="chip-day-wd">${year}</span><span class="chip-day-num">${month}月</span></button>`;
  for (let d = 1; d <= range.last; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const wd = new Date(`${iso}T12:00:00`).getDay();
    const on = iso === selectedDay;
    const isToday = iso === today;
    const hasTxn = daysWithTxn.has(iso);
    html += `<button type="button" class="chip-day${on ? ' on' : ''}${isToday ? ' is-today' : ''}${hasTxn ? ' has-txn' : ''}${wd === 0 || wd === 6 ? ' is-weekend' : ''}" data-date="${iso}" onclick="filterLedgerDay('${iso}')" role="tab" aria-selected="${on ? 'true' : 'false'}" title="${iso} ${WEEKDAY_LABELS[wd]}${isToday ? '（今天）' : ''}"><span class="chip-day-wd">${WEEKDAY_SHORT[wd]}</span><span class="chip-day-num">${d}</span></button>`;
  }
  html += '</div>';
  return html;
}

function buildLedgerDayChips() {
  const el = document.getElementById('ledgerDayChips');
  if (!el) return;
  const months = ledgerDayChipMonths();
  const today = todayIso();
  const d1 = document.getElementById('d1')?.value || '';
  const d2 = document.getElementById('d2')?.value || '';
  const selectedDay = d1 && d1 === d2 ? d1 : '';
  const monthSet = new Set(months);
  const daysWithTxn = new Set();
  for (const r of allData) {
    const dt = r['日期'];
    if (dt && monthSet.has(dt.slice(0, 7))) daysWithTxn.add(dt);
  }

  const prevScroll = el.scrollLeft;
  const firstBuild = !el.dataset.ready;
  el.innerHTML = months.map(ym => buildLedgerDayChipMonthHtml(ym, selectedDay, d1, d2, today, daysWithTxn)).join('');
  el.dataset.ready = '1';

  const forceScroll = pendingDayChipScroll;
  const scrollTo = pendingDayChipScroll || selectedDay || today;
  pendingDayChipScroll = null;
  if (forceScroll || firstBuild) {
    const target = el.querySelector(`[data-date="${scrollTo}"]`)
      || el.querySelector(`[data-month="${String(scrollTo).slice(0, 7)}"]`);
    if (target) target.scrollIntoView({ inline: 'center', block: 'nearest', behavior: firstBuild ? 'auto' : 'smooth' });
  } else {
    el.scrollLeft = prevScroll;
  }
}

function filterLedgerDay(iso) {
  const d1 = document.getElementById('d1');
  const d2 = document.getElementById('d2');
  if (!d1 || !d2) return;
  if (d1.value === iso && d2.value === iso) {
    filterLedgerMonth(iso.slice(0, 7));
    return;
  }
  pendingDayChipScroll = iso;
  d1.value = iso;
  d2.value = iso;
  applyF();
}

function filterLedgerMonth(ym) {
  const range = monthDateRange(ym || currentMonthYm());
  const d1 = document.getElementById('d1');
  const d2 = document.getElementById('d2');
  if (!d1 || !d2) return;
  pendingDayChipScroll = todayIso().startsWith(range.d1.slice(0, 7)) ? todayIso() : range.d1;
  d1.value = range.d1;
  d2.value = range.d2;
  applyF();
}

function syncCatFilterBtn(cat) {
  const btn = document.getElementById('cfPickBtn');
  const hidden = document.getElementById('cf');
  if (!btn || !hidden) return;
  hidden.value = cat || '';
  const label = btn.querySelector('.cat-filter-label');
  const iconEl = btn.querySelector('.cat-filter-icon');
  const display = cat ? catLabel(cat) : '全部分类';
  if (label) label.textContent = display;
  btn.dataset.currentCat = cat || '';
  btn.classList.toggle('on', !!cat);
  if (iconEl) {
    iconEl.innerHTML = cat
      ? catIconHtml(cat, { size: 14, wrapClass: 'cat-filter-emoji-wrap' })
      : '<i class="ti ti-category"></i>';
  }
}

function subcatsForFilter(cat) {
  if (!cat) return [];
  const configured = subcatsFor(cat);
  const used = new Set();
  allData.forEach(r => {
    if (!rowMatchesCat(r, cat)) return;
    if (hasSplits(r)) {
      r.splits.forEach(sp => {
        if (sp.category === cat) {
          used.add((sp.subcategory || '').trim() || SUBCAT_UNSET_LABEL);
        }
      });
    } else {
      used.add((r['子分类'] || '').trim() || SUBCAT_UNSET_LABEL);
    }
  });
  const merged = [...new Set([...configured, ...used])];
  return merged.sort((a, b) => {
    if (a === SUBCAT_UNSET_LABEL) return 1;
    if (b === SUBCAT_UNSET_LABEL) return -1;
    return a.localeCompare(b, 'zh-CN');
  });
}

function syncSubFilterOptions(cat, reset = false) {
  const sel = document.getElementById('subf');
  if (!sel) return;
  if (reset) filterSubCat = '';
  const activeCat = cat ?? document.getElementById('cf')?.value ?? '';
  sel.replaceChildren();
  const addOpt = (val, label) => {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = label;
    sel.appendChild(o);
  };
  if (!activeCat) {
    sel.disabled = true;
    addOpt('', '全部子分类');
    sel.value = '';
    filterSubCat = '';
    sel.classList.remove('on');
    return;
  }
  const subs = subcatsForFilter(activeCat);
  if (!subs.length) {
    sel.disabled = true;
    addOpt('', '无子分类');
    sel.value = '';
    filterSubCat = '';
    sel.classList.remove('on');
    return;
  }
  sel.disabled = false;
  addOpt('', '全部子分类');
  subs.forEach(s => addOpt(s, s));
  if (filterSubCat && !subs.includes(filterSubCat)) filterSubCat = '';
  sel.value = filterSubCat;
  sel.classList.toggle('on', !!filterSubCat);
}

function onSubFilterChange(val) {
  filterSubCat = val || '';
  const sel = document.getElementById('subf');
  if (sel) sel.classList.toggle('on', !!filterSubCat);
  curPage = 1;
  applyF();
}

function buildCatFilter() {
  const cat = document.getElementById('cf')?.value || '';
  syncCatFilterBtn(cat);
  syncSubFilterOptions(cat, false);
  const fs = document.getElementById('f-cat');
  if (fs) {
    fs.innerHTML = '';
    CATS.forEach(c => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = catLabel(c);
      fs.appendChild(o);
    });
  }
}

function rowMatchesSearch(row, q) {
  if (!q) return true;
  return rowSearchHaystack(row).includes(q);
}

function applyF() {
  const q = document.getElementById('qi').value.trim().toLowerCase();
  const cat = document.getElementById('cf').value;
  const tp = document.getElementById('tf').value;
  const hideRf = document.getElementById('rfHide').checked;
  const so = document.getElementById('sf').value;
  const d1 = document.getElementById('d1').value;
  const d2 = document.getElementById('d2').value;

  filteredData = allData.filter(r => {
    if (activeTxnMergeId) {
      const merge = findMergeById(activeTxnMergeId);
      if (!merge || !rowInMerge(r, merge)) return false;
      if (hideRf && r['退款状态'] === 'refunded') return false;
      if (q && !rowMatchesSearch(r, q)) return false;
      return true;
    }
    if (activeTxnLinkId) {
      const link = findLinkById(activeTxnLinkId);
      if (!link || !rowInLink(r, link)) return false;
    }
    if (activeSrc !== 'all' && r['来源'] !== activeSrc) return false;
    if (cat && !rowMatchesCat(r, cat)) return false;
    if (tp && r['收支'] !== tp) return false;
    if (hideRf && r['退款状态'] === 'refunded') return false;
    if (filterUnsetSubOnly && !rowHasUnsetSub(r, subcatsFor)) return false;
    if (filterSubCat && !rowMatchesSubCat(r, filterSubCat, subcatsFor, cat)) return false;
    if (q && !rowMatchesSearch(r, q)) return false;
    if (d1 && r['日期'] < d1) return false;
    if (d2 && r['日期'] > d2) return false;
    return true;
  });

  filteredData.sort((a, b) => {
    const key = so.slice(0, -1);
    const dir = so.slice(-1);
    const mul = dir === '+' ? 1 : -1;
    let cmp = 0;
    switch (key) {
      case 'd':
        cmp = (a['日期'] + a['时间']).localeCompare(b['日期'] + b['时间']);
        break;
      case 's':
        cmp = (a['来源'] || '').localeCompare(b['来源'] || '', 'zh-CN');
        break;
      case 'p': {
        const ta = (a['交易对方'] || a['商品说明'] || a['产品名称'] || '');
        const tb = (b['交易对方'] || b['商品说明'] || b['产品名称'] || '');
        cmp = ta.localeCompare(tb, 'zh-CN');
        break;
      }
      case 'c': {
        const ca = hasSplits(a) ? (a.splits[0]?.category || '') : (a['分类'] || '');
        const cb = hasSplits(b) ? (b.splits[0]?.category || '') : (b['分类'] || '');
        cmp = ca.localeCompare(cb, 'zh-CN');
        if (!cmp) {
          const sa = hasSplits(a) ? (a.splits[0]?.subcategory || '') : (a['子分类'] || '');
          const sb = hasSplits(b) ? (b.splits[0]?.subcategory || '') : (b['子分类'] || '');
          cmp = sa.localeCompare(sb, 'zh-CN');
        }
        break;
      }
      case 't':
        cmp = (a['收支'] || '').localeCompare(b['收支'] || '', 'zh-CN');
        break;
      case 'a':
        cmp = a['金额'] - b['金额'];
        break;
      default:
        cmp = (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']);
        return cmp;
    }
    return cmp * mul;
  });
  curPage = 1;
  renderTable();
  syncSortHeaders();
  syncDateSortBtn();
  updateTxnLinkFilterBar();
  buildLedgerDayChips();
}

function syncDateSortBtn() {
  const btn = document.getElementById('dateSortBtn');
  const sf = document.getElementById('sf');
  if (!btn || !sf) return;
  const onDate = sf.value.startsWith('d');
  const desc = sf.value === 'd-';
  btn.classList.toggle('on', onDate);
  btn.title = onDate
    ? (desc ? '当前：日期从新到旧，点击改为从旧到新' : '当前：日期从旧到新，点击改为从新到旧')
    : '按日期排序（当前为其他排序）';
  btn.innerHTML = onDate
    ? `<i class="ti ti-sort-${desc ? 'descending' : 'ascending'}"></i> 日期`
    : '<i class="ti ti-calendar"></i> 日期';
}

function toggleDateSort() {
  const sf = document.getElementById('sf');
  if (!sf) return;
  if (sf.value.startsWith('d')) {
    sf.value = sf.value === 'd-' ? 'd+' : 'd-';
  } else {
    sf.value = 'd-';
  }
  applyF();
}

function syncSortHeaders() {
  const so = document.getElementById('sf')?.value || 'd-';
  const key = so.slice(0, -1);
  const dir = so.slice(-1);
  document.querySelectorAll('#ledgerHead .th-sort').forEach(btn => {
    const on = btn.dataset.sort === key;
    btn.classList.toggle('on', on);
    const icon = btn.querySelector('.th-sort-icon');
    if (icon) icon.textContent = on ? (dir === '-' ? '↓' : '↑') : '';
  });
}

function toggleSortCol(key) {
  const sf = document.getElementById('sf');
  if (!sf) return;
  const cur = sf.value;
  sf.value = cur.startsWith(key) ? (cur.endsWith('-') ? key + '+' : key + '-') : key + '-';
  applyF();
}

function changePgSize(val) { PG = parseInt(val, 10); curPage = 1; applyF(); }

function syncTypeSegUI() {
  const val = document.getElementById('tf')?.value || '';
  document.querySelectorAll('#tfSeg .fb-seg-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.val === val);
  });
}

function setTypeFilter(val) {
  const inp = document.getElementById('tf');
  if (!inp) return;
  inp.value = inp.value === val ? '' : val;
  syncTypeSegUI();
  applyF();
}

function resetF() {
  ['qi', 'd1', 'd2'].forEach(id => document.getElementById(id).value = '');
  const top = document.getElementById('topSearch');
  if (top) top.value = '';
  updateSearchClear();
  document.getElementById('cf').value = '';
  syncCatFilterBtn('');
  filterSubCat = '';
  syncSubFilterOptions('', true);
  document.getElementById('tf').value = '';
  syncTypeSegUI();
  document.getElementById('rfHide').checked = true;
  filterUnsetSubOnly = false;
  syncUnsetSubFilterUI();
  document.getElementById('sf').value = 'd-';
  activeSrc = 'all';
  activeTxnLinkId = null;
  activeTxnMergeId = null;
  buildSrcChips();
  applyF();
}

function srcBadge(s) {
  const lbl = s.length > 9 ? s.slice(0, 9) + '…' : s;
  return `<span class="src-inline">${srcMarkHtml(s, { size: 18, fallbackColor: srcColor(s) })}${lbl}</span>`;
}

function srcBadgeBrowse(s) {
  return `<span class="src-inline src-inline-browse">${srcMarkHtml(s, { size: 18, fallbackColor: srcColor(s) })}${s}</span>`;
}

function typeBadge(t, rf, cat) {
  if (rf === 'refunded') return '<span class="type-lbl rf">已退款</span>';
  if (OFFSET_CATS_SET.has(cat)) {
    return t === '收入'
      ? '<span class="type-lbl offset-i">对冲收</span>'
      : '<span class="type-lbl offset-e">对冲支</span>';
  }
  return t === '收入' ? '<span class="type-lbl inc">收入</span>' : '<span class="type-lbl exp">支出</span>';
}


function dayNoteHtml(date) {
  const raw = dayNotes[date] || '';
  const val = raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<input type="text" class="ledger-day-note" data-date="${date}" value="${val}" placeholder="当天备注…" maxlength="120" onclick="event.stopPropagation()" aria-label="当天备注">`;
}

function setDayNote(date, text) {
  if (!date) return;
  const note = String(text || '').trim();
  const prev = dayNotes[date] || '';
  if (note === prev) return;
  if (note) dayNotes[date] = note;
  else delete dayNotes[date];
  persist();
}

let dayNoteEventsBound = false;
function ensureDayNoteEvents() {
  const el = document.getElementById('tbody');
  if (!el || dayNoteEventsBound) return;
  dayNoteEventsBound = true;
  el.addEventListener('change', e => {
    const inp = e.target.closest('.ledger-day-note');
    if (!inp) return;
    setDayNote(inp.dataset.date, inp.value);
  });
  el.addEventListener('keydown', e => {
    const inp = e.target.closest('.ledger-day-note');
    if (!inp || e.key !== 'Enter') return;
    e.preventDefault();
    inp.blur();
  });
}

function renderTable() {
  const start = (curPage - 1) * PG;
  const pd = filteredData.slice(start, start + PG);
  const el = document.getElementById('tbody');
  if (!pd.length) {
    el.innerHTML = '<div class="ledger-day-empty"><i class="ti ti-inbox"></i>没有符合条件的记录</div>';
    renderPager();
    return;
  }

  const dayTotals = computeDayTotals(filteredData);
  const dayOrder = [];
  const dayMap = new Map();
  pd.forEach(row => {
    const d = row['日期'];
    if (!dayMap.has(d)) {
      dayMap.set(d, []);
      dayOrder.push(d);
    }
    dayMap.get(d).push(row);
  });

  el.innerHTML = dayOrder.map(date => {
    const rows = dayMap.get(date);
    const t = dayTotals[date] || { inc: 0, exp: 0 };
    return `<section class="ledger-day-card">
      <header class="ledger-day-head">
        <span class="ledger-day-date"><i class="ti ti-calendar" aria-hidden="true"></i>${formatDayHeader(date)}</span>
        ${dayNoteHtml(date)}
        ${daySumHtml(t.inc, t.exp)}
      </header>
      <div class="ledger-day-rows">${rows.map(renderLedgerDayRow).join('')}</div>
    </section>`;
  }).join('');
  ensureDayNoteEvents();
  renderPager();
}

function renderPager() {
  const total = filteredData.length;
  const tp = Math.ceil(total / PG);
  const s = (curPage - 1) * PG + 1;
  const e = Math.min(curPage * PG, total);
  const info = total > 0 ? `第 ${s}–${e} 条，共 ${total} 条` : '';
  document.getElementById('pi').textContent = info;
  const piTop = document.getElementById('piTop');
  if (piTop) piTop.textContent = info;
  const el = document.getElementById('pgs');
  if (tp <= 1) { el.innerHTML = ''; return; }
  let h = `<button class="pg" onclick="goP(${curPage - 1})" ${curPage === 1 ? 'disabled' : ''}><i class="ti ti-chevron-left" style="font-size:11px"></i></button>`;
  const rng = [];
  for (let i = 1; i <= tp; i++) {
    if (i === 1 || i === tp || Math.abs(i - curPage) <= 1) rng.push(i);
    else if (rng[rng.length - 1] !== '…') rng.push('…');
  }
  rng.forEach(p => {
    h += p === '…' ? `<button class="pg" disabled>…</button>` : `<button class="pg${p === curPage ? ' on' : ''}" onclick="goP(${p})">${p}</button>`;
  });
  h += `<button class="pg" onclick="goP(${curPage + 1})" ${curPage === tp ? 'disabled' : ''}><i class="ti ti-chevron-right" style="font-size:11px"></i></button>`;
  el.innerHTML = h;
}

function goP(p) {
  const tp = Math.ceil(filteredData.length / PG);
  if (p < 1 || p > tp) return;
  curPage = p;
  renderTable();
  document.querySelector('.main').scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleRf(id) {
  const row = allData.find(r => r.id === id);
  if (!row) return;
  const isR = row['退款状态'] === 'refunded';
  row['退款状态'] = isR ? 'normal' : 'refunded';
  if (row['退款状态'] === 'refunded') refunded.add(id);
  else refunded.delete(id);
  persist();
  renderKPI();
  renderTable();
  renderRfView();
  renderMonitor();
  refreshDetailModal();
}

function toggleExclude(id) {
  const row = allData.find(r => r.id === id);
  if (!row) return;
  const isEx = row['统计状态'] === 'excluded';
  row['统计状态'] = isEx ? 'normal' : 'excluded';
  if (row['统计状态'] === 'excluded') excluded.add(id);
  else excluded.delete(id);
  persist();
  renderKPI();
  renderTable();
  renderMonitor();
  updateSubtitle();
}

function updCat(id, nc) {
  const row = allData.find(r => r.id === id);
  if (row && hasSplits(row)) {
    alert('此记录已拆分，请通过「拆分」按钮编辑子账目分类');
    renderTable();
    return;
  }
  if (!row || row['分类'] === nc) return;
  row['分类'] = nc;
  const subs = subcatsFor(nc);
  if (row['子分类'] && !subs.includes(row['子分类'])) row['子分类'] = '';
  row._autoCat = false;
  row._catConf = 'manual';
  Categorizer.learn(row['交易对方'], nc, row['商品说明']);
  persist();
  renderKPI();
  renderMonitor();
  renderTable();
  refreshDetailModal();
  refreshActiveViews();
}

function updSubCat(id, sub) {
  const row = allData.find(r => r.id === id);
  if (row && hasSplits(row)) {
    alert('此记录已拆分，请通过「拆分」按钮编辑子账目');
    renderTable();
    return;
  }
  if (!row) return;
  row['子分类'] = sub || '';
  persist();
  renderTable();
  refreshDetailModal();
  refreshActiveViews();
}

function updRenqingSubCat(id, sub) {
  const row = allData.find(r => r.id === id);
  if (row && hasSplits(row)) {
    alert('此记录已拆分，请在下方拆分项上修改子分类');
    return;
  }
  if (!row) return;
  updSubCat(id, sub);
  selectRenqingPerson(sub || '未分类');
}

function updRenqingSplitSub(parentId, idx, sub) {
  handleUpdSplitSub(parentId, idx, sub);
  selectRenqingPerson(sub || '未分类');
}

function reorderCats(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= CATS.length || toIdx >= CATS.length) return;
  const [moved] = CATS.splice(fromIdx, 1);
  CATS.splice(toIdx, 0, moved);
  persist();
  buildCatFilter();
  renderCatBrowse();
}

function applyCatBrowseBulkCat() {
  const newCat = document.getElementById('catBrowseBulkCatSel')?.value;
  if (!newCat) return;
  getCatBrowseSelectedKeys().forEach(key => {
    const sep = key.indexOf(':');
    const parentId = Number(sep < 0 ? key : key.slice(0, sep));
    const splitIdx = sep < 0 ? null : Number(key.slice(sep + 1));
    const row = allData.find(r => r.id === parentId);
    if (!row) return;
    if (splitIdx != null && hasSplits(row)) {
      updateSplitItem(parentId, splitIdx, 'category', newCat);
    } else if (!hasSplits(row)) {
      row['分类'] = newCat;
      const subs = subcatsFor(newCat);
      if (row['子分类'] && !subs.includes(row['子分类'])) row['子分类'] = '';
      row._autoCat = false;
      row._catConf = 'manual';
      Categorizer.learn(row['交易对方'], newCat, row['商品说明']);
    }
  });
  persist();
  renderKPI();
  renderMonitor();
  applyF();
  clearCatBrowseSelection();
}

function catBrowseRowsForKeys(keys) {
  const expanded = activeExpanded();
  return keys.map(key => {
    const sep = key.indexOf(':');
    const parentId = Number(sep < 0 ? key : key.slice(0, sep));
    const splitIdx = sep < 0 ? null : Number(key.slice(sep + 1));
    if (splitIdx != null) {
      return expanded.find(r => r._splitOf === parentId && r._splitIdx === splitIdx);
    }
    return expanded.find(r => r.id === parentId && r._splitOf == null);
  }).filter(Boolean);
}

function linkCatBrowsePair() {
  const keys = [...getCatBrowseSelectedKeys()];
  if (keys.length !== 2) {
    alert('请选择恰好两条账目进行配对');
    return;
  }
  const rows = catBrowseRowsForKeys(keys);
  if (rows.length !== 2) {
    alert('记录不存在');
    return;
  }
  const err = validateTxnPair(rows[0], rows[1], keys[0], keys[1]);
  if (err) {
    alert(err);
    return;
  }
  addTxnPair(keys[0], keys[1]);
  persist();
  clearCatBrowseSelection();
  renderCatBrowse();
}

function unlinkCatBrowsePair() {
  const keys = [...getCatBrowseSelectedKeys()];
  if (keys.length === 1) {
    if (!findPairForKey(keys[0])) {
      alert('该账目未配对');
      return;
    }
    removeTxnPairByKey(keys[0]);
  } else if (keys.length === 2) {
    const linkA = findLinkForKey(keys[0]);
    const linkB = findLinkForKey(keys[1]);
    if (!linkA || linkA !== linkB) {
      alert('两条账目不在同一关联中');
      return;
    }
    removeTxnLinkById(linkA.id);
  } else {
    alert('请选择已配对的账目');
    return;
  }
  persist();
  clearCatBrowseSelection();
  renderCatBrowse();
}

function applyCatBrowseBulkSub() {
  const subSel = document.getElementById('catBrowseBulkSubSel');
  if (!subSel || subSel.disabled) return;
  const newSub = subSel.value;
  getCatBrowseSelectedKeys().forEach(key => {
    const sep = key.indexOf(':');
    const parentId = Number(sep < 0 ? key : key.slice(0, sep));
    const splitIdx = sep < 0 ? null : Number(key.slice(sep + 1));
    const row = allData.find(r => r.id === parentId);
    if (!row) return;
    if (splitIdx != null && hasSplits(row)) {
      updateSplitItem(parentId, splitIdx, 'subcategory', newSub);
    } else if (!hasSplits(row)) {
      row['子分类'] = newSub;
    }
  });
  persist();
  applyF();
  clearCatBrowseSelection();
}

function renderRfView() {
  const rfList = allData.filter(r => r['退款状态'] === 'refunded').sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  const el = document.getElementById('rfbody');
  if (!rfList.length) {
    el.innerHTML = '<div style="padding:36px;text-align:center;color:var(--txt3);font-size:13px"><i class="ti ti-circle-check" style="font-size:28px;display:block;margin-bottom:7px;color:var(--grn)"></i>暂无退款条目</div>';
    return;
  }
  el.innerHTML = rfList.map(row => `
    <div class="tr rf-row ledger-row refunded">
      ${dateTimeCell(row['日期'], row['时间'])}
      <div class="td no-strike src-cell">${srcBadge(row['来源'])}</div>
      ${peerDescCell(row)}
      <div class="td no-strike type-cell">${typeBadge(row['收支'], 'normal', row['分类'])}</div>
      ${amtCellHtml(row, true)}
      <div class="td no-strike td-actions">
        <button type="button" class="icon-act rf um" title="撤销退款" onclick="toggleRf(${row.id})"><i class="ti ti-rotate-clockwise"></i></button>
      </div>
    </div>`).join('');
}

function showAllDetail(cat) {
  detSort = 'a-';
  detIsIncome = false;
  detFilterUnsetSubOnly = false;
  detContext = { type: 'expense', cat };
  detSelectedIds.clear();
  const ad = statsExpanded().filter(r => r['收支'] === '支出' && r['分类'] === cat);
  const total = ad.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `<span class="inline-cat-icon" style="margin-right:6px">${catIconHtml(cat, { size: 18 })}</span>${cat} · 全部`;
  document.getElementById('detSummary').textContent = `共 ${fmtCount(ad.length)} 笔支出`;
  document.getElementById('detTotal').textContent = fmtMoney(total);
  document.getElementById('detTotal').style.color = 'var(--red-t)';
  renderDetailBody(ad);
  updateDetBulkBar();
  syncDetModalLayout();
  syncDetFilterBar();
  document.getElementById('moDet').classList.remove('hide');
}

function showDetail(month, cat) {
  detSort = 'a-';
  detIsIncome = false;
  detFilterUnsetSubOnly = false;
  detContext = { type: 'expense', month, cat };
  detSelectedIds.clear();
  const rows = statsExpanded().filter(r => r['收支'] === '支出' && r['日期'].startsWith(month) && r['分类'] === cat);
  const total = rows.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `<span class="inline-cat-icon" style="margin-right:6px">${catIconHtml(cat, { size: 18, value: MONITOR_EMOJIS[cat] })}</span>${cat} · ${month}`;
  document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔支出`;
  document.getElementById('detTotal').textContent = fmtMoney(total);
  document.getElementById('detTotal').style.color = 'var(--red-t)';
  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  syncDetFilterBar();
  document.getElementById('moDet').classList.remove('hide');
}

function showIncomeDetail(month, cat) {
  detSort = 'a-';
  detIsIncome = true;
  detFilterUnsetSubOnly = false;
  detContext = { type: 'income', month, cat };
  detSelectedIds.clear();
  const rows = incomeCatRows(cat).filter(r => r['日期'].startsWith(month));
  const netted = incomeCatShowsCostBreakdown(cat, rows);
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const total = netted ? incomeCatNet(rows) : rows.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `${cat} · ${fmtMonthLabel(month)}`;
  document.getElementById('detSummary').textContent = netted
    ? `共 ${fmtCount(rows.length)} 笔 · 收入 ${fmtMoney(inc)} · 成本 ${fmtMoney(exp)}`
    : `共 ${fmtCount(rows.length)} 笔收入`;
  document.getElementById('detTotal').textContent = netted ? fmtMoneySigned(total) : fmtMoney(total);
  document.getElementById('detTotal').style.color = total >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  syncDetFilterBar();
  document.getElementById('moDet').classList.remove('hide');
}

function showCatReportDetail(month, cat, sub) {
  detSort = 'a-';
  detIsIncome = false;
  detFilterUnsetSubOnly = false;
  detContext = { type: 'catreport', month, cat, sub: sub || '' };
  detSelectedIds.clear();
  const rows = getDetailRows();
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const net = inc - exp;
  const subLabel = sub ? ` · ${sub}` : '';
  document.getElementById('detTitle').innerHTML = `<span class="inline-cat-icon" style="margin-right:6px">${catIconHtml(cat, { size: 18 })}</span>${catLabel(cat)} · ${fmtMonthLabel(month)}${subLabel}`;
  document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔 · 支出 ${fmtMoney(exp)} · 收入 ${fmtMoney(inc)}`;
  document.getElementById('detTotal').textContent = fmtMoneySigned(net);
  document.getElementById('detTotal').style.color = net >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  syncDetFilterBar();
  document.getElementById('moDet').classList.remove('hide');
}

function closeDetModal() {
  document.getElementById('moDet').classList.add('hide');
  document.getElementById('moDet').classList.remove('det-income');
  detSelectedIds.clear();
  detFilterUnsetSubOnly = false;
  detContext = null;
  syncDetFilterBar();
  updateDetBulkBar();
}

function syncDetModalLayout() {
  const wide = !!detIsIncome || detContext?.type === 'catreport'
    || (detContext?.type === 'home-month' && detContext.flow !== 'exp');
  document.getElementById('moDet')?.classList.toggle('det-income', wide);
}

function syncDetFilterBar() {
  const btn = document.getElementById('detUnsetSubFilterBtn');
  if (!btn) return;
  const show = detContext?.type === 'catreport';
  btn.style.display = show ? '' : 'none';
  btn.classList.toggle('on', !!detFilterUnsetSubOnly);
}

function toggleDetUnsetSubFilter(btn) {
  detFilterUnsetSubOnly = !detFilterUnsetSubOnly;
  if (btn) btn.classList.toggle('on', detFilterUnsetSubOnly);
  else syncDetFilterBar();
  refreshDetailModal();
}

function detShowsTypeCol() {
  return detIsIncome || detContext?.type === 'catreport'
    || (detContext?.type === 'home-month' && detContext.flow !== 'exp');
}

function getDetailRows() {
  if (!detContext) return detRows;
  if (detContext.type === 'home-est') return detRows;
  if (detContext.type === 'home-month') {
    const flow = detContext.flow === 'exp' ? '支出' : detContext.flow === 'inc' ? '收入' : 'all';
    return homeMonthTxnRows(detContext.month, flow);
  }
  const ad = statsExpanded();
  if (detContext.type === 'catreport') {
    const { month, cat, sub } = detContext;
    let rows = ad.filter(r => r['分类'] === cat && r['日期'].startsWith(month));
    if (sub) rows = rows.filter(r => (r['子分类'] || '未分类') === sub);
    if (detFilterUnsetSubOnly) rows = rows.filter(r => rowHasUnsetSub(r, subcatsFor));
    return rows;
  }
  if (detContext.type === 'income') {
    const { month, cat } = detContext;
    const match = r => r['分类'] === cat && r['日期'].startsWith(month);
    return incomeCatShowsCostBreakdown(cat, ad.filter(match)) ? ad.filter(match) : ad.filter(r => match(r) && r['收支'] === '收入');
  }
  if (detContext.month) {
    return ad.filter(r => r['收支'] === '支出' && r['日期'].startsWith(detContext.month) && r['分类'] === detContext.cat);
  }
  return ad.filter(r => r['收支'] === '支出' && r['分类'] === detContext.cat);
}

function refreshDetailModal() {
  if (!detContext || document.getElementById('moDet').classList.contains('hide')) return;
  if (detContext.type === 'home-est') {
    const ym = detContext.month;
    const months = yearMonthsThroughYm(ym);
    const cats = expenseCategoriesInYear(ym);
    const list = cats.map(cat => {
      const { ytd, avg } = categoryYearStats(cat, '支出', ym);
      return { cat, ytd, avg };
    }).sort((a, b) => b.avg - a.avg);
    const estExp = estimatedMonthlyExpense(ym);
    document.getElementById('detSummary').textContent = `${cats.length} 个分类 · 本年已统计 ${months.length} 个月月均`;
    document.getElementById('detTotal').textContent = fmtMoney(estExp);
    document.getElementById('detTotal').style.color = 'var(--amb-t)';
    renderHomeEstDetailBody(list, months.length);
    updateDetBulkBar();
    refreshActiveViews();
    return;
  }
  const rows = getDetailRows();
  if (detContext.type === 'home-month') {
    const kind = detContext.flow;
    if (kind === 'exp') {
      const total = rows.reduce((s, r) => s + r['金额'], 0);
      document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔支出`;
      document.getElementById('detTotal').textContent = fmtMoney(total);
      document.getElementById('detTotal').style.color = 'var(--red-t)';
    } else if (kind === 'inc') {
      const total = rows.reduce((s, r) => s + r['金额'], 0);
      document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔收入`;
      document.getElementById('detTotal').textContent = fmtMoney(total);
      document.getElementById('detTotal').style.color = 'var(--grn-t)';
    } else {
      const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
      const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
      const net = inc - exp;
      document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔 · 收入 ${fmtMoney(inc)} · 支出 ${fmtMoney(exp)}`;
      document.getElementById('detTotal').textContent = fmtMoneySigned(net);
      document.getElementById('detTotal').style.color = net >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
    }
  } else if (detContext.type === 'catreport') {
    const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
    const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
    const net = inc - exp;
    document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔 · 支出 ${fmtMoney(exp)} · 收入 ${fmtMoney(inc)}`;
    document.getElementById('detTotal').textContent = fmtMoneySigned(net);
    document.getElementById('detTotal').style.color = net >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  } else {
    const netted = detContext.type === 'income' && incomeCatShowsCostBreakdown(detContext.cat, rows);
    const total = netted ? incomeCatNet(rows) : rows.reduce((s, r) => s + r['金额'], 0);
    const typeLabel = detIsIncome ? (netted ? '（含对冲支出）' : '收入') : '支出';
    document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔${typeLabel}`;
    document.getElementById('detTotal').textContent = netted ? fmtMoneySigned(total) : fmtMoney(total);
    if (detIsIncome) {
      document.getElementById('detTotal').style.color = total >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
    }
  }
  renderDetailBody(rows);
  updateDetBulkBar();
  refreshActiveViews();
}

function refreshActiveViews() {
  if (document.getElementById('view-home')?.classList.contains('on')) renderHome();
  if (document.getElementById('view-income')?.classList.contains('on')) renderIncomeData();
  if (document.getElementById('view-report')?.classList.contains('on')) renderReport();
  if (document.getElementById('view-catreport')?.classList.contains('on')) renderCatReport();
  if (document.getElementById('view-catbrowse')?.classList.contains('on')) renderCatBrowse();
  if (document.getElementById('view-trades')?.classList.contains('on')) renderTradesPage();
  if (document.getElementById('view-renqing')?.classList.contains('on')) renderRenqingPage();
  if (document.getElementById('view-accounts')?.classList.contains('on')) renderAccountsPage();
}

function rowDisplayTitle(row) {
  return (row['产品名称'] || row['交易对方'] || '').trim() || '—';
}

function sortDetRows(rows) {
  const s = [...rows];
  if (detSort === 'a-') return s.sort((a, b) => b['金额'] - a['金额']);
  if (detSort === 'a+') return s.sort((a, b) => a['金额'] - b['金额']);
  return s.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
}

function toggleDetSort() {
  detSort = detSort === 'a-' ? 'a+' : 'a-';
  renderDetailBody();
}

function renderDetailBody(rows) {
  if (rows) detRows = rows;
  const el = document.getElementById('detBody');
  if (!detRows.length) {
    el.innerHTML = '<div class="det-empty">暂无记录</div>';
    return;
  }
  const sorted = sortDetRows(detRows);
  const amtSortIcon = detSort === 'a-' ? '↓' : '↑';
  const selectable = sorted.filter(r => !r._statsMerge);
  const allChecked = selectable.length > 0 && selectable.every(r => detSelectedIds.has(r.id));
  const showTypeCol = detShowsTypeCol();
  const signedAmt = showTypeCol;
  const incomeCols = showTypeCol ? ' det-cols-income' : '';
  const typeHdr = showTypeCol ? '<div class="det-th det-th-type">收支</div>' : '';
  el.innerHTML = `
    <div class="det-head det-cols det-cols-actions${incomeCols}">
      <div class="det-th det-th-check"><input type="checkbox" class="cb" id="detSelAll" ${allChecked ? 'checked' : ''} onchange="toggleDetSelectAll(this)"></div>
      <div class="det-th">日期</div>
      <div class="det-th">来源</div>
      <div class="det-th">交易对方</div>
      <div class="det-th">分类</div>
      ${typeHdr}
      <button type="button" class="det-th det-th-amt" onclick="toggleDetSort()">金额 ${amtSortIcon}</button>
      <div class="det-th det-th-act">操作</div>
    </div>
    ${sorted.map((r, i) => {
      const p = rowDisplayTitle(r);
      const d = (r['商品说明'] || '').trim();
      const showDesc = d && d !== '/' && d !== p;
      const isR = r['退款状态'] === 'refunded';
      const isMerge = !!r._statsMerge;
      const isSel = !isMerge && detSelectedIds.has(r.id);
      const typeCell = showTypeCol
        ? `<div class="det-type">${typeBadge(r['收支'], r['退款状态'], r['分类'])}</div>`
        : '';
      const isInc = r['收支'] === '收入';
      const amtCls = signedAmt ? (isInc ? ' det-amt-inc' : ' det-amt-exp') : '';
      const amtTxt = signedAmt
        ? `${isInc ? '+' : '-'}¥${r['金额'].toFixed(2)}`
        : `¥${r['金额'].toFixed(2)}`;
      const mergeTag = isMerge ? '<span class="ledger-merge-tag" title="合并统计净额">合并净额</span>' : '';
      const checkCell = isMerge
        ? '<div class="det-check"></div>'
        : `<div class="det-check"><input type="checkbox" class="cb" ${isSel ? 'checked' : ''} onchange="toggleDetSelect(${r.id},this)"></div>`;
      const catCell = isMerge
        ? `<div class="td no-strike cat-cell det-cat-cell">${escHtml(r['分类'] || '')}${r['子分类'] ? ' · ' + escHtml(r['子分类']) : ''}</div>`
        : detCatCellHtml(r);
      const actCell = isMerge
        ? '<div class="det-act"></div>'
        : `<div class="det-act">
          <button type="button" class="icon-act rf ${isR ? 'um' : 'mk'}" title="${isR ? '撤销退款' : '标记退款'}" onclick="toggleRf(${r.id})"><i class="ti ${isR ? 'ti-rotate-clockwise' : 'ti-receipt-refund'}"></i></button>
        </div>`;
      return `<div class="det-row det-cols det-cols-actions${incomeCols}${i % 2 ? ' alt' : ''}${isSel ? ' selected' : ''}${isMerge ? ' det-merge-row' : ''}">
        ${checkCell}
        <div class="det-dt">${formatDateLabel(r['日期'])}<span>${formatTimeShort(r['时间'])}</span></div>
        <div class="det-src">${srcBadge(r['来源'])}</div>
        <div class="det-peer"><div class="det-peer-main">${p}${mergeTag}</div>${showDesc ? `<div class="det-peer-sub">${d}</div>` : ''}</div>
        ${catCell}
        ${typeCell}
        <div class="det-amt${amtCls}">${amtTxt}</div>
        ${actCell}
      </div>`;
    }).join('')}`;
}

function updCatDet(id, newCat) { updCat(id, newCat); }

function renderMonitor() {
  const months = [...new Set(allData.map(r => r['日期'].slice(0, 7)))].sort();
  const ad = statsData().filter(r => r['收支'] === '支出');
  const offsetEl = document.getElementById('offsetSummary');
  if (offsetEl && OFFSET_CATS_SET.size > 0) {
    const offRows = activeExpanded().filter(r => OFFSET_CATS_SET.has(r['分类']));
    if (offRows.length > 0) {
      const cards = [...OFFSET_CATS_SET].map(cat => {
        const rows = offRows.filter(r => r['分类'] === cat);
        const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
        const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
        const net = inc - exp;
        return `<div class="kpi-c" style="border-left:3px solid #ff6d00;cursor:pointer" onclick="showAllDetail('${cat}')">
          <div class="kpi-l"><span class="inline-cat-icon">${catIconHtml(cat, { size: 16 })}</span> ${cat}</div>
          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-top:4px">
            <span style="font-size:13px;color:var(--grn-t);font-weight:600">+${fmtMoney(inc)}</span>
            <span style="font-size:12px;color:var(--red-t)">-${fmtMoney(exp)}</span>
            <span style="font-size:14px;font-weight:700;color:${net >= 0 ? 'var(--blu-t)' : 'var(--red-t)'}">净${fmtMoneySigned(net)}</span>
          </div>
          <div class="kpi-s">${fmtCount(rows.length)} 笔流水</div>
        </div>`;
      }).join('');
      offsetEl.innerHTML = `<div style="margin-bottom:14px"><div class="kpi5" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${cards}</div></div>`;
    } else offsetEl.innerHTML = '';
  }
  const grid = document.getElementById('monGrid');
  if (!grid) {
    refreshActiveViews();
    return;
  }
  grid.innerHTML = MONITOR_CATS.map(cat => {
    const rows = months.map(m => ({ m, amt: ad.filter(r => r['日期'].startsWith(m) && r['分类'] === cat).reduce((s, r) => s + r['金额'], 0) }));
    const total = rows.reduce((s, r) => s + r.amt, 0);
    const maxAmt = Math.max(...rows.map(r => r.amt), 1);
    return `<div class="mon-c">
      <div class="mon-title" style="justify-content:space-between"><span><span class="inline-cat-icon">${catIconHtml(cat, { size: 16, value: MONITOR_EMOJIS[cat] })}</span> ${cat}</span><span style="font-size:11px;font-weight:700;color:var(--red-t)">共 ${fmtMoney(total)}</span></div>
      ${rows.map(({ m, amt }) => `<div class="mon-row" onclick="showDetail('${m}','${cat}')" style="cursor:pointer">
        <span class="mon-month">${m}</span>
        <div style="flex:1;margin:0 8px;height:6px;background:var(--surf2);border-radius:3px;overflow:hidden"><div style="width:${(amt / maxAmt * 100).toFixed(1)}%;height:100%;background:${catColor(cat)};border-radius:3px"></div></div>
        <span class="mon-amt">${fmtMoney(amt)}</span>
      </div>`).join('')}
    </div>`;
  }).join('');

  if (charts.monBar) charts.monBar.destroy();
  const monCtx = document.getElementById('monBar');
  if (!monCtx || !months.length) return;
  charts.monBar = new Chart(monCtx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: MONITOR_CATS.map(cat => ({
        label: catLabel(cat),
        data: months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['分类'] === cat).reduce((s, r) => s + r['金额'], 0).toFixed(2)),
        backgroundColor: catColor(cat), borderRadius: 3
      }))
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 }, color: CHART_THEME.tick } }, tooltip: chartMoneyTooltip }, scales: chartDarkScalesXY }
  });
  refreshActiveViews();
}

function renderCharts() {
  const ad = statsData();
  const expD = ad.filter(r => r['收支'] === '支出');
  const incD = ad.filter(r => r['收支'] === '收入');
  const catT = {}; expD.forEach(r => catT[r['分类']] = (catT[r['分类']] || 0) + r['金额']);
  const catS = Object.entries(catT).sort((a, b) => b[1] - a[1]);
  const cKeys = catS.map(c => c[0]), cVals = catS.map(c => +c[1].toFixed(2));
  const cColors = cKeys.map(catColor), totE = cVals.reduce((s, v) => s + v, 0) || 1;
  document.getElementById('catLeg').innerHTML = cKeys.map((c, i) => `<span style="display:flex;align-items:center;gap:3px"><span style="width:9px;height:9px;border-radius:2px;background:${cColors[i]}"></span>${catLabel(c)} ${((cVals[i] / totE) * 100).toFixed(1)}%</span>`).join('');
  if (charts.cPie) charts.cPie.destroy();
  charts.cPie = new Chart(document.getElementById('cPie'), { type: 'doughnut', data: { labels: cKeys.map(catLabel), datasets: [{ data: cVals, backgroundColor: cColors, borderWidth: 2, borderColor: CHART_THEME.pieBorder }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, cutout: '58%' } });

  const incT = {}; incD.forEach(r => incT[r['分类']] = (incT[r['分类']] || 0) + r['金额']);
  const incS = Object.entries(incT).sort((a, b) => b[1] - a[1]);
  const iKeys = incS.map(c => c[0]), iVals = incS.map(c => +c[1].toFixed(2));
  const iColors = iKeys.map(catColor), totI = iVals.reduce((s, v) => s + v, 0) || 1;
  document.getElementById('incLeg').innerHTML = iKeys.map((c, i) => `<span style="display:flex;align-items:center;gap:3px"><span style="width:9px;height:9px;border-radius:2px;background:${iColors[i]}"></span>${catLabel(c)} ${((iVals[i] / totI) * 100).toFixed(1)}%</span>`).join('');
  if (charts.iPie) charts.iPie.destroy();
  charts.iPie = new Chart(document.getElementById('iPie'), { type: 'doughnut', data: { labels: iKeys.map(catLabel), datasets: [{ data: iVals, backgroundColor: iColors, borderWidth: 2, borderColor: CHART_THEME.pieBorder }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, cutout: '58%' } });

  const months = [...new Set(allData.map(r => r['日期'].slice(0, 7)))].sort();
  const mInc = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  const mExp = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  if (charts.mBar) charts.mBar.destroy();
  charts.mBar = new Chart(document.getElementById('mBar'), { type: 'bar', data: { labels: months, datasets: [{ label: '收入', data: mInc, backgroundColor: CHART_THEME.inc, borderRadius: 4 }, { label: '支出', data: mExp, backgroundColor: CHART_THEME.exp, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, scales: chartDarkScalesXY } });

  const srcNames = [...new Set(allData.map(r => r['来源']))];
  const topCats = cKeys.slice(0, 9);
  if (charts.srcBar) charts.srcBar.destroy();
  charts.srcBar = new Chart(document.getElementById('srcBar'), {
    type: 'bar',
    data: {
      labels: topCats.map(catLabel),
      datasets: srcNames.map(s => ({
        label: s, data: topCats.map(c => +expD.filter(r => r['来源'] === s && r['分类'] === c).reduce((sum, r) => sum + r['金额'], 0).toFixed(2)),
        backgroundColor: srcColor(s), borderRadius: 3
      }))
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 }, color: CHART_THEME.tick } }, tooltip: chartMoneyTooltip }, scales: { ...chartDarkScalesXY, x: { ...chartDarkScalesXY.x, stacked: true }, y: { ...chartDarkScalesXY.y, stacked: true } } }
  });
}

function fmtMonthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}

function renderReport() {
  const ad = statsData();
  const months = [...new Set(allData.map(r => r['日期'].slice(0, 7)))].sort();
  const mInc = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  const mExp = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  const mNet = mInc.map((v, i) => +(v - mExp[i]).toFixed(2));

  const totalInc = mInc.reduce((s, v) => s + v, 0);
  const totalExp = mExp.reduce((s, v) => s + v, 0);
  const totalNet = totalInc - totalExp;

  const kpiEl = document.getElementById('reportKpi');
  if (kpiEl) {
    kpiEl.innerHTML = [
      kpiCard('累计收入', fmtMoney(totalInc), `${months.length} 个月`, 'ti-trending-up', 'green', 'c-grn'),
      kpiCard('累计支出', fmtMoney(totalExp), `${months.length} 个月`, 'ti-trending-down', 'pink', 'c-red'),
      kpiCard('净结余', fmtMoneySigned(totalNet), totalNet >= 0 ? '整体盈余' : '整体超支', 'ti-scale', 'blue', totalNet >= 0 ? 'c-blu' : 'c-red')
    ].join('');
  }

  const leg = document.getElementById('reportLeg');
  if (leg) {
    leg.innerHTML = `
      <span class="report-leg-item"><span class="report-leg-bar" style="background:#34d399"></span>收入</span>
      <span class="report-leg-item"><span class="report-leg-bar" style="background:#818cf8"></span>支出</span>
      <span class="report-leg-item"><span class="report-leg-line"></span>净结余</span>`;
  }

  const tbody = document.getElementById('reportTableBody');
  if (tbody) {
    if (!months.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--txt3);padding:24px">暂无数据</td></tr>';
    } else {
      tbody.innerHTML = [...months].reverse().map((m, ri) => {
        const i = months.length - 1 - ri;
        const net = mNet[i];
        return `<tr>
          <td>${fmtMonthLabel(m)}</td>
          <td class="c-inc">${fmtMoney(mInc[i])}</td>
          <td class="c-exp">${fmtMoney(mExp[i])}</td>
          <td class="c-net" style="color:${net >= 0 ? 'var(--blu-t)' : 'var(--red-t)'}">${fmtMoneySigned(net)}</td>
        </tr>`;
      }).join('');
    }
  }

  if (charts.reportChart) charts.reportChart.destroy();
  const ctx = document.getElementById('reportChart');
  if (!ctx || !months.length) return;

  const labels = months.map(fmtMonthLabel);
  charts.reportChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '收入',
          data: mInc,
          backgroundColor: 'rgba(52,211,153,0.9)',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          order: 2
        },
        {
          label: '支出',
          data: mExp,
          backgroundColor: 'rgba(129,140,248,0.9)',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false,
          order: 2
        },
        {
          type: 'line',
          label: '净结余',
          data: mNet,
          borderColor: '#8b7fd4',
          backgroundColor: 'rgba(139,127,212,0.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#8b7fd4',
          pointBorderColor: '#8b7fd4',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: false,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: chartMoneyTooltip
      },
      scales: {
        x: {
          grid: { color: CHART_THEME.grid },
          ticks: { color: CHART_THEME.tick, font: { size: 11 }, maxRotation: 45 }
        },
        y: {
          grid: { color: CHART_THEME.gridY },
          ticks: { color: CHART_THEME.tick, callback: fmtChartAxis }
        }
      }
    }
  });
}

const INCOME_SUB_COLORS = ['#FDBA74', '#86EFAC', '#1E3A5F', '#93C5FD', '#C4B5FD', '#FDA4AF', '#67E8F9', '#FDE68A'];
const EXPENSE_SUB_COLORS = ['#FDA4AF', '#FB7185', '#F87171', '#EF4444', '#E11D48', '#F97316', '#FB923C', '#FDBA74'];
let catReportCat = '';
let catReportYear = new Date().getFullYear();

function catReportAvailableYears() {
  const years = new Set();
  statsExpanded().forEach(r => {
    const y = r['日期']?.slice(0, 4);
    if (y && /^\d{4}$/.test(y)) years.add(+y);
  });
  years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

function catReportFilterByYear(rows, year) {
  const prefix = String(year);
  return rows.filter(r => r['日期']?.startsWith(prefix));
}

function catReportRows(cat) {
  return statsExpanded().filter(r => r['分类'] === cat);
}

function catReportSubcats(cat, rows, type) {
  const typed = rows.filter(r => r['收支'] === type);
  const configured = subcatsFor(cat);
  const used = [...new Set(typed.map(r => r['子分类'] || '未分类'))];
  const merged = [...configured];
  used.forEach(s => { if (!merged.includes(s)) merged.push(s); });
  const list = merged.filter(s => typed.some(r => (r['子分类'] || '未分类') === s));
  return list.sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    const ai = configured.indexOf(a), bi = configured.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
}

function catReportSubcatSum(rows, sub, type) {
  return rows
    .filter(r => r['收支'] === type && (sub === '全部' || (r['子分类'] || '未分类') === sub))
    .reduce((s, r) => s + r['金额'], 0);
}

function catReportSubMonthPair(catRows, month, sub) {
  const rows = catRows.filter(r =>
    r['日期'].startsWith(month) && (r['子分类'] || '未分类') === sub
  );
  return {
    exp: rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0),
    inc: rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0)
  };
}

function catReportAllSubcats(expSubcats, incSubcats) {
  const seen = new Set();
  const list = [];
  [...expSubcats, ...incSubcats].forEach(s => {
    if (!seen.has(s)) { seen.add(s); list.push(s); }
  });
  return list;
}

function catReportStackSliceAt(chart, dataIndex) {
  const pick = k => +(chart.data.datasets.find(d => d._kind === k)?.data[dataIndex] ?? 0);
  return {
    net: pick('exp'),
    offset: pick('inc-offset'),
    surplus: pick('inc-surplus'),
    incOnly: pick('inc')
  };
}

function catReportStackSlice(ctx) {
  return catReportStackSliceAt(ctx.chart, ctx.dataIndex);
}

function catReportSlotStack(ctx) {
  return `slot-${ctx.dataIndex}`;
}

function catReportSlotRadius(ctx, radius = 5) {
  const { chart, datasetIndex, dataIndex } = ctx;
  const kind = chart.data.datasets[datasetIndex]._kind;
  const slice = catReportStackSliceAt(chart, dataIndex);
  const layers = [];
  if (slice.net > 0) layers.push('exp');
  if (slice.surplus > 0) layers.push('inc-surplus');
  if (slice.offset > 0) layers.push('inc-offset');
  if (slice.incOnly > 0) layers.push('inc');
  const idx = layers.indexOf(kind);
  if (idx < 0) return 0;
  return {
    topLeft: idx === layers.length - 1 ? radius : 0,
    topRight: idx === layers.length - 1 ? radius : 0,
    bottomLeft: idx === 0 ? radius : 0,
    bottomRight: idx === 0 ? radius : 0
  };
}

function catReportBarOpts(radius) {
  return {
    stack: catReportSlotStack,
    borderRadius: ctx => catReportSlotRadius(ctx, radius),
    borderSkipped: false,
    barPercentage: 0.85,
    categoryPercentage: 0.72,
    maxBarThickness: 42
  };
}

const CAT_REPORT_HOLLOW_LW = 2;
const CAT_REPORT_HOLLOW_R = 5;

/** 手绘镂空框，避免 Chart.js 边框在衔接处留下黑线 */
const catReportHollowBarPlugin = {
  id: 'catReportHollowBar',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const slots = chart.options._catReportSlots || [];
    chart.data.datasets.forEach((ds, dsIndex) => {
      if (ds._kind !== 'inc-offset') return;
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;

      meta.data.forEach((bar, index) => {
        if (!bar || bar.skip || !ds.data[index]) return;

        const slot = slots[index];
        const color = slot
          ? EXPENSE_SUB_COLORS[slot.si % EXPENSE_SUB_COLORS.length]
          : '#FDA4AF';
        const { net } = catReportStackSliceAt(chart, index);

        const { x, y, base, width } = bar;
        const left = x - width / 2;
        const right = x + width / 2;
        const top = Math.min(y, base);
        const bottom = Math.max(y, base);
        const topRounded = true;
        const radius = topRounded ? CAT_REPORT_HOLLOW_R : 0;

        const half = CAT_REPORT_HOLLOW_LW / 2;
        const xL = left + half;
        const xR = right - half;
        const yT = top + half;
        const yJoin = net > 0 ? bottom + 1 : bottom - half;
        const r = topRounded ? Math.min(radius, (xR - xL) / 2, (yJoin - yT) / 2) : 0;
        const fillColor = color;

        ctx.save();
        if (net > 0) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(left, bottom - 1, width, 2);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = CAT_REPORT_HOLLOW_LW;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.beginPath();

        if (net <= 0) {
          const yB = bottom - half;
          if (r > 0) {
            ctx.moveTo(xL, yB);
            ctx.lineTo(xL, yT + r);
            ctx.arcTo(xL, yT, xL + r, yT, r);
            ctx.lineTo(xR - r, yT);
            ctx.arcTo(xR, yT, xR, yT + r, r);
            ctx.lineTo(xR, yB);
            ctx.closePath();
          } else {
            ctx.rect(xL, yT, xR - xL, yB - yT);
          }
        } else if (r > 0) {
          ctx.moveTo(xL, yJoin);
          ctx.lineTo(xL, yT + r);
          ctx.arcTo(xL, yT, xL + r, yT, r);
          ctx.lineTo(xR - r, yT);
          ctx.arcTo(xR, yT, xR, yT + r, r);
          ctx.lineTo(xR, yJoin);
        } else {
          ctx.moveTo(xL, yJoin);
          ctx.lineTo(xL, yT);
          ctx.lineTo(xR, yT);
          ctx.lineTo(xR, yJoin);
        }

        ctx.stroke();
        ctx.restore();
      });
    });
  }
};

/** 柱顶显示总金额（收入数据页可设 _catReportLabelNet 显示净值） */
const catReportBarValueLabelsPlugin = {
  id: 'catReportBarValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const slots = chart.options._catReportSlots || [];
    const showNet = chart.options._catReportLabelNet;
    const n = chart.data.labels?.length || 0;

    for (let index = 0; index < n; index++) {
      let anchorBar = null;
      chart.data.datasets.forEach((ds, dsIndex) => {
        const v = ds.data[index];
        if (!(v > 0)) return;
        const b = chart.getDatasetMeta(dsIndex).data[index];
        if (b && !b.skip) anchorBar = b;
      });
      if (!anchorBar) continue;

      let text;
      if (showNet && slots[index]) {
        const { inc = 0, exp = 0 } = slots[index];
        if (!inc && !exp) continue;
        const net = inc - exp;
        text = fmtMoney(net, { integer: Math.abs(net) >= 1000 });
      } else {
        let total = 0;
        chart.data.datasets.forEach(ds => {
          const v = ds.data[index];
          if (v > 0) total += v;
        });
        if (!total) continue;
        text = fmtMoney(total, { integer: total >= 1000 });
      }

      let topY = anchorBar.y;
      chart.data.datasets.forEach((ds, dsIndex) => {
        const v = ds.data[index];
        if (!(v > 0)) return;
        const b = chart.getDatasetMeta(dsIndex).data[index];
        if (b && !b.skip) topY = Math.min(topY, b.y);
      });

      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.font = '600 10px system-ui, -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, anchorBar.x, topY - 5);
      ctx.restore();
    }
  }
};

function catReportSubHasMonthData(catRows, month, sub) {
  const { exp, inc } = catReportSubMonthPair(catRows, month, sub);
  return exp > 0 || inc > 0;
}

function catReportSubChartSlots(months, catRows, sub, si) {
  return months.map(m => {
    const { exp, inc } = catReportSubMonthPair(catRows, m, sub);
    return { month: m, sub, si, exp, inc };
  });
}

function catReportBuildSubChartDatasets(months, catRows, sub, si) {
  const n = months.length;
  const expData = new Array(n).fill(null);
  const offsetData = new Array(n).fill(null);
  const surplusData = new Array(n).fill(null);
  const incData = new Array(n).fill(null);

  months.forEach((m, i) => {
    const { exp, inc } = catReportSubMonthPair(catRows, m, sub);
    if (exp <= 0 && inc <= 0) return;
    if (exp > 0 && inc > 0) {
      expData[i] = +Math.max(0, exp - inc).toFixed(2);
      offsetData[i] = +Math.min(inc, exp).toFixed(2);
      const surplus = +Math.max(0, inc - exp).toFixed(2);
      if (surplus > 0) surplusData[i] = surplus;
    } else if (exp > 0) {
      expData[i] = +exp.toFixed(2);
    } else if (inc > 0) {
      incData[i] = +inc.toFixed(2);
    }
  });

  const barOpts = catReportBarOpts(5);
  const expColor = EXPENSE_SUB_COLORS[si % EXPENSE_SUB_COLORS.length];
  const incColor = INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length];

  return [
    {
      label: '支出',
      data: expData,
      backgroundColor: expColor,
      _kind: 'exp',
      ...barOpts
    },
    {
      label: '盈余收入',
      data: surplusData,
      backgroundColor: incColor,
      _kind: 'inc-surplus',
      ...barOpts
    },
    {
      label: '收入抵扣',
      data: offsetData,
      backgroundColor: 'rgba(0,0,0,0)',
      hoverBackgroundColor: 'rgba(0,0,0,0)',
      borderWidth: 0,
      borderRadius: 0,
      _kind: 'inc-offset',
      stack: catReportSlotStack,
      borderSkipped: false,
      barPercentage: 0.85,
      categoryPercentage: 0.72,
      maxBarThickness: 42
    },
    {
      label: '收入',
      data: incData,
      backgroundColor: incColor,
      _kind: 'inc',
      ...barOpts
    }
  ];
}

function catReportBuildMonthChartDatasets(months, catRows, si = 0) {
  const n = months.length;
  const expData = new Array(n).fill(null);
  const offsetData = new Array(n).fill(null);
  const surplusData = new Array(n).fill(null);
  const incData = new Array(n).fill(null);

  months.forEach((m, i) => {
    const { exp, inc } = incomeMonthBreakdown(catRows, m);
    if (exp <= 0 && inc <= 0) return;
    if (exp > 0 && inc > 0) {
      expData[i] = +Math.max(0, exp - inc).toFixed(2);
      offsetData[i] = +Math.min(inc, exp).toFixed(2);
      const surplus = +Math.max(0, inc - exp).toFixed(2);
      if (surplus > 0) surplusData[i] = surplus;
    } else if (exp > 0) {
      expData[i] = +exp.toFixed(2);
    } else if (inc > 0) {
      incData[i] = +inc.toFixed(2);
    }
  });

  const barOpts = catReportBarOpts(5);
  const expColor = EXPENSE_SUB_COLORS[si % EXPENSE_SUB_COLORS.length];
  const incColor = INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length];

  return [
    { label: '支出', data: expData, backgroundColor: expColor, _kind: 'exp', ...barOpts },
    { label: '盈余收入', data: surplusData, backgroundColor: incColor, _kind: 'inc-surplus', ...barOpts },
    {
      label: '收入抵扣', data: offsetData, backgroundColor: 'rgba(0,0,0,0)',
      hoverBackgroundColor: 'rgba(0,0,0,0)', borderWidth: 0, borderRadius: 0,
      _kind: 'inc-offset', stack: catReportSlotStack, borderSkipped: false,
      barPercentage: 0.85, categoryPercentage: 0.72, maxBarThickness: 42
    },
    { label: '收入', data: incData, backgroundColor: incColor, _kind: 'inc', ...barOpts }
  ];
}

function incomeCatReportChartSlots(months, catRows, si) {
  return months.map(m => {
    const { exp, inc } = incomeMonthBreakdown(catRows, m);
    return { month: m, si, exp, inc };
  });
}

function incomeCatReportChartOptions(months, cat) {
  const opts = catReportChartOptions(months, cat, '');
  opts.onClick = (evt, _elements, chart) => {
    const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
    if (!hit.length) return;
    const month = months[hit[0].index];
    if (month) showIncomeDetail(month, cat);
  };
  opts.onHover = (evt, elements) => {
    evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
  };
  return opts;
}

function destroyCatReportCharts() {
  if (!charts.catReport) {
    charts.catReport = {};
    return;
  }
  if (typeof charts.catReport.destroy === 'function') {
    charts.catReport.destroy();
  } else {
    Object.values(charts.catReport).forEach(c => c?.destroy?.());
  }
  charts.catReport = {};
}

function catReportSubChartKey(sub) {
  return sub.replace(/[^\w\u4e00-\u9fff-]/g, '_');
}

function renderCatReportSubCharts(months, catRows, cat, allSubcats, expSet, incSet) {
  const wrap = document.getElementById('catReportSubCharts');
  if (!wrap) return;

  destroyCatReportCharts();

  if (!months.length) {
    wrap.innerHTML = '<div class="catreport-sub-charts-empty">该分类暂无月度数据</div>';
    return;
  }

  const activeSubcats = allSubcats.filter(sub =>
    months.some(m => catReportSubHasMonthData(catRows, m, sub))
  );

  if (!activeSubcats.length) {
    wrap.innerHTML = '<div class="catreport-sub-charts-empty">该分类暂无子分类数据</div>';
    return;
  }

  wrap.innerHTML = activeSubcats.map(sub => {
    const si = allSubcats.indexOf(sub);
    const expColor = EXPENSE_SUB_COLORS[si % EXPENSE_SUB_COLORS.length];
    const incColor = INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length];
    const hasBoth = expSet.has(sub) && incSet.has(sub);
    const badges = hasBoth
      ? '<span class="catreport-sub-row-badges"><span class="catreport-leg-dot" style="background:' + expColor + '"></span>净支出 <span class="catreport-leg-dot hollow" style="border-color:' + expColor + '"></span>收入抵扣</span>'
      : (expSet.has(sub)
        ? '<span class="catreport-sub-row-badges">支出</span>'
        : '<span class="catreport-sub-row-badges">收入</span>');
    const key = catReportSubChartKey(sub);
    return `<section class="catreport-sub-row">
      <div class="catreport-sub-row-head">
        <span class="catreport-leg-dot" style="background:${expSet.has(sub) ? expColor : incColor}"></span>
        <span class="catreport-sub-row-title">${sub}</span>
        ${badges}
      </div>
      <div class="catreport-sub-row-chart"><canvas id="catSubChart-${key}" data-sub="${sub}"></canvas></div>
    </section>`;
  }).join('');

  activeSubcats.forEach(sub => {
    const si = allSubcats.indexOf(sub);
    const canvas = document.getElementById(`catSubChart-${catReportSubChartKey(sub)}`);
    if (!canvas) return;
    const datasets = catReportBuildSubChartDatasets(months, catRows, sub, si);
    const chartOpts = catReportChartOptions(months, cat, sub);
    chartOpts._catReportSlots = catReportSubChartSlots(months, catRows, sub, si);
    charts.catReport[sub] = new Chart(canvas, {
      type: 'bar',
      data: { labels: months.map(fmtMonthLabel), datasets },
      options: chartOpts,
      plugins: [catReportHollowBarPlugin, catReportBarValueLabelsPlugin]
    });
  });
}

function populateCatReportYearSelect() {
  const sel = document.getElementById('catReportYearSel');
  if (!sel) return;
  const years = catReportAvailableYears();
  if (!years.includes(catReportYear)) catReportYear = new Date().getFullYear();
  sel.innerHTML = years.map(y => `<option value="${y}">${y} 年</option>`).join('');
  sel.value = String(catReportYear);
}

function populateCatReportSelect() {
  const sel = document.getElementById('catReportSel');
  if (!sel) return;
  sel.innerHTML = CATS.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('');
  if (!catReportCat || !CATS.includes(catReportCat)) catReportCat = CATS[0] || '';
  sel.value = catReportCat;
}

function onCatReportChange() {
  catReportCat = document.getElementById('catReportSel')?.value || CATS[0] || '';
  renderCatReport();
}

function onCatReportYearChange() {
  catReportYear = +(document.getElementById('catReportYearSel')?.value) || new Date().getFullYear();
  renderCatReport();
}

function catReportChartOptions(months, cat, sub) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 20 } },
    interaction: { mode: 'index', intersect: false },
    _catReportSub: sub,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartMoneyTooltip,
        backgroundColor: CHART_THEME.tooltip.backgroundColor,
        titleColor: CHART_THEME.tooltip.titleColor,
        bodyColor: CHART_THEME.tooltip.bodyColor,
        borderColor: CHART_THEME.tooltip.borderColor,
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        usePointStyle: true,
        boxPadding: 4,
        callbacks: {
          ...chartMoneyTooltip.callbacks,
          title(tooltipItems) {
            const chart = tooltipItems[0]?.chart;
            const idx = tooltipItems[0]?.dataIndex;
            const slot = chart?.options?._catReportSlots?.[idx];
            const month = slot?.month || months[idx];
            return month ? fmtMonthLabel(month) : (tooltipItems[0]?.label || '');
          },
          label(ctx) {
            const v = ctx.parsed?.y ?? 0;
            if (!v) return null;
            const prefix = ctx.dataset?.label ? `${ctx.dataset.label}: ` : '';
            return prefix + fmtMoney(v);
          },
          labelColor(ctx) {
            if (ctx.dataset._kind === 'inc-offset') {
              const slot = ctx.chart?.options?._catReportSlots?.[ctx.dataIndex];
              const c = slot
                ? EXPENSE_SUB_COLORS[slot.si % EXPENSE_SUB_COLORS.length]
                : '#FDA4AF';
              return {
                borderColor: c,
                backgroundColor: 'rgba(0,0,0,0)',
                borderWidth: 2,
                pointStyle: 'circle'
              };
            }
            const bg = ctx.dataset.backgroundColor;
            return {
              borderColor: bg,
              backgroundColor: bg,
              borderWidth: 0,
              pointStyle: 'circle'
            };
          },
          footer(items) {
            const exp = items
              .filter(i => i.dataset._kind === 'exp' || i.dataset._kind === 'inc-offset')
              .reduce((s, i) => s + (i.parsed?.y || 0), 0);
            const inc = items
              .filter(i => i.dataset._kind === 'inc' || i.dataset._kind === 'inc-offset' || i.dataset._kind === 'inc-surplus')
              .reduce((s, i) => s + (i.parsed?.y || 0), 0);
            if (!exp && !inc) return '';
            return `净额 ${fmtMoneySigned(inc - exp)}`;
          }
        },
        filter(item) {
          return (item.parsed?.y ?? 0) > 0;
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: CHART_THEME.grid },
        ticks: {
          color: CHART_THEME.tick,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12
        }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: CHART_THEME.gridY },
        ticks: { color: CHART_THEME.tick, callback: fmtChartAxis }
      }
    },
    onClick(evt, _elements, chart) {
      if (!cat || !chart) return;
      const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, false);
      if (!hit.length) return;
      const el = hit[0];
      const month = months[el.index];
      const subName = chart.options._catReportSub || sub || '';
      if (month) showCatReportDetail(month, cat, subName);
    },
    onHover(evt, elements) {
      evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    }
  };
}

function catReportSubKpiCard(sub, exp, inc, color) {
  const net = inc - exp;
  const valCls = net >= 0 ? 'c-grn' : 'c-red';
  const subLine = inc > 0
    ? `支出 ${fmtMoney(exp)} · 收入 ${fmtMoney(inc)}`
    : `支出 ${fmtMoney(exp)}`;
  return `<div class="catreport-sub-kpi">
    <span class="catreport-sub-kpi-dot" style="background:${color}"></span>
    <div class="catreport-sub-kpi-body">
      <div class="catreport-sub-kpi-label">${sub}</div>
      <div class="catreport-sub-kpi-val ${valCls}">${fmtMoneySigned(net)}</div>
      <div class="catreport-sub-kpi-sub">${subLine}</div>
    </div>
  </div>`;
}

function renderCatReportSubKpis(catRows, allSubcats) {
  const items = allSubcats
    .map((sub, si) => {
      const exp = catRows.filter(r => r['收支'] === '支出' && (r['子分类'] || '未分类') === sub)
        .reduce((s, r) => s + r['金额'], 0);
      const inc = catRows.filter(r => r['收支'] === '收入' && (r['子分类'] || '未分类') === sub)
        .reduce((s, r) => s + r['金额'], 0);
      if (!exp && !inc) return null;
      const color = EXPENSE_SUB_COLORS[si % EXPENSE_SUB_COLORS.length];
      return { sub, exp, inc, color, net: inc - exp };
    })
    .filter(Boolean)
    .sort((a, b) => b.exp - a.exp || b.inc - a.inc);

  const kpiEl = document.getElementById('catReportKpi');
  if (!kpiEl) return;
  if (!items.length) {
    kpiEl.innerHTML = '<div class="catreport-sub-kpi-empty">暂无子分类数据</div>';
    return;
  }
  kpiEl.innerHTML = items.map(it => catReportSubKpiCard(it.sub, it.exp, it.inc, it.color)).join('');
}

function renderCatReport() {
  populateCatReportSelect();
  populateCatReportYearSelect();
  const cat = catReportCat || document.getElementById('catReportSel')?.value || CATS[0];
  if (!cat) return;

  const catRows = catReportFilterByYear(catReportRows(cat), catReportYear);
  const months = [...new Set(catRows.map(r => r['日期'].slice(0, 7)))].sort();
  const titleEl = document.getElementById('catReportChartTitle');
  if (titleEl) titleEl.textContent = `${catLabel(cat)} · ${catReportYear} 年各子分类月度收支`;

  const expSubcats = catReportSubcats(cat, catRows, '支出');
  const incSubcats = catReportSubcats(cat, catRows, '收入');
  const allSubcats = catReportAllSubcats(expSubcats, incSubcats);
  const expSet = new Set(expSubcats);
  const incSet = new Set(incSubcats);

  renderCatReportSubKpis(catRows, allSubcats);

  const legEl = document.getElementById('catReportLeg');
  if (legEl) {
    legEl.innerHTML = '<span class="catreport-leg-item"><span class="catreport-leg-dot" style="background:#FDA4AF"></span>实心=净支出</span><span class="catreport-leg-item"><span class="catreport-leg-dot hollow" style="border-color:#FDA4AF"></span>镂空=收入抵扣</span>';
  }

  const tbody = document.getElementById('catReportTableBody');
  if (tbody) {
    if (!months.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--txt3);padding:24px">该分类暂无数据</td></tr>';
    } else {
      tbody.innerHTML = [...months].reverse().map(m => {
        const exp = catRows.filter(r => r['日期'].startsWith(m) && r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
        const inc = catRows.filter(r => r['日期'].startsWith(m) && r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
        const net = inc - exp;
        return `<tr>
          <td>${fmtMonthLabel(m)}</td>
          <td class="c-exp">${fmtMoney(exp)}</td>
          <td class="c-inc">${fmtMoney(inc)}</td>
          <td class="c-net" style="color:${net >= 0 ? 'var(--blu-t)' : 'var(--red-t)'}">${fmtMoneySigned(net)}</td>
        </tr>`;
      }).join('');
    }
  }

  renderCatReportSubCharts(months, catRows, cat, allSubcats, expSet, incSet);
}

function incomeCatBreakdown(catRows) {
  const inc = catRows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const exp = catRows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  return { inc, exp, net: inc - exp };
}

function incomeCatHasCostView(cat) {
  const rows = activeExpanded().filter(r => r['分类'] === cat);
  return incomeCatIsNetted(cat) || rows.some(r => r['收支'] === '支出');
}

function incomeCatIsNetted(cat) {
  return OFFSET_CATS_SET.has(cat);
}

function incomeCatRows(cat) {
  const rows = activeExpanded().filter(r => r['分类'] === cat);
  if (incomeCatIsNetted(cat) || rows.some(r => r['收支'] === '支出')) return rows;
  return rows.filter(r => r['收支'] === '收入');
}

function incomeCatNet(rows) {
  return rows.reduce((s, r) => s + (r['收支'] === '收入' ? r['金额'] : -r['金额']), 0);
}

function incomeSubcatBreakdown(catRows, sub) {
  const filtered = sub === '全部' ? catRows : catRows.filter(r => (r['子分类'] || '未分类') === sub);
  const inc = filtered.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const exp = filtered.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  return { inc, exp, net: inc - exp };
}

function incomeSubcatTotalsHtml(cat, catRows) {
  const subcats = incomeSubcatsFor(cat, catRows);
  const items = subcats
    .map((sub, si) => ({ sub, si, ...incomeSubcatBreakdown(catRows, sub) }))
    .filter(x => x.inc > 0);
  if (!items.length) return '';
  return items.map(({ sub, si, inc, exp, net }) => {
    const color = INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length];
    const amtFmt = exp > 0 ? fmtMoneySigned(net) : fmtMoney(inc);
    return `<span class="income-sub-total"><span class="income-leg-dot" style="background:${color}"></span><span class="income-sub-total-name">${sub}</span><span class="income-sub-total-amt">${amtFmt}</span></span>`;
  }).join('');
}

function incomeSubcatNet(rows, sub) {
  const filtered = sub === '全部' ? rows : rows.filter(r => (r['子分类'] || '未分类') === sub);
  return incomeCatNet(filtered);
}

function incomeSubcatsFor(cat, rows) {
  const catRows = rows.filter(r => r['分类'] === cat);
  const configured = subcatsFor(cat);
  const used = [...new Set(catRows.map(r => r['子分类'] || '未分类'))];
  const merged = [...configured];
  used.forEach(s => { if (!merged.includes(s)) merged.push(s); });
  const list = merged.filter(s => catRows.some(r => (r['子分类'] || '未分类') === s));
  return list.sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    const ai = configured.indexOf(a), bi = configured.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
}

function stackedBarRadius(ctx, radius = 10) {
  const chart = ctx.chart;
  const dsIdx = ctx.datasetIndex;
  const di = ctx.dataIndex;
  const stack = chart.data.datasets[dsIdx].stack;
  const stackSets = chart.data.datasets.filter(d => d.stack === stack);
  const vals = stackSets.map(d => +(d.data[di] || 0));
  let first = -1, last = -1;
  vals.forEach((v, i) => { if (v > 0) { if (first < 0) first = i; last = i; } });
  const myIdx = stackSets.indexOf(chart.data.datasets[dsIdx]);
  return {
    topLeft: myIdx === last ? radius : 0,
    topRight: myIdx === last ? radius : 0,
    bottomLeft: myIdx === first ? radius : 0,
    bottomRight: myIdx === first ? radius : 0
  };
}

function monthChangePct(totals) {
  if (totals.length < 2) return null;
  const last = totals[totals.length - 1];
  const prev = totals[totals.length - 2];
  if (prev === 0) return last > 0 ? 100 : (last === 0 ? 0 : null);
  return Math.round(((last - prev) / prev) * 100);
}

function incomeMonthLabels(months) {
  const multiYear = new Set(months.map(m => m.slice(0, 4))).size > 1;
  return months.map(m => {
    const mo = parseInt(m.split('-')[1], 10);
    return multiYear ? `${m.slice(2, 4)}/${mo}月` : `${mo}月`;
  });
}

function incomeChartTooltipExternal({ chart, tooltip }) {
  const wrap = chart.canvas.parentNode;
  let el = wrap.querySelector('.income-chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.className = 'income-chart-tooltip';
    wrap.appendChild(el);
  }
  if (!tooltip || tooltip.opacity === 0) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    return;
  }

  const title = tooltip.title?.[0] || '';
  const footer = tooltip.footer?.filter(Boolean) || [];
  const rows = (tooltip.dataPoints || []).map(dp => {
    const color = dp.dataset?.backgroundColor || '#98a2b3';
    const label = dp.dataset?.label || '';
    const val = fmtMoney(dp.parsed?.y ?? 0);
    return `<div class="ict-row"><span class="ict-dot" style="background:${color}"></span><span class="ict-label">${label}</span><span class="ict-val">${val}</span></div>`;
  }).join('');

  el.innerHTML = `
    ${title ? `<div class="ict-title">${title}</div>` : ''}
    <div class="ict-body">${rows}</div>
    ${footer.length ? `<div class="ict-footer">${footer.map(f => `<div>${f}</div>`).join('')}</div>` : ''}`;

  el.style.opacity = '1';
  el.style.pointerEvents = 'none';
  el.style.left = `${tooltip.caretX}px`;
  el.style.top = `${tooltip.caretY}px`;
}

function incomeMonthBreakdown(catRows, month) {
  return incomeCatBreakdown(catRows.filter(r => r['日期'].startsWith(month)));
}

function incomeCatShowsCostBreakdown(cat, _catRows) {
  return incomeCatHasCostView(cat);
}

function incomeMonthTableHtml(months, catRows, cat) {
  const safeCat = cat.replace(/'/g, "\\'");
  const rows = [...months].reverse().map(m => {
    const { inc, exp, net } = incomeMonthBreakdown(catRows, m);
    if (!inc && !exp) return '';
    return `<tr class="income-month-row" onclick="showIncomeDetail('${m}','${safeCat}')">
      <td>${fmtMonthLabel(m)}</td>
      <td class="income-t-exp">${fmtMoney(exp)}</td>
      <td class="income-t-inc">${fmtMoney(inc)}</td>
      <td class="income-t-net" style="color:${net >= 0 ? 'var(--blu-t)' : 'var(--red-t)'}">${fmtMoneySigned(net)}</td>
    </tr>`;
  }).filter(Boolean).join('');
  if (!rows) {
    return '<div class="income-month-empty">暂无月度数据</div>';
  }
  return `<table class="income-month-table">
    <thead><tr><th>月份</th><th>支出</th><th>收入</th><th>净值</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function incomeChartOptions(months, cat) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: false,
        external: incomeChartTooltipExternal,
        callbacks: {
          footer(items) {
            const sum = items.reduce((s, i) => s + (i.parsed?.y || 0), 0);
            if (!sum) return '';
            return sum < 0 ? `净额 ${fmtMoneySigned(sum)}` : `合计 ${fmtMoney(sum)}`;
          }
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: CHART_THEME.tick,
          font: { size: 11, weight: '500' },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12
        }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: CHART_THEME.gridY, drawBorder: false },
        border: { display: false },
        ticks: {
          color: CHART_THEME.tick,
          font: { size: 10 },
          maxTicksLimit: 5,
          callback: fmtChartAxis
        }
      }
    },
    onClick(_evt, elements) {
      if (!elements.length) return;
      showIncomeDetail(months[elements[0].index], cat);
    },
    onHover(evt, elements) {
      evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    }
  };
}

function incomeYearsFromData() {
  const years = [...new Set(allData.map(r => r['日期'].slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  return years.length ? years : [String(new Date().getFullYear())];
}

function ensureIncomeYear() {
  const years = incomeYearsFromData();
  if (!incomeYear || !years.includes(incomeYear)) {
    const current = String(new Date().getFullYear());
    incomeYear = years.includes(current) ? current : years[0];
  }
}

function incomeMonthsForYear(year) {
  return [...new Set(allData.map(r => r['日期'].slice(0, 7)).filter(m => m.startsWith(`${year}-`)))].sort();
}

function onIncomeYearChange(year) {
  incomeYear = String(year || '');
  ensureIncomeYear();
  renderIncomeData();
}

function renderIncomeToolbar() {
  const bar = document.getElementById('incomeToolbar');
  if (!bar) return;
  ensureIncomeYear();
  const years = incomeYearsFromData();
  const available = CATS.filter(c => isIncomeCategory(c) && !INCOME_DATA_CATS_LIST.includes(c));
  const chips = INCOME_DATA_CATS_LIST.map(cat => {
    const safe = cat.replace(/'/g, "\\'");
    return `<span class="income-cat-chip">
      <span class="inline-cat-icon">${catIconHtml(cat, { size: 14 })}</span>
      <span>${catLabel(cat)}</span>
      <button type="button" class="income-cat-chip-x" onclick="removeIncomeMonitorCat('${safe}')" title="移除监视">×</button>
    </span>`;
  }).join('');
  bar.innerHTML = `<div class="income-toolbar-inner">
    <div class="income-year-wrap">
      <span class="income-toolbar-label">年份</span>
      <select id="incomeYearSel" class="income-year-sel" onchange="onIncomeYearChange(this.value)" aria-label="选择年份">
        ${years.map(y => `<option value="${y}"${y === incomeYear ? ' selected' : ''}>${y}年</option>`).join('')}
      </select>
    </div>
    <span class="income-toolbar-label">监视分类</span>
    <div class="income-cat-chips">${chips || '<span class="income-toolbar-empty">点击下方添加要监视的分类</span>'}</div>
    ${available.length ? `<div class="income-cat-add">
      <select id="incomeCatAddSel" class="income-cat-add-sel">${available.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('')}</select>
      <button type="button" class="btn btn-sm btn-p" onclick="addIncomeMonitorCatFromSel()"><i class="ti ti-plus"></i> 添加</button>
    </div>` : '<span class="income-toolbar-full">已添加全部分类</span>'}
  </div>`;
}

function addIncomeMonitorCat(cat) {
  const name = String(cat || '').trim();
  if (!name || !CATS.includes(name) || !isIncomeCategory(name) || INCOME_DATA_CATS_LIST.includes(name)) return;
  INCOME_DATA_CATS_LIST.push(name);
  persist();
  renderIncomeData();
}

function addIncomeMonitorCatFromSel() {
  const sel = document.getElementById('incomeCatAddSel');
  if (sel?.value) addIncomeMonitorCat(sel.value);
}

function removeIncomeMonitorCat(cat) {
  if (!cat) return;
  INCOME_DATA_CATS_LIST = INCOME_DATA_CATS_LIST.filter(c => c !== cat);
  persist();
  renderIncomeData();
}

function renderIncomeData() {
  renderIncomeToolbar();
  ensureIncomeYear();
  const months = incomeMonthsForYear(incomeYear);
  const grid = document.getElementById('incomeGrid');
  if (!grid) return;

  if (charts.income) Object.values(charts.income).forEach(c => c?.destroy?.());
  charts.income = {};

  if (!allData.length) {
    grid.innerHTML = '<div class="income-card income-card-empty" style="grid-column:1/-1">暂无收入数据</div>';
    return;
  }
  if (!INCOME_DATA_CATS_LIST.length) {
    grid.innerHTML = '<div class="income-card income-card-empty" style="grid-column:1/-1">请先在上方添加要监视的分类</div>';
    return;
  }
  if (!months.length) {
    grid.innerHTML = `<div class="income-card income-card-empty" style="grid-column:1/-1">${incomeYear}年暂无数据</div>`;
    return;
  }

  grid.innerHTML = INCOME_DATA_CATS_LIST.map((cat, i) => {
    const catRows = incomeCatRows(cat);
    const yearRows = catRows.filter(r => r['日期'].startsWith(`${incomeYear}-`));
    const costView = incomeCatHasCostView(cat);
    const { net: total } = incomeCatBreakdown(yearRows);
    const totalFmt = costView ? fmtMoneySigned(total) : fmtMoney(total);
    const subTotals = incomeSubcatTotalsHtml(cat, yearRows);
    const subSummary = '';
    const tag = costView ? '<span class="income-net-tag">净值</span>' : '';
    const footer = costView
      ? `<div class="income-cr-foot" id="incTable-${i}"></div>`
      : `<div class="income-legend" id="incLegend-${i}"></div>`;
    return `<div class="income-card${costView ? ' income-card--net' : ''}">
      <div class="income-card-head">
        <div class="income-card-meta">
          <div class="income-card-title">${catLabel(cat)}${tag}</div>
          <div class="income-card-total-row">
            <div class="income-card-total">${totalFmt}</div>
            ${subTotals ? `<div class="income-sub-totals">${subTotals}</div>` : ''}
          </div>
          ${subSummary}
        </div>
        <div class="income-card-change" id="incChange-${i}"></div>
      </div>
      <div class="income-chart-wrap${costView ? ' income-chart-wrap--cr' : ''}"><canvas id="incChart-${i}"></canvas></div>
      ${footer}
    </div>`;
  }).join('');

  INCOME_DATA_CATS_LIST.forEach((cat, i) => {
    const catRows = incomeCatRows(cat);
    const yearRows = catRows.filter(r => r['日期'].startsWith(`${incomeYear}-`));
    const costView = incomeCatHasCostView(cat);

    const monthlyTotals = months.map(m =>
      +incomeCatNet(yearRows.filter(r => r['日期'].startsWith(m))).toFixed(2)
    );

    let datasets;
    let chartOptions;
    let chartPlugins;
    if (costView) {
      datasets = catReportBuildMonthChartDatasets(months, yearRows, i);
      chartOptions = incomeCatReportChartOptions(months, cat);
      chartOptions._catReportSlots = incomeCatReportChartSlots(months, yearRows, i);
      chartOptions._catReportLabelNet = true;
      chartPlugins = [catReportHollowBarPlugin, catReportBarValueLabelsPlugin];
    } else {
      chartPlugins = undefined;
      let subcats = incomeSubcatsFor(cat, yearRows);
      if (!subcats.length) subcats = ['全部'];
      datasets = subcats.map((sub, si) => ({
        label: sub,
        data: months.map(m => {
          const mr = yearRows.filter(r => r['日期'].startsWith(m));
          return +incomeSubcatNet(mr, sub).toFixed(2);
        }),
        backgroundColor: INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length],
        stack: 'inc',
        borderRadius: ctx => stackedBarRadius(ctx, 10),
        borderSkipped: false,
        barPercentage: 0.55,
        categoryPercentage: 0.68
      }));
      chartOptions = incomeChartOptions(months, cat);
    }

    const canvas = document.getElementById(`incChart-${i}`);
    if (!canvas) return;

    const chartCfg = {
      type: 'bar',
      data: {
        labels: costView ? months.map(fmtMonthLabel) : incomeMonthLabels(months),
        datasets
      },
      options: chartOptions
    };
    if (chartPlugins) chartCfg.plugins = chartPlugins;
    charts.income[cat] = new Chart(canvas, chartCfg);

    const changeEl = document.getElementById(`incChange-${i}`);
    if (changeEl) {
      const pct = monthChangePct(monthlyTotals);
      if (pct !== null && (monthlyTotals.at(-1) > 0 || monthlyTotals.at(-2) > 0)) {
        const up = pct >= 0;
        changeEl.innerHTML = `<span class="income-change ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
      }
    }

    if (costView) {
      const tableEl = document.getElementById(`incTable-${i}`);
      if (tableEl) {
        const expColor = EXPENSE_SUB_COLORS[i % EXPENSE_SUB_COLORS.length];
        const tableHtml = incomeMonthTableHtml(months, yearRows, cat);
        const wrap = tableHtml.includes('income-month-table')
          ? `<div class="income-month-table-wrap">${tableHtml}</div>`
          : tableHtml;
        tableEl.innerHTML = `<div class="catreport-legend income-cr-legend">
          <span class="catreport-leg-item"><span class="catreport-leg-dot" style="background:${expColor}"></span>净支出</span>
          <span class="catreport-leg-item"><span class="catreport-leg-dot hollow" style="border-color:${expColor}"></span>收入抵扣</span>
        </div>${wrap}`;
      }
    } else {
      const legEl = document.getElementById(`incLegend-${i}`);
      if (legEl) {
        let subcats = incomeSubcatsFor(cat, yearRows);
        if (!subcats.length) subcats = ['全部'];
        legEl.innerHTML = subcats.map((sub, si) =>
          `<span class="income-leg-item"><span class="income-leg-dot" style="background:${INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length]}"></span>${sub}</span>`
        ).join('');
      }
    }
  });
}

function sw(name, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  document.getElementById('view-' + name).classList.add('on');
  el.classList.add('on');
  document.getElementById('vt').textContent = { home: '首页', ledger: '明细列表', trades: '事件', catbrowse: '分类检索', catreport: '分类报表', renqing: '人情往来', accounts: '信用账户', charts: '统计图表', monitor: '统计监控', gear: '装备库', family: '家庭', report: '收支报告', income: '收入数据', company: '公司成本', refunds: '退款管理', import: '导入预览' }[name];
  if (name === 'home') setTimeout(renderHome, 60);
  if (name === 'trades') setTimeout(renderTradesPage, 60);
  if (name === 'charts') setTimeout(renderCharts, 60);
  if (name === 'report') setTimeout(renderReport, 60);
  if (name === 'income') setTimeout(renderIncomeData, 60);
  if (name === 'catreport') setTimeout(renderCatReport, 60);
  if (name === 'renqing') setTimeout(renderRenqingPage, 60);
  if (name === 'accounts') setTimeout(renderAccountsPage, 60);
  if (name === 'refunds') renderRfView();
  if (name === 'monitor') renderMonitor();
  if (name === 'gear') renderGearPage();
  if (name === 'family') setTimeout(() => { loadFamilyEvents().catch(err => alert(err.message || '加载失败')); }, 60);
  if (name === 'company') renderCompanyCostPage();
  if (name === 'import') renderImportPage();
  if (name === 'catbrowse') setTimeout(renderCatBrowse, 60);
}

function setQuick(type) {
  const now = new Date();
  let y = now.getFullYear(), mo = now.getMonth();
  let d1, d2;
  if (type === 'month') {
    d1 = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    d2 = `${y}-${String(mo + 1).padStart(2, '0')}-${String(new Date(y, mo + 1, 0).getDate()).padStart(2, '0')}`;
  } else {
    const pm = mo === 0 ? 12 : mo, py = mo === 0 ? y - 1 : y;
    d1 = `${py}-${String(pm).padStart(2, '0')}-01`;
    d2 = `${py}-${String(pm).padStart(2, '0')}-${String(new Date(py, pm, 0).getDate()).padStart(2, '0')}`;
  }
  document.getElementById('d1').value = d1;
  document.getElementById('d2').value = d2;
  applyF();
}

function syncUnsetSubFilterUI() {
  const btn = document.getElementById('unsetSubFilterBtn');
  if (!btn) return;
  btn.classList.toggle('on', filterUnsetSubOnly);
  btn.setAttribute('aria-pressed', filterUnsetSubOnly ? 'true' : 'false');
}

function toggleUnsetSubFilter(btn) {
  filterUnsetSubOnly = !filterUnsetSubOnly;
  if (btn) btn.classList.toggle('on', filterUnsetSubOnly);
  else syncUnsetSubFilterUI();
  curPage = 1;
  applyF();
}

// ── 导入账单 ─────────────────────────────────────────────────────────────────
function openImport() {
  sw('import', document.getElementById('nav-import'));
}

function resetImportPreview() {
  pendingImport = null;
  document.getElementById('importPreview').innerHTML = '选择来源并上传文件后将显示解析摘要';
  document.getElementById('importStats').innerHTML = '';
  document.getElementById('importConfirmBtn').disabled = true;
  document.getElementById('importRecordPreview').style.display = 'none';
  document.getElementById('importDupPanel').style.display = 'none';
  document.getElementById('importDupList').innerHTML = '';
  updateImportStepUI(importActiveSource ? 2 : 1);
  renderImportTimelineView();
}

function populateImportSources() {
  const sel = document.getElementById('imp-src');
  if (!sel) return;
  sel.innerHTML = '<option value="">请选择导入来源</option>'
    + SOURCES.map(s => `<option value="${s.name}"${importActiveSource === s.name ? ' selected' : ''}>${s.name}</option>`).join('')
    + '<option value="__new__">+ 新建来源…</option>';
  if (importActiveSource) sel.value = importActiveSource;
}

function getImportSourceName() {
  const sel = document.getElementById('imp-src');
  if (!sel?.value || sel.value === '') throw new Error('请先选择导入来源');
  if (sel.value === '__new__') {
    const name = document.getElementById('imp-new-src').value.trim();
    if (!name) throw new Error('请输入新来源名称');
    if (!SOURCES.find(s => s.name === name)) {
      SOURCES.push({ name, color: document.getElementById('imp-new-color').value || '#6941c6' });
      persist();
      populateImportSources();
      sel.value = name;
    }
    importActiveSource = name;
    return name;
  }
  importActiveSource = sel.value;
  return sel.value;
}

function onImportSrcChange() {
  const sel = document.getElementById('imp-src');
  document.getElementById('imp-new-row').style.display = sel?.value === '__new__' ? 'block' : 'none';
  if (sel?.value && sel.value !== '__new__') {
    importActiveSource = sel.value;
  } else if (sel?.value !== '__new__') {
    importActiveSource = null;
  }
  updateImportUploadState();
  if (pendingImport && importActiveSource) {
    pendingImport.sourceName = importActiveSource;
    pendingImport.allRecords?.forEach(r => { r['来源'] = importActiveSource; });
    pendingImport.newRecords?.forEach(r => { r['来源'] = importActiveSource; });
    pendingImport.duplicateRecords?.forEach(r => { r['来源'] = importActiveSource; });
    refreshImportRecords();
    document.getElementById('importPreview').innerHTML =
      document.getElementById('importPreview').innerHTML.replace(
        /来源：<strong>[^<]+<\/strong>/,
        `来源：<strong>${importActiveSource}</strong>`
      );
  } else {
    renderImportTimelineView();
  }
}

function updateImportUploadState() {
  const section = document.getElementById('importUploadSection');
  const hint = document.getElementById('dropZoneHint');
  const ready = !!importActiveSource;
  section?.classList.toggle('disabled', !ready);
  if (hint) hint.textContent = ready ? '拖入 CSV / Excel 文件，或点击选择' : '请先选择导入来源';
  updateImportStepUI(pendingImport ? 3 : (ready ? 2 : 1));
}

function updateImportStepUI(step) {
  [1, 2, 3].forEach(n => {
    document.getElementById(`impStep${n}`)?.classList.toggle('on', n <= step);
  });
}

function refreshImportRecords() {
  if (!pendingImport) return;
  const selectedDups = (pendingImport.duplicateRecords || []).filter(r => r._dupSelected);
  pendingImport.records = [...(pendingImport.newRecords || []), ...selectedDups];
  const pending = pendingImport.records.filter(r => Categorizer.isPending(r)).length;
  const dupSel = selectedDups.length;
  document.getElementById('importStats').innerHTML = `
    <div class="import-stat"><div class="n">${pendingImport.records.length}</div><div class="l">将导入</div></div>
    <div class="import-stat"><div class="n">${pendingImport.newRecords.length}</div><div class="l">新增</div></div>
    <div class="import-stat"><div class="n">${pendingImport.dup}</div><div class="l">重复跳过</div></div>
    <div class="import-stat"><div class="n">${dupSel}</div><div class="l">重复已选</div></div>
    <div class="import-stat"><div class="n">${pending}</div><div class="l">待确认</div></div>`;
  document.getElementById('importConfirmBtn').disabled = pendingImport.records.length === 0;
  renderImportTimelineView();
  renderImportRecordTable(pendingImport.allRecords || []);
  updateImportStepUI(3);
}

function renderDuplicateReview() {
  const panel = document.getElementById('importDupPanel');
  const list = document.getElementById('importDupList');
  const dups = pendingImport?.duplicateRecords || [];
  if (!dups.length) {
    panel.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  panel.style.display = '';
  list.innerHTML = dups.map(r => {
    const peer = (r['交易对方'] || r['商品说明'] || '—').trim();
    const sign = r['收支'] === '收入' ? '+' : '-';
    const on = r._dupSelected ? ' on' : '';
    return `<label class="import-dup-row${on}">
      <input type="checkbox" ${r._dupSelected ? 'checked' : ''} onchange="toggleDupImport('${r._importUid}', this.checked)">
      <div class="import-dup-main">
        <div class="import-dup-title">${peer} · ${sign}¥${Number(r['金额'] || 0).toFixed(2)}</div>
        <div class="import-dup-meta">${r['日期']} ${r['时间'] || ''} · ${dupReasonLabel(r._dupReason)}${dupMatchMeta(r)}</div>
      </div>
    </label>`;
  }).join('');
}

function toggleDupImport(uid, checked) {
  if (!pendingImport) return;
  const row = pendingImport.duplicateRecords.find(r => r._importUid === uid);
  if (!row) return;
  row._dupSelected = !!checked;
  renderDuplicateReview();
  refreshImportRecords();
}

function toggleAllDupImport(checked) {
  if (!pendingImport?.duplicateRecords) return;
  pendingImport.duplicateRecords.forEach(r => { r._dupSelected = !!checked; });
  renderDuplicateReview();
  refreshImportRecords();
}

async function handleImportFile(file) {
  if (!file) return;
  if (!importActiveSource) {
    alert('请先选择导入来源');
    return;
  }
  try {
    const sourceName = getImportSourceName();
    const { format, records } = await Parsers.parseFile(file, sourceName, 'auto', SOURCES);
    const classified = Categorizer.classifyAll(records, CATS);
    const existingDedup = Parsers.buildDedupSet(allData);
    const fileDedup = new Set(existingDedup);
    const crossIndex = Parsers.buildCrossSourceIndex(allData);
    const newRecords = [];
    const duplicateRecords = [];
    const replaceIds = new Set();
    let dup = 0;
    let crossDup = 0;

    classified.forEach(r => {
      r._importUid = `improw_${Math.random().toString(36).slice(2, 10)}`;
      r._dupSelected = false;
      if (Parsers.isDuplicate(r, fileDedup)) {
        dup++;
        r._dupReason = Parsers.isDuplicate(r, existingDedup) ? 'existing' : 'file';
        duplicateRecords.push(r);
        return;
      }
      const crossMatch = Parsers.findCrossSourceDuplicate(r, crossIndex);
      if (crossMatch) {
        const decision = Parsers.crossSourceDedupDecision(r, crossMatch);
        if (decision === 'skip_incoming') {
          dup++;
          crossDup++;
          r._dupReason = Parsers.isBankPlatform(Parsers.sourcePlatform(r['来源']))
            && Parsers.isWalletPlatform(Parsers.sourcePlatform(crossMatch['来源']))
            ? 'cross_wallet'
            : 'cross';
          r._dupMatch = Parsers.summarizeDupMatch(crossMatch);
          duplicateRecords.push(r);
          return;
        }
        if (decision === 'replace_existing') {
          replaceIds.add(crossMatch.id);
          Parsers.removeFromCrossSourceIndex(crossIndex, crossMatch);
        }
      }
      r._hash = Parsers.txnHash(r);
      Parsers.addToDedupSet(fileDedup, r);
      Parsers.addToCrossSourceIndex(crossIndex, r);
      r.id = nextId++;
      newRecords.push(r);
    });

    const range = ImportTimeline.monthRangeFromRecords(classified);
    pendingImport = {
      records: [...newRecords],
      newRecords,
      duplicateRecords,
      allRecords: classified,
      format,
      dup,
      crossDup,
      replaceIds: [...replaceIds],
      sourceName,
      fileName: file.name,
      startMonth: range.months[0] || '',
      endMonth: range.months[range.months.length - 1] || ''
    };

    const pending = newRecords.filter(r => Categorizer.isPending(r)).length;
    const crossOnly = !newRecords.length && crossDup > 0;
    document.getElementById('importPreview').innerHTML =
      `识别格式：<strong>${Parsers.FORMAT_LABELS[format] || format}</strong><br>` +
      `来源：<strong>${sourceName}</strong><br>` +
      `时间范围：<strong>${range.months[0] ? ImportTimeline.yearMonthLabel(range.months[0]) : '—'}</strong> 至 <strong>${range.months.length ? ImportTimeline.yearMonthLabel(range.months[range.months.length - 1]) : '—'}</strong><br>` +
      `解析 ${classified.length} 笔 · 新增 ${newRecords.length} 笔 · 重复 ${dup} 笔${crossDup ? `（含跨来源 ${crossDup} 笔，银行流水优先保留微信/支付宝）` : ''}${dup ? '（可在下方勾选导入）' : ''} · 待确认 ${pending} 笔` +
      (crossOnly ? `<br><span style="color:var(--amb-t)">本次解析记录均与已有微信/支付宝账单重复。若仍希望在时间轴显示该来源覆盖，请勾选下方重复记录后确认导入。</span>` : '');

    document.getElementById('importStats').innerHTML = `
      <div class="import-stat"><div class="n">${newRecords.length}</div><div class="l">将导入</div></div>
      <div class="import-stat"><div class="n">${dup}</div><div class="l">重复跳过</div></div>
      <div class="import-stat"><div class="n">${pending}</div><div class="l">待确认</div></div>
      <div class="import-stat"><div class="n">${range.months.length}</div><div class="l">覆盖月份</div></div>`;

    renderImportTimelineView();
    renderImportRecordTable(pendingImport.allRecords);
    renderDuplicateReview();
    document.getElementById('importConfirmBtn').disabled = pendingImport.records.length === 0;
    updateImportStepUI(3);

    sw('import', document.getElementById('nav-import'));
  } catch (err) {
    document.getElementById('importPreview').innerHTML = `<span style="color:var(--red-t)">解析失败：${err.message}</span>`;
    document.getElementById('importStats').innerHTML = '';
    document.getElementById('importConfirmBtn').disabled = true;
    pendingImport = null;
    renderImportTimelineView();
    document.getElementById('importRecordPreview').style.display = 'none';
    document.getElementById('importDupPanel').style.display = 'none';
  }
}

function confirmImport() {
  if (!pendingImport) return;
  refreshImportRecords();
  if (!pendingImport.records.length) {
    alert('没有可导入的记录');
    return;
  }

  pendingImport.records.forEach(r => {
    if (!r.id) {
      r.id = nextId++;
      r._hash = Parsers.txnHash(r);
    }
    if (r._dupReason === 'cross' && r._dupMatch) {
      r._dupSuspect = r._dupMatch.id;
      const tag = `疑似重复(${r._dupMatch['来源']} ${r._dupMatch['日期']} ${formatTimeShort(r._dupMatch['时间'])})`;
      if (!String(r['备注'] || '').includes('疑似重复')) {
        r['备注'] = r['备注'] ? `${r['备注']} · ${tag}` : tag;
      }
    }
  });

  if (pendingImport.replaceIds?.length) {
    const remove = new Set(pendingImport.replaceIds);
    allData = allData.filter(r => !remove.has(r.id));
  }

  const batchId = createBatchId();
  const importedAt = new Date().toISOString();
  stampImportBatch(pendingImport.records, {
    batchId,
    fileName: pendingImport.fileName,
    format: pendingImport.format,
    importedAt,
    fileStartMonth: pendingImport.startMonth,
    fileEndMonth: pendingImport.endMonth
  });

  allData.push(...pendingImport.records);
  allData.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));

  const count = pendingImport.records.length;
  resetImportPreview();
  persist();
  buildSrcChips();
  applyF();
  renderKPI();
  renderMonitor();
  renderImportHistoryUI();
  alert(`成功导入 ${count} 笔记录`);
}

async function deleteImportBatch(encodedId) {
  const batchId = decodeURIComponent(encodedId);
  const entry = importHistory.find(h => String(h.id) === String(batchId));
  if (!entry) return;

  const toDelete = batchRecords(allData, entry);
  if (!confirm(deleteConfirmMessage(entry, toDelete))) return;

  try {
    const res = await deleteImportBatchApi(batchId);
    if (res?.stateVersion != null) stateVersion = res.stateVersion;
    await loadData();
    renderImportTimelineView();
  } catch (err) {
    alert('删除失败：' + (err.message || '请刷新后重试'));
  }
}

let editingBatchId = null;

function openBatchSrc(encodedId) {
  const batchId = decodeURIComponent(encodedId);
  const entry = importHistory.find(h => String(h.id) === String(batchId));
  if (!entry) return;

  editingBatchId = batchId;
  const fileEl = document.getElementById('batchSrcFile');
  const curEl = document.getElementById('batchSrcCurrent');
  const sel = document.getElementById('batchSrcSel');
  if (!fileEl || !curEl || !sel) return;

  fileEl.textContent = entry.fileName || '未命名文件';
  curEl.textContent = entry.source || '—';
  sel.innerHTML = SOURCES.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  const alt = SOURCES.find(s => s.name !== entry.source);
  sel.value = alt?.name || SOURCES[0]?.name || '';

  document.getElementById('moBatchSrc')?.classList.remove('hide');
}

function closeBatchSrc() {
  editingBatchId = null;
  document.getElementById('moBatchSrc')?.classList.add('hide');
}

async function saveBatchSrc() {
  const newSource = document.getElementById('batchSrcSel')?.value?.trim();
  if (!editingBatchId || !newSource) return;

  const entry = importHistory.find(h => String(h.id) === String(editingBatchId));
  if (!entry) return;
  if (entry.source === newSource) {
    closeBatchSrc();
    return;
  }

  const count = entry.count || batchRecords(allData, entry).length;
  const fname = entry.fileName || '未命名文件';
  if (!confirm(`将「${fname}」的 ${count} 笔账目来源改为「${newSource}」？`)) return;

  try {
    const res = await changeImportBatchSourceApi(editingBatchId, newSource);
    if (res?.stateVersion != null) stateVersion = res.stateVersion;
    closeBatchSrc();
    await loadData();
    renderImportTimelineView();
  } catch (err) {
    alert('修改失败：' + (err.message || '请刷新后重试'));
  }
}

async function resetAllLedger() {
  const n = allData.length;
  const files = importHistory.length;
  const msg =
    `将永久删除全部 ${n} 笔账目和 ${files} 条导入记录。\n\n` +
    '分类、来源、规则、装备库等设置会保留。\n\n' +
    '此操作不可撤销。请输入「清空」以确认：';
  const input = prompt(msg);
  if (input !== '清空') return;

  try {
    const res = await resetLedger();
    if (res?.stateVersion != null) stateVersion = res.stateVersion;
    allData = [];
    importHistory = [];
    refunded = new Set();
    excluded = new Set();
    nextId = 1;
    pendingImport = null;
    resetImportPreview();
    buildSrcChips();
    applyF();
    renderKPI();
    renderMonitor();
    renderImportPage();
    updateBackendFooter(0);
    alert('已清空全部账目，请重新导入账单文件。');
  } catch (err) {
    alert('清空失败：' + err.message);
  }
}

function setupImportHistoryActions() {
  ['importHistoryMain'].forEach(cid => {
    const el = document.getElementById(cid);
    if (!el || el._ihBound) return;
    el._ihBound = true;
    el.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit-batch]');
      if (editBtn) {
        openBatchSrc(editBtn.getAttribute('data-edit-batch'));
        return;
      }
      const delBtn = e.target.closest('[data-del-batch]');
      if (delBtn) deleteImportBatch(delBtn.getAttribute('data-del-batch'));
    });
  });
}

function setupDropZone() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('importBillFile');
  if (!zone || !input || zone._bound) return;
  zone._bound = true;
  zone.addEventListener('click', () => {
    if (!importActiveSource) { alert('请先选择导入来源'); return; }
    input.click();
  });
  zone.addEventListener('dragover', e => {
    if (!importActiveSource) return;
    e.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (!importActiveSource) { alert('请先选择导入来源'); return; }
    if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files[0]) handleImportFile(e.target.files[0]);
    e.target.value = '';
  });
}

// ── 手动新增 / 来源 / 分类 ───────────────────────────────────────────────────
let editRowId = null;

const ADD_TITLE_HTML = '<i class="ti ti-plus" style="color:var(--primary);margin-right:6px"></i>手动新增';
const EDIT_TITLE_HTML = '<i class="ti ti-edit" style="color:var(--primary);margin-right:6px"></i>编辑账目';

function setAddModalMode(edit) {
  const h3 = document.querySelector('#moAdd .mh h3');
  if (h3) h3.innerHTML = edit ? EDIT_TITLE_HTML : ADD_TITLE_HTML;
}

function fillAddForm(row) {
  document.getElementById('f-src').innerHTML = SOURCES.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  buildCatFilter();
  document.getElementById('f-date').value = row['日期'] || '';
  document.getElementById('f-time').value = row['时间'] || '12:00';
  document.getElementById('f-src').value = row['来源'] || '';
  document.getElementById('f-type').value = row['收支'] || '支出';
  document.getElementById('f-amt').value = row['金额'] ?? '';
  document.getElementById('f-cat').value = row['分类'] || '';
  syncAddSubcats();
  document.getElementById('f-sub').value = row['子分类'] || '';
  document.getElementById('f-peer').value = row['交易对方'] || '';
  document.getElementById('f-pay').value = row['支付方式'] || '';
  document.getElementById('f-desc').value = row['商品说明'] || '';
  document.getElementById('f-note').value = row['备注'] || '';
}

function openAdd() {
  editRowId = null;
  setAddModalMode(false);
  fillAddForm({
    日期: new Date().toISOString().slice(0, 10),
    时间: '12:00',
    收支: '支出',
    分类: CATS[0] || ''
  });
  document.getElementById('f-amt').value = '';
  document.getElementById('f-peer').value = '';
  document.getElementById('f-pay').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('moAdd').classList.remove('hide');
}

function openEditRow(id) {
  const row = allData.find(r => r.id === id);
  if (!row) return;
  editRowId = id;
  setAddModalMode(true);
  fillAddForm(row);
  document.getElementById('moAdd').classList.remove('hide');
}

function editRenqingRow(id) {
  const row = allData.find(r => r.id === id);
  if (row && hasSplits(row)) openSplitEditor(id);
  else openEditRow(id);
}

function closeAdd() {
  editRowId = null;
  setAddModalMode(false);
  document.getElementById('moAdd').classList.add('hide');
}
function syncAddSubcats() {
  const cat = document.getElementById('f-cat').value;
  const sel = document.getElementById('f-sub');
  const subs = subcatsFor(cat);
  sel.innerHTML = '<option value="">无</option>' + subs.map(s => `<option value="${s}">${s}</option>`).join('');
  sel.disabled = !subs.length;
}
function saveAdd() {
  const dt = document.getElementById('f-date').value;
  const tm = document.getElementById('f-time').value || '00:00';
  const src = document.getElementById('f-src').value;
  const tp = document.getElementById('f-type').value;
  const amt = parseFloat(document.getElementById('f-amt').value);
  const cat = document.getElementById('f-cat').value;
  const sub = document.getElementById('f-sub').value || '';
  const peer = document.getElementById('f-peer').value.trim() || '手动录入';
  const pay = document.getElementById('f-pay').value.trim() || '';
  const desc = document.getElementById('f-desc').value.trim() || '手动录入';
  const note = document.getElementById('f-note').value.trim() || '';
  if (!dt || !src || !tp || isNaN(amt) || amt <= 0 || !cat) { alert('请填写必填项'); return; }
  if (editRowId != null) {
    const row = allData.find(r => r.id === editRowId);
    if (!row) { closeAdd(); return; }
    Object.assign(row, {
      日期: dt, 时间: tm, 来源: src, 交易对方: peer, 商品说明: desc,
      分类: cat, 子分类: sub, 收支: tp, 金额: amt, 支付方式: pay, 备注: note
    });
    row._hash = Parsers.txnHash(row);
  } else {
    const row = { id: nextId++, 日期: dt, 时间: tm, 来源: src, 交易对方: peer, 商品说明: desc, 分类: cat, 子分类: sub, 收支: tp, 金额: amt, 支付方式: pay, 备注: note, 退款状态: 'normal', 统计状态: 'normal', _autoCat: false, _catConf: 'manual', _hash: '' };
    row._hash = Parsers.txnHash(row);
    allData.push(row);
  }
  allData.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  persist();
  buildSrcChips();
  applyF();
  renderKPI();
  refreshActiveViews();
  closeAdd();
}

function openSrc() { renderSrcList(); document.getElementById('moSrc').classList.remove('hide'); }
function closeSrc() { document.getElementById('moSrc').classList.add('hide'); }
function renderSrcList() {
  document.getElementById('srcList').innerHTML = SOURCES.map((s, i) => `
    <div class="src-row">${srcMarkHtml(s.name, { size: 32, fallbackColor: s.color })}
    <input class="sni" value="${s.name}" data-i="${i}"></div>`).join('');
}
function addSrc() {
  const n = document.getElementById('ns-name').value.trim();
  if (!n) return;
  SOURCES.push({ name: n, color: document.getElementById('ns-color').value });
  document.getElementById('ns-name').value = '';
  renderSrcList();
}
function delSrc(i) { if (SOURCES.length <= 1) { alert('至少保留一个来源'); return; } SOURCES.splice(i, 1); renderSrcList(); }
function saveSrc() {
  document.querySelectorAll('.sni').forEach(inp => { SOURCES[inp.dataset.i].name = inp.value.trim(); });
  persist();
  buildSrcChips();
  closeSrc();
}

function catIconValue(cat) {
  return resolveCatIconValue(cat, EMOJIS[cat], {
    iconMap: DEFAULT_EMOJIS,
    legacyMap: LEGACY_DEFAULT_EMOJIS,
    nameAliases: CAT_ICON_NAME_ALIASES,
  });
}

function pruneCategoryMeta() {
  const active = new Set(CATS);
  for (const key of Object.keys(SUBCATS)) {
    if (!active.has(key)) delete SUBCATS[key];
  }
  for (const key of Object.keys(EMOJIS)) {
    if (!active.has(key)) delete EMOJIS[key];
  }
  CAT_STATS_EXCLUDE = new Set([...CAT_STATS_EXCLUDE].filter(c => active.has(c)));
  OFFSET_CATS_SET = new Set([...OFFSET_CATS_SET].filter(c => active.has(c)));
  INCOME_CATS_SET = new Set([...INCOME_CATS_SET].filter(c => active.has(c)));
  INCOME_DATA_CATS_LIST = INCOME_DATA_CATS_LIST.filter(c => active.has(c) && isIncomeCategory(c));
  for (const key of [...catSubExpanded]) {
    if (!active.has(key)) catSubExpanded.delete(key);
  }
}

function applyLoadedCategories(categories) {
  CATS = [...(categories.cats || [])];
  EMOJIS = {};
  for (const cat of CATS) {
    EMOJIS[cat] = DEFAULT_EMOJIS[cat] || iconRef('1F4CC');
  }
  if (categories.emojis) {
    for (const [cat, val] of Object.entries(categories.emojis)) {
      if (!CATS.includes(cat)) continue;
      EMOJIS[cat] = val;
    }
  }
  SUBCATS = { ...(categories.subcats || {}) };
  for (const cat of CATS) {
    if (!SUBCATS[cat]?.length && DEFAULT_SUBCATS[cat]?.length) {
      SUBCATS[cat] = [...DEFAULT_SUBCATS[cat]];
    }
  }
  if (CATS.includes('母婴亲子')) {
    const babySubs = SUBCATS['母婴亲子'] || [];
    if (babySubs.length && !babySubs.includes('母婴装备')) {
      SUBCATS['母婴亲子'] = [...babySubs, '母婴装备'];
    }
  }
  if (Array.isArray(categories.statsExclude)) {
    CAT_STATS_EXCLUDE = new Set(categories.statsExclude.filter(c => CATS.includes(c)));
  } else {
    CAT_STATS_EXCLUDE = new Set(DEFAULT_CAT_STATS_EXCLUDE.filter(c => CATS.includes(c)));
  }
  if (Array.isArray(categories.offsetCats)) {
    OFFSET_CATS_SET = new Set(categories.offsetCats.filter(c => CATS.includes(c)));
  } else {
    OFFSET_CATS_SET = new Set(DEFAULT_OFFSET_CATS.filter(c => CATS.includes(c)));
  }
  if (Array.isArray(categories.incomeCats) && categories.incomeCats.length) {
    INCOME_CATS_SET = new Set(categories.incomeCats.filter(c => CATS.includes(c)));
  } else {
    const named = CATS.filter(c => c.includes('收入'));
    INCOME_CATS_SET = new Set([...DEFAULT_INCOME_CATS, ...named].filter(c => CATS.includes(c)));
  }
  if (Array.isArray(categories.incomeDataCats) && categories.incomeDataCats.length) {
    INCOME_DATA_CATS_LIST = categories.incomeDataCats.filter(c => CATS.includes(c));
  } else {
    INCOME_DATA_CATS_LIST = DEFAULT_INCOME_DATA_CATS.filter(c => CATS.includes(c));
  }
  INCOME_DATA_CATS_LIST = INCOME_DATA_CATS_LIST.filter(c => INCOME_CATS_SET.has(c));
  pruneCategoryMeta();
}

function migrateCatEmojisToIcons() {
  let changed = false;
  for (const cat of CATS) {
    const stored = EMOJIS[cat];
    if (!stored || isIconRef(stored) || isIconifyRef(stored)) continue;
    const legacy = LEGACY_DEFAULT_EMOJIS[cat];
    if (!legacy || stored !== legacy) continue;
    const resolved = resolveCatIconValue(cat, stored, {
      iconMap: DEFAULT_EMOJIS,
      legacyMap: LEGACY_DEFAULT_EMOJIS,
      nameAliases: CAT_ICON_NAME_ALIASES,
    });
    if (EMOJIS[cat] !== resolved) {
      EMOJIS[cat] = resolved;
      changed = true;
    }
  }
  return changed;
}

function catIconHtml(cat, opts = {}) {
  const value = opts.value ?? catIconValue(cat);
  return renderCatIcon(value, { size: opts.size, wrapClass: opts.wrapClass, class: opts.class });
}

function setCatIconBtn(btn, value) {
  const v = normalizeIconRef(value) || value || iconRef('1F4CC');
  btn.dataset.emoji = v;
  btn.innerHTML = renderCatIcon(v, { size: 22 });
}

function readCatEmojiFromBtn(btn) {
  if (!btn) return '';
  return (btn.getAttribute('data-emoji') ?? btn.dataset.emoji ?? '').trim();
}

function openCat() { renderCatList(); document.getElementById('moCat').classList.remove('hide'); }
function closeCat() { document.getElementById('moCat').classList.add('hide'); closeEmojiPicker(); }

function pickCatEmoji(ev, i) {
  ev.stopPropagation();
  const btn = ev.currentTarget;
  openEmojiPicker(btn, btn.dataset.emoji || catIconValue(CATS[i]), em => setCatIconBtn(btn, em));
}

function pickNewCatEmoji(ev) {
  ev.stopPropagation();
  const btn = ev.currentTarget;
  openEmojiPicker(btn, btn.dataset.emoji || iconRef('1F4CC'), em => setCatIconBtn(btn, em));
}

const catSubExpanded = new Set();
let catListDragFromIdx = null;
let catListDragBound = false;

function collectCatListFromDom() {
  return [...document.querySelectorAll('#catList .cat-edit-item')].map(item => {
    const origIdx = parseInt(item.dataset.i, 10);
    const oldName = CATS[origIdx];
    const emojiBtn = item.querySelector('.cat-emoji-btn');
    const pickedEmoji = readCatEmojiFromBtn(emojiBtn);
    return {
      origIdx,
      oldName,
      name: item.querySelector('.ni2')?.value.trim() || oldName,
      emoji: pickedEmoji || catIconValue(oldName),
      statsExclude: !!item.querySelector('.cat-stats-exclude-cb')?.checked,
      income: !!item.querySelector('.cat-income-cb')?.checked,
      offset: !!item.querySelector('.cat-offset-cb')?.checked,
      subsRaw: item.querySelector('.subcat-inp')?.value || '',
    };
  });
}

function moveCatEditDom(fromIdx, toIdx) {
  const list = document.getElementById('catList');
  if (!list || fromIdx === toIdx) return;
  const items = [...list.querySelectorAll('.cat-edit-item')];
  const fromEl = items.find(el => parseInt(el.dataset.i, 10) === fromIdx);
  const toEl = items.find(el => parseInt(el.dataset.i, 10) === toIdx);
  if (!fromEl || !toEl) return;
  const fromPos = items.indexOf(fromEl);
  const toPos = items.indexOf(toEl);
  if (fromPos < toPos) toEl.after(fromEl);
  else list.insertBefore(fromEl, toEl);
}

function ensureCatListDrag() {
  if (catListDragBound) return;
  const list = document.getElementById('catList');
  if (!list) return;
  catListDragBound = true;

  list.addEventListener('dragstart', e => {
    const handle = e.target.closest('.cat-drag-handle');
    if (!handle) return;
    const item = handle.closest('.cat-edit-item');
    if (!item) return;
    catListDragFromIdx = parseInt(item.dataset.i, 10);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(catListDragFromIdx));
    item.classList.add('is-dragging');
  });

  list.addEventListener('dragend', e => {
    const item = e.target.closest('.cat-edit-item');
    item?.classList.remove('is-dragging');
    catListDragFromIdx = null;
    list.querySelectorAll('.cat-edit-item').forEach(el => el.classList.remove('drag-over'));
  });

  list.addEventListener('dragover', e => {
    if (catListDragFromIdx == null) return;
    const item = e.target.closest('.cat-edit-item');
    if (!item) return;
    e.preventDefault();
    list.querySelectorAll('.cat-edit-item').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });

  list.addEventListener('dragleave', e => {
    const item = e.target.closest('.cat-edit-item');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('drag-over');
  });

  list.addEventListener('drop', e => {
    if (catListDragFromIdx == null) return;
    const item = e.target.closest('.cat-edit-item');
    if (!item) return;
    e.preventDefault();
    const toIdx = parseInt(item.dataset.i, 10);
    list.querySelectorAll('.cat-edit-item').forEach(el => el.classList.remove('drag-over'));
    if (toIdx !== catListDragFromIdx) moveCatEditDom(catListDragFromIdx, toIdx);
    catListDragFromIdx = null;
  });
}

function toggleCatSub(i) {
  const c = CATS[i];
  if (!c) return;
  if (catSubExpanded.has(c)) catSubExpanded.delete(c);
  else catSubExpanded.add(c);
  const item = document.querySelector(`.cat-edit-item[data-i="${i}"]`);
  if (!item) return;
  item.querySelector('.cat-sub-panel')?.classList.toggle('open', catSubExpanded.has(c));
  item.querySelector('.cat-sub-toggle')?.classList.toggle('open', catSubExpanded.has(c));
}

function renderCatList() {
  document.getElementById('catList').innerHTML = CATS.map((c, i) => {
    const subs = SUBCATS[c] || [];
    const open = catSubExpanded.has(c);
    const em = EMOJIS[c] || catIconValue(c);
    return `<div class="cat-edit-item" data-i="${i}">
      <div class="cr">
        <button type="button" class="cat-drag-handle" draggable="true" title="拖动排序" aria-label="拖动排序"><i class="ti ti-grip-vertical"></i></button>
        <button type="button" class="cat-sub-toggle${open ? ' open' : ''}" title="子分类${subs.length ? `（${subs.length}）` : ''}" onclick="toggleCatSub(${i})"><i class="ti ti-chevron-right"></i></button>
        <button type="button" class="cat-emoji-btn" data-i="${i}" data-emoji="${em}" title="设置图标" onclick="pickCatEmoji(event,${i})">${catIconHtml(c, { size: 22, value: em })}</button>
        <input class="ni2" value="${c}" data-i="${i}">
        <label class="cat-stats-exclude" title="不计入首页总收支、图表等统计">
          <input type="checkbox" class="cat-stats-exclude-cb" data-i="${i}"${CAT_STATS_EXCLUDE.has(c) ? ' checked' : ''}>
          <span>不计入统计</span>
        </label>
        <label class="cat-income-type" title="勾选后出现在首页收入分类卡片、收入数据页可选监视">
          <input type="checkbox" class="cat-income-cb" data-i="${i}"${INCOME_CATS_SET.has(c) ? ' checked' : ''}>
          <span>收入类</span>
        </label>
        <label class="cat-offset-type" title="统计时该分类收支相抵，只计净收入/净支出">
          <input type="checkbox" class="cat-offset-cb" data-i="${i}"${OFFSET_CATS_SET.has(c) ? ' checked' : ''}>
          <span>对冲</span>
        </label>
        <button class="db" onclick="delCat(${i})">✕</button>
      </div>
      <div class="cat-sub-panel${open ? ' open' : ''}">
        <input class="subcat-inp" data-i="${i}" placeholder="子分类（逗号分隔，如：地铁, 停车）" value="${subs.join(', ')}">
      </div>
    </div>`;
  }).join('');
  ensureCatListDrag();
}
function delCat(i) {
  const c = CATS[i];
  const inUse = allData.some(r => r['分类'] === c || (hasSplits(r) && r.splits.some(sp => sp.category === c)));
  if (inUse) { alert(`"${c}" 还有记录在使用`); return; }
  CATS.splice(i, 1);
  delete EMOJIS[c];
  delete SUBCATS[c];
  CAT_STATS_EXCLUDE.delete(c);
  OFFSET_CATS_SET.delete(c);
  INCOME_CATS_SET.delete(c);
  INCOME_DATA_CATS_LIST = INCOME_DATA_CATS_LIST.filter(x => x !== c);
  catSubExpanded.delete(c);
  renderCatList();
}
function addCat() {
  const n = document.getElementById('nn').value.trim();
  if (!n || CATS.includes(n)) { alert(n ? '已存在' : '请输入名称'); return; }
  const emBtn = document.getElementById('nnEmoji');
  const em = normalizeIconRef(readCatEmojiFromBtn(emBtn)) || readCatEmojiFromBtn(emBtn) || iconRef('1F4CC');
  CATS.push(n);
  EMOJIS[n] = em;
  SUBCATS[n] = [];
  document.getElementById('nn').value = '';
  if (emBtn) setCatIconBtn(emBtn, iconRef('1F4CC'));
  renderCatList();
}
function renameCategoryInTransactions(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  let count = 0;
  allData.forEach(r => {
    let touched = false;
    if (r['分类'] === oldName) {
      r['分类'] = newName;
      touched = true;
    }
    if (hasSplits(r)) {
      r.splits.forEach(sp => {
        if (sp.category === oldName) {
          sp.category = newName;
          touched = true;
        }
      });
    }
    if (touched) count++;
  });
  Categorizer.renameCategory(oldName, newName);
  return count;
}
function saveCat() {
  const rows = collectCatListFromDom();
  if (!rows.length) return;

  const names = rows.map(r => r.name).filter(Boolean);
  if (names.length !== rows.length) {
    alert('分类名称不能为空');
    return;
  }
  if (new Set(names).size !== names.length) {
    alert('分类名称不能重复');
    return;
  }

  const modal = document.getElementById('moCat');
  const saveBtn = modal?.querySelector('.mf .btn-p');
  const prevLabel = saveBtn?.textContent || '保存';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
  }

  const finishSaveUi = () => {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = prevLabel;
    }
  };

  for (const row of rows) {
    if (row.name === row.oldName) continue;
    renameCategoryInTransactions(row.oldName, row.name);
    EMOJIS[row.name] = normalizeIconRef(row.emoji) || row.emoji || EMOJIS[row.oldName] || iconRef('1F4CC');
    delete EMOJIS[row.oldName];
    if (SUBCATS[row.oldName]) {
      SUBCATS[row.name] = SUBCATS[row.oldName];
      delete SUBCATS[row.oldName];
    }
    if (catSubExpanded.has(row.oldName)) {
      catSubExpanded.delete(row.oldName);
      catSubExpanded.add(row.name);
    }
    if (CAT_STATS_EXCLUDE.has(row.oldName)) {
      CAT_STATS_EXCLUDE.delete(row.oldName);
      CAT_STATS_EXCLUDE.add(row.name);
    }
    if (OFFSET_CATS_SET.has(row.oldName)) {
      OFFSET_CATS_SET.delete(row.oldName);
      OFFSET_CATS_SET.add(row.name);
    }
    if (INCOME_CATS_SET.has(row.oldName)) {
      INCOME_CATS_SET.delete(row.oldName);
      INCOME_CATS_SET.add(row.name);
    }
    const incIdx = INCOME_DATA_CATS_LIST.indexOf(row.oldName);
    if (incIdx >= 0) INCOME_DATA_CATS_LIST[incIdx] = row.name;
  }

  const nextCats = [];
  const nextExclude = new Set();
  const nextIncome = new Set();
  const nextOffset = new Set();

  for (const row of rows) {
    nextCats.push(row.name);
    const icon = normalizeIconRef(row.emoji) || row.emoji || EMOJIS[row.name] || iconRef('1F4CC');
    EMOJIS[row.name] = icon;
    const subs = row.subsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (subs.length) SUBCATS[row.name] = subs;
    else delete SUBCATS[row.name];
    allData.filter(r => r['分类'] === row.name && r['子分类'] && !subs.includes(r['子分类']))
      .forEach(r => r['子分类'] = '');
    if (row.statsExclude) nextExclude.add(row.name);
    if (row.income) nextIncome.add(row.name);
    if (row.offset) nextOffset.add(row.name);
  }

  CATS = nextCats;
  CAT_STATS_EXCLUDE = nextExclude;
  INCOME_CATS_SET = nextIncome;
  OFFSET_CATS_SET = nextOffset;
  INCOME_DATA_CATS_LIST = INCOME_DATA_CATS_LIST.filter(c => INCOME_CATS_SET.has(c));
  pruneCategoryMeta();

  persistNow().then(ok => {
    finishSaveUi();
    if (!ok) return;
    buildCatFilter();
    applyF();
    renderKPI();
    renderMonitor();
    closeCat();
    refreshActiveViews();
    flash();
  }).catch(err => {
    finishSaveUi();
    alert('保存失败：' + (err?.message || err));
  });
}

// ── 批量选择 ─────────────────────────────────────────────────────────────────
let selectedIds = new Set();
let pendingTxnLinkKeys = null;
let pendingTxnMergeKeys = null;

function computeSelectedStats() {
  const rows = [...selectedIds].map(id => allData.find(r => r.id === id)).filter(Boolean);
  let exp = 0;
  let inc = 0;
  rows.forEach(r => {
    const amt = Number(r['金额']) || 0;
    if (r['收支'] === '收入') inc += amt;
    else exp += amt;
  });
  return { count: rows.length, exp, inc, net: inc - exp };
}

function toggleSelect(id, cb) {
  if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
  updateBulkBar();
  const row = document.querySelector(`[data-id="${id}"]`);
  if (row) row.classList.toggle('selected', cb.checked);
}

function toggleSelectAll(masterCb) {
  const visibleIds = filteredData.slice((curPage - 1) * PG, curPage * PG).map(r => r.id);
  if (masterCb.checked) visibleIds.forEach(id => selectedIds.add(id));
  else visibleIds.forEach(id => selectedIds.delete(id));
  renderTable();
  updateBulkBar();
}

function clearSelection() {
  selectedIds.clear();
  renderTable();
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.classList.add('show');
    const stats = computeSelectedStats();
    document.getElementById('bulkCnt').textContent = `${stats.count} 项已选`;
    const statsEl = document.getElementById('bulkStats');
    if (statsEl) {
      const parts = [`支出 ${fmtMoney(stats.exp)}`, `收入 ${fmtMoney(stats.inc)}`];
      if (stats.exp || stats.inc) parts.push(`净额 ${fmtMoneySigned(stats.net)}`);
      statsEl.textContent = parts.join(' · ');
    }
    const rows = [...selectedIds].map(id => allData.find(r => r.id === id)).filter(Boolean);
    const cats = new Set(rows.map(r => r['分类']));
    const sameCat = cats.size === 1 ? [...cats][0] : null;

    const catSel = document.getElementById('bulkCatSel');
    catSel.innerHTML = CATS.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('');
    if (sameCat) catSel.value = sameCat;

    const subSel = document.getElementById('bulkSubCatSel');
    const subBtn = document.getElementById('bulkSubCatBtn');
    const subs = sameCat ? subcatsFor(sameCat) : [];
    if (sameCat && subs.length) {
      subSel.disabled = false;
      subBtn.disabled = false;
      subSel.title = '';
      subSel.innerHTML = ['<option value="">无</option>', ...subs.map(s =>
        `<option value="${s}">${s}</option>`
      )].join('');
      const selectedSubs = new Set(rows.map(r => r['子分类'] || ''));
      subSel.value = selectedSubs.size === 1 ? [...selectedSubs][0] : '';
    } else {
      subSel.disabled = true;
      subBtn.disabled = true;
      subSel.title = sameCat ? '该分类暂无子分类' : '选中项需属于同一分类';
      subSel.innerHTML = `<option value="">${sameCat ? '该分类无子分类' : '需同一分类'}</option>`;
    }

    const linkBtn = document.getElementById('bulkLinkBtn');
    const unlinkBtn = document.getElementById('bulkUnlinkBtn');
    if (linkBtn) linkBtn.disabled = selectedIds.size < 2;
    if (unlinkBtn) {
      const linkIds = new Set();
      [...selectedIds].forEach(id => {
        const link = findLinkForKey(String(id));
        if (link) linkIds.add(link.id);
      });
      unlinkBtn.disabled = linkIds.size !== 1;
    }
    const mergeBtn = document.getElementById('bulkMergeBtn');
    const unmergeBtn = document.getElementById('bulkUnmergeBtn');
    const mergeIds = new Set();
    [...selectedIds].forEach(id => {
      const merge = findMergeForKey(String(id));
      if (merge) mergeIds.add(merge.id);
    });
    if (mergeBtn) mergeBtn.disabled = selectedIds.size < 2 || mergeIds.size > 0;
    if (unmergeBtn) unmergeBtn.disabled = mergeIds.size !== 1;
  } else {
    bar.classList.remove('show');
    const statsEl = document.getElementById('bulkStats');
    if (statsEl) statsEl.textContent = '';
  }
}

function applyBulkCat() {
  const newCat = document.getElementById('bulkCatSel').value;
  selectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (!row) return;
    row['分类'] = newCat;
    const subs = subcatsFor(newCat);
    if (row['子分类'] && !subs.includes(row['子分类'])) row['子分类'] = '';
    row._autoCat = false;
    row._catConf = 'manual';
    Categorizer.learn(row['交易对方'], newCat, row['商品说明']);
  });
  persist();
  renderKPI();
  renderMonitor();
  applyF();
  updateBulkBar();
}

function applyBulkSubCat() {
  const subSel = document.getElementById('bulkSubCatSel');
  if (!subSel || subSel.disabled) return;
  const newSub = subSel.value;
  selectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (row) row['子分类'] = newSub;
  });
  persist();
  clearSelection();
  applyF();
}

function bulkToggleRefund(markAsRefund) {
  selectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (!row) return;
    row['退款状态'] = markAsRefund ? 'refunded' : 'normal';
    if (markAsRefund) refunded.add(id); else refunded.delete(id);
  });
  persist();
  renderKPI();
  renderRfView();
  clearSelection();
  applyF();
}

function linkLedgerGroup() {
  const keys = [...selectedIds].map(id => String(id));
  if (keys.length < 2) {
    alert('请至少选择 2 笔账目进行关联');
    return;
  }
  const rows = keys.map(id => allData.find(r => r.id === Number(id))).filter(Boolean);
  const err = validateTxnLink(keys, rows);
  if (err) {
    alert(err);
    return;
  }
  pendingTxnLinkKeys = keys;
  const inp = document.getElementById('txnLinkNameInp');
  const modal = document.getElementById('moTxnLink');
  if (!inp || !modal) return;
  inp.value = suggestTxnLinkName(rows);
  modal.classList.remove('hide');
  inp.focus();
  inp.select();
}

function closeTxnLinkModal() {
  pendingTxnLinkKeys = null;
  document.getElementById('moTxnLink')?.classList.add('hide');
}

function confirmTxnLinkModal() {
  const keys = pendingTxnLinkKeys;
  if (!keys?.length) {
    closeTxnLinkModal();
    return;
  }
  const trimmed = document.getElementById('txnLinkNameInp')?.value?.trim() || '';
  if (!trimmed) {
    alert('关联名称不能为空');
    document.getElementById('txnLinkNameInp')?.focus();
    return;
  }
  try {
    addTxnLink(trimmed, keys);
  } catch (e) {
    alert(e.message || '关联失败');
    return;
  }
  closeTxnLinkModal();
  persist();
  clearSelection();
  applyF();
  renderTradesPage();
}

function unlinkLedgerGroup() {
  const keys = [...selectedIds].map(id => String(id));
  if (!keys.length) return;
  const linkIds = new Set();
  keys.forEach(k => {
    const link = findLinkForKey(k);
    if (link) linkIds.add(link.id);
  });
  if (linkIds.size !== 1) {
    alert('请选择属于同一关联的账目，或选择单条已关联账目');
    return;
  }
  const linkId = [...linkIds][0];
  const link = findLinkById(linkId);
  if (!confirm(`确定取消关联「${link?.name || ''}」？`)) return;
  removeTxnLinkById(linkId);
  if (activeTxnLinkId === linkId) activeTxnLinkId = null;
  if (activeTradeLinkId === linkId) activeTradeLinkId = null;
  persist();
  clearSelection();
  applyF();
  renderTradesPage();
}

function majorityValue(rows, field) {
  const counts = new Map();
  rows.forEach(r => {
    const v = String(r[field] || '').trim();
    if (!v) return;
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  let best = '';
  let n = 0;
  counts.forEach((c, v) => {
    if (c > n) { best = v; n = c; }
  });
  return best;
}

function fillTxnMergeSubSel(cat, preferred) {
  const subSel = document.getElementById('txnMergeSubSel');
  if (!subSel) return;
  const subs = subcatsFor(cat);
  if (!subs.length) {
    subSel.innerHTML = '<option value="">无</option>';
    subSel.disabled = true;
    return;
  }
  subSel.disabled = false;
  subSel.innerHTML = ['<option value="">无</option>', ...subs.map(s =>
    `<option value="${escHtml(s)}">${escHtml(s)}</option>`
  )].join('');
  subSel.value = preferred && subs.includes(preferred) ? preferred : '';
}

function openTxnMergeModal() {
  const keys = [...selectedIds].map(id => String(id));
  if (keys.length < 2) {
    alert('请至少选择 2 笔账目进行合并统计');
    return;
  }
  const rows = keys.map(id => allData.find(r => r.id === Number(id))).filter(Boolean);
  const err = validateTxnMerge(keys, rows);
  if (err) {
    alert(err);
    return;
  }
  pendingTxnMergeKeys = keys;
  const stats = computeMergeNet(rows);
  const preview = document.getElementById('txnMergePreview');
  if (preview) {
    const netKind = stats.net < -0.009 ? '支出' : stats.net > 0.009 ? '收入' : '相抵';
    preview.innerHTML = `
      <div>支出 ${fmtMoney(stats.exp)} · 收入 ${fmtMoney(stats.inc)}</div>
      <div class="txn-merge-preview-net">统计净额 ${fmtMoneySigned(stats.net)}（${netKind} ${fmtMoney(stats.abs)}）</div>`;
  }
  const expRows = rows.filter(r => r['收支'] === '支出');
  const catGuess = majorityValue(expRows.length ? expRows : rows, '分类') || CATS[0] || '';
  const catSel = document.getElementById('txnMergeCatSel');
  if (catSel) {
    catSel.innerHTML = CATS.map(c => `<option value="${escHtml(c)}">${escHtml(catLabel(c))}</option>`).join('');
    catSel.value = CATS.includes(catGuess) ? catGuess : (CATS[0] || '');
  }
  const sameCatRows = rows.filter(r => r['分类'] === (catSel?.value || catGuess));
  fillTxnMergeSubSel(catSel?.value || catGuess, majorityValue(sameCatRows, '子分类'));
  document.getElementById('moTxnMerge')?.classList.remove('hide');
}

function onTxnMergeCatChange() {
  const cat = document.getElementById('txnMergeCatSel')?.value || '';
  const keys = pendingTxnMergeKeys || [];
  const rows = keys.map(id => allData.find(r => r.id === Number(id))).filter(Boolean);
  const sameCatRows = rows.filter(r => r['分类'] === cat);
  fillTxnMergeSubSel(cat, majorityValue(sameCatRows, '子分类'));
}

function closeTxnMergeModal() {
  pendingTxnMergeKeys = null;
  document.getElementById('moTxnMerge')?.classList.add('hide');
}

function confirmTxnMergeModal() {
  const keys = pendingTxnMergeKeys;
  if (!keys?.length) {
    closeTxnMergeModal();
    return;
  }
  const category = document.getElementById('txnMergeCatSel')?.value || '';
  const subcategory = document.getElementById('txnMergeSubSel')?.value || '';
  try {
    addTxnMerge({ keys, category, subcategory });
  } catch (e) {
    alert(e.message || '合并失败');
    return;
  }
  closeTxnMergeModal();
  persist();
  clearSelection();
  applyF();
  renderKPI();
  renderMonitor();
  refreshActiveViews();
}

function unmergeLedgerGroup() {
  const keys = [...selectedIds].map(id => String(id));
  if (!keys.length) return;
  const mergeIds = new Set();
  keys.forEach(k => {
    const merge = findMergeForKey(k);
    if (merge) mergeIds.add(merge.id);
  });
  if (mergeIds.size !== 1) {
    alert('请选择属于同一合并的账目，或选择单条已合并账目');
    return;
  }
  if (!confirm('确定取消合并统计？账目将恢复分别计入分类统计。')) return;
  const mergeId = [...mergeIds][0];
  removeTxnMergeById(mergeId);
  if (activeTxnMergeId === mergeId) activeTxnMergeId = null;
  persist();
  clearSelection();
  applyF();
  renderKPI();
  renderMonitor();
  refreshActiveViews();
}

function filterTxnMerge(id) {
  activeTxnMergeId = id;
  activeTxnLinkId = null;
  applyF();
}

function clearTxnMergeFilter() {
  activeTxnMergeId = null;
  applyF();
}

function tradeCatCellHtml(row) {
  const cat = row['分类'] || '';
  const sub = (row['子分类'] || '').trim();
  const icon = catIconHtml(cat, { size: 18, wrapClass: 'cat-pick-emoji-wrap' });
  const subPart = sub
    ? `<span class="cat-cell-sep">·</span><span class="cs cs-sub trade-cat-sub">${escHtml(sub)}</span>`
    : '';
  return `<div class="trade-row-cat cat-cell">
    <div class="cat-cell-inner">
      ${icon}
      <div class="cat-cell-text">
        <span class="trade-cat-label">${escHtml(cat)}</span>${subPart}
      </div>
    </div>
  </div>`;
}

function tradeRowHtml(row) {
  const isInc = row['收支'] === '收入';
  const peer = (row['交易对方'] || row['产品名称'] || '—').trim();
  return `<div class="trade-row">
    <div class="trade-row-dt">${formatDateLabel(row['日期'])}<span>${formatTimeShort(row['时间'])}</span></div>
    <div class="trade-row-peer">${escHtml(peer)}</div>
    ${tradeCatCellHtml(row)}
    <div class="trade-row-type">${typeBadge(row['收支'], row['退款状态'], row['分类'])}</div>
    <div class="trade-row-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
  </div>`;
}

function tradeLinkSortKey(link) {
  const rows = rowsForLinkKeys(link.keys, allData);
  if (!rows.length) return '';
  return rows.map(r => r['日期'] + r['时间']).sort().pop();
}

function tradeLinkPrimaryCat(link) {
  const rows = rowsForLinkKeys(link.keys, allData);
  if (!rows.length) return '未分类';
  const counts = new Map();
  for (const r of rows) {
    const cat = (r['分类'] || '').trim() || '未分类';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  let best = '未分类';
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) { best = cat; bestN = n; }
  }
  return best;
}

function tradeCatSortIndex(cat) {
  const idx = CATS.indexOf(cat);
  return idx >= 0 ? idx : CATS.length + 1;
}

function groupTradesByCategory(links) {
  const map = new Map();
  for (const link of links) {
    const cat = tradeLinkPrimaryCat(link);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(link);
  }
  return [...map.entries()]
    .sort((a, b) => {
      const d = tradeCatSortIndex(a[0]) - tradeCatSortIndex(b[0]);
      return d !== 0 ? d : a[0].localeCompare(b[0], 'zh-CN');
    })
    .map(([cat, items]) => ({
      cat,
      items: items.sort((a, b) => tradeLinkSortKey(b).localeCompare(tradeLinkSortKey(a)))
    }));
}

function renderTradeLinkName(link) {
  if (activeTradeNameEditId === link.id) {
    return `<span class="trade-card-name trade-card-name--edit" onclick="event.stopPropagation()">
      <input type="text" class="trade-card-name-inp" id="tradeNameInp-${escHtml(link.id)}" maxlength="80" value="${escHtml(link.name)}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();saveTradeNameEdit('${escHtml(link.id)}');} if(event.key==='Escape'){event.preventDefault();cancelTradeNameEdit();}">
      <button type="button" class="btn btn-sm btn-p" onclick="saveTradeNameEdit('${escHtml(link.id)}')"><i class="ti ti-check"></i></button>
      <button type="button" class="btn btn-sm" onclick="cancelTradeNameEdit()"><i class="ti ti-x"></i></button>
    </span>`;
  }
  return `<span class="trade-card-name">
    <i class="ti ti-link"></i>
    <span class="trade-card-name-text">${escHtml(link.name)}</span>
    <button type="button" class="trade-card-name-edit" onclick="event.stopPropagation();startTradeNameEdit('${escHtml(link.id)}')" title="编辑名称"><i class="ti ti-pencil"></i></button>
  </span>`;
}

function computeAllTradesStats(links) {
  const seen = new Set();
  const rows = [];
  for (const link of links || []) {
    for (const row of rowsForLinkKeys(link.keys, allData)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return computeLinkStats(rows);
}

function renderTradesTotal(links) {
  const el = document.getElementById('tradesTotal');
  if (!el) return;
  if (!links?.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const stats = computeAllTradesStats(links);
  const meta = linkBalanceMeta(stats);
  const plHtml = stats.balanced
    ? `<span class="txn-link-balance ok">${meta.label}</span>`
    : `<span class="trade-card-pl trade-card-pl--${meta.cls}">
        <span class="trade-card-pl-label">${meta.label}</span>
        <span class="trade-card-pl-amt">${fmtMoney(Math.abs(stats.net))}</span>
      </span>`;
  el.hidden = false;
  el.innerHTML = `<div class="trades-total-meta">${links.length} 个事件</div>
    <div class="trades-total-stats">支出 ${fmtMoney(stats.exp)} · 收入 ${fmtMoney(stats.inc)}</div>
    <div class="trades-total-pl">${plHtml}</div>`;
}

function renderTradeLinkSummary(link, stats) {
  const meta = linkBalanceMeta(stats);
  const plHtml = stats.balanced
    ? `<span class="txn-link-balance ok">${meta.label}</span>`
    : `<span class="trade-card-pl trade-card-pl--${meta.cls}">
        <span class="trade-card-pl-label">${meta.label}</span>
        <span class="trade-card-pl-amt">${fmtMoney(Math.abs(stats.net))}</span>
      </span>`;
  return `${renderTradeLinkName(link)}
    <span class="trade-card-stats">
      支出 ${fmtMoney(stats.exp)} · 收入 ${fmtMoney(stats.inc)}
      ${plHtml}
    </span>`;
}

function renderTradeCardHtml(link) {
  const rows = rowsForLinkKeys(link.keys, allData);
  const stats = computeLinkStats(rows);
  const expanded = activeTradeLinkId === link.id;
  const rowHtml = rows
    .sort((a, b) => (a['日期'] + a['时间']).localeCompare(b['日期'] + b['时间']))
    .map(tradeRowHtml)
    .join('');
  return `<article class="trade-card${expanded ? ' is-open' : ''}" data-link-id="${escHtml(link.id)}">
    <div class="trade-card-head">
      <button type="button" class="trade-card-toggle" onclick="toggleTradeCard('${escHtml(link.id)}')">
        <span class="trade-card-summary">${renderTradeLinkSummary(link, stats)}</span>
        <i class="ti ti-chevron-down trade-card-chevron"></i>
      </button>
      <span class="trade-card-actions">
        <button type="button" class="btn btn-sm btn-p" onclick="openTradeAddModal('${escHtml(link.id)}')" title="加入交易账目"><i class="ti ti-plus"></i> 加入交易账目</button>
        <button type="button" class="btn btn-sm" onclick="viewTradeInLedger('${escHtml(link.id)}')" title="在明细中查看"><i class="ti ti-list-details"></i></button>
        <button type="button" class="btn btn-sm btn-a" onclick="unlinkTradeGroup('${escHtml(link.id)}')" title="取消关联"><i class="ti ti-unlink"></i></button>
      </span>
    </div>
    <div class="trade-card-body">${rowHtml}</div>
  </article>`;
}

function renderTradesPage() {
  const el = document.getElementById('tradesList');
  if (!el) return;
  const links = getTxnPairs().slice().sort((a, b) => tradeLinkSortKey(b).localeCompare(tradeLinkSortKey(a)));
  renderTradesTotal(links);
  if (!links.length) {
    el.innerHTML = `<div class="trades-empty">
      <i class="ti ti-link-off"></i>
      <p>暂无关联交易事件</p>
      <span>在明细列表勾选多笔账目后，点击「关联」即可创建</span>
    </div>`;
    return;
  }
  const groups = groupTradesByCategory(links);
  el.innerHTML = groups.map(({ cat, items }) => `<section class="trades-group">
    <header class="trades-group-head">
      <span class="trades-group-icon">${catIconHtml(cat, { size: 18, wrapClass: 'cat-pick-emoji-wrap' })}</span>
      <h3 class="trades-group-title">${escHtml(catLabel(cat))}</h3>
      <span class="trades-group-meta">${items.length} 个事件</span>
    </header>
    <div class="trades-group-list">${items.map(renderTradeCardHtml).join('')}</div>
  </section>`).join('');
  if (activeTradeNameEditId) {
    const inp = document.getElementById(`tradeNameInp-${activeTradeNameEditId}`);
    inp?.focus();
    inp?.select();
  }
}

function startTradeNameEdit(id) {
  if (!findLinkById(id)) return;
  activeTradeNameEditId = id;
  renderTradesPage();
}

function cancelTradeNameEdit() {
  activeTradeNameEditId = null;
  renderTradesPage();
}

function saveTradeNameEdit(id) {
  const link = findLinkById(id);
  if (!link) return;
  const inp = document.getElementById(`tradeNameInp-${id}`);
  const trimmed = inp?.value?.trim() || '';
  if (!trimmed) {
    alert('关联名称不能为空');
    inp?.focus();
    return;
  }
  try {
    renameTxnLink(id, trimmed);
  } catch (e) {
    alert(e.message || '保存失败');
    return;
  }
  activeTradeNameEditId = null;
  persist();
  renderTradesPage();
  applyF();
}

function toggleTradeCard(id) {
  activeTradeLinkId = activeTradeLinkId === id ? null : id;
  renderTradesPage();
}

function openTradeLink(id) {
  if (!findLinkById(id)) return;
  activeTradeLinkId = id;
  const nav = document.getElementById('nav-trades') || document.querySelector('.ni[title="关联交易事件"]');
  if (nav) sw('trades', nav);
  else renderTradesPage();
}

function viewTradeInLedger(id) {
  if (!findLinkById(id)) return;
  activeTxnLinkId = id;
  const nav = document.querySelector('.ni[title="明细列表"]');
  if (nav) sw('ledger', nav);
  applyF();
}

function unlinkTradeGroup(id) {
  const link = findLinkById(id);
  if (!link) return;
  if (!confirm(`确定取消关联「${link.name}」？`)) return;
  removeTxnLinkById(id);
  if (activeTxnLinkId === id) activeTxnLinkId = null;
  if (activeTradeLinkId === id) activeTradeLinkId = null;
  if (activeTradeNameEditId === id) activeTradeNameEditId = null;
  persist();
  renderTradesPage();
  applyF();
}

function tradeAddRowTitle(row) {
  const product = (row['产品名称'] || '').trim();
  const peer = (row['交易对方'] || '').trim();
  const desc = (row['商品说明'] || '').trim();
  return product || peer || (desc && desc !== '/' ? desc : '—');
}

function tradeEventDateRange(link) {
  const rows = rowsForLinkKeys(link?.keys || [], allData);
  const dates = rows.map(r => r['日期']).filter(Boolean).sort();
  if (!dates.length) return { d1: '', d2: '' };
  return { d1: dates[0], d2: dates[dates.length - 1] };
}

function openTradeAddModal(id) {
  const link = findLinkById(id);
  if (!link) return;
  tradeAddLinkId = id;
  activeTradeLinkId = id;
  const nameEl = document.getElementById('tradeAddEventName');
  if (nameEl) nameEl.textContent = `事件：${link.name}`;
  const range = tradeEventDateRange(link);
  const d1 = document.getElementById('tradeAddD1');
  const d2 = document.getElementById('tradeAddD2');
  const q = document.getElementById('tradeAddQ');
  if (d1) d1.value = range.d1;
  if (d2) d2.value = range.d2;
  if (q) q.value = '';
  renderTradeAddResults();
  document.getElementById('moTradeAdd')?.classList.remove('hide');
  setTimeout(() => document.getElementById('tradeAddQ')?.focus(), 60);
}

function closeTradeAddModal() {
  document.getElementById('moTradeAdd')?.classList.add('hide');
  tradeAddLinkId = null;
}

function onTradeAddFilterChange() {
  renderTradeAddResults();
}

function tradeAddCandidateRows(link, limit = 80) {
  const owned = new Set(link.keys.map(String));
  const d1 = document.getElementById('tradeAddD1')?.value || '';
  const d2 = document.getElementById('tradeAddD2')?.value || '';
  const q = (document.getElementById('tradeAddQ')?.value || '').trim().toLowerCase();
  const matched = allData
    .filter(row => {
      const key = String(row.id);
      if (owned.has(key)) return false;
      if (d1 && row['日期'] < d1) return false;
      if (d2 && row['日期'] > d2) return false;
      if (q && !`${rowSearchHaystack(row)} ${row['日期'] || ''}`.includes(q)) return false;
      return true;
    })
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  return { rows: matched.slice(0, limit), total: matched.length, limit };
}

function renderTradeAddResults() {
  const wrap = document.getElementById('tradeAddResults');
  const countEl = document.getElementById('tradeAddCount');
  const link = findLinkById(tradeAddLinkId);
  if (!wrap || !link) return;
  const { rows, total, limit } = tradeAddCandidateRows(link);
  if (countEl) {
    if (!total) countEl.textContent = '没有符合条件的账目';
    else if (total > limit) countEl.textContent = `找到 ${total} 笔，显示前 ${limit} 笔，点击加入本事件`;
    else countEl.textContent = `找到 ${total} 笔，点击加入本事件`;
  }
  if (!rows.length) {
    wrap.innerHTML = '<div class="trade-add-empty">没有符合条件的账目，试试调整日期或关键词。</div>';
    return;
  }
  wrap.innerHTML = rows.map(row => {
    const other = findLinkForKey(String(row.id));
    const blocked = other && other.id !== link.id;
    const isInc = row['收支'] === '收入';
    const sub = (row['子分类'] || '').trim();
    const catTxt = sub ? `${row['分类']} · ${sub}` : (row['分类'] || '—');
    const meta = `${formatDateLabel(row['日期'])}${row['时间'] ? ` ${formatTimeShort(row['时间'])}` : ''} · ${catTxt} · ${row['来源'] || ''}`;
    if (blocked) {
      return `<div class="trade-add-item is-blocked" title="已属于事件「${escHtml(other.name)}」">
        <div class="trade-add-main">
          <div class="trade-add-title">${escHtml(tradeAddRowTitle(row))}</div>
          <div class="trade-add-meta">${escHtml(meta)} · 已在「${escHtml(other.name)}」</div>
        </div>
        <div class="trade-add-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
      </div>`;
    }
    return `<button type="button" class="trade-add-item" onclick="addTxnToTradeEvent(${row.id})">
      <div class="trade-add-main">
        <div class="trade-add-title">${escHtml(tradeAddRowTitle(row))}</div>
        <div class="trade-add-meta">${escHtml(meta)}</div>
      </div>
      <div class="trade-add-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
    </button>`;
  }).join('');
}

function addTxnToTradeEvent(id) {
  const linkId = tradeAddLinkId;
  if (!linkId) return;
  try {
    appendTxnLinkKeys(linkId, [String(id)]);
  } catch (e) {
    alert(e.message || '加入失败');
    return;
  }
  persist();
  renderTradesPage();
  applyF();
  renderTradeAddResults();
}

function filterTxnLink(id) {
  openTradeLink(id);
}

function clearTxnLinkFilter() {
  activeTxnLinkId = null;
  applyF();
}

function updateTxnLinkFilterBar() {
  const bar = document.getElementById('txnLinkFilterBar');
  if (!bar) return;
  if (activeTxnMergeId) {
    const merge = findMergeById(activeTxnMergeId);
    if (!merge) {
      activeTxnMergeId = null;
      bar.classList.add('hide');
      bar.innerHTML = '';
      return;
    }
    const rows = merge.keys.map(k => allData.find(r => String(r.id) === String(k))).filter(Boolean);
    const stats = computeMergeNet(rows);
    const netKind = stats.net < -0.009 ? '净支出' : stats.net > 0.009 ? '净收入' : '已相抵';
    const sub = merge.subcategory ? ` · ${merge.subcategory}` : '';
    bar.classList.remove('hide');
    bar.innerHTML = `
      <span class="txn-link-filter-name"><i class="ti ti-arrows-join"></i> 合并统计 · ${escHtml(merge.category)}${escHtml(sub)}</span>
      <span class="txn-link-filter-stats">
        支出 ${fmtMoney(stats.exp)} · 收入 ${fmtMoney(stats.inc)} · ${netKind} ${fmtMoney(stats.abs)}
      </span>
      <button type="button" class="btn btn-sm txn-link-filter-close" onclick="clearTxnMergeFilter()" title="退出筛选"><i class="ti ti-x"></i></button>`;
    return;
  }
  if (!activeTxnLinkId) {
    bar.classList.add('hide');
    bar.innerHTML = '';
    return;
  }
  const link = findLinkById(activeTxnLinkId);
  if (!link) {
    activeTxnLinkId = null;
    bar.classList.add('hide');
    bar.innerHTML = '';
    return;
  }
  const rows = rowsForLinkKeys(link.keys, allData);
  const stats = computeLinkStats(rows);
  const meta = linkBalanceMeta(stats);
  bar.classList.remove('hide');
  bar.innerHTML = `
    <span class="txn-link-filter-name"><i class="ti ti-link"></i> ${escHtml(link.name)}</span>
    <span class="txn-link-filter-stats">
      支出 ${fmtMoney(stats.exp)} · 收入 ${fmtMoney(stats.inc)} · 净额 ${fmtMoneySigned(stats.net)}
      <span class="txn-link-balance ${meta.cls}">${meta.label}</span>
    </span>
    <button type="button" class="btn btn-sm txn-link-filter-close" onclick="openTradeLink('${escHtml(link.id)}')" title="在事件页查看"><i class="ti ti-calendar-event"></i></button>
    <button type="button" class="btn btn-sm txn-link-filter-close" onclick="clearTxnLinkFilter()" title="退出筛选"><i class="ti ti-x"></i></button>`;
}

// ── 明细弹窗批量选择 ─────────────────────────────────────────────────────────
function toggleDetSelect(id, cb) {
  if (cb.checked) detSelectedIds.add(id); else detSelectedIds.delete(id);
  updateDetBulkBar();
  renderDetailBody();
}

function toggleDetSelectAll(masterCb) {
  const ids = sortDetRows(detRows).filter(r => !r._statsMerge).map(r => r.id);
  if (masterCb.checked) ids.forEach(id => detSelectedIds.add(id));
  else ids.forEach(id => detSelectedIds.delete(id));
  updateDetBulkBar();
  renderDetailBody();
}

function clearDetSelection() {
  detSelectedIds.clear();
  updateDetBulkBar();
  renderDetailBody();
}

function updateDetBulkBar() {
  const bar = document.getElementById('detBulkBar');
  if (!bar) return;
  if (detSelectedIds.size > 0) {
    bar.classList.add('show');
    document.getElementById('detBulkCnt').textContent = `${detSelectedIds.size} 项已选`;
    const rows = [...detSelectedIds].map(id => allData.find(r => r.id === id)).filter(Boolean);
    const cats = new Set(rows.map(r => r['分类']));
    const sameCat = cats.size === 1 ? [...cats][0] : null;

    const catSel = document.getElementById('detBulkCatSel');
    catSel.innerHTML = CATS.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('');
    if (sameCat) catSel.value = sameCat;

    const subSel = document.getElementById('detBulkSubCatSel');
    const subBtn = document.getElementById('detBulkSubCatBtn');
    const subs = sameCat ? subcatsFor(sameCat) : [];
    if (sameCat && subs.length) {
      subSel.disabled = false;
      subBtn.disabled = false;
      subSel.title = '';
      subSel.innerHTML = ['<option value="">无</option>', ...subs.map(s =>
        `<option value="${s}">${s}</option>`
      )].join('');
      const selectedSubs = new Set(rows.map(r => r['子分类'] || ''));
      subSel.value = selectedSubs.size === 1 ? [...selectedSubs][0] : '';
    } else {
      subSel.disabled = true;
      subBtn.disabled = true;
      subSel.title = sameCat ? '该分类暂无子分类' : '选中项需属于同一分类';
      subSel.innerHTML = `<option value="">${sameCat ? '该分类无子分类' : '需同一分类'}</option>`;
    }
  } else {
    bar.classList.remove('show');
  }
}

function applyDetBulkCat() {
  const newCat = document.getElementById('detBulkCatSel').value;
  detSelectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (!row) return;
    row['分类'] = newCat;
    const subs = subcatsFor(newCat);
    if (row['子分类'] && !subs.includes(row['子分类'])) row['子分类'] = '';
    row._autoCat = false;
    row._catConf = 'manual';
    Categorizer.learn(row['交易对方'], newCat, row['商品说明']);
  });
  persist();
  renderKPI();
  renderMonitor();
  applyF();
  refreshDetailModal();
}

function applyDetBulkSubCat() {
  const subSel = document.getElementById('detBulkSubCatSel');
  if (!subSel || subSel.disabled) return;
  const newSub = subSel.value;
  detSelectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (row) row['子分类'] = newSub;
  });
  persist();
  detSelectedIds.clear();
  applyF();
  refreshDetailModal();
}

function detBulkToggleRefund(markAsRefund) {
  detSelectedIds.forEach(id => {
    const row = allData.find(r => r.id === id);
    if (!row) return;
    row['退款状态'] = markAsRefund ? 'refunded' : 'normal';
    if (markAsRefund) refunded.add(id); else refunded.delete(id);
  });
  persist();
  renderKPI();
  renderRfView();
  detSelectedIds.clear();
  applyF();
  refreshDetailModal();
}

export function syncSearch(v) {
  document.getElementById('qi').value = v;
  const top = document.getElementById('topSearch');
  if (top && top.value !== v) top.value = v;
  updateSearchClear();
  applyF();
}

function updateSearchClear() {
  const btn = document.getElementById('searchClear');
  const q = document.getElementById('qi')?.value.trim();
  if (btn) btn.classList.toggle('hide', !q);
}

export function clearSearch() {
  syncSearch('');
}

function onSplitSaved() {
  renderTable();
  renderKPI();
  renderMonitor();
  refreshDetailModal();
  refreshActiveViews();
}

function handleToggleSplitExpand(id) {
  toggleSplitExpand(id);
  renderTable();
}

function handleUpdSplitCat(parentId, idx, cat) {
  updateSplitItem(parentId, idx, 'category', cat);
  renderTable();
  renderKPI();
  renderMonitor();
  refreshActiveViews();
}

function handleUpdSplitSub(parentId, idx, sub) {
  updateSplitItem(parentId, idx, 'subcategory', sub);
  renderTable();
  refreshActiveViews();
}

function handleSaveSplit() {
  saveSplitEditor(onSplitSaved);
}

function handleClearSplit(id) {
  clearSplits(id, () => {
    closeSplitEditor();
    onSplitSaved();
  });
}

function clearSplitFromModal() {
  const id = getSplitEditId();
  if (id) handleClearSplit(id);
}

let appReady = false;
let initPromise = null;

function ensureScrollReveal(el) {
  if (!el || el._scrollReveal) return;
  el._scrollReveal = true;
  let timer = 0;
  const reveal = () => {
    el.classList.add('is-scrolling');
    clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('is-scrolling'), 900);
  };
  el.addEventListener('wheel', reveal, { passive: true });
  el.addEventListener('scroll', reveal, { passive: true });
  el.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    el.classList.remove('is-scrolling');
  });
}

function ensureNavScrollReveal() {
  ensureScrollReveal(document.querySelector('.sb .nav'));
  document.querySelectorAll('.fb').forEach(ensureScrollReveal);
}

export async function initApp() {
  if (initPromise) return initPromise;
  initPromise = initAppInner().catch(err => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

async function initAppInner() {
  if (appReady) {
    await loadData();
    return;
  }
  const nnEmoji = document.getElementById('nnEmoji');
  if (nnEmoji) setCatIconBtn(nnEmoji, nnEmoji.dataset.emoji || iconRef('1F4CC'));
  Categorizer.onRulesChange(() => persist());
  initCatPicker({
    getCats: () => CATS,
    getEmoji: c => catIconValue(c),
    getCatColor: c => catColor(c),
    onSelect: (rowId, cat, splitIdx) => {
      if (splitIdx != null) handleUpdSplitCat(rowId, splitIdx, cat);
      else updCat(rowId, cat);
    },
    onFilterSelect: cat => {
      syncCatFilterBtn(cat);
      syncSubFilterOptions(cat, true);
      applyF();
    },
  });
  syncUnsetSubFilterUI();
  ensureNavScrollReveal();
  initCatBrowse({
    getCats: () => CATS,
    getEmoji: c => catIconHtml(c, { size: 20, wrapClass: 'catbrowse-tab-emoji-wrap' }),
    getSubcatsFor: subcatsFor,
    getExpandedRows: statsExpanded,
    getCatLabel: catLabel,
    formatDateLabel,
    formatTimeShort,
    srcBadge: srcBadgeBrowse,
    onReorderCats: reorderCats,
    isOffsetCat: cat => OFFSET_CATS_SET.has(cat),
    isIncomeCategory,
  });
  initRenqing({
    getExpandedRows: renqingExpanded,
    getSubcatsFor: subcatsFor,
    formatDayHeader,
    formatTimeShort,
    srcBadgeHtml: srcBadge,
    typeBadgeHtml: typeBadge,
    onPersist: persist,
    onEditRow: editRenqingRow
  });
  setupRenqingUpload();
  initAccounts({
    getAllRows: () => allData,
    onPersist: persist,
    persistNow: persistNow,
    bindScrollReveal: ensureScrollReveal
  });
  setupAccountsEvents();
  initGear({
    getAllData: () => allData,
    onPersist: persist,
    getCats: () => CATS,
    getSubcatsFor: cat => SUBCATS[cat] || [],
    ensureSubcat: (cat, sub) => {
      if (!cat || !sub) return;
      if (!SUBCATS[cat]) SUBCATS[cat] = [];
      if (!SUBCATS[cat].includes(sub)) SUBCATS[cat] = [...SUBCATS[cat], sub];
    }
  });
  initFamily({
    getAllData: () => allData,
    rowSearchHaystack,
    rowDisplayTitle,
    formatDateLabel,
    formatTimeShort,
  });
  initSplits({
    getCats: () => CATS,
    getSubcatsFor: subcatsFor,
    getAllData: () => allData,
    onPersist: persist
  });
  setupGearUpload();
  setupCompanyCost();
  setupFamilyEvents();
  ensureHomeMonthDropEvents();
  setupDropZone();
  setupImportHistoryActions();
  setupLedgerHeadScrollSync();
  await loadData();
  appReady = true;
}

export function refreshForTheme() {
  if (!appReady) return;
  renderKPI();
  renderHome();
  renderMonitor();
  refreshActiveViews();
}

Object.assign(window, {
  sw, openImport, toggleUnsetSubFilter, toggleCatBrowseUnsetSubFilter, selectCatBrowse, toggleCatBrowseGroup,
  toggleCatBrowseSelect, toggleCatBrowseGroupSelect, toggleCatBrowseSelectAll, clearCatBrowseSelection,
  applyCatBrowseBulkCat, applyCatBrowseBulkSub, linkCatBrowsePair, unlinkCatBrowsePair,
  openAdd, closeAdd, saveAdd, openEditRow, openSrc, closeSrc, addSrc, saveSrc,
  openCat, closeCat, addCat, saveCat, delCat, toggleCatSub, pickCatEmoji, pickNewCatEmoji,
  setQuick, resetF, applyF, changePgSize, filterSrc, filterLedgerDay, filterLedgerMonth, setTypeFilter, onSubFilterChange, toggleSortCol, toggleDateSort,
  toggleSelect, toggleSelectAll, clearSelection, applyBulkCat, applyBulkSubCat, bulkToggleRefund,
  linkLedgerGroup, unlinkLedgerGroup, closeTxnLinkModal, confirmTxnLinkModal,
  openTxnMergeModal, closeTxnMergeModal, confirmTxnMergeModal, onTxnMergeCatChange, unmergeLedgerGroup,
  filterTxnMerge, clearTxnMergeFilter,
  filterTxnLink, clearTxnLinkFilter, toggleTradeCard, openTradeLink, viewTradeInLedger, unlinkTradeGroup,
  startTradeNameEdit, saveTradeNameEdit, cancelTradeNameEdit,
  openTradeAddModal, closeTradeAddModal, onTradeAddFilterChange, addTxnToTradeEvent,
  resetImportPreview, confirmImport, onImportSrcChange, toggleDupImport, toggleAllDupImport,
  toggleImportRecordType, updateImportRecordAmount, resetAllLedger,
  openBatchSrc, closeBatchSrc, saveBatchSrc, onCatReportChange, onCatReportYearChange, selectRenqingPerson, goRenqingPage, triggerRenqingAvatarUpload,
  updRenqingSubCat, updRenqingSplitSub,
  openAccountsMgr, closeAccountsMgr, resetAccountsMgrForm, saveAccountsMgr,
  editAccountsMgr, startAccountMerge, cancelAccountMerge, confirmAccountMerge,
  addCreditCardRow, deleteCreditCard, toggleCreditCardEditMode, toggleCreditCancelled,
  toggleCashAccountEditMode, addCashAccountRow, deleteCashAccount,
  toggleBudgetEditMode, addBudgetRow, deleteBudget,
  toggleLifeAccountEditMode, addLifeAccountRow, deleteLifeAccount,
  toggleLongReminderEditMode, addLongReminderRow, deleteLongReminder, addLongReminderToCalendar,
  toggleTopbarReminders, closeTopbarReminders,
  toggleWebAccountEditMode, addWebAccountRow, addWebAccountColumn, deleteWebAccountRow, deleteWebAccountColumn,
  bindSelectedCreditCards, unbindCreditCardFromPool, dissolveCreditPoolById,
  selectAccountsTab,
  goP, toggleRf, toggleExclude, updCat, updSubCat, updCatDet, showAllDetail, showDetail, showIncomeDetail, showCatReportDetail, closeDetModal, toggleDetSort, toggleDetUnsetSubFilter,
  openHomeExpCatSettings, closeHomeExpCatSettings, saveHomeExpCatSettings, toggleHomeExpCatSetting,
  openHomeIncCatSettings, closeHomeIncCatSettings, saveHomeIncCatSettings, toggleHomeIncCatSetting,
  onHomeMonthChange,
  toggleHomeMonthDrop, selectHomeMonth,
  toggleDetSelect, toggleDetSelectAll, clearDetSelection, applyDetBulkCat, applyDetBulkSubCat, detBulkToggleRefund,
  openGearEdit, closeGearEdit, saveGearEdit, triggerGearUpload, submitGearImageUrl,
  selectGearTab, markGearSold, markGearUnsold, markGearSoldFromModal,
  onGearCatChange, openGearSectionAdd, closeGearSectionAdd, confirmGearSectionAdd,
  onGearSectionCatChange, onGearSectionSubChange, removeGearSection,
  addIncomeMonitorCat, addIncomeMonitorCatFromSel, removeIncomeMonitorCat, onIncomeYearChange,
  openInvoiceEdit, closeInvoiceEdit, saveInvoiceEdit, removeInvoice, triggerInvoiceUpload, triggerManualInvoiceUpload,
  toggleInvoicePrinted, downloadInvoiceFile, printInvoiceFile, openAppConfig,
  openFamilyCreate, openFamilyEdit, closeFamilyEdit, saveFamilyEdit, removeFamilyEvent, triggerFamilyUpload,
  onFamilySearch, clearFamilySearch, setFamilyViewMode,
  openFamilyTxnSearch, closeFamilyTxnSearch, onFamilyTxnSearch, pickFamilyLinkedTxn, removeFamilyLinkedTxn,
  openSplitEditor, closeSplitEditor, addSplitLine, saveSplitEdit: handleSaveSplit,
  clearSplit: handleClearSplit, clearSplitFromModal, toggleSplitExpand: handleToggleSplitExpand,
  updSplitCat: handleUpdSplitCat, updSplitSub: handleUpdSplitSub,
  syncSearch, clearSearch, syncAddSubcats, srcColor, catLabel, catColor
});
