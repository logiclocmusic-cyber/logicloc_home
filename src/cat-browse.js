/** 分类检索：顶部分类标签，下方按子分类分组展示账目 */
import { fmtMoney, fmtMoneySigned, fmtCount } from './format.js';
import { catCellInnerHtml } from './cat-picker.js';
import { subCatSelectHtml, subCatGroupTitleHtml, rowHasUnsetSub } from './subcat-ui.js';
import { findPairForKey, validateTxnPair } from './txn-pairs.js';

let getCats = () => [];
let getEmoji = () => '📌';
let getSubcatsFor = () => [];
let getExpandedRows = () => [];
let getCatLabel = c => c;
let formatDateLabel = d => d;
let formatTimeShort = t => t;
let srcBadge = s => s;
let onReorderCats = () => {};
let isOffsetCat = () => false;
let isIncomeCategory = () => false;

let activeCat = '';
let tabsBound = false;
let bodyBound = false;
let dragFromIdx = null;
let holdTimer = null;
let holdTab = null;
let suppressTabClick = false;
const TAB_HOLD_MS = 320;
const SUBCHART_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#6366f1'];
const collapsedGroups = new Set();
const catBrowseSelected = new Set();
let filterUnsetSubOnly = false;
let catBrowseYear = String(new Date().getFullYear());
let catBrowseDateFrom = `${new Date().getFullYear()}-01-01`;
let catBrowseDateTo = `${new Date().getFullYear()}-12-31`;

export function initCatBrowse(deps) {
  getCats = deps.getCats || getCats;
  getEmoji = deps.getEmoji || getEmoji;
  getSubcatsFor = deps.getSubcatsFor || getSubcatsFor;
  getExpandedRows = deps.getExpandedRows || getExpandedRows;
  getCatLabel = deps.getCatLabel || getCatLabel;
  formatDateLabel = deps.formatDateLabel || formatDateLabel;
  formatTimeShort = deps.formatTimeShort || formatTimeShort;
  srcBadge = deps.srcBadge || srcBadge;
  onReorderCats = deps.onReorderCats || onReorderCats;
  isOffsetCat = deps.isOffsetCat || isOffsetCat;
  isIncomeCategory = deps.isIncomeCategory || isIncomeCategory;
}

export function getCatBrowseSelectedKeys() {
  return catBrowseSelected;
}

function groupKey(cat, sub) {
  return `${cat}|${sub}`;
}

function selKey(row) {
  const parentId = row._splitOf ?? row.id;
  return row._splitIdx != null ? `${parentId}:${row._splitIdx}` : `${parentId}`;
}

function browseAvailableYears() {
  const years = new Set();
  getExpandedRows().forEach(r => {
    const y = r['日期']?.slice(0, 4);
    if (y && /^\d{4}$/.test(y)) years.add(y);
  });
  years.add(String(new Date().getFullYear()));
  return [...years].sort((a, b) => b.localeCompare(a));
}

