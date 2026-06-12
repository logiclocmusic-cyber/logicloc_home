/** 分类检索：顶部分类标签，下方按子分类分组展示账目 */
import { fmtMoney, fmtCount } from './format.js';
import { catPickBtnHtml } from './cat-picker.js';
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

let activeCat = '';
let tabsBound = false;
let bodyBound = false;
let dragFromIdx = null;
let holdTimer = null;
let holdTab = null;
let suppressTabClick = false;
const TAB_HOLD_MS = 320;
const collapsedGroups = new Set();
const catBrowseSelected = new Set();
let filterUnsetSubOnly = false;

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

function rowsForCat(cat) {
  let rows = getExpandedRows().filter(r => r['分类'] === cat);
  if (filterUnsetSubOnly) rows = rows.filter(r => rowHasUnsetSub(r, getSubcatsFor));
  return rows;
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

function rowTitle(row) {
  return (row['产品名称'] || row['交易对方'] || '').trim() || '—';
}

function browseCatCell(row) {
  const parentId = row._splitOf ?? row.id;
  const splitIdx = row._splitIdx;
  const cat = row['分类'];
  const sub = row['子分类'] || '';
  const subs = getSubcatsFor(cat);
  const pickOpts = splitIdx != null ? { splitIdx } : {};
  const mainBtn = catPickBtnHtml(parentId, cat, pickOpts);
  const subChange = splitIdx != null
    ? `updSplitSub(${parentId},${splitIdx},this.value)`
    : `updSubCat(${parentId},this.value)`;
  const subSel = subCatSelectHtml({ subs, sub, onchange: subChange, extraClass: 'cs-compact' });
  return `<div class="catbrowse-row-cat">${mainBtn}<span class="catbrowse-cat-sep">·</span>${subSel}</div>`;
}

function renderBrowseRow(row) {
  const key = selKey(row);
  const isSel = catBrowseSelected.has(key);
  const p = rowTitle(row);
  const d = (row['商品说明'] || '').trim();
  const showDesc = d && d !== '/' && d !== p;
  const isInc = row['收支'] === '收入';
  const splitTag = row._splitOf != null ? '<span class="catbrowse-split-tag">拆分</span>' : '';
  const pairTag = findPairForKey(key)
    ? '<span class="catbrowse-pair-tag" title="付款与返款已配对，探店已完成"><i class="ti ti-link"></i> 已完成</span>'
    : '';
  return `<div class="catbrowse-row${isSel ? ' selected' : ''}${pairTag ? ' paired' : ''}" data-sel-key="${key}">
    <div class="catbrowse-row-check" onclick="event.stopPropagation()">
      <input type="checkbox" class="cb" ${isSel ? 'checked' : ''}>
    </div>
    <div class="catbrowse-row-dt">${formatDateLabel(row['日期'])}<span>${formatTimeShort(row['时间'])}</span></div>
    <div class="catbrowse-row-src">${srcBadge(row['来源'])}</div>
    <div class="catbrowse-row-peer">
      <div class="catbrowse-row-title">${p}${splitTag}${pairTag}</div>
      ${showDesc ? `<div class="catbrowse-row-desc">${d}</div>` : ''}
    </div>
    ${browseCatCell(row)}
    <div class="catbrowse-row-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}¥${row['金额'].toFixed(2)}</div>
  </div>`;
}

function syncSelectAllUI(rows) {
  const selAllCb = document.getElementById('catBrowseSelAll');
  if (!selAllCb) return;
  const keys = rows.map(selKey);
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
  const subRows = rowsForCat(cat).filter(r => (r['子分类'] || '未分类') === sub);
  const keys = subRows.map(selKey);
  if (cb.checked) keys.forEach(k => catBrowseSelected.add(k));
  else keys.forEach(k => catBrowseSelected.delete(k));
  renderCatBrowse();
}

export function toggleCatBrowseSelectAll(masterCb) {
  const keys = rowsForCat(activeCat).map(selKey);
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
  if (!tabsEl || !bodyEl) return;

  ensureTabsEvents();
  ensureBodyEvents();

  const cats = getCats();
  if (!activeCat || !cats.includes(activeCat)) {
    activeCat = cats.find(c => rowsForCat(c).length > 0) || cats[0] || '';
  }

  tabsEl.innerHTML = cats.map((c, i) => {
    const rows = rowsForCat(c);
    const cnt = rows.length;
    const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
    const on = c === activeCat ? ' on' : '';
    const empty = cnt === 0 ? ' empty' : '';
    return `<button type="button" class="catbrowse-tab${on}${empty}" data-cat="${c}" data-idx="${i}" title="点击切换；长按拖动排序">
      ${getEmoji(c)}
      <span class="catbrowse-tab-name">${c}</span>
      <span class="catbrowse-tab-meta">${cnt ? fmtMoney(exp) : '暂无'}</span>
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
      summaryEl.innerHTML = `<span class="catbrowse-summary-name">${getEmoji(activeCat)} ${activeCat}</span><span class="catbrowse-summary-meta">暂无账目</span>`;
    } else {
      summaryEl.innerHTML = `<span class="catbrowse-summary-name">${getEmoji(activeCat)} ${activeCat}</span><span class="catbrowse-summary-meta">${subcatMeta(rows)}</span>${selectAll}`;
    }
  }

  if (!rows.length) {
    bodyEl.innerHTML = '<div class="catbrowse-empty"><i class="ti ti-inbox"></i>该分类暂无账目</div>';
    updateCatBrowseBulkBar();
    return;
  }

  const subcats = subcatsForBrowse(activeCat, rows);
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
