// ── 主应用 ───────────────────────────────────────────────────────────────────
import { Categorizer } from './categorizer.js';
import { ImportTimeline } from './import-timeline.js';
import { Parsers } from './parsers.js';
import {
  DEFAULT_CATS, DEFAULT_EMOJIS, LEGACY_DEFAULT_EMOJIS, DEFAULT_SOURCES, DEFAULT_SUBCATS, CAT_COLORS,
  MONITOR_CATS, EXCLUDE_CATS, OFFSET_CATS, MONITOR_EMOJIS, INCOME_DATA_CATS
} from './config.js';
import { renderCatIcon, iconRef } from './cat-icons.js';
import { fetchState, saveState, resetLedger, deleteImportBatchApi, changeImportBatchSourceApi, checkHealth } from './api.js';
import {
  createBatchId, stampImportBatch, deriveImportHistory,
  recordsForBatch as batchRecords, deleteConfirmMessage
} from './import-manager.js';
import { API_BASE } from './apiBase.js';
import { fmtMoney, fmtMoneySigned, fmtCount, fmtChartAxis, chartMoneyTooltip } from './format.js';
import {
  initGear, loadGearState, getGearState, renderGearPage,
  openGearEdit, closeGearEdit, saveGearEdit, triggerGearUpload, setupGearUpload
} from './gear.js';
import {
  renderCompanyCostPage, setupCompanyCost,
  openInvoiceEdit, closeInvoiceEdit, saveInvoiceEdit, removeInvoice, triggerInvoiceUpload
} from './company-cost.js';
import {
  initSplits, hasSplits, expandRowForStats, rowMatchesCat, rowSearchHaystack,
  toggleSplitExpand, isSplitExpanded, openSplitEditor, closeSplitEditor, getSplitEditId,
  addSplitLine, saveSplitEditor, clearSplits, updateSplitItem,
  parentCatCellHtml, splitSubRowHtml, splitSubRowNoDateHtml
} from './splits.js';
import { initCatPicker, catPickBtnHtml, openEmojiPicker, closeEmojiPicker } from './cat-picker.js';
import { subCatSelectHtml, rowHasUnsetSub } from './subcat-ui.js';
import { srcMarkHtml } from './source-logos.js';
import {
  initCatBrowse, renderCatBrowse, selectCatBrowse,
  toggleCatBrowseGroup, toggleCatBrowseUnsetSubFilter,
  getCatBrowseSelectedKeys, clearCatBrowseSelection, updateCatBrowseBulkBar,
  toggleCatBrowseSelect, toggleCatBrowseGroupSelect, toggleCatBrowseSelectAll
} from './cat-browse.js';

let CATS = [...DEFAULT_CATS];
let EMOJIS = { ...DEFAULT_EMOJIS };
let SUBCATS = { ...DEFAULT_SUBCATS };
let SOURCES = JSON.parse(JSON.stringify(DEFAULT_SOURCES));
let OFFSET_CATS_SET = OFFSET_CATS;

let allData = [], filteredData = [], curPage = 1;
let PG = 30;
let activeSrc = 'all', refunded = new Set(), excluded = new Set(), charts = {};
let filterUnsetSubOnly = false;
let detRows = [], detSort = 'a-';
let detIsIncome = false;
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

function renderImportPage() {
  populateImportSources();
  updateImportUploadState();
  syncImportHistory();
  renderImportHistoryUI();
  renderImportTimelineView();
}

function renderImportTimelineView() {
  ImportTimeline.render({
    containerId: 'importTimeline',
    existingData: allData,
    pendingRecords: pendingImport?.records || [],
    pendingAllRecords: pendingImport?.allRecords || [],
    pendingNewRecords: pendingImport?.records || [],
    activeSource: pendingImport?.sourceName || importActiveSource || '',
    fileName: pendingImport?.fileName || ''
  });
}

