import { assetUrl, API_BASE } from './apiBase.js';
import { fmtMoney } from './format.js';
import {
  fetchFamilyEvents,
  fetchFamilyEventStorage,
  createFamilyEvent,
  updateFamilyEvent,
  deleteFamilyEvent,
  uploadFamilyEventImage,
  deleteFamilyEventImage,
} from './api.js';

let events = [];
let editingId = null;
let pendingFiles = [];
let familySearchQuery = '';
let storageStats = null;
let linkedTxnIds = [];
let familyTxnSearchQuery = '';
const FAMILY_VIEW_KEY = 'familyViewMode';
let familyViewMode = (() => {
  try {
    const v = localStorage.getItem(FAMILY_VIEW_KEY);
    return v === 'list' ? 'list' : 'timeline';
  } catch {
    return 'timeline';
  }
})();

let getAllData = () => [];
let rowSearchHaystack = () => '';
let rowDisplayTitle = row => (row['交易对方'] || row['产品名称'] || '—').trim();
let formatTxnDateLabel = date => date || '—';
let formatTxnTimeShort = time => time || '';

export function initFamily(deps) {
  getAllData = deps.getAllData || getAllData;
  rowSearchHaystack = deps.rowSearchHaystack || rowSearchHaystack;
  rowDisplayTitle = deps.rowDisplayTitle || rowDisplayTitle;
  formatTxnDateLabel = deps.formatDateLabel || formatTxnDateLabel;
  formatTxnTimeShort = deps.formatTimeShort || formatTxnTimeShort;
}

function txnById(id) {
  return getAllData().find(r => r.id === id);
}

function linkedTxnRows(ids = linkedTxnIds) {
  return (ids || []).map(id => txnById(id)).filter(Boolean);
}

function renderFamilyLinkedTxns() {
  const wrap = document.getElementById('familyLinkedTxns');
  if (!wrap) return;
  const rows = linkedTxnRows();
  if (!rows.length) {
    wrap.innerHTML = '<p class="family-txn-empty">暂无关联交易，点击「添加」从账本中搜索。</p>';
    return;
  }
  wrap.innerHTML = rows.map(row => {
    const isInc = row['收支'] === '收入';
    const sub = (row['子分类'] || '').trim();
    const catTxt = sub ? `${row['分类']} · ${sub}` : (row['分类'] || '—');
    return `<div class="family-txn-item">
      <div class="family-txn-item-main">
        <div class="family-txn-item-title">${esc(rowDisplayTitle(row))}</div>
        <div class="family-txn-item-meta">${esc(formatTxnDateLabel(row['日期']))}${row['时间'] ? ` ${esc(formatTxnTimeShort(row['时间']))}` : ''} · ${esc(catTxt)}</div>
      </div>
      <div class="family-txn-item-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
      <button type="button" class="family-txn-item-remove" onclick="removeFamilyLinkedTxn(${row.id})" title="移除关联" aria-label="移除关联"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
}

function linkedTxnTotals(ids = []) {
  const rows = linkedTxnRows(ids);
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    const amt = Math.abs(Number(row['金额']) || 0);
    if (row['收支'] === '收入') income += amt;
    else expense += amt;
  }
  return { income, expense };
}

function linkedTxnTitleSuffix(ids = []) {
  const { income, expense } = linkedTxnTotals(ids);
  const parts = [];
  if (income > 0) parts.push(`收入${fmtYuan(income)}元`);
  if (expense > 0) parts.push(`支出${fmtYuan(expense)}元`);
  return parts.join('/');
}

function fmtYuan(n) {
  const num = Math.abs(Number(n));
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(2);
}

function renderFamilyLinkedTxnsSummary(ev) {
  const rows = linkedTxnRows(ev.linkedTxnIds || []);
  if (!rows.length) return '';
  const items = rows.map(row => {
    const isInc = row['收支'] === '收入';
    return `<div class="family-milestone-txn-row ${isInc ? 'inc' : 'exp'}">
      <span class="family-milestone-txn-name">${esc(rowDisplayTitle(row))}</span>
      <span class="family-milestone-txn-amt">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</span>
    </div>`;
  }).join('');
  return `<div class="family-milestone-txn-list" onclick="event.stopPropagation()">${items}</div>`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function currentEventDate() {
  return document.getElementById('familyDateInp')?.value?.trim() || '';
}

/** 解析搜索框：空=事件当天；日期格式=按日/月筛选；其它=关键词 */
function parseTxnSearchQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return { mode: 'eventDate' };

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { mode: 'date', date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` };

  m = raw.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return { mode: 'date', date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` };

  m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { mode: 'date', date: `${m[1]}-${m[2]}-${m[3]}` };

  m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (m) return { mode: 'date', date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` };

  m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { mode: 'month', month: `${m[1]}-${pad2(m[2])}` };

  m = raw.match(/^(\d{4})年(\d{1,2})月?$/);
  if (m) return { mode: 'month', month: `${m[1]}-${pad2(m[2])}` };

  return { mode: 'text', needle: raw.toLowerCase() };
}

function familyTxnSearchEmptyMessage() {
  const q = String(familyTxnSearchQuery || '').trim();
  if (!q) {
    const d = currentEventDate();
    if (d) return `${formatDateLabel(d)} 暂无其他可关联交易`;
    return '请先填写事件日期，或输入日期/关键词搜索';
  }
  const parsed = parseTxnSearchQuery(q);
  if (parsed.mode === 'date') return `${formatDateLabel(parsed.date)} 没有匹配的交易`;
  if (parsed.mode === 'month') return `${parsed.month.replace('-', '年')}月 没有匹配的交易`;
  return '没有匹配的交易';
}

function familyTxnSearchResults(limit = 40) {
  const linked = new Set(linkedTxnIds);
  const all = getAllData()
    .filter(row => !linked.has(row.id))
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));

  const parsed = parseTxnSearchQuery(familyTxnSearchQuery);

  if (parsed.mode === 'eventDate') {
    const eventDate = currentEventDate();
    if (eventDate) {
      return all.filter(row => row['日期'] === eventDate).slice(0, limit);
    }
    return all.slice(0, limit);
  }

  if (parsed.mode === 'date') {
    return all.filter(row => row['日期'] === parsed.date).slice(0, limit);
  }

  if (parsed.mode === 'month') {
    return all.filter(row => String(row['日期'] || '').startsWith(parsed.month)).slice(0, limit);
  }

  const needle = parsed.needle;
  return all.filter(row => {
    const hay = `${rowSearchHaystack(row)} ${row['日期'] || ''}`.toLowerCase();
    return hay.includes(needle);
  }).slice(0, limit);
}

