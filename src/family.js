import { assetUrl } from './apiBase.js';
import {
  fetchFamilyEvents,
  createFamilyEvent,
  updateFamilyEvent,
  deleteFamilyEvent,
  uploadFamilyEventImage,
  deleteFamilyEventImage,
} from './api.js';

let events = [];
let editingId = null;
let pendingFiles = [];

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

function groupByYear(list) {
  const map = new Map();
  for (const ev of list) {
    const y = String(ev.eventDate || '').slice(0, 4) || '未定';
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(ev);
  }
  return [...map.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function syncEvents(list) {
  events = Array.isArray(list) ? list : [];
  const countEl = document.getElementById('familyCount');
  if (countEl) countEl.textContent = events.length ? `${events.length} 条` : '';
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
  pendingFiles = [];
  renderPendingPreviews();
  renderSavedImages(ev);
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

  const groups = groupByYear(events);
  listEl.innerHTML = groups.map(([year, items]) => `
    <section class="family-year">
      <h3 class="family-year-title">${esc(year)}</h3>
      <div class="family-cards">
        ${items.map(ev => {
          const cover = ev.images?.[0];
          const more = Math.max(0, (ev.images?.length || 0) - 1);
          return `<article class="family-card" onclick="openFamilyEdit(${ev.id})">
            <div class="family-card-media ${cover ? '' : 'is-empty'}">
              ${cover
                ? `<img src="${esc(assetUrl(cover.url))}" alt="">`
                : `<i class="ti ti-photo"></i>`}
              ${more ? `<span class="family-card-more">+${more}</span>` : ''}
            </div>
            <div class="family-card-body">
              <div class="family-card-date">${esc(formatDateLabel(ev.eventDate))}</div>
              <div class="family-card-title">${esc(ev.title)}</div>
              ${ev.notes ? `<div class="family-card-notes">${esc(ev.notes)}</div>` : ''}
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>
  `).join('');
}

export async function loadFamilyEvents() {
  const data = await fetchFamilyEvents();
  syncEvents(data.events || []);
  renderFamilyPage();
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
  editingId = null;
  pendingFiles = [];
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
    if (editingId) {
      ev = await updateFamilyEvent(editingId, { title, eventDate, notes });
    } else {
      ev = await createFamilyEvent({ title, eventDate, notes });
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