const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

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
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}.${dd} ${WEEKDAY_LABELS[d.getDay()]}`;
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
    <div class="td no-strike src-cell">${srcBadge(row['来源'])}</div>
    ${peerDescCell(row)}
    ${catCell}
    <div class="td no-strike type-cell">${typeBadge(row['收支'], row['退款状态'], typeCat)}</div>
    ${amtCellHtml(row, isR)}
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

function peerDescCell(row) {
  const product = (row['产品名称'] || '').trim();
  const peer = (row['交易对方'] || '').trim();
  const main = product || peer || '—';
  const d = (row['商品说明'] || '').trim();
  const showDesc = d && d !== '/' && d !== main && (!product || d !== peer);
  const title = showDesc ? `${main} · ${d}` : main;
  return `<div class="td peer-desc" title="${title}"><div class="peer-main">${main}</div>${showDesc ? `<div class="peer-sub">${d}</div>` : ''}</div>`;
}

function renderImportRecordTable(records) {
  const wrap = document.getElementById('importRecordPreview');
  const el = document.getElementById('importRecordTable');
  if (!records.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  el.innerHTML = `
    <div class="th-row import-rec-cols">
      <div class="th">日期</div><div class="th">交易对方</div><div class="th">收支</div><div class="th">分类</div>
    </div>
    ${records.slice(0, 20).map(r => `
      <div class="tr import-rec-cols">
        ${dateTimeCell(r['日期'], r['时间'])}
        ${peerDescCell(r)}
        <div class="td">${r['收支']}</div>
        <div class="td">${catLabel(r['分类'])}${r['子分类'] ? ' · ' + r['子分类'] : ''}</div>
      </div>`).join('')}`;
}

function subcatsFor(cat) {
  return SUBCATS[cat] || [];
}

function amtCellHtml(row, isR) {
  const pay = row['支付方式'] || '';
  const pm = pay.length > 10 ? pay.slice(0, 10) + '…' : pay;
  const sign = row['收支'] === '收入' ? '+' : '-';
  const cls = isR ? ' rf' : row['收支'] === '收入' ? ' i' : ' e';
  return `<div class="td amt-cell no-strike${cls}">
    <div class="amt-val">${isR ? '<span class="amt-rf-tag">退</span>' : ''}${sign}¥${row['金额'].toFixed(2)}</div>
    ${pm ? `<div class="amt-pay" title="${pay}">${pm}</div>` : ''}
  </div>`;
}

function catCellHtml(row) {
  const cat = row['分类'];
  const sub = row['子分类'] || '';
  const subs = subcatsFor(cat);
  const mainBtn = catPickBtnHtml(row.id, cat);
  const subSel = subCatSelectHtml({ subs, sub, onchange: `updSubCat(${row.id},this.value)` });
  return `<div class="td no-strike cat-cell">${mainBtn}${subSel}</div>`;
}

function catLabel(c) { return c; }
function catColor(c) { const i = CATS.indexOf(c); return i >= 0 ? CAT_COLORS[i] : '#98a2b3'; }
function srcColor(s) { const f = SOURCES.find(x => x.name === s); return f ? f.color : '#98a2b3'; }
function isCountedInStats(r) {
  return r['退款状态'] !== 'refunded' && r['统计状态'] !== 'excluded';
}

function activeData() { return allData.filter(isCountedInStats); }

function activeExpanded() {
  const out = [];
  allData.filter(isCountedInStats).forEach(r => out.push(...expandRowForStats(r)));
  return out;
}

function statsData() {
  const expanded = [];
  allData.filter(isCountedInStats).forEach(r => expanded.push(...expandRowForStats(r)));
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
    categories: { cats: CATS, emojis: EMOJIS, subcats: SUBCATS },
    sources: SOURCES,
    rules: { peerRules: Categorizer.peerRules, keywordRules: Categorizer.keywordRules },
    importHistory,
    nextId,
    stateVersion,
    gearLibrary: gear.gearLibrary,
    nextGearId: gear.nextGearId
  };
}

let persistTimer = null;

async function persistNow(opts = {}) {
  flash();
  updateSubtitle();
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    const res = await saveState(buildState());
    if (res?.stateVersion != null) stateVersion = res.stateVersion;
    return true;
  } catch (err) {
    if (err.code === 'STATE_CONFLICT' && !opts._retried && err.currentVersion != null) {
      stateVersion = err.currentVersion;
      return persistNow({ _retried: true });
    }
    if (err.code === 'STATE_CONFLICT') {
      await loadData();
      alert('保存失败：云端数据已被其他设备更新，已同步最新数据');
      return false;
    }
    alert('保存失败：' + err.message);
    return false;
  }
}

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistNow(); }, 300);
}

async function updateBackendFooter(count) {
  const title = document.querySelector('#sbFooterText strong');
  const sub = document.getElementById('sbFooterSub');
  const footer = document.getElementById('sbFooter');
  if (!sub) return;
  if (API_BASE) {
    let host = API_BASE;
    try { host = new URL(API_BASE).hostname; } catch { /* keep raw */ }
    if (title) title.textContent = '云端数据库';
    sub.textContent = count != null
      ? `Railway · ${host} · ${count} 笔`
      : `Railway · ${host}`;
    footer?.setAttribute('title', `数据保存在 Railway 后端 (${API_BASE})`);
  } else {
    if (title) title.textContent = 'SQLite 数据库';
    sub.textContent = count != null
      ? `本地开发 · data/ledger.db · ${count} 笔`
      : '本地开发 · data/ledger.db';
    footer?.setAttribute('title', '数据保存在本地 data/ledger.db');
  }
}

async function loadData() {
  try {
    const health = await checkHealth().catch(() => null);
    const state = await fetchState();
    refunded = new Set((state.refunded || []).map(id => typeof id === 'string' ? parseInt(id, 10) : id));
    excluded = new Set((state.excluded || []).map(id => typeof id === 'string' ? parseInt(id, 10) : id));

    if (state.categories) {
      CATS = [...state.categories.cats];
      DEFAULT_CATS.forEach(c => { if (!CATS.includes(c)) CATS.push(c); });
      EMOJIS = { ...DEFAULT_EMOJIS };
      if (state.categories.emojis) {
        for (const [cat, val] of Object.entries(state.categories.emojis)) {
          const legacy = LEGACY_DEFAULT_EMOJIS[cat];
          if (legacy && val === legacy) continue;
          EMOJIS[cat] = val;
        }
      }
      SUBCATS = { ...DEFAULT_SUBCATS, ...(state.categories.subcats || {}) };
      const babySubs = SUBCATS['母婴亲子'];
      if (babySubs && !babySubs.includes('母婴装备')) {
        SUBCATS['母婴亲子'] = [...babySubs, '母婴装备'];
      }
    }

    if (state.sources) SOURCES = state.sources;
    stateVersion = state.stateVersion || 0;
    allData = state.transactions || [];
    const maxId = allData.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    nextId = Math.max(Number(state.nextId) || 1, maxId + 1);
    importHistory = state.importHistory || [];
    Categorizer.applyRules(state.rules);
    loadGearState(state);

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

    syncImportHistory();
    buildSrcChips();
    buildCatFilter();
    applyF();
    renderKPI();
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

function updateSubtitle() {
  const el = document.getElementById('subtitle');
  if (!allData.length) {
    if (el) el.textContent = '家庭记账 · 导入账单开始使用';
    return;
  }
  const dates = allData.map(r => r['日期']).filter(Boolean).sort();
  const range = `${dates[0]} 至 ${dates[dates.length - 1]}`;
  if (el) el.textContent = `家庭记账 · ${range} · ${fmtCount(allData.length)} 笔`;
}

function kpiCard(label, value, sub, icon, iconCls, valCls) {
  return `<div class="kpi-c">
    <div class="kpi-icon ${iconCls}"><i class="ti ${icon}"></i></div>
    <div class="kpi-body">
      <div class="kpi-l">${label}</div>
      <div class="kpi-v ${valCls || ''}">${value}</div>
      <div class="kpi-s">${sub}</div>
    </div>
  </div>`;
}

function renderKPI() {
  const ad = statsData();
  const exp = ad.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = ad.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const net = inc - exp;
  const rfc = allData.filter(r => r['退款状态'] === 'refunded').length;
  const pending = allData.filter(r => Categorizer.isPending(r) && isCountedInStats(r)).length;
  const h = [
    kpiCard('实际支出', fmtMoney(exp), `${fmtCount(ad.filter(r => r['收支'] === '支出').length)} 笔`, 'ti-arrow-down-right', 'pink', 'c-red'),
    kpiCard('总收入', fmtMoney(inc), `${fmtCount(ad.filter(r => r['收支'] === '收入').length)} 笔`, 'ti-arrow-up-right', 'green', 'c-grn'),
    kpiCard('净结余', fmtMoneySigned(net), net >= 0 ? '收入大于支出' : '支出大于收入', 'ti-scale', 'blue', net >= 0 ? 'c-blu' : 'c-red'),
    kpiCard('待确认分类', fmtCount(pending), '自动分类需复核', 'ti-tag-starred', 'amber', 'c-amb'),
    kpiCard('总笔数', fmtCount(allData.length), `已退款 ${fmtCount(rfc)} 笔 · 不计入 ${fmtCount(allData.filter(r => r['统计状态'] === 'excluded').length)} 笔`, 'ti-list-numbers', 'lav', '')
  ].join('');
  const kpi2 = document.getElementById('kpi2');
  if (kpi2) kpi2.innerHTML = h;
  updateSubtitle();
}

function buildSrcChips() {
  const el = document.getElementById('srcChips');
  const allSrcs = ['all', ...new Set(allData.map(r => r['来源']))];
  el.innerHTML = allSrcs.map(s => {
    const clr = s === 'all' ? '#98a2b3' : srcColor(s);
    const on = (s === 'all' && activeSrc === 'all') || s === activeSrc;
    const mark = s === 'all'
      ? '<span class="dot" style="background:#98a2b3"></span>'
      : srcMarkHtml(s, { size: 20, fallbackColor: clr });
    return `<div class="chip${on ? ' on' : ''}" onclick="filterSrc('${s.replace(/'/g, "\\'")}',this)" data-src="${s}">${mark}${s === 'all' ? '全部' : s}</div>`;
  }).join('');
}