function familyTxnRowsForEventDay(limit = 12) {
  const eventDate = currentEventDate();
  if (!eventDate) return [];
  const linked = new Set(linkedTxnIds);
  return getAllData()
    .filter(row => !linked.has(row.id) && row['日期'] === eventDate)
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']))
    .slice(0, limit);
}

function familyTxnPickItemHtml(row) {
  const isInc = row['收支'] === '收入';
  const sub = (row['子分类'] || '').trim();
  const catTxt = sub ? `${row['分类']} · ${sub}` : (row['分类'] || '—');
  return `<button type="button" class="family-txn-search-item" onclick="pickFamilyLinkedTxn(${row.id})">
      <div class="family-txn-search-main">
        <div class="family-txn-search-title">${esc(rowDisplayTitle(row))}</div>
        <div class="family-txn-search-meta">${esc(formatTxnDateLabel(row['日期']))}${row['时间'] ? ` ${esc(formatTxnTimeShort(row['时间']))}` : ''} · ${esc(catTxt)} · ${esc(row['来源'] || '')}</div>
      </div>
      <div class="family-txn-search-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
    </button>`;
}

function updateFamilyTxnSearchScope() {
  const el = document.getElementById('familyTxnSearchScope');
  if (!el) return;
  const q = String(familyTxnSearchQuery || '').trim();
  if (q) {
    const parsed = parseTxnSearchQuery(q);
    if (parsed.mode === 'date') el.textContent = `按日期：${formatDateLabel(parsed.date)}`;
    else if (parsed.mode === 'month') el.textContent = `按月份：${parsed.month.replace('-', '年')}月`;
    else el.textContent = `关键词：${q}`;
    return;
  }
  const d = currentEventDate();
  el.textContent = d ? `默认显示事件当天 · ${formatDateLabel(d)}` : '请先填写事件日期';
}

