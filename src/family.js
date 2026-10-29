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
let pageFileCat = '';
let modalFileCat = '';
let pageFileStar = false;
let modalFileStar = false;
let fileNoteEdit = null;
const selectedFileKeys = new Set();
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

function renderLinkedTxnTitleSuffixHtml(ids = []) {
  const { income, expense } = linkedTxnTotals(ids);
  const parts = [];
  if (income > 0) {
    parts.push(`<span class="family-milestone-title-sum is-inc">收入<span class="family-milestone-title-amt">${fmtYuan(income)}</span>元</span>`);
  }
  if (expense > 0) {
    parts.push(`<span class="family-milestone-title-sum is-exp">支出<span class="family-milestone-title-amt">${fmtYuan(expense)}</span>元</span>`);
  }
  if (!parts.length) return '';
  return parts.join('<span class="family-milestone-title-sum-sep">/</span>');
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

function familyAttachmentKind(fileOrName, kind) {
  if (kind === 'pdf' || kind === 'spreadsheet') return kind;
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name || '';
  const mime = typeof fileOrName === 'string' ? '' : String(fileOrName?.type || '').toLowerCase();
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (
    ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime)
    || /\.(csv|xls|xlsx)$/i.test(name)
  ) return 'spreadsheet';
  return 'image';
}

function familyAttachmentIcon(fileOrName, kind) {
  if (familyAttachmentKind(fileOrName, kind) === 'pdf') return 'ti-file-type-pdf';
  return /\.csv$/i.test(typeof fileOrName === 'string' ? fileOrName : fileOrName?.name || '')
    ? 'ti-file-type-csv'
    : 'ti-file-spreadsheet';
}

function attachmentDisplayName(img) {
  if (img?.fileName) return img.fileName;
  return familyAttachmentKind(img?.name, img?.kind) === 'pdf' ? 'PDF' : '表格文件';
}

function fileCategory(img) {
  return String(img?.category || '').trim();
}

function fileMatchesFilter(img, category, starredOnly) {
  if (starredOnly && !img?.starred) return false;
  if (!category) return true;
  if (category === '__none__') return !fileCategory(img);
  return fileCategory(img) === category;
}

function filesForCategory(imgs, category, starredOnly = false) {
  return (imgs || []).filter(img => fileMatchesFilter(img, category, starredOnly));
}

function countStarred(list = events) {
  let n = 0;
  for (const ev of list) {
    for (const img of ev.images || []) if (img.starred) n += 1;
  }
  return n;
}

function collectFileCategories(list = events) {
  const counts = new Map();
  let uncategorized = 0;
  for (const ev of list) {
    for (const img of ev.images || []) {
      const cat = fileCategory(img);
      if (!cat) uncategorized += 1;
      else counts.set(cat, (counts.get(cat) || 0) + 1);
    }
  }
  return { counts, uncategorized };
}

function renderFileCatChips(targetId, active, { counts, uncategorized }, onClickName, star = null) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const cats = [...counts.keys()];
  const showStar = !!(star && (star.count || star.active));
  if (!cats.length && !uncategorized && !showStar) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  if (active && active !== '__none__' && !counts.has(active)) active = '';
  const chips = [
    `<button type="button" class="family-file-cat${active ? '' : ' on'}" onclick="${onClickName}('')">全部</button>`,
    ...cats.map(cat => `<button type="button" class="family-file-cat${active === cat ? ' on' : ''}" onclick="${onClickName}('${esc(encodeURIComponent(cat))}')">${esc(cat)}<span>${counts.get(cat)}</span></button>`),
  ];
  if (uncategorized) {
    chips.push(`<button type="button" class="family-file-cat${active === '__none__' ? ' on' : ''}" onclick="${onClickName}('__none__')">未分类<span>${uncategorized}</span></button>`);
  }
  if (showStar) {
    chips.push(`<button type="button" class="family-file-cat family-file-star-chip${star.active ? ' on' : ''}" onclick="${star.onClick}(${star.active ? 'false' : 'true'})"><i class="ti ti-star${star.active ? '-filled' : ''}"></i>星标<span>${star.count}</span></button>`);
  }
  el.hidden = false;
  el.innerHTML = chips.join('');
}