function filterSrc(s, el) {
  activeSrc = s;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  applyF();
}

function buildCatFilter() {
  const sel = document.getElementById('cf');
  sel.innerHTML = '<option value="">全部分类</option>';
  CATS.forEach(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = catLabel(c);
    sel.appendChild(o);
  });
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
    if (activeSrc !== 'all' && r['来源'] !== activeSrc) return false;
    if (cat && !rowMatchesCat(r, cat)) return false;
    if (tp && r['收支'] !== tp) return false;
    if (hideRf && r['退款状态'] === 'refunded') return false;
    if (filterUnsetSubOnly && !rowHasUnsetSub(r, subcatsFor)) return false;
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
  document.getElementById('tf').value = '';
  syncTypeSegUI();
  document.getElementById('rfHide').checked = true;
  filterUnsetSubOnly = false;
  syncUnsetSubFilterUI();
  document.getElementById('sf').value = 'd-';
  activeSrc = 'all';
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  const allChip = document.querySelector('[data-src="all"]');
  if (allChip) allChip.classList.add('on');
  applyF();
}

function srcBadge(s) {
  const lbl = s.length > 9 ? s.slice(0, 9) + '…' : s;
  return `<span class="src-inline">${srcMarkHtml(s, { size: 18, fallbackColor: srcColor(s) })}${lbl}</span>`;
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
        <span class="ledger-day-date">${formatDayHeader(date)}</span>
        ${daySumHtml(t.inc, t.exp)}
      </header>
      <div class="ledger-day-rows">${rows.map(renderLedgerDayRow).join('')}</div>
    </section>`;
  }).join('');
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
  detContext = { type: 'expense', cat };
  detSelectedIds.clear();
  const ad = activeExpanded().filter(r => r['收支'] === '支出' && r['分类'] === cat);
  const total = ad.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `<span class="inline-cat-icon" style="margin-right:6px">${catIconHtml(cat, { size: 18 })}</span>${cat} · 全部`;
  document.getElementById('detSummary').textContent = `共 ${fmtCount(ad.length)} 笔支出`;
  document.getElementById('detTotal').textContent = fmtMoney(total);
  document.getElementById('detTotal').style.color = 'var(--red-t)';
  renderDetailBody(ad);
  updateDetBulkBar();
  syncDetModalLayout();
  document.getElementById('moDet').classList.remove('hide');
}

function showDetail(month, cat) {
  detSort = 'a-';
  detIsIncome = false;
  detContext = { type: 'expense', month, cat };
  detSelectedIds.clear();
  const rows = activeExpanded().filter(r => r['收支'] === '支出' && r['日期'].startsWith(month) && r['分类'] === cat);
  const total = rows.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `<span class="inline-cat-icon" style="margin-right:6px">${catIconHtml(cat, { size: 18, value: MONITOR_EMOJIS[cat] })}</span>${cat} · ${month}`;
  document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔支出`;
  document.getElementById('detTotal').textContent = fmtMoney(total);
  document.getElementById('detTotal').style.color = 'var(--red-t)';
  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  document.getElementById('moDet').classList.remove('hide');
}