function renderFamilyTxnDayPick() {
  const block = document.getElementById('familyTxnDayBlock');
  const label = document.getElementById('familyTxnDayLabel');
  const wrap = document.getElementById('familyTxnDayPick');
  if (!block || !wrap) return;

  const eventDate = currentEventDate();
  if (!eventDate) {
    block.hidden = true;
    return;
  }

  const rows = familyTxnRowsForEventDay(12);
  block.hidden = false;
  if (label) {
    label.textContent = `${formatDateLabel(eventDate)} 可关联（${rows.length} 笔）`;
  }
  if (!rows.length) {
    wrap.innerHTML = '<p class="family-txn-day-empty">当日暂无可关联的其他交易</p>';
    return;
  }
  wrap.innerHTML = rows.map(familyTxnPickItemHtml).join('');
}

function onFamilyEventDateChange() {
  renderFamilyTxnDayPick();
  if (!document.getElementById('moFamilyTxnSearch')?.classList.contains('hide')) {
    renderFamilyTxnSearchResults();
    updateFamilyTxnSearchScope();
  }
}

function renderFamilyTxnSearchResults() {
  updateFamilyTxnSearchScope();
  const wrap = document.getElementById('familyTxnSearchResults');
  if (!wrap) return;
  const rows = familyTxnSearchResults();
  if (!rows.length) {
    wrap.innerHTML = `<div class="family-txn-search-empty">${familyTxnSearchEmptyMessage()}</div>`;
    return;
  }
  wrap.innerHTML = rows.map(familyTxnPickItemHtml).join('');
}

export function openFamilyTxnSearch() {
  familyTxnSearchQuery = '';
  const inp = document.getElementById('familyTxnSearchInp');
  if (inp) inp.value = '';
  renderFamilyTxnSearchResults();
  document.getElementById('moFamilyTxnSearch')?.classList.remove('hide');
  setTimeout(() => document.getElementById('familyTxnSearchInp')?.focus(), 60);
}

export function closeFamilyTxnSearch() {
  document.getElementById('moFamilyTxnSearch')?.classList.add('hide');
  familyTxnSearchQuery = '';
}

export function onFamilyTxnSearch(query) {
  familyTxnSearchQuery = query;
  renderFamilyTxnSearchResults();
}

export function pickFamilyLinkedTxn(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0 || linkedTxnIds.includes(n)) return;
  if (linkedTxnIds.length >= 50) {
    alert('每个事件最多关联 50 笔交易');
    return;
  }
  if (!txnById(n)) {
    alert('交易不存在');
    return;
  }
  linkedTxnIds = [...linkedTxnIds, n];
  renderFamilyLinkedTxns();
  renderFamilyTxnDayPick();
  renderFamilyTxnSearchResults();
}