function feedFileNoteHtml(ev, img) {
  const modalOpen = !document.getElementById('moFamily')?.classList.contains('hide');
  const editing = !modalOpen && fileNoteEdit?.pendingIndex == null && fileNoteEdit?.eventId === ev.id && fileNoteEdit?.name === img.name;
  if (editing) {
    return `<div class="family-file-note-edit" onclick="event.stopPropagation()">
      <input type="text" maxlength="40" data-file-note-input value="${esc(fileNoteEdit.draft || '')}" placeholder="如：重要文件">
      <button type="button" data-file-note-save="1">完成</button>
    </div>`;
  }
  return img.note ? `<p class="family-file-note">${esc(img.note)}</p>` : '';
}

function renderImageGrid(ev, images, compact) {
  if (!images.length) return '';
  const cells = images.map(img => {
    const cat = fileCategory(img);
    const badge = cat ? `<span class="family-file-cat-badge">${esc(cat)}</span>` : '';
    return `<div class="family-feed-file">
      <div class="family-feed-img-wrap">
        <a class="family-feed-img${compact ? ' family-feed-img--thumb' : ''}" href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><img src="${esc(assetUrl(img.url))}" alt="">${badge}</a>
        <button type="button" class="family-file-star${img.starred ? ' on' : ''}" data-feed-star="${esc(img.name)}" data-event-id="${ev.id}" title="${img.starred ? '取消星标' : '星标'}" aria-pressed="${img.starred ? 'true' : 'false'}"><i class="ti ti-star${img.starred ? '-filled' : ''}"></i></button>
        <button type="button" class="family-file-pencil" data-feed-note="${esc(img.name)}" data-event-id="${ev.id}" title="备注"><i class="ti ti-pencil"></i></button>
      </div>
      ${feedFileNoteHtml(ev, img)}
    </div>`;
  }).join('');
  if (compact) return `<div class="family-feed-media family-feed-media--thumbs">${cells}</div>`;
  const cls = images.length === 1 ? 'family-feed-media--1'
    : images.length === 2 ? 'family-feed-media--2'
      : images.length === 4 ? 'family-feed-media--4'
        : 'family-feed-media--n';
  return `<div class="family-feed-media ${cls}">${cells}</div>`;
}

function renderAttachmentList(ev, attachments) {
  if (!attachments.length) return '';
  const rows = attachments.map(img => {
    const cat = fileCategory(img);
    const name = attachmentDisplayName(img);
    const icon = familyAttachmentIcon(name, img.kind);
    return `<div class="family-pdf-row">
      <div class="family-pdf-row-main">
        <a class="family-pdf-row-link" href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${esc(name)}">
          <i class="ti ${icon}"></i>
          <span class="family-pdf-row-text">
            <span class="family-pdf-row-name">${esc(name)}</span>
            ${cat ? `<span class="family-pdf-row-cat">${esc(cat)}</span>` : ''}
          </span>
        </a>
        <button type="button" class="family-file-star${img.starred ? ' on' : ''}" data-feed-star="${esc(img.name)}" data-event-id="${ev.id}" title="${img.starred ? '取消星标' : '星标'}" aria-pressed="${img.starred ? 'true' : 'false'}"><i class="ti ti-star${img.starred ? '-filled' : ''}"></i></button>
        <button type="button" class="family-file-pencil" data-feed-note="${esc(img.name)}" data-event-id="${ev.id}" title="备注"><i class="ti ti-pencil"></i></button>
      </div>
      ${feedFileNoteHtml(ev, img)}
    </div>`;
  }).join('');
  return `<div class="family-pdf-list">${rows}</div>`;
}

function renderFamilyImages(ev, { compact = false, category = '', starredOnly = false } = {}) {
  const list = filesForCategory(ev?.images || [], category, starredOnly);
  if (!list.length) return '';
  const images = list.filter(img => familyAttachmentKind(img.name, img.kind) === 'image');
  const attachments = list.filter(img => familyAttachmentKind(img.name, img.kind) !== 'image');
  return `${renderImageGrid(ev, images, compact)}${renderAttachmentList(ev, attachments)}`;
}