function showIncomeDetail(month, cat) {
  detSort = 'a-';
  detIsIncome = true;
  detContext = { type: 'income', month, cat };
  detSelectedIds.clear();
  const rows = incomeCatRows(cat).filter(r => r['日期'].startsWith(month));
  const netted = incomeCatIsNetted(cat);
  const total = netted ? incomeCatNet(rows) : rows.reduce((s, r) => s + r['金额'], 0);
  document.getElementById('detTitle').innerHTML = `${cat} · ${fmtMonthLabel(month)}`;
  document.getElementById('detSummary').textContent = netted
    ? `共 ${fmtCount(rows.length)} 笔（含对冲支出）`
    : `共 ${fmtCount(rows.length)} 笔收入`;
  document.getElementById('detTotal').textContent = netted ? fmtMoneySigned(total) : fmtMoney(total);
  document.getElementById('detTotal').style.color = total >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  renderDetailBody(rows);
  updateDetBulkBar();
  syncDetModalLayout();
  document.getElementById('moDet').classList.remove('hide');
}

function closeDetModal() {
  document.getElementById('moDet').classList.add('hide');
  document.getElementById('moDet').classList.remove('det-income');
  detSelectedIds.clear();
  detContext = null;
  updateDetBulkBar();
}

function syncDetModalLayout() {
  document.getElementById('moDet')?.classList.toggle('det-income', !!detIsIncome);
}

function getDetailRows() {
  if (!detContext) return detRows;
  const ad = activeExpanded();
  if (detContext.type === 'income') {
    const { month, cat } = detContext;
    const match = r => r['分类'] === cat && r['日期'].startsWith(month);
    return incomeCatIsNetted(cat) ? ad.filter(match) : ad.filter(r => match(r) && r['收支'] === '收入');
  }
  if (detContext.month) {
    return ad.filter(r => r['收支'] === '支出' && r['日期'].startsWith(detContext.month) && r['分类'] === detContext.cat);
  }
  return ad.filter(r => r['收支'] === '支出' && r['分类'] === detContext.cat);
}

function refreshDetailModal() {
  if (!detContext || document.getElementById('moDet').classList.contains('hide')) return;
  const rows = getDetailRows();
  const netted = detContext.type === 'income' && incomeCatIsNetted(detContext.cat);
  const total = netted ? incomeCatNet(rows) : rows.reduce((s, r) => s + r['金额'], 0);
  const typeLabel = detIsIncome ? (netted ? '（含对冲支出）' : '收入') : '支出';
  document.getElementById('detSummary').textContent = `共 ${fmtCount(rows.length)} 笔${typeLabel}`;
  document.getElementById('detTotal').textContent = netted ? fmtMoneySigned(total) : fmtMoney(total);
  if (detIsIncome) {
    document.getElementById('detTotal').style.color = total >= 0 ? 'var(--grn-t)' : 'var(--red-t)';
  }
  renderDetailBody(rows);
  updateDetBulkBar();
  refreshActiveViews();
}