export function removeFamilyLinkedTxn(id) {
  const n = Number(id);
  linkedTxnIds = linkedTxnIds.filter(x => x !== n);
  renderFamilyLinkedTxns();
  renderFamilyTxnDayPick();
  if (!document.getElementById('moFamilyTxnSearch')?.classList.contains('hide')) {
    renderFamilyTxnSearchResults();
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || '';
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function formatTimelineDate(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || '';
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function parseEventDateParts(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { year: '—', month: '—', day: '—' };
  return {
    year: m[1],
    month: `${Number(m[2])}月`,
    day: String(Number(m[3])),
  };
}

function sortedFamilyEvents() {
  return [...events].sort((a, b) =>
    String(b.eventDate).localeCompare(String(a.eventDate)) || (b.id || 0) - (a.id || 0)
  );
}

function familyMatchesSearch(ev, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const linkedHay = linkedTxnRows(ev.linkedTxnIds || [])
    .map(row => rowSearchHaystack(row))
    .join(' ');
  const hay = [
    ev.title,
    ev.notes,
    ev.eventDate,
    formatDateLabel(ev.eventDate),
    formatTimelineDate(ev.eventDate),
    linkedHay,
  ].join(' ').toLowerCase();
  return hay.includes(needle);
}

function filteredFamilyEvents() {
  return sortedFamilyEvents().filter(ev => familyMatchesSearch(ev, familySearchQuery));
}

function syncFamilySearchClear() {
  const btn = document.getElementById('familySearchClear');
  if (!btn) return;
  btn.classList.toggle('hide', !familySearchQuery.trim());
}

function renderFamilyImages(imgs) {
  if (!imgs?.length) return '';
  const cells = imgs.map(img => `
    <a class="family-feed-img" href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
      <img src="${esc(assetUrl(img.url))}" alt="">
    </a>
  `).join('');
  const cls = imgs.length === 1 ? 'family-feed-media--1'
    : imgs.length === 2 ? 'family-feed-media--2'
      : imgs.length === 4 ? 'family-feed-media--4'
        : 'family-feed-media--n';
  return `<div class="family-feed-media ${cls}">${cells}</div>`;
}

function renderFamilyEventMain(ev) {
  const mediaHtml = renderFamilyImages(ev.images || []);
  const txnSuffix = linkedTxnTitleSuffix(ev.linkedTxnIds || []);
  return `<div class="family-milestone-head">
      <h3 class="family-milestone-title">${esc(ev.title)}${txnSuffix ? `<span class="family-milestone-title-sum">${esc(txnSuffix)}</span>` : ''}</h3>
      <button type="button" class="family-milestone-edit" onclick="event.stopPropagation();openFamilyEdit(${ev.id})" title="编辑" aria-label="编辑"><i class="ti ti-pencil"></i></button>
    </div>
    ${ev.notes ? `<p class="family-milestone-notes">${esc(ev.notes)}</p>` : ''}
    ${mediaHtml}
    ${renderFamilyLinkedTxnsSummary(ev)}`;
}

function renderFamilyMilestoneItem(ev, index, showYear, year) {
  const side = index % 2 === 0 ? 'is-left' : 'is-right';
  const date = parseEventDateParts(ev.eventDate);
  const dateHtml = `<div class="family-milestone-date" aria-label="${esc(formatDateLabel(ev.eventDate))}">
          <span class="family-milestone-month">${esc(date.month)}</span>
          <span class="family-milestone-day">${esc(date.day)}</span>
          <span class="family-milestone-year-num">${esc(date.year)}</span>
        </div>`;
  const mainHtml = `<div class="family-milestone-main">${renderFamilyEventMain(ev)}</div>`;
  const bodyHtml = side === 'is-left' ? `${dateHtml}${mainHtml}` : `${mainHtml}${dateHtml}`;
  return `${showYear ? `<div class="family-milestone-year"><span>${esc(year)}</span></div>` : ''}
  <article class="family-milestone ${side}" onclick="openFamilyEdit(${ev.id})">
    <div class="family-milestone-card">
      <div class="family-milestone-body">${bodyHtml}</div>
    </div>
    <div class="family-milestone-marker" aria-hidden="true"><span class="family-milestone-dot"></span></div>
  </article>`;
}

function renderFamilyListItem(ev, showYear, year) {
  return `${showYear ? `<div class="family-milestone-year"><span>${esc(year)}</span></div>` : ''}
  <article class="family-list-item" onclick="openFamilyEdit(${ev.id})">
    <div class="family-list-date" aria-label="${esc(formatDateLabel(ev.eventDate))}">
      <span class="family-list-date-text">${esc(formatTimelineDate(ev.eventDate))}</span>
    </div>
    <div class="family-list-card">${renderFamilyEventMain(ev)}</div>
  </article>`;
}

function syncFamilyViewToggle() {
  document.querySelectorAll('#familyViewSeg .fb-seg-btn').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.val === familyViewMode);
  });
}

export function setFamilyViewMode(mode) {
  if (mode !== 'list' && mode !== 'timeline') return;
  familyViewMode = mode;
  try { localStorage.setItem(FAMILY_VIEW_KEY, mode); } catch { /* ignore */ }
  syncFamilyViewToggle();
  renderFamilyPage();
}

function syncEvents(list) {
  events = Array.isArray(list) ? list : [];
  const countEl = document.getElementById('familyCount');
  if (countEl) {
    const total = events.length;
    const shown = filteredFamilyEvents().length;
    if (familySearchQuery.trim() && total) {
      countEl.textContent = shown ? `匹配 ${shown} / ${total} 条` : `无匹配 · 共 ${total} 条`;
    } else {
      countEl.textContent = total ? `${total} 条` : '';
    }
  }
  syncFamilySearchClear();
}

function formatStorageBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function storageLevel(percent) {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warn';
  return 'ok';
}

