// ── 装备库 ───────────────────────────────────────────────────────────────────
import { fmtMoney, fmtCount } from './format.js';

export const GEAR_CATEGORY = '母婴亲子';
export const GEAR_SUBCAT = '母婴装备';

let gearLibrary = [];
let nextGearId = 1;
let getAllData = () => [];
let onPersist = () => {};

export function initGear(deps) {
  getAllData = deps.getAllData;
  onPersist = deps.onPersist;
}

export function loadGearState(state) {
  gearLibrary = state.gearLibrary || [];
  nextGearId = state.nextGearId || 1;
}

export function getGearState() {
  return { gearLibrary, nextGearId };
}

export function getGearLibrary() {
  return gearLibrary;
}

function txnById(id) {
  return getAllData().find(r => r.id === id);
}

function defaultGearName(row) {
  const desc = (row['商品说明'] || '').trim();
  const peer = (row['交易对方'] || '').trim();
  if (desc && desc !== '/' && desc !== peer) return desc.length > 40 ? desc.slice(0, 40) + '…' : desc;
  if (peer) return peer.length > 40 ? peer.slice(0, 40) + '…' : peer;
  return '未命名装备';
}

function isGearRow(row) {
  return row['分类'] === GEAR_CATEGORY
    && row['子分类'] === GEAR_SUBCAT
    && row['收支'] === '支出'
    && row['退款状态'] !== 'refunded';
}

function gearItems() {
  return gearLibrary.filter(g => {
    const row = txnById(g.txnId);
    return row && isGearRow(row);
  });
}

/** 将「母婴亲子 · 母婴装备」子分类下的支出同步进装备库 */
export function syncBabyGear() {
  const beforeLen = gearLibrary.length;
  gearLibrary = gearLibrary.filter(g => {
    const row = txnById(g.txnId);
    return row && isGearRow(row);
  });
  const removed = beforeLen - gearLibrary.length;

  const linked = new Set(gearLibrary.map(g => g.txnId));
  let added = 0;
  getAllData().forEach(row => {
    if (!isGearRow(row)) return;
    if (linked.has(row.id)) return;
    const name = row['产品名称'] || defaultGearName(row);
    if (!row['产品名称']) row['产品名称'] = name;
    gearLibrary.push({
      id: nextGearId++,
      txnId: row.id,
      category: GEAR_CATEGORY,
      name,
      image: null
    });
    linked.add(row.id);
    added++;
  });
  gearLibrary.sort((a, b) => {
    const ta = txnById(a.txnId);
    const tb = txnById(b.txnId);
    if (!ta || !tb) return 0;
    return (tb['日期'] + tb['时间']).localeCompare(ta['日期'] + ta['时间']);
  });
  return added + removed;
}

export function updateGearName(gearId, name) {
  const gear = gearLibrary.find(g => g.id === gearId);
  if (!gear) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  gear.name = trimmed;
  const row = txnById(gear.txnId);
  if (row) row['产品名称'] = trimmed;
  onPersist();
  renderGearGallery();
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
}

export async function handleGearImageUpload(gearId, file) {
  if (!isImageFile(file)) {
    alert('请选择图片文件');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('图片不能超过 5MB');
    return;
  }
  const gear = gearLibrary.find(g => g.id === gearId);
  if (!gear) return;
  try {
    gear.image = await readImageAsDataUrl(file);
    onPersist();
    renderGearGallery();
    if (openGearId === gearId) refreshGearModal(gearId);
  } catch (err) {
    alert('上传失败：' + err.message);
  }
}

let openGearId = null;

function gearCardHtml(gear) {
  const row = txnById(gear.txnId);
  const img = gear.image
    ? `<img class="gear-card-img" src="${gear.image}" alt="${gear.name}">`
    : `<div class="gear-card-ph"><i class="ti ti-photo-plus"></i><span>上传图片</span></div>`;
  const sub = row ? `${row['日期']} · ${fmtMoney(row['金额'])}` : '';
  const subcat = row?.['子分类'] ? `<span class="gear-card-subcat">${row['子分类']}</span>` : '';
  return `<article class="gear-card" onclick="openGearEdit(${gear.id})">
    <div class="gear-card-media">${img}</div>
    <div class="gear-card-body">
      <div class="gear-card-name" title="${gear.name}">${gear.name}</div>
      ${subcat}
      <div class="gear-card-meta">${sub || ''}</div>
    </div>
  </article>`;
}

export function renderGearGallery() {
  const el = document.getElementById('gearGallery');
  const cnt = document.getElementById('gearCount');
  if (!el) return;
  const items = gearItems();
  if (cnt) cnt.textContent = items.length ? `共 ${fmtCount(items.length)} 件` : '';
  if (!items.length) {
    el.innerHTML = `<div class="gear-empty"><i class="ti ti-baby-carriage"></i><p>暂无母婴装备</p><span>「母婴亲子 · 母婴装备」子分类下的支出会自动收录至此</span></div>`;
    return;
  }
  el.innerHTML = items.map(gearCardHtml).join('');
}

function refreshGearModal(gearId) {
  const gear = gearLibrary.find(g => g.id === gearId);
  const row = gear ? txnById(gear.txnId) : null;
  if (!gear) return;
  const preview = document.getElementById('gearImgPreview');
  const nameInp = document.getElementById('gearNameInp');
  const meta = document.getElementById('gearMeta');
  if (nameInp) nameInp.value = gear.name;
  if (preview) {
    preview.innerHTML = gear.image
      ? `<img src="${gear.image}" alt="">`
      : `<div class="gear-modal-ph"><i class="ti ti-photo-plus"></i><span>点击上传产品图</span></div>`;
    preview.onclick = () => triggerGearUpload();
  }
  if (meta && row) {
    meta.innerHTML = `
      <div><span>日期</span>${row['日期']} ${row['时间'] || ''}</div>
      <div><span>金额</span>${fmtMoney(row['金额'])}</div>
      <div><span>来源</span>${row['来源'] || '—'}</div>
      <div><span>商户</span>${row['交易对方'] || '—'}</div>
      ${row['商品说明'] ? `<div><span>原说明</span>${row['商品说明']}</div>` : ''}`;
  }
}

export function openGearEdit(gearId) {
  openGearId = gearId;
  refreshGearModal(gearId);
  document.getElementById('moGear')?.classList.remove('hide');
}

export function closeGearEdit() {
  openGearId = null;
  document.getElementById('moGear')?.classList.add('hide');
}

export function saveGearEdit() {
  if (!openGearId) return;
  const name = document.getElementById('gearNameInp')?.value || '';
  updateGearName(openGearId, name);
  closeGearEdit();
}

export function triggerGearUpload() {
  if (!openGearId) return;
  document.getElementById('gearFileInp')?.click();
}

export function setupGearUpload() {
  const inp = document.getElementById('gearFileInp');
  inp?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && openGearId) handleGearImageUpload(openGearId, file);
  });
}

export function renderGearPage() {
  const added = syncBabyGear();
  if (added > 0) onPersist();
  renderGearGallery();
}