function refreshActiveViews() {
  if (document.getElementById('view-income')?.classList.contains('on')) renderIncomeData();
  if (document.getElementById('view-report')?.classList.contains('on')) renderReport();
  if (document.getElementById('view-catbrowse')?.classList.contains('on')) renderCatBrowse();
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
  const allChecked = sorted.length > 0 && sorted.every(r => detSelectedIds.has(r.id));
  const incomeCols = detIsIncome ? ' det-cols-income' : '';
  const typeHdr = detIsIncome ? '<div class="det-th det-th-type">收支</div>' : '';
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
      const isSel = detSelectedIds.has(r.id);
      const typeCell = detIsIncome
        ? `<div class="det-type">${typeBadge(r['收支'], r['退款状态'], r['分类'])}</div>`
        : '';
      const isInc = r['收支'] === '收入';
      const amtCls = detIsIncome ? (isInc ? ' det-amt-inc' : ' det-amt-exp') : '';
      const amtTxt = detIsIncome
        ? `${isInc ? '+' : '-'}¥${r['金额'].toFixed(2)}`
        : `¥${r['金额'].toFixed(2)}`;
      return `<div class="det-row det-cols det-cols-actions${incomeCols}${i % 2 ? ' alt' : ''}${isSel ? ' selected' : ''}">
        <div class="det-check"><input type="checkbox" class="cb" ${isSel ? 'checked' : ''} onchange="toggleDetSelect(${r.id},this)"></div>
        <div class="det-dt">${formatDateLabel(r['日期'])}<span>${formatTimeShort(r['时间'])}</span></div>
        <div class="det-src">${srcBadge(r['来源'])}</div>
        <div class="det-peer"><div class="det-peer-main">${p}</div>${showDesc ? `<div class="det-peer-sub">${d}</div>` : ''}</div>
        ${catCellHtml(r).replace('class="td no-strike cat-cell"', 'class="det-cat"')}
        ${typeCell}
        <div class="det-amt${amtCls}">${amtTxt}</div>
        <div class="det-act">
          <button type="button" class="icon-act rf ${isR ? 'um' : 'mk'}" title="${isR ? '撤销退款' : '标记退款'}" onclick="toggleRf(${r.id})"><i class="ti ${isR ? 'ti-rotate-clockwise' : 'ti-receipt-refund'}"></i></button>
        </div>
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } }, tooltip: chartMoneyTooltip }, scales: { y: { ticks: { callback: fmtChartAxis } } } }
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
  charts.cPie = new Chart(document.getElementById('cPie'), { type: 'doughnut', data: { labels: cKeys.map(catLabel), datasets: [{ data: cVals, backgroundColor: cColors, borderWidth: 2, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, cutout: '58%' } });

  const incT = {}; incD.forEach(r => incT[r['分类']] = (incT[r['分类']] || 0) + r['金额']);
  const incS = Object.entries(incT).sort((a, b) => b[1] - a[1]);
  const iKeys = incS.map(c => c[0]), iVals = incS.map(c => +c[1].toFixed(2));
  const iColors = iKeys.map(catColor), totI = iVals.reduce((s, v) => s + v, 0) || 1;
  document.getElementById('incLeg').innerHTML = iKeys.map((c, i) => `<span style="display:flex;align-items:center;gap:3px"><span style="width:9px;height:9px;border-radius:2px;background:${iColors[i]}"></span>${catLabel(c)} ${((iVals[i] / totI) * 100).toFixed(1)}%</span>`).join('');
  if (charts.iPie) charts.iPie.destroy();
  charts.iPie = new Chart(document.getElementById('iPie'), { type: 'doughnut', data: { labels: iKeys.map(catLabel), datasets: [{ data: iVals, backgroundColor: iColors, borderWidth: 2, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, cutout: '58%' } });

  const months = [...new Set(allData.map(r => r['日期'].slice(0, 7)))].sort();
  const mInc = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  const mExp = months.map(m => +ad.filter(r => r['日期'].startsWith(m) && r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0).toFixed(2));
  if (charts.mBar) charts.mBar.destroy();
  charts.mBar = new Chart(document.getElementById('mBar'), { type: 'bar', data: { labels: months, datasets: [{ label: '收入', data: mInc, backgroundColor: '#12b76a', borderRadius: 4 }, { label: '支出', data: mExp, backgroundColor: '#f04438', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: chartMoneyTooltip }, scales: { y: { ticks: { callback: fmtChartAxis } } } } });

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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } }, tooltip: chartMoneyTooltip }, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: fmtChartAxis } } } }
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
          borderColor: '#ffffff',
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 2.5,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#fff',
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
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 11 }, maxRotation: 45 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: 'rgba(255,255,255,0.55)', callback: fmtChartAxis }
        }
      }
    }
  });
}

const INCOME_SUB_COLORS = ['#FDBA74', '#86EFAC', '#1E3A5F', '#93C5FD', '#C4B5FD', '#FDA4AF', '#67E8F9', '#FDE68A'];

function incomeCatIsNetted(cat) {
  return OFFSET_CATS_SET.has(cat);
}

function incomeCatRows(cat) {
  const rows = activeExpanded().filter(r => r['分类'] === cat);
  return incomeCatIsNetted(cat) ? rows : rows.filter(r => r['收支'] === '收入');
}

function incomeCatNet(rows) {
  return rows.reduce((s, r) => s + (r['收支'] === '收入' ? r['金额'] : -r['金额']), 0);
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

function incomeChartOptions(months, cat) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartMoneyTooltip,
        backgroundColor: '#fff',
        titleColor: '#344054',
        bodyColor: '#475467',
        borderColor: '#eaecf0',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        boxPadding: 4,
        callbacks: {
          ...chartMoneyTooltip.callbacks,
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
          color: '#98a2b3',
          font: { size: 11, weight: '500' },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12
        }
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: '#f2f4f7', drawBorder: false },
        border: { display: false },
        ticks: {
          color: '#98a2b3',
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

function renderIncomeData() {
  const months = [...new Set(allData.map(r => r['日期'].slice(0, 7)))].sort();
  const grid = document.getElementById('incomeGrid');
  if (!grid) return;

  if (charts.income) Object.values(charts.income).forEach(c => c?.destroy?.());
  charts.income = {};

  if (!months.length) {
    grid.innerHTML = '<div class="income-card income-card-empty" style="grid-column:1/-1">暂无收入数据</div>';
    return;
  }

  grid.innerHTML = INCOME_DATA_CATS.map((cat, i) => {
    const total = incomeCatNet(incomeCatRows(cat));
    const totalFmt = incomeCatIsNetted(cat) ? fmtMoneySigned(total) : fmtMoney(total);
    return `<div class="income-card">
      <div class="income-card-head">
        <div class="income-card-meta">
          <div class="income-card-title">${catLabel(cat)}${incomeCatIsNetted(cat) ? '<span class="income-net-tag">净收入</span>' : ''}</div>
          <div class="income-card-total">${totalFmt}</div>
        </div>
        <div class="income-card-change" id="incChange-${i}"></div>
      </div>
      <div class="income-chart-wrap"><canvas id="incChart-${i}"></canvas></div>
      <div class="income-legend" id="incLegend-${i}"></div>
    </div>`;
  }).join('');

  INCOME_DATA_CATS.forEach((cat, i) => {
    const catRows = incomeCatRows(cat);
    let subcats = incomeSubcatsFor(cat, catRows);
    if (!subcats.length) subcats = ['全部'];

    const monthlyTotals = months.map(m =>
      +incomeCatNet(catRows.filter(r => r['日期'].startsWith(m))).toFixed(2)
    );

    const datasets = subcats.map((sub, si) => ({
      label: sub,
      data: months.map(m => {
        const mr = catRows.filter(r => r['日期'].startsWith(m));
        return +incomeSubcatNet(mr, sub).toFixed(2);
      }),
      backgroundColor: INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length],
      stack: 'inc',
      borderRadius: ctx => stackedBarRadius(ctx, 10),
      borderSkipped: false,
      barPercentage: 0.55,
      categoryPercentage: 0.68
    }));

    const canvas = document.getElementById(`incChart-${i}`);
    if (!canvas) return;

    charts.income[cat] = new Chart(canvas, {
      type: 'bar',
      data: { labels: incomeMonthLabels(months), datasets },
      options: incomeChartOptions(months, cat)
    });

    const changeEl = document.getElementById(`incChange-${i}`);
    if (changeEl) {
      const pct = monthChangePct(monthlyTotals);
      if (pct !== null && (monthlyTotals.at(-1) > 0 || monthlyTotals.at(-2) > 0)) {
        const up = pct >= 0;
        changeEl.innerHTML = `<span class="income-change ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
      }
    }

    const legEl = document.getElementById(`incLegend-${i}`);
    if (legEl) {
      legEl.innerHTML = subcats.map((sub, si) =>
        `<span class="income-leg-item"><span class="income-leg-dot" style="background:${INCOME_SUB_COLORS[si % INCOME_SUB_COLORS.length]}"></span>${sub}</span>`
      ).join('');
    }
  });
}