function isLocalFamilyStorage() {
  if (!API_BASE) return true;
  try {
    const host = new URL(API_BASE).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function familyStorageHintText(limitMb, level) {
  if (level === 'danger') {
    return '存储空间即将用尽，请删除旧事件中的照片或调大上限。';
  }
  if (level === 'warn') {
    return '存储使用较高，建议清理不再需要的照片。';
  }
  if (isLocalFamilyStorage()) {
    return `照片保存在本机，当前上限 ${limitMb} MB。`;
  }
  return `照片保存在服务器，当前上限 ${limitMb} MB。`;
}

function renderFamilyStorage() {
  const wrap = document.getElementById('familyStorage');
  const meta = document.getElementById('familyStorageMeta');
  const fill = document.getElementById('familyStorageFill');
  const bar = document.getElementById('familyStorageBar');
  const hint = document.getElementById('familyStorageHint');
  if (!wrap) return;
  if (!storageStats) {
    wrap.hidden = true;
    return;
  }

  const { totalBytes, fileCount, limitBytes, limitMb, percent } = storageStats;
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const level = storageLevel(pct);

  wrap.hidden = false;
  wrap.dataset.level = level;
  if (meta) {
    meta.textContent = `${formatStorageBytes(totalBytes)} / ${formatStorageBytes(limitBytes)} · ${fileCount} 张`;
  }
  if (fill) fill.style.width = `${pct}%`;
  if (bar) {
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.setAttribute('aria-label', `已用 ${Math.round(pct * 10) / 10}%`);
  }
  if (hint) {
    hint.textContent = familyStorageHintText(limitMb, level);
  }
}

async function refreshFamilyStorage() {
  try {
    storageStats = await fetchFamilyEventStorage();
    renderFamilyStorage();
  } catch {
    storageStats = null;
    renderFamilyStorage();
  }
}

function renderPendingPreviews() {
  const wrap = document.getElementById('familyPendingImgs');
  if (!wrap) return;
  if (!pendingFiles.length) {
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = pendingFiles.map((file, i) => {
    const url = URL.createObjectURL(file);
    return `<div class="family-pending-item" data-i="${i}">
      <img src="${url}" alt="">
      <button type="button" class="family-img-del" data-pending="${i}" title="移除"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
}

function renderSavedImages(ev) {
  const wrap = document.getElementById('familySavedImgs');
  if (!wrap) return;
  const imgs = ev?.images || [];
  if (!imgs.length) {
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = imgs.map(img => `
    <div class="family-saved-item">
      <a href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener">
        <img src="${esc(assetUrl(img.url))}" alt="">
      </a>
      <button type="button" class="family-img-del" data-remove="${esc(img.name)}" title="删除图片"><i class="ti ti-x"></i></button>
    </div>
  `).join('');
}

function fillForm(ev) {
  document.getElementById('familyTitleInp').value = ev?.title || '';
  document.getElementById('familyDateInp').value = ev?.eventDate || todayYmd();
  document.getElementById('familyNotesInp').value = ev?.notes || '';
  linkedTxnIds = [...(ev?.linkedTxnIds || [])];
  pendingFiles = [];
  const dateInp = document.getElementById('familyDateInp');
  if (dateInp && !dateInp.dataset.familyTxnBound) {
    dateInp.dataset.familyTxnBound = '1';
    dateInp.addEventListener('change', onFamilyEventDateChange);
  }
  renderPendingPreviews();
  renderSavedImages(ev);
  renderFamilyLinkedTxns();
  renderFamilyTxnDayPick();
  const delBtn = document.getElementById('familyDeleteBtn');
  if (delBtn) delBtn.hidden = !ev?.id;
  const title = document.querySelector('#moFamily .mh h3');
  if (title) {
    title.innerHTML = ev?.id
      ? '<i class="ti ti-home-heart" style="color:var(--primary);margin-right:6px"></i>编辑家庭事件'
      : '<i class="ti ti-home-heart" style="color:var(--primary);margin-right:6px"></i>新增家庭事件';
  }
}

export function renderFamilyPage() {
  const listEl = document.getElementById('familyList');
  if (!listEl) return;
  syncFamilyViewToggle();

  if (!events.length) {
    listEl.innerHTML = `<div class="family-empty">
      <i class="ti ti-home-heart"></i>
      <p>还没有家庭事件</p>
      <button type="button" class="btn btn-p" onclick="openFamilyCreate()"><i class="ti ti-plus"></i> 新增事件</button>
    </div>`;
    return;
  }

  const items = filteredFamilyEvents();
  if (!items.length) {
    listEl.innerHTML = `<div class="family-empty">
      <i class="ti ti-search"></i>
      <p>没有匹配的事件</p>
      <button type="button" class="btn btn-sm" onclick="clearFamilySearch()">清除搜索</button>
    </div>`;
    return;
  }

  let lastYear = '';
  const rows = items.map((ev, index) => {
    const year = String(ev.eventDate || '').slice(0, 4);
    const showYear = !!(year && year !== lastYear);
    if (showYear) lastYear = year;
    return familyViewMode === 'list'
      ? renderFamilyListItem(ev, showYear, year)
      : renderFamilyMilestoneItem(ev, index, showYear, year);
  }).join('');

  const containerClass = familyViewMode === 'list' ? 'family-rows' : 'family-timeline';
  listEl.innerHTML = `<div class="${containerClass}">${rows}</div>`;
}

export function onFamilySearch(query) {
  familySearchQuery = query;
  syncEvents(events);
  renderFamilyPage();
}

export function clearFamilySearch() {
  familySearchQuery = '';
  const inp = document.getElementById('familySearchInp');
  if (inp) inp.value = '';
  syncEvents(events);
  renderFamilyPage();
}

export async function loadFamilyEvents() {
  const data = await fetchFamilyEvents();
  syncEvents(data.events || []);
  renderFamilyPage();
  await refreshFamilyStorage();
}

export function openFamilyCreate() {
  editingId = null;
  fillForm(null);
  document.getElementById('moFamily')?.classList.remove('hide');
}

export function openFamilyEdit(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  editingId = id;
  fillForm(ev);
  document.getElementById('moFamily')?.classList.remove('hide');
}

export function closeFamilyEdit() {
  document.getElementById('moFamily')?.classList.add('hide');
  closeFamilyTxnSearch();
  editingId = null;
  pendingFiles = [];
  linkedTxnIds = [];
}

export function triggerFamilyUpload() {
  document.getElementById('familyFileInp')?.click();
}

async function refreshAfterMutation(ev) {
  const idx = events.findIndex(e => e.id === ev.id);
  if (idx >= 0) events[idx] = ev;
  else events.unshift(ev);
  events.sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)) || b.id - a.id);
  syncEvents(events);
  renderFamilyPage();
  fillForm(ev);
  editingId = ev.id;
  await refreshFamilyStorage();
}

export async function saveFamilyEdit() {
  const title = document.getElementById('familyTitleInp')?.value?.trim() || '';
  const eventDate = document.getElementById('familyDateInp')?.value || '';
  const notes = document.getElementById('familyNotesInp')?.value?.trim() || '';
  if (!title) {
    alert('请填写事件标题');
    return;
  }
  if (!eventDate) {
    alert('请选择日期');
    return;
  }

  try {
    let ev;
    const payload = { title, eventDate, notes, linkedTxnIds: [...linkedTxnIds] };
    if (editingId) {
      ev = await updateFamilyEvent(editingId, payload);
    } else {
      ev = await createFamilyEvent(payload);
    }

    for (const file of pendingFiles) {
      ev = await uploadFamilyEventImage(ev.id, file);
    }
    pendingFiles = [];
    await refreshAfterMutation(ev);
    closeFamilyEdit();
  } catch (err) {
    alert(err.message || '保存失败');
  }
}

export async function removeFamilyEvent() {
  if (!editingId) return;
  if (!confirm('确定删除这条家庭事件？图片也会一并删除。')) return;
  try {
    await deleteFamilyEvent(editingId);
    events = events.filter(e => e.id !== editingId);
    syncEvents(events);
    renderFamilyPage();
    await refreshFamilyStorage();
    closeFamilyEdit();
  } catch (err) {
    alert(err.message || '删除失败');
  }
}

export function setupFamilyEvents() {
  const fileInp = document.getElementById('familyFileInp');
  if (fileInp && !fileInp.dataset.bound) {
    fileInp.dataset.bound = '1';
    fileInp.addEventListener('change', () => {
      const files = [...(fileInp.files || [])].filter(f =>
        f.type?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name || '')
      );
      if (!files.length) {
        fileInp.value = '';
        return;
      }
      pendingFiles = [...pendingFiles, ...files].slice(0, 12);
      renderPendingPreviews();
      fileInp.value = '';
    });
  }

  const modal = document.getElementById('moFamily');
  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('click', async (e) => {
      const pendingBtn = e.target.closest('[data-pending]');
      if (pendingBtn) {
        const i = Number(pendingBtn.getAttribute('data-pending'));
        pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
        renderPendingPreviews();
        return;
      }
      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn && editingId) {
        const name = removeBtn.getAttribute('data-remove');
        if (!confirm('删除这张图片？')) return;
        try {
          const ev = await deleteFamilyEventImage(editingId, name);
          await refreshAfterMutation(ev);
        } catch (err) {
          alert(err.message || '删除图片失败');
        }
      }
    });
  }
}