function renderFamilyEventMain(ev, { compactImages = false } = {}) {
  const mediaHtml = renderFamilyImages(ev, { compact: compactImages, category: pageFileCat, starredOnly: pageFileStar });
  const txnSuffixHtml = renderLinkedTxnTitleSuffixHtml(ev.linkedTxnIds || []);
  return `<div class="family-milestone-head">
      <h3 class="family-milestone-title">${esc(ev.title)}${txnSuffixHtml}</h3>
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
    <div class="family-list-card">${renderFamilyEventMain(ev, { compactImages: true })}</div>
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
    meta.textContent = `${formatStorageBytes(totalBytes)} / ${formatStorageBytes(limitBytes)} · ${fileCount} 个文件`;
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

function fileMatchesModalCat(file) {
  return fileMatchesFilter(file, modalFileCat, modalFileStar);
}

function fileNoteDraft() {
  return String(fileNoteEdit?.draft || '');
}

function isEditingNote(eventId, name, pendingIndex = null) {
  if (!fileNoteEdit) return false;
  if (pendingIndex != null) return fileNoteEdit.pendingIndex === pendingIndex;
  return fileNoteEdit.eventId === eventId && fileNoteEdit.name === name;
}

function fileToolsHtml(key, { starred = false } = {}) {
  return `${filePickHtml(key)}
    <button type="button" class="family-file-star${starred ? ' on' : ''}" data-file-star="${esc(key)}" title="${starred ? '取消星标' : '星标'}" aria-pressed="${starred ? 'true' : 'false'}"><i class="ti ti-star${starred ? '-filled' : ''}"></i></button>
    <button type="button" class="family-file-pencil" data-file-note="${esc(key)}" title="备注"><i class="ti ti-pencil"></i></button>`;
}

function fileCaptionHtml(editing, note) {
  if (editing) {
    return `<div class="family-file-note-edit">
      <input type="text" maxlength="40" data-file-note-input value="${esc(fileNoteDraft())}" placeholder="如：重要文件">
      <button type="button" data-file-note-save="1">完成</button>
    </div>`;
  }
  return note ? `<p class="family-file-note">${esc(note)}</p>` : '';
}

function focusFileNoteInput() {
  const inp = document.querySelector('#moFamily [data-file-note-input], #familyList [data-file-note-input]');
  if (!inp) return;
  inp.focus();
  const end = inp.value.length;
  try { inp.setSelectionRange(end, end); } catch { /* ignore */ }
}

function filePickHtml(key) {
  const on = selectedFileKeys.has(key);
  return `<button type="button" class="family-file-pick${on ? ' on' : ''}" data-file-pick="${esc(key)}" title="${on ? '取消选择' : '选择'}" aria-pressed="${on ? 'true' : 'false'}"><i class="ti ti-check"></i></button>`;
}

function fileCatBadge(category) {
  const cat = String(category || '').trim();
  return cat ? `<span class="family-file-cat-badge">${esc(cat)}</span>` : '';
}

function renderModalFileCats(ev) {
  const counts = new Map();
  let uncategorized = 0;
  const add = (category) => {
    const cat = String(category || '').trim();
    if (!cat) uncategorized += 1;
    else counts.set(cat, (counts.get(cat) || 0) + 1);
  };
  for (const img of ev?.images || []) add(img.category);
  for (const item of pendingFiles) add(item.category);
  if (modalFileCat && modalFileCat !== '__none__' && !counts.has(modalFileCat)) modalFileCat = '';
  if (modalFileCat === '__none__' && !uncategorized) modalFileCat = '';
  let starred = 0;
  for (const img of ev?.images || []) if (img.starred) starred += 1;
  for (const item of pendingFiles) if (item.starred) starred += 1;
  if (modalFileStar && !starred) modalFileStar = false;
  renderFileCatChips('familyModalFileCats', modalFileCat, { counts, uncategorized }, 'setFamilyModalFileCat', {
    count: starred,
    active: modalFileStar,
    onClick: 'setFamilyModalFileStar',
  });
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
  const imageCells = [];
  const pdfRows = [];
  pendingFiles.forEach((item, i) => {
    const file = item.file;
    const visible = fileMatchesModalCat(item);
    const key = `p:${i}`;
    const filtered = visible ? '' : ' is-filtered';
    const caption = fileCaptionHtml(isEditingNote(null, null, i), item.note);
    if (familyAttachmentKind(file) !== 'image') {
      const icon = familyAttachmentIcon(file);
      pdfRows.push(`<div class="family-pdf-row${selectedFileKeys.has(key) ? ' is-selected' : ''}${filtered}">
        <div class="family-pdf-row-main">
          ${filePickHtml(key)}
          <span class="family-pdf-row-link" title="${esc(file.name || '附件')}">
            <i class="ti ${icon}"></i>
            <span class="family-pdf-row-text">
              <span class="family-pdf-row-name">${esc(file.name || '附件')}</span>
              ${item.category ? `<span class="family-pdf-row-cat">${esc(item.category)}</span>` : ''}
            </span>
          </span>
          <button type="button" class="family-file-star${item.starred ? ' on' : ''}" data-file-star="${esc(key)}" title="${item.starred ? '取消星标' : '星标'}"><i class="ti ti-star${item.starred ? '-filled' : ''}"></i></button>
          <button type="button" class="family-file-pencil" data-file-note="${esc(key)}" title="备注"><i class="ti ti-pencil"></i></button>
          <button type="button" class="family-img-del" data-pending="${i}" title="移除"><i class="ti ti-x"></i></button>
        </div>
        ${caption}
      </div>`);
      return;
    }
    imageCells.push(`<div class="family-file-cell${filtered}">
      <div class="family-pending-item${selectedFileKeys.has(key) ? ' is-selected' : ''}" data-i="${i}">
        <img src="${URL.createObjectURL(file)}" alt="">
        ${fileCatBadge(item.category)}
        ${fileToolsHtml(key, { starred: item.starred })}
        <button type="button" class="family-img-del" data-pending="${i}" title="移除"><i class="ti ti-x"></i></button>
      </div>
      ${caption}
    </div>`);
  });
  wrap.innerHTML = `${imageCells.length ? `<div class="family-img-grid">${imageCells.join('')}</div>` : ''}${pdfRows.length ? `<div class="family-pdf-list">${pdfRows.join('')}</div>` : ''}`;
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
  const imageCells = [];
  const pdfRows = [];
  imgs.forEach(img => {
    const visible = fileMatchesModalCat(img);
    const key = `s:${img.name}`;
    const filtered = visible ? '' : ' is-filtered';
    const caption = fileCaptionHtml(isEditingNote(editingId, img.name), img.note);
    if (familyAttachmentKind(img.name, img.kind) !== 'image') {
      const name = attachmentDisplayName(img);
      const icon = familyAttachmentIcon(name, img.kind);
      pdfRows.push(`<div class="family-pdf-row${selectedFileKeys.has(key) ? ' is-selected' : ''}${filtered}">
        <div class="family-pdf-row-main">
          ${filePickHtml(key)}
          <a class="family-pdf-row-link" href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener" title="${esc(name)}">
            <i class="ti ${icon}"></i>
            <span class="family-pdf-row-text">
              <span class="family-pdf-row-name">${esc(name)}</span>
              ${img.category ? `<span class="family-pdf-row-cat">${esc(img.category)}</span>` : ''}
            </span>
          </a>
          <button type="button" class="family-file-star${img.starred ? ' on' : ''}" data-file-star="${esc(key)}" title="${img.starred ? '取消星标' : '星标'}"><i class="ti ti-star${img.starred ? '-filled' : ''}"></i></button>
          <button type="button" class="family-file-pencil" data-file-note="${esc(key)}" title="备注"><i class="ti ti-pencil"></i></button>
          <button type="button" class="family-img-del" data-remove="${esc(img.name)}" title="删除文件"><i class="ti ti-x"></i></button>
        </div>
        ${caption}
      </div>`);
      return;
    }
    imageCells.push(`<div class="family-file-cell${filtered}">
      <div class="family-saved-item${selectedFileKeys.has(key) ? ' is-selected' : ''}">
        <a href="${esc(assetUrl(img.url))}" target="_blank" rel="noopener"><img src="${esc(assetUrl(img.url))}" alt=""></a>
        ${fileCatBadge(img.category)}
        ${fileToolsHtml(key, { starred: img.starred })}
        <button type="button" class="family-img-del" data-remove="${esc(img.name)}" title="删除文件"><i class="ti ti-x"></i></button>
      </div>
      ${caption}
    </div>`);
  });
  wrap.innerHTML = `${imageCells.length ? `<div class="family-img-grid">${imageCells.join('')}</div>` : ''}${pdfRows.length ? `<div class="family-pdf-list">${pdfRows.join('')}</div>` : ''}`;
}

function renderFileEditors(ev) {
  renderModalFileCats(ev);
  renderPendingPreviews();
  renderSavedImages(ev);
  focusFileNoteInput();
}

function fillForm(ev, { resetPending = true } = {}) {
  document.getElementById('familyTitleInp').value = ev?.title || '';
  document.getElementById('familyDateInp').value = ev?.eventDate || todayYmd();
  document.getElementById('familyNotesInp').value = ev?.notes || '';
  linkedTxnIds = [...(ev?.linkedTxnIds || [])];
  if (resetPending) {
    pendingFiles = [];
    selectedFileKeys.clear();
    modalFileCat = '';
    modalFileStar = false;
    fileNoteEdit = null;
  }
  const dateInp = document.getElementById('familyDateInp');
  if (dateInp && !dateInp.dataset.familyTxnBound) {
    dateInp.dataset.familyTxnBound = '1';
    dateInp.addEventListener('change', onFamilyEventDateChange);
  }
  renderFileEditors(ev);
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

function renderPageFileCats() {
  const stats = collectFileCategories(events);
  if (pageFileCat && pageFileCat !== '__none__' && !stats.counts.has(pageFileCat)) pageFileCat = '';
  if (pageFileCat === '__none__' && !stats.uncategorized) pageFileCat = '';
  const starred = countStarred(events);
  if (pageFileStar && !starred) pageFileStar = false;
  renderFileCatChips('familyPageFileCats', pageFileCat, stats, 'setFamilyPageFileCat', {
    count: starred,
    active: pageFileStar,
    onClick: 'setFamilyPageFileStar',
  });
}

export function setFamilyPageFileCat(encoded) {
  pageFileCat = encoded ? decodeURIComponent(encoded) : '';
  renderFamilyPage();
}

export function setFamilyPageFileStar(on) {
  pageFileStar = on === true || on === 'true';
  renderFamilyPage();
}

export function setFamilyModalFileStar(on) {
  modalFileStar = on === true || on === 'true';
  renderFileEditors(events.find(e => e.id === editingId) || null);
}

export function renderFamilyPage() {
  const listEl = document.getElementById('familyList');
  if (!listEl) return;
  syncFamilyViewToggle();
  renderPageFileCats();

  if (!events.length) {
    listEl.innerHTML = `<div class="family-empty">
      <i class="ti ti-home-heart"></i>
      <p>还没有家庭事件</p>
      <button type="button" class="btn btn-p" onclick="openFamilyCreate()"><i class="ti ti-plus"></i> 新增事件</button>
    </div>`;
    return;
  }

  const items = filteredFamilyEvents().filter(ev => {
    if (!pageFileCat && !pageFileStar) return true;
    return filesForCategory(ev.images || [], pageFileCat, pageFileStar).length > 0;
  });
  if (!items.length) {
    const clearBtn = (pageFileCat || pageFileStar)
      ? `<button type="button" class="btn btn-sm" onclick="setFamilyPageFileCat('');setFamilyPageFileStar(false);clearFamilySearch()">清除筛选</button>`
      : `<button type="button" class="btn btn-sm" onclick="clearFamilySearch()">清除搜索</button>`;
    listEl.innerHTML = `<div class="family-empty">
      <i class="ti ti-search"></i>
      <p>没有匹配的事件</p>
      ${clearBtn}
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
  hideFileCatSuggest();
  document.getElementById('moFamily')?.classList.add('hide');
  closeFamilyTxnSearch();
  editingId = null;
  pendingFiles = [];
  selectedFileKeys.clear();
  modalFileStar = false;
  fileNoteEdit = null;
  linkedTxnIds = [];
}