function sw(name, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  document.getElementById('view-' + name).classList.add('on');
  el.classList.add('on');
  document.getElementById('vt').textContent = { ledger: '明细列表', catbrowse: '分类检索', charts: '统计图表', monitor: '统计监控', gear: '装备库', report: '收支报告', income: '收入数据', company: '公司成本', refunds: '退款管理', import: '导入预览' }[name];
  if (name === 'charts') setTimeout(renderCharts, 60);
  if (name === 'report') setTimeout(renderReport, 60);
  if (name === 'income') setTimeout(renderIncomeData, 60);
  if (name === 'refunds') renderRfView();
  if (name === 'monitor') renderMonitor();
  if (name === 'gear') renderGearPage();
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
  if (btn) btn.classList.toggle('on', filterUnsetSubOnly);
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
        <div class="import-dup-meta">${r['日期']} ${r['时间'] || ''} · ${r._dupReason === 'file' ? '文件内重复' : '与已有账目重复'}</div>
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
    const newRecords = [];
    const duplicateRecords = [];
    let dup = 0;

    classified.forEach(r => {
      r._importUid = `improw_${Math.random().toString(36).slice(2, 10)}`;
      r._dupSelected = false;
      if (Parsers.isDuplicate(r, fileDedup)) {
        dup++;
        r._dupReason = Parsers.isDuplicate(r, existingDedup) ? 'existing' : 'file';
        duplicateRecords.push(r);
        return;
      }
      r._hash = Parsers.txnHash(r);
      Parsers.addToDedupSet(fileDedup, r);
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
      sourceName,
      fileName: file.name,
      startMonth: range.months[0] || '',
      endMonth: range.months[range.months.length - 1] || ''
    };

    const pending = newRecords.filter(r => Categorizer.isPending(r)).length;
    document.getElementById('importPreview').innerHTML =
      `识别格式：<strong>${{ wechat: '微信支付', alipay: '支付宝', bank: '银行流水' }[format] || format}</strong><br>` +
      `来源：<strong>${sourceName}</strong><br>` +
      `时间范围：<strong>${range.months[0] ? ImportTimeline.yearMonthLabel(range.months[0]) : '—'}</strong> 至 <strong>${range.months.length ? ImportTimeline.yearMonthLabel(range.months[range.months.length - 1]) : '—'}</strong><br>` +
      `解析 ${classified.length} 笔 · 新增 ${newRecords.length} 笔 · 重复 ${dup} 笔${dup ? '（可在下方勾选导入）' : ''} · 待确认 ${pending} 笔`;

    document.getElementById('importStats').innerHTML = `
      <div class="import-stat"><div class="n">${newRecords.length}</div><div class="l">将导入</div></div>
      <div class="import-stat"><div class="n">${dup}</div><div class="l">重复跳过</div></div>
      <div class="import-stat"><div class="n">${pending}</div><div class="l">待确认</div></div>
      <div class="import-stat"><div class="n">${range.months.length}</div><div class="l">覆盖月份</div></div>`;

    renderImportTimelineView();
    renderImportRecordTable(newRecords);
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
  });

  const batchId = createBatchId();
  const importedAt = new Date().toISOString();
  stampImportBatch(pendingImport.records, {
    batchId,
    fileName: pendingImport.fileName,
    format: pendingImport.format,
    importedAt
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
function openAdd() {
  document.getElementById('f-src').innerHTML = SOURCES.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  buildCatFilter();
  syncAddSubcats();
  document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('moAdd').classList.remove('hide');
}
function closeAdd() { document.getElementById('moAdd').classList.add('hide'); }
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
  const row = { id: nextId++, 日期: dt, 时间: tm, 来源: src, 交易对方: peer, 商品说明: desc, 分类: cat, 子分类: sub, 收支: tp, 金额: amt, 支付方式: pay, 备注: note, 退款状态: 'normal', 统计状态: 'normal', _autoCat: false, _catConf: 'manual', _hash: '' };
  row._hash = Parsers.txnHash(row);
  allData.push(row);
  allData.sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  persist();
  buildSrcChips();
  applyF();
  renderKPI();
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
  return EMOJIS[cat] || DEFAULT_EMOJIS[cat] || iconRef('1F4CC');
}

function catIconHtml(cat, opts = {}) {
  const value = opts.value ?? catIconValue(cat);
  return renderCatIcon(value, { size: opts.size, wrapClass: opts.wrapClass, class: opts.class });
}

function setCatIconBtn(btn, value) {
  const v = value || iconRef('1F4CC');
  btn.dataset.emoji = v;
  btn.innerHTML = renderCatIcon(v, { size: 22 });
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
    const em = catIconValue(c);
    return `<div class="cat-edit-item" data-i="${i}">
      <div class="cr">
        <button type="button" class="cat-sub-toggle${open ? ' open' : ''}" title="子分类${subs.length ? `（${subs.length}）` : ''}" onclick="toggleCatSub(${i})"><i class="ti ti-chevron-right"></i></button>
        <button type="button" class="cat-emoji-btn" data-i="${i}" data-emoji="${em}" title="设置图标" onclick="pickCatEmoji(event,${i})">${catIconHtml(c, { size: 22 })}</button>
        <input class="ni2" value="${c}" data-i="${i}">
        <button class="db" onclick="delCat(${i})">✕</button>
      </div>
      <div class="cat-sub-panel${open ? ' open' : ''}">
        <input class="subcat-inp" data-i="${i}" placeholder="子分类（逗号分隔，如：地铁, 停车）" value="${subs.join(', ')}">
      </div>
    </div>`;
  }).join('');
}
function delCat(i) {
  const c = CATS[i];
  if (allData.find(r => r['分类'] === c)) { alert(`"${c}" 还有记录在使用`); return; }
  CATS.splice(i, 1);
  delete EMOJIS[c];
  delete SUBCATS[c];
  catSubExpanded.delete(c);
  renderCatList();
}
function addCat() {
  const n = document.getElementById('nn').value.trim();
  if (!n || CATS.includes(n)) { alert(n ? '已存在' : '请输入名称'); return; }
  const emBtn = document.getElementById('nnEmoji');
  const em = emBtn?.dataset.emoji || iconRef('1F4CC');
  CATS.push(n);
  EMOJIS[n] = em;
  SUBCATS[n] = [];
  document.getElementById('nn').value = '';
  if (emBtn) setCatIconBtn(emBtn, iconRef('1F4CC'));
  renderCatList();
}
function saveCat() {
  const emojiByIndex = {};
  document.querySelectorAll('#catList .cat-emoji-btn').forEach(btn => {
    emojiByIndex[parseInt(btn.dataset.i, 10)] = btn.dataset.emoji?.trim() || btn.textContent.trim() || iconRef('1F4CC');
  });

  document.querySelectorAll('#catList .ni2').forEach(inp => {
    const i = parseInt(inp.dataset.i, 10);
    const old = CATS[i];
    const nv = inp.value.trim();
    if (nv && nv !== old) {
      allData.filter(r => r['分类'] === old).forEach(r => r['分类'] = nv);
      EMOJIS[nv] = EMOJIS[old] || '';
      delete EMOJIS[old];
      if (SUBCATS[old]) {
        SUBCATS[nv] = SUBCATS[old];
        delete SUBCATS[old];
      }
      if (catSubExpanded.has(old)) {
        catSubExpanded.delete(old);
        catSubExpanded.add(nv);
      }
      CATS[i] = nv;
    }
  });
  document.querySelectorAll('#catList .subcat-inp').forEach(inp => {
    const i = parseInt(inp.dataset.i, 10);
    const cat = CATS[i];
    if (!cat) return;
    const subs = inp.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (subs.length) SUBCATS[cat] = subs;
    else delete SUBCATS[cat];
    allData.filter(r => r['分类'] === cat && r['子分类'] && !subs.includes(r['子分类']))
      .forEach(r => r['子分类'] = '');
  });
  CATS.forEach((c, i) => {
    if (emojiByIndex[i] != null) EMOJIS[c] = emojiByIndex[i];
  });
  persist();
  buildCatFilter();
  applyF();
  closeCat();
  refreshActiveViews();
}