function browseYearBounds(year) {
  const y = String(year);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

function filterByBrowseDateRange(rows) {
  return rows.filter(r => {
    const d = r['日期'];
    if (!d) return false;
    if (catBrowseDateFrom && d < catBrowseDateFrom) return false;
    if (catBrowseDateTo && d > catBrowseDateTo) return false;
    return true;
  });
}

function rowsForCat(cat) {
  let rows = getExpandedRows().filter(r => r['分类'] === cat);
  rows = filterByBrowseDateRange(rows);
  if (filterUnsetSubOnly) rows = rows.filter(r => rowHasUnsetSub(r, getSubcatsFor));
  return rows;
}

function syncCatBrowseDateInputs() {
  const d1 = document.getElementById('catBrowseD1');
  const d2 = document.getElementById('catBrowseD2');
  if (d1) d1.value = catBrowseDateFrom;
  if (d2) d2.value = catBrowseDateTo;
}

function browseEmptyRangeLabel() {
  if (catBrowseDateFrom && catBrowseDateTo) {
    return catBrowseDateFrom === catBrowseDateTo
      ? catBrowseDateFrom
      : `${catBrowseDateFrom} 至 ${catBrowseDateTo}`;
  }
  return `${catBrowseYear}年`;
}

export function onCatBrowseYearChange(year) {
  catBrowseYear = String(year || new Date().getFullYear());
  const bounds = browseYearBounds(catBrowseYear);
  catBrowseDateFrom = bounds.from;
  catBrowseDateTo = bounds.to;
  syncCatBrowseDateInputs();
  renderCatBrowse();
}

export function onCatBrowseDateRangeChange() {
  catBrowseDateFrom = document.getElementById('catBrowseD1')?.value || catBrowseDateFrom;
  catBrowseDateTo = document.getElementById('catBrowseD2')?.value || catBrowseDateTo;
  renderCatBrowse();
}

function renderCatBrowseYearSelect() {
  const sel = document.getElementById('catBrowseYearSel');
  if (!sel) return;
  const years = browseAvailableYears();
  if (!years.includes(catBrowseYear)) {
    const current = String(new Date().getFullYear());
    catBrowseYear = years.includes(current) ? current : years[0];
    const bounds = browseYearBounds(catBrowseYear);
    catBrowseDateFrom = bounds.from;
    catBrowseDateTo = bounds.to;
  }
  sel.innerHTML = years.map(y =>
    `<option value="${y}"${y === catBrowseYear ? ' selected' : ''}>${y}年</option>`
  ).join('');
}

export function toggleCatBrowseUnsetSubFilter(btn) {
  filterUnsetSubOnly = !filterUnsetSubOnly;
  if (btn) btn.classList.toggle('on', filterUnsetSubOnly);
  renderCatBrowse();
}

function rowsForKeys(keys) {
  const expanded = getExpandedRows();
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

function subcatsForBrowse(cat, rows) {
  const configured = getSubcatsFor(cat);
  const used = [...new Set(rows.map(r => r['子分类'] || '未分类'))];
  const merged = [...configured];
  used.forEach(s => { if (!merged.includes(s)) merged.push(s); });
  const list = merged.filter(s => rows.some(r => (r['子分类'] || '未分类') === s));
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

function subcatMeta(rows) {
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  let meta = `${fmtCount(rows.length)} 笔`;
  if (exp) meta += ` · 支出 ${fmtMoney(exp)}`;
  if (inc) meta += ` · 收入 ${fmtMoney(inc)}`;
  return meta;
}

function browseTabAmount(cat, rows) {
  if (!rows.length) return { text: '暂无', cls: '' };
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  if (isIncomeCategory(cat)) {
    if (isOffsetCat(cat)) {
      const net = inc - exp;
      return { text: fmtMoneySigned(net), cls: net >= 0 ? 'inc' : 'exp' };
    }
    return { text: fmtMoneySigned(inc), cls: 'inc' };
  }
  if (isOffsetCat(cat)) {
    const net = inc - exp;
    return { text: fmtMoneySigned(net), cls: net >= 0 ? 'inc' : 'exp' };
  }
  return { text: fmtMoney(-exp), cls: 'exp' };
}

function subcatBarAmount(subRows, cat) {
  const inc = subRows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const exp = subRows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  if (isIncomeCategory(cat) && !isOffsetCat(cat)) return inc;
  if (isOffsetCat(cat)) return Math.abs(inc - exp);
  return exp;
}

let subchartTipBound = false;

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildSubcatChartHtml(cat, rows, subcats) {
  const items = subcats.map((sub, i) => {
    const subRows = rows.filter(r => (r['子分类'] || '未分类') === sub);
    const value = subcatBarAmount(subRows, cat);
    return { sub, value, color: SUBCHART_COLORS[i % SUBCHART_COLORS.length] };
  }).filter(x => x.value > 0.009);

  const total = items.reduce((s, x) => s + x.value, 0);
  if (!items.length || total <= 0) return '';

  const segs = items.map((x, i) => {
    const pct = x.value / total * 100;
    const radius = i === 0 ? 'border-radius:7px 0 0 7px;' : i === items.length - 1 ? 'border-radius:0 7px 7px 0;' : '';
    return `<div class="catbrowse-subchart-seg" data-sub="${escAttr(x.sub)}" data-value="${x.value}" data-pct="${pct.toFixed(1)}" style="width:${pct.toFixed(3)}%;background:${x.color};${radius}"></div>`;
  }).join('');

  const leg = items.map(x => {
    const pct = (x.value / total * 100).toFixed(1);
    return `<span class="catbrowse-subchart-leg-item" title="${escAttr(x.sub)} · ${fmtMoney(x.value)}"><span class="catbrowse-subchart-dot" style="background:${x.color}"></span><span>${x.sub}</span><span class="catbrowse-subchart-pct">${pct}%</span></span>`;
  }).join('');

  return `<div class="catbrowse-subchart-inner" role="img" aria-label="子分类占比">
    <div class="catbrowse-subchart-tip hide" aria-hidden="true">
      <span class="catbrowse-subchart-tip-name"></span>
      <span class="catbrowse-subchart-tip-amt"></span>
    </div>
    <div class="catbrowse-subchart-bar">${segs}</div>
    <div class="catbrowse-subchart-foot">
      <div class="catbrowse-subchart-leg">${leg}</div>
      <div class="catbrowse-subchart-total">${fmtMoney(total)}</div>
    </div>
  </div>`;
}

function positionSubchartTip(seg, bar, tip) {
  const inner = bar.closest('.catbrowse-subchart-inner');
  if (!inner) return;
  const nameEl = tip.querySelector('.catbrowse-subchart-tip-name');
  const amtEl = tip.querySelector('.catbrowse-subchart-tip-amt');
  if (!nameEl || !amtEl) return;
  nameEl.textContent = seg.dataset.sub || '';
  const value = Number(seg.dataset.value);
  amtEl.textContent = Number.isFinite(value) ? fmtMoney(value) : '';

  const innerRect = inner.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const segRect = seg.getBoundingClientRect();
  let left = segRect.left - innerRect.left + segRect.width / 2;
  const tipW = tip.offsetWidth || 0;
  const pad = 6;
  left = Math.max(pad + tipW / 2, Math.min(left, innerRect.width - pad - tipW / 2));
  const top = barRect.top - innerRect.top;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.classList.remove('hide');
}

function hideSubchartTip(chartEl) {
  chartEl?.querySelectorAll('.catbrowse-subchart-tip').forEach(el => el.classList.add('hide'));
}

function ensureSubchartTooltip() {
  const chartEl = document.getElementById('catBrowseSubChart');
  if (!chartEl || subchartTipBound) return;
  subchartTipBound = true;

  chartEl.addEventListener('mousemove', e => {
    const seg = e.target.closest('.catbrowse-subchart-seg');
    const bar = e.target.closest('.catbrowse-subchart-bar');
    const inner = e.target.closest('.catbrowse-subchart-inner');
    const tip = inner?.querySelector('.catbrowse-subchart-tip');
    if (!seg || !bar || !tip) {
      hideSubchartTip(chartEl);
      return;
    }
    positionSubchartTip(seg, bar, tip);
  });

  chartEl.addEventListener('mouseleave', () => hideSubchartTip(chartEl));
}

function rowTitle(row) {
  return (row['产品名称'] || row['交易对方'] || '').trim() || '—';
}

function browseCatCell(row) {
  if (row._statsMerge) {
    const cat = row['分类'] || '';
    const sub = row['子分类'] || '';
    return `<div class="catbrowse-row-cat cat-cell"><span class="catbrowse-merge-cat">${getEmoji(cat)} ${escAttr(cat)}${sub ? ' · ' + escAttr(sub) : ''}</span></div>`;
  }
  const parentId = row._splitOf ?? row.id;
  const splitIdx = row._splitIdx;
  const cat = row['分类'];
  const sub = row['子分类'] || '';
  const subs = getSubcatsFor(cat);
  const pickOpts = splitIdx != null ? { splitIdx } : {};
  const subChange = splitIdx != null
    ? `updSplitSub(${parentId},${splitIdx},this.value)`
    : `updSubCat(${parentId},this.value)`;
  const subSel = subCatSelectHtml({ subs, sub, onchange: subChange });
  return `<div class="catbrowse-row-cat cat-cell">${catCellInnerHtml(parentId, cat, subSel, pickOpts)}</div>`;
}

function renderBrowseRow(row) {
  const isMerge = !!row._statsMerge;
  const key = selKey(row);
  const isSel = !isMerge && catBrowseSelected.has(key);
  const p = rowTitle(row);
  const d = (row['商品说明'] || '').trim();
  const showDesc = d && d !== '/' && d !== p;
  const isInc = row['收支'] === '收入';
  const splitTag = row._splitOf != null ? '<span class="catbrowse-split-tag">拆分</span>' : '';
  const link = isMerge ? null : findPairForKey(key);
  const pairLabel = link?.name === '已完成配对' ? '已完成' : (link?.name || '已完成');
  const pairTag = link
    ? `<span class="catbrowse-pair-tag" title="关联账目"><i class="ti ti-link"></i> ${escAttr(pairLabel)}</span>`
    : '';
  const mergeTag = isMerge
    ? '<span class="catbrowse-merge-tag" title="合并统计净额">合并净额</span>'
    : '';
  const checkHtml = isMerge
    ? '<div class="catbrowse-row-check"></div>'
    : `<div class="catbrowse-row-check" onclick="event.stopPropagation()">
      <input type="checkbox" class="cb" ${isSel ? 'checked' : ''}>
    </div>`;
  return `<div class="catbrowse-row${isSel ? ' selected' : ''}${pairTag ? ' paired' : ''}${isMerge ? ' merged' : ''}" data-sel-key="${key}">
    ${checkHtml}
    <div class="catbrowse-row-dt">${formatDateLabel(row['日期'])}<span>${formatTimeShort(row['时间'])}</span></div>
    <div class="catbrowse-row-src">${srcBadge(row['来源'])}</div>
    <div class="catbrowse-row-peer">
      <div class="catbrowse-row-title">${p}${splitTag}${pairTag}${mergeTag}</div>
      ${showDesc ? `<div class="catbrowse-row-desc">${d}</div>` : ''}
    </div>
    ${browseCatCell(row)}
    <div class="catbrowse-row-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}¥${row['金额'].toFixed(2)}</div>
  </div>`;
}

function syncSelectAllUI(rows) {
  const selAllCb = document.getElementById('catBrowseSelAll');
  if (!selAllCb) return;
  const keys = rows.filter(r => !r._statsMerge).map(selKey);
  const allSelected = keys.length > 0 && keys.every(k => catBrowseSelected.has(k));
  const someSelected = keys.some(k => catBrowseSelected.has(k));
  selAllCb.checked = allSelected;
  selAllCb.indeterminate = !allSelected && someSelected;
}

export function updateCatBrowseBulkBar() {
  const bar = document.getElementById('catBrowseBulkBar');
  if (!bar) return;
  if (catBrowseSelected.size > 0) {
    bar.classList.add('show');
    document.getElementById('catBrowseBulkCnt').textContent = `${catBrowseSelected.size} 项已选`;
    const rows = rowsForKeys([...catBrowseSelected]);
    const cats = new Set(rows.map(r => r['分类']));
    const sameCat = cats.size === 1 ? [...cats][0] : null;

    const catSel = document.getElementById('catBrowseBulkCatSel');
    catSel.innerHTML = getCats().map(c => `<option value="${c}">${getCatLabel(c)}</option>`).join('');
    if (sameCat) catSel.value = sameCat;

    const subSel = document.getElementById('catBrowseBulkSubSel');
    const subBtn = document.getElementById('catBrowseBulkSubBtn');
    const subs = sameCat ? getSubcatsFor(sameCat) : [];
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

    const keys = [...catBrowseSelected];
    const pairRows = rowsForKeys(keys);
    const linkBtn = document.getElementById('catBrowseLinkBtn');
    const unlinkBtn = document.getElementById('catBrowseUnlinkBtn');
    if (linkBtn) {
      const canLink = keys.length === 2 && pairRows.length === 2
        && !validateTxnPair(pairRows[0], pairRows[1], keys[0], keys[1]);
      linkBtn.disabled = !canLink;
      linkBtn.title = canLink ? '将付款与返款配对，标记探店完成' : '需选中一笔支出与一笔收入，且金额相等、均未配对';
    }
    if (unlinkBtn) {
      let canUnlink = false;
      if (keys.length === 1 && findPairForKey(keys[0])) canUnlink = true;
      if (keys.length === 2 && findPairForKey(keys[0]) && findPairForKey(keys[0]) === findPairForKey(keys[1])) {
        canUnlink = true;
      }
      unlinkBtn.disabled = !canUnlink;
    }
  } else {
    bar.classList.remove('show');
  }
}

export function toggleCatBrowseSelect(key, cb) {
  if (cb.checked) catBrowseSelected.add(key);
  else catBrowseSelected.delete(key);
  const row = document.querySelector(`.catbrowse-row[data-sel-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('selected', cb.checked);
  syncSelectAllUI(rowsForCat(activeCat));
  updateCatBrowseBulkBar();
}

export function toggleCatBrowseGroupSelect(groupKeyVal, cb) {
  const sep = groupKeyVal.indexOf('|');
  if (sep < 0) return;
  const cat = groupKeyVal.slice(0, sep);
  const sub = groupKeyVal.slice(sep + 1);
  const subRows = rowsForCat(cat).filter(r => !r._statsMerge && (r['子分类'] || '未分类') === sub);
  const keys = subRows.map(selKey);
  if (cb.checked) keys.forEach(k => catBrowseSelected.add(k));
  else keys.forEach(k => catBrowseSelected.delete(k));
  renderCatBrowse();
}

export function toggleCatBrowseSelectAll(masterCb) {
  const keys = rowsForCat(activeCat).filter(r => !r._statsMerge).map(selKey);
  if (masterCb.checked) keys.forEach(k => catBrowseSelected.add(k));
  else keys.forEach(k => catBrowseSelected.delete(k));
  renderCatBrowse();
}

export function clearCatBrowseSelection() {
  catBrowseSelected.clear();
  renderCatBrowse();
}

function clearTabHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
  if (holdTab) {
    holdTab.classList.remove('hold-ready');
    if (!holdTab.classList.contains('dragging')) holdTab.removeAttribute('draggable');
    holdTab = null;
  }
}

function ensureBodyEvents() {
  const bodyEl = document.getElementById('catBrowseBody');
  if (!bodyEl || bodyBound) return;
  bodyBound = true;
  bodyEl.addEventListener('click', e => {
    if (e.target.closest('.catbrowse-row-check') || e.target.closest('.catbrowse-grp-check')) return;
    const head = e.target.closest('.catbrowse-group-head');
    if (!head) return;
    const sec = head.closest('[data-group-key]');
    if (!sec) return;
    const key = sec.dataset.groupKey;
    const sep = key.indexOf('|');
    if (sep < 0) return;
    toggleCatBrowseGroup(key.slice(0, sep), key.slice(sep + 1));
  });

  bodyEl.addEventListener('change', e => {
    const grpCb = e.target.closest('.catbrowse-grp-check input[type="checkbox"]');
    if (grpCb) {
      const sec = grpCb.closest('[data-group-key]');
      if (sec) toggleCatBrowseGroupSelect(sec.dataset.groupKey, grpCb);
      return;
    }
    const rowCb = e.target.closest('.catbrowse-row-check input[type="checkbox"]');
    if (rowCb) {
      const row = rowCb.closest('.catbrowse-row');
      if (row) toggleCatBrowseSelect(row.dataset.selKey, rowCb);
    }
  });
}

function ensureTabsEvents() {
  const tabsEl = document.getElementById('catBrowseTabs');
  if (!tabsEl || tabsBound) return;
  tabsBound = true;

  tabsEl.addEventListener('pointerdown', e => {
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    clearTabHold();
    holdTab = tab;
    holdTimer = setTimeout(() => {
      if (!holdTab) return;
      holdTab.classList.add('hold-ready');
      holdTab.setAttribute('draggable', 'true');
    }, TAB_HOLD_MS);
  });

  tabsEl.addEventListener('pointerup', clearTabHold);
  tabsEl.addEventListener('pointercancel', clearTabHold);

  tabsEl.addEventListener('click', e => {
    if (suppressTabClick) {
      suppressTabClick = false;
      return;
    }
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    selectCatBrowse(tab.dataset.cat);
  });

  tabsEl.addEventListener('dragstart', e => {
    const tab = e.target.closest('[data-cat]');
    if (!tab?.hasAttribute('draggable')) {
      e.preventDefault();
      return;
    }
    dragFromIdx = getCats().indexOf(tab.dataset.cat);
    e.dataTransfer.effectAllowed = 'move';
    tab.classList.add('dragging');
    if (holdTimer) clearTimeout(holdTimer);
  });

  tabsEl.addEventListener('dragend', e => {
    const tab = e.target.closest('[data-cat]');
    tab?.classList.remove('dragging', 'hold-ready');
    tab?.removeAttribute('draggable');
    dragFromIdx = null;
    holdTab = null;
    suppressTabClick = true;
    tabsEl.querySelectorAll('.catbrowse-tab').forEach(t => t.classList.remove('drag-over'));
  });

  tabsEl.addEventListener('dragover', e => {
    if (dragFromIdx == null) return;
    e.preventDefault();
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    tabsEl.querySelectorAll('.catbrowse-tab').forEach(t => t.classList.remove('drag-over'));
    tab.classList.add('drag-over');
  });

  tabsEl.addEventListener('drop', e => {
    if (dragFromIdx == null) return;
    e.preventDefault();
    const tab = e.target.closest('[data-cat]');
    if (!tab) return;
    const toIdx = getCats().indexOf(tab.dataset.cat);
    tabsEl.querySelectorAll('.catbrowse-tab').forEach(t => t.classList.remove('drag-over'));
    if (toIdx >= 0 && dragFromIdx !== toIdx) onReorderCats(dragFromIdx, toIdx);
    dragFromIdx = null;
  });
}

export function toggleCatBrowseGroup(cat, sub) {
  const key = groupKey(cat, sub);
  if (collapsedGroups.has(key)) collapsedGroups.delete(key);
  else collapsedGroups.add(key);
  const sec = document.querySelector(`[data-group-key="${CSS.escape(key)}"]`);
  if (sec) {
    sec.classList.toggle('collapsed', collapsedGroups.has(key));
    const toggle = sec.querySelector('.catbrowse-group-toggle');
    if (toggle) toggle.classList.toggle('collapsed', collapsedGroups.has(key));
  } else {
    renderCatBrowse();
  }
}

export function selectCatBrowse(cat) {
  if (!cat) return;
  activeCat = cat;
  renderCatBrowse();
}

export function renderCatBrowse() {
  const tabsEl = document.getElementById('catBrowseTabs');
  const bodyEl = document.getElementById('catBrowseBody');
  const summaryEl = document.getElementById('catBrowseSummary');
  const chartEl = document.getElementById('catBrowseSubChart');
  if (!tabsEl || !bodyEl) return;

  ensureTabsEvents();
  ensureBodyEvents();
  renderCatBrowseYearSelect();
  syncCatBrowseDateInputs();

  const cats = getCats();
  if (!activeCat || !cats.includes(activeCat)) {
    activeCat = cats.find(c => rowsForCat(c).length > 0) || cats[0] || '';
  }

  tabsEl.innerHTML = cats.map((c, i) => {
    const rows = rowsForCat(c);
    const cnt = rows.length;
    const amt = browseTabAmount(c, rows);
    const on = c === activeCat ? ' on' : '';
    const empty = cnt === 0 ? ' empty' : '';
    return `<button type="button" class="catbrowse-tab${on}${empty}" data-cat="${c}" data-idx="${i}" title="点击切换；长按拖动排序">
      ${getEmoji(c)}
      <span class="catbrowse-tab-name">${c}</span>
      <span class="catbrowse-tab-meta${amt.cls ? ` ${amt.cls}` : ''}">${amt.text}</span>
    </button>`;
  }).join('');

  const rows = rowsForCat(activeCat);
  if (summaryEl) {
    const selectAll = rows.length
      ? `<label class="catbrowse-select-all" onclick="event.stopPropagation()">
          <input type="checkbox" class="cb" id="catBrowseSelAll" onchange="toggleCatBrowseSelectAll(this)">
          <span>全选本分类</span>
        </label>`
      : '';
    if (!rows.length) {
      summaryEl.innerHTML = `<span class="catbrowse-summary-name">${getEmoji(activeCat)} ${activeCat}</span><span class="catbrowse-summary-meta">${browseEmptyRangeLabel()}暂无账目</span>`;
      if (chartEl) {
        chartEl.innerHTML = '';
        chartEl.classList.add('hide');
      }
    } else {
      summaryEl.innerHTML = `<span class="catbrowse-summary-name">${getEmoji(activeCat)} ${activeCat}</span><span class="catbrowse-summary-meta">${subcatMeta(rows)}</span>${selectAll}`;
    }
  }

  if (!rows.length) {
    if (chartEl) {
      chartEl.innerHTML = '';
      chartEl.classList.add('hide');
    }
    bodyEl.innerHTML = `<div class="catbrowse-empty"><i class="ti ti-inbox"></i>${browseEmptyRangeLabel()}该分类暂无账目</div>`;
    updateCatBrowseBulkBar();
    return;
  }

  const subcats = subcatsForBrowse(activeCat, rows);
  if (chartEl) {
    const chartHtml = buildSubcatChartHtml(activeCat, rows, subcats);
    chartEl.innerHTML = chartHtml;
    chartEl.classList.toggle('hide', !chartHtml);
    ensureSubchartTooltip();
  }

  bodyEl.innerHTML = subcats.map(sub => {
    const key = groupKey(activeCat, sub);
    const collapsed = collapsedGroups.has(key);
    const subRows = rows
      .filter(r => (r['子分类'] || '未分类') === sub)
      .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
    const grpKeys = subRows.map(selKey);
    const grpAll = grpKeys.length > 0 && grpKeys.every(k => catBrowseSelected.has(k));
    const grpSome = grpKeys.some(k => catBrowseSelected.has(k));
    const grpChecked = grpAll ? 'checked' : '';
    const grpIndet = !grpAll && grpSome ? ' data-indet="1"' : '';
    return `<section class="catbrowse-group${collapsed ? ' collapsed' : ''}" data-group-key="${key}">
      <header class="catbrowse-group-head">
        <div class="catbrowse-grp-check" onclick="event.stopPropagation()">
          <input type="checkbox" class="cb" ${grpChecked}${grpIndet}>
        </div>
        <button type="button" class="catbrowse-group-toggle${collapsed ? ' collapsed' : ''}" tabindex="-1"><i class="ti ti-chevron-down"></i></button>
        <h4 class="catbrowse-group-title">${subCatGroupTitleHtml(sub)}</h4>
        <span class="catbrowse-group-meta">${subcatMeta(subRows)}</span>
      </header>
      <div class="catbrowse-group-list">${subRows.map(renderBrowseRow).join('')}</div>
    </section>`;
  }).join('');

  bodyEl.querySelectorAll('.catbrowse-grp-check input[data-indet]').forEach(cb => {
    cb.indeterminate = true;
  });
  syncSelectAllUI(rows);
  updateCatBrowseBulkBar();
}