export function setFamilyModalFileCat(encoded) {
  modalFileCat = encoded ? decodeURIComponent(encoded) : '';
  renderFileEditors(events.find(e => e.id === editingId) || null);
}

async function applyFileCategory(category) {
  if (!selectedFileKeys.size) {
    alert('请先勾选要编组的文件');
    return;
  }
  pendingFiles.forEach((item, i) => {
    if (selectedFileKeys.has(`p:${i}`)) item.category = category;
  });
  const savedNames = [...selectedFileKeys].filter(key => key.startsWith('s:')).map(key => key.slice(2));
  selectedFileKeys.clear();
  if (!savedNames.length) {
    renderFileEditors(events.find(e => e.id === editingId) || null);
    return;
  }
  if (!editingId) return;
  const ev = events.find(e => e.id === editingId);
  const images = (ev?.images || []).map(img => ({
    name: img.name,
    category: savedNames.includes(img.name) ? category : (img.category || ''),
    note: img.note || '',
    starred: !!img.starred,
    fileName: img.fileName || '',
  }));
  const updated = await updateFamilyEvent(editingId, { images });
  await refreshAfterMutation(updated);
}

function knownFileCategories() {
  const { counts } = collectFileCategories(events);
  for (const item of pendingFiles) {
    const cat = fileCategory(item);
    if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return [...counts.keys()];
}

function placeFileCatSuggest() {
  const box = document.getElementById('familyFileCatSuggest');
  const inp = document.getElementById('familyFileCatInp');
  if (!box || box.hidden || !inp) return;
  const rect = inp.getBoundingClientRect();
  box.style.top = `${rect.bottom + 4}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
}

function hideFileCatSuggest() {
  const box = document.getElementById('familyFileCatSuggest');
  if (!box) return;
  box.hidden = true;
  box.innerHTML = '';
}

function showFileCatSuggest() {
  const box = document.getElementById('familyFileCatSuggest');
  const inp = document.getElementById('familyFileCatInp');
  if (!box || !inp) return;
  const q = inp.value.trim().toLowerCase();
  const cats = knownFileCategories().filter(cat => !q || cat.toLowerCase().includes(q));
  if (!cats.length) {
    hideFileCatSuggest();
    return;
  }
  box.hidden = false;
  box.innerHTML = cats.map(cat => `<button type="button" data-file-cat-pick="${esc(cat)}">${esc(cat)}</button>`).join('');
  placeFileCatSuggest();
}

export async function assignSelectedFamilyFiles() {
  const category = String(document.getElementById('familyFileCatInp')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!category) {
    alert('请填写分类名称');
    return;
  }
  try {
    await applyFileCategory(category);
  } catch (err) {
    alert(err.message || '分类保存失败');
  }
}

export async function clearSelectedFamilyFileCat() {
  try {
    await applyFileCategory('');
  } catch (err) {
    alert(err.message || '分类保存失败');
  }
}

function normalizeFileNote(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function currentEditorEvent() {
  return events.find(e => e.id === editingId) || null;
}

function beginNoteEdit(target) {
  fileNoteEdit = target;
  const modalOpen = !document.getElementById('moFamily')?.classList.contains('hide');
  if (modalOpen) renderFileEditors(currentEditorEvent());
  if (target.name) renderFamilyPage();
  if (!modalOpen) focusFileNoteInput();
}

async function patchEventImage(eventId, name, patch) {
  const ev = events.find(e => e.id === eventId);
  if (!ev) return;
  const images = (ev.images || []).map(img => ({
    name: img.name,
    category: img.category || '',
    note: img.name === name && Object.prototype.hasOwnProperty.call(patch, 'note') ? patch.note : (img.note || ''),
    starred: img.name === name && Object.prototype.hasOwnProperty.call(patch, 'starred') ? !!patch.starred : !!img.starred,
    fileName: img.fileName || '',
  }));
  const updated = await updateFamilyEvent(eventId, { images });
  const modalOpen = editingId === eventId && !document.getElementById('moFamily')?.classList.contains('hide');
  if (modalOpen) {
    await refreshAfterMutation(updated);
    return;
  }
  const idx = events.findIndex(e => e.id === updated.id);
  if (idx >= 0) events[idx] = updated;
  syncEvents(events);
  renderFamilyPage();
}

async function saveOpenFileNote() {
  const note = normalizeFileNote(document.querySelector('[data-file-note-input]')?.value);
  const edit = fileNoteEdit;
  fileNoteEdit = null;
  if (!edit) return;
  if (edit.pendingIndex != null) {
    const item = pendingFiles[edit.pendingIndex];
    if (item) item.note = note;
    renderFileEditors(currentEditorEvent());
    return;
  }
  await patchEventImage(edit.eventId, edit.name, { note });
}

async function toggleFileStarByKey(key) {
  if (key.startsWith('p:')) {
    const item = pendingFiles[Number(key.slice(2))];
    if (item) item.starred = !item.starred;
    renderFileEditors(currentEditorEvent());
    return;
  }
  const name = key.slice(2);
  const img = currentEditorEvent()?.images?.find(item => item.name === name);
  if (!img || !editingId) return;
  await patchEventImage(editingId, name, { starred: !img.starred });
}

function bindFamilyFeedFileActions() {
  const listEl = document.getElementById('familyList');
  if (!listEl || listEl.dataset.fileBound) return;
  listEl.dataset.fileBound = '1';
  listEl.addEventListener('click', (e) => {
    const star = e.target.closest('[data-feed-star]');
    const pencil = e.target.closest('[data-feed-note]');
    const save = e.target.closest('[data-file-note-save]');
    const field = e.target.closest('.family-file-note-edit');
    if (!star && !pencil && !save && !field) return;
    e.preventDefault();
    e.stopPropagation();
    if (star) {
      const eventId = Number(star.dataset.eventId);
      const name = star.dataset.feedStar;
      const img = events.find(ev => ev.id === eventId)?.images?.find(item => item.name === name);
      if (!img) return;
      patchEventImage(eventId, name, { starred: !img.starred }).catch(err => alert(err.message || '星标保存失败'));
      return;
    }
    if (pencil) {
      const eventId = Number(pencil.dataset.eventId);
      const name = pencil.dataset.feedNote;
      const img = events.find(ev => ev.id === eventId)?.images?.find(item => item.name === name);
      beginNoteEdit({ eventId, name, draft: img?.note || '' });
      return;
    }
    if (save) saveOpenFileNote().catch(err => alert(err.message || '备注保存失败'));
  }, true);
  listEl.addEventListener('keydown', (e) => {
    if (!e.target?.matches?.('[data-file-note-input]')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      saveOpenFileNote().catch(err => alert(err.message || '备注保存失败'));
    } else if (e.key === 'Escape') {
      fileNoteEdit = null;
      renderFamilyPage();
    }
  }, true);
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
  fillForm(ev, { resetPending: false });
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

    for (const item of pendingFiles) {
      ev = await uploadFamilyEventImage(ev.id, item.file, item.category || '', item.note || '', !!item.starred);
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
  if (!confirm('确定删除这条家庭事件？附件也会一并删除。')) return;
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
  bindFamilyFeedFileActions();
  const fileInp = document.getElementById('familyFileInp');
  if (fileInp && !fileInp.dataset.bound) {
    fileInp.dataset.bound = '1';
    fileInp.addEventListener('change', () => {
      const files = [...(fileInp.files || [])].filter(f =>
        f.type?.startsWith('image/')
        || ['application/pdf', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(f.type)
        || /\.(jpe?g|png|gif|webp|heic|heif|pdf|csv|xls|xlsx)$/i.test(f.name || '')
      );
      if (!files.length) {
        fileInp.value = '';
        return;
      }
      const preset = modalFileCat && modalFileCat !== '__none__' ? modalFileCat : '';
      pendingFiles = [...pendingFiles, ...files.map(file => ({ file, category: preset, note: '', starred: false }))].slice(0, 12);
      renderFileEditors(events.find(e => e.id === editingId) || null);
      fileInp.value = '';
    });
  }

  const catInp = document.getElementById('familyFileCatInp');
  if (catInp && !catInp.dataset.bound) {
    catInp.dataset.bound = '1';
    catInp.addEventListener('focus', showFileCatSuggest);
    catInp.addEventListener('click', showFileCatSuggest);
    catInp.addEventListener('input', showFileCatSuggest);
    catInp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideFileCatSuggest();
    });
    catInp.addEventListener('blur', () => {
      setTimeout(hideFileCatSuggest, 0);
    });
  }
  const catScroller = document.querySelector('#moFamily .mb');
  if (catScroller && !catScroller.dataset.catSuggestBound) {
    catScroller.dataset.catSuggestBound = '1';
    catScroller.addEventListener('scroll', placeFileCatSuggest);
  }
  if (!setupFamilyEvents._suggestResize) {
    setupFamilyEvents._suggestResize = true;
    window.addEventListener('resize', placeFileCatSuggest);
  }

  const modal = document.getElementById('moFamily');
  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('mousedown', (e) => {
      const pick = e.target.closest('[data-file-cat-pick]');
      if (!pick) return;
      e.preventDefault();
      const inp = document.getElementById('familyFileCatInp');
      if (inp) inp.value = pick.getAttribute('data-file-cat-pick') || '';
      hideFileCatSuggest();
    });
    modal.addEventListener('keydown', (e) => {
      if (!e.target?.matches?.('[data-file-note-input]')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        saveOpenFileNote().catch(err => alert(err.message || '备注保存失败'));
      } else if (e.key === 'Escape') {
        fileNoteEdit = null;
        renderFileEditors(currentEditorEvent());
      }
    });
    modal.addEventListener('click', async (e) => {
      const noteSave = e.target.closest('[data-file-note-save]');
      if (noteSave) {
        try { await saveOpenFileNote(); } catch (err) { alert(err.message || '备注保存失败'); }
        return;
      }
      const noteBtn = e.target.closest('[data-file-note]');
      if (noteBtn) {
        const key = noteBtn.dataset.fileNote || '';
        if (key.startsWith('p:')) {
          const i = Number(key.slice(2));
          beginNoteEdit({ pendingIndex: i, draft: pendingFiles[i]?.note || '' });
        } else if (editingId) {
          const name = key.slice(2);
          const img = currentEditorEvent()?.images?.find(item => item.name === name);
          beginNoteEdit({ eventId: editingId, name, draft: img?.note || '' });
        }
        return;
      }
      const starBtn = e.target.closest('[data-file-star]');
      if (starBtn) {
        try { await toggleFileStarByKey(starBtn.dataset.fileStar || ''); } catch (err) { alert(err.message || '星标保存失败'); }
        return;
      }
      const pendingBtn = e.target.closest('[data-pending]');
      if (pendingBtn) {
        const i = Number(pendingBtn.getAttribute('data-pending'));
        pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
        if (fileNoteEdit?.pendingIndex != null) fileNoteEdit = null;
        [...selectedFileKeys].forEach(key => {
          if (key.startsWith('p:')) selectedFileKeys.delete(key);
        });
        renderFileEditors(events.find(ev => ev.id === editingId) || null);
        return;
      }
      const pickBtn = e.target.closest('[data-file-pick]');
      if (pickBtn) {
        const key = pickBtn.dataset.filePick;
        if (selectedFileKeys.has(key)) selectedFileKeys.delete(key);
        else selectedFileKeys.add(key);
        renderFileEditors(events.find(ev => ev.id === editingId) || null);
        return;
      }
      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn && editingId) {
        const name = removeBtn.getAttribute('data-remove');
        if (!confirm('删除这个文件？')) return;
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