// ── 批量选择 ─────────────────────────────────────────────────────────────────
let selectedIds = new Set();

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
    document.getElementById('bulkCnt').textContent = `${selectedIds.size} 项已选`;
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
  } else bar.classList.remove('show');
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

// ── 明细弹窗批量选择 ─────────────────────────────────────────────────────────
function toggleDetSelect(id, cb) {
  if (cb.checked) detSelectedIds.add(id); else detSelectedIds.delete(id);
  updateDetBulkBar();
  renderDetailBody();
}

function toggleDetSelectAll(masterCb) {
  const ids = sortDetRows(detRows).map(r => r.id);
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
    }
  });
  syncUnsetSubFilterUI();
  initCatBrowse({
    getCats: () => CATS,
    getEmoji: c => catIconHtml(c, { size: 20, wrapClass: 'catbrowse-tab-emoji-wrap' }),
    getSubcatsFor: subcatsFor,
    getExpandedRows: activeExpanded,
    getCatLabel: catLabel,
    formatDateLabel,
    formatTimeShort,
    srcBadge,
    onReorderCats: reorderCats
  });
  initGear({ getAllData: () => allData, onPersist: persist });
  initSplits({
    getCats: () => CATS,
    getSubcatsFor: subcatsFor,
    getAllData: () => allData,
    onPersist: persist
  });
  setupGearUpload();
  setupCompanyCost();
  setupDropZone();
  setupImportHistoryActions();
  await loadData();
  appReady = true;
}

