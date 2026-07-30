import { assetUrl } from './apiBase.js';
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

function renderFamilyLinkedTxnsSummary(ev) {
  const rows = linkedTxnRows(ev.linkedTxnIds || []);
  if (!rows.length) return '';
  const chips = rows.slice(0, 2).map(row => {
    const isInc = row['收支'] === '收入';
    return `<span class="family-milestone-txn-chip ${isInc ? 'inc' : 'exp'}">${esc(rowDisplayTitle(row))} ${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</span>`;
  }).join('');
  const more = rows.length > 2 ? `<span class="family-milestone-txn-more">+${rows.length - 2} 笔</span>` : '';
  return `<div class="family-milestone-txns" onclick="event.stopPropagation()">${chips}${more}</div>`;
}

function familyTxnSearchResults(limit = 40) {
  const needle = String(familyTxnSearchQuery || '').trim().toLowerCase();
  const linked = new Set(linkedTxnIds);
  const all = getAllData()
    .filter(row => !linked.has(row.id))
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
  if (!needle) return all.slice(0, limit);
  return all.filter(row => rowSearchHaystack(row).includes(needle)).slice(0, limit);
}

function renderFamilyTxnSearchResults() {
  const wrap = document.getElementById('familyTxnSearchResults');
  if (!wrap) return;
  const rows = familyTxnSearchResults();
  if (!rows.length) {
    wrap.innerHTML = `<div class="family-txn-search-empty">${familyTxnSearchQuery.trim() ? '没有匹配的交易' : '输入关键词搜索账本交易'}</div>`;
    return;
  }
  wrap.innerHTML = rows.map(row => {
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
  }).join('');
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
  renderFamilyTxnSearchResults();
}

export function removeFamilyLinkedTxn(id) {
  const n = Number(id);
  linkedTxnIds = linkedTxnIds.filter(x => x !== n);
  renderFamilyLinkedTxns();
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

function renderFamilyMilestoneItem(ev, index, showYear, year) {
  const side = index % 2 === 0 ? 'is-left' : 'is-right';
  const imgs = ev.images || [];
  const date = parseEventDateParts(ev.eventDate);
  const mediaHtml = renderFamilyImages(imgs);
  const dateHtml = `<div class="family-milestone-date" aria-label="${esc(formatDateLabel(ev.eventDate))}">
          <span class="family-milestone-month">${esc(date.month)}</span>
          <span class="family-milestone-day">${esc(date.day)}</span>
          <span class="family-milestone-year-num">${esc(date.year)}</span>
        </div>`;
  const mainHtml = `<div class="family-milestone-main">
          <div class="family-milestone-head">
            <h3 class="family-milestone-title">${esc(ev.title)}</h3>
            <button type="button" class="family-milestone-edit" onclick="event.stopPropagation();openFamilyEdit(${ev.id})" title="编辑" aria-label="编辑"><i class="ti ti-pencil"></i></button>
          </div>
          ${ev.notes ? `<p class="family-milestone-notes">${esc(ev.notes)}</p>` : ''}
          ${renderFamilyLinkedTxnsSummary(ev)}
          ${mediaHtml}
        </div>`;
  const bodyHtml = side === 'is-left' ? `${dateHtml}${mainHtml}` : `${mainHtml}${dateHtml}`;
  return `${showYear ? `<div class="family-milestone-year"><span>${esc(year)}</span></div>` : ''}
  <article class="family-milestone ${side}" onclick="openFamilyEdit(${ev.id})">
    <div class="family-milestone-card">
      <div class="family-milestone-body">${bodyHtml}</div>
    </div>
    <div class="family-milestone-marker" aria-hidden="true"><span class="family-milestone-dot"></span></div>
  </article>`;
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
    if (level === 'danger') {
      hint.textContent = '存储空间即将用尽，请删除旧事件中的照片或联系管理员扩容。';
    } else if (level === 'warn') {
      hint.textContent = '存储使用较高，建议清理不再需要的照片。';
    } else {
      hint.textContent = `照片保存在 Railway 云端，当前上限 ${limitMb} MB。`;
    }
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
  renderPendingPreviews();
  renderSavedImages(ev);
  renderFamilyLinkedTxns();
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
    return renderFamilyMilestoneItem(ev, index, showYear, year);
  }).join('');

  listEl.innerHTML = `<div class="family-timeline">${rows}</div>`;
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