Object.assign(window, {
  sw, openImport, toggleUnsetSubFilter, toggleCatBrowseUnsetSubFilter, selectCatBrowse, toggleCatBrowseGroup,
  toggleCatBrowseSelect, toggleCatBrowseGroupSelect, toggleCatBrowseSelectAll, clearCatBrowseSelection,
  applyCatBrowseBulkCat, applyCatBrowseBulkSub,
  openAdd, closeAdd, saveAdd, openSrc, closeSrc, addSrc, saveSrc,
  openCat, closeCat, addCat, saveCat, delCat, toggleCatSub, pickCatEmoji, pickNewCatEmoji,
  setQuick, resetF, applyF, changePgSize, filterSrc, setTypeFilter, toggleSortCol,
  toggleSelect, toggleSelectAll, clearSelection, applyBulkCat, applyBulkSubCat, bulkToggleRefund,
  resetImportPreview, confirmImport, onImportSrcChange, toggleDupImport, toggleAllDupImport, resetAllLedger,
  openBatchSrc, closeBatchSrc, saveBatchSrc,
  goP, toggleRf, toggleExclude, updCat, updSubCat, updCatDet, showAllDetail, showDetail, showIncomeDetail, closeDetModal, toggleDetSort,
  toggleDetSelect, toggleDetSelectAll, clearDetSelection, applyDetBulkCat, applyDetBulkSubCat, detBulkToggleRefund,
  openGearEdit, closeGearEdit, saveGearEdit, triggerGearUpload,
  openInvoiceEdit, closeInvoiceEdit, saveInvoiceEdit, removeInvoice, triggerInvoiceUpload,
  openSplitEditor, closeSplitEditor, addSplitLine, saveSplitEdit: handleSaveSplit,
  clearSplit: handleClearSplit, clearSplitFromModal, toggleSplitExpand: handleToggleSplitExpand,
  updSplitCat: handleUpdSplitCat, updSplitSub: handleUpdSplitSub,
  syncSearch, clearSearch, syncAddSubcats, srcColor, catLabel, catColor
});
