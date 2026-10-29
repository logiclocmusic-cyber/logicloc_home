// ── 装备库 ───────────────────────────────────────────────────────────────────
import { fmtMoney, fmtCount } from './format.js';
import { uploadGearImage, uploadGearImageFromUrl } from './api.js';
import { assetUrl } from './apiBase.js';

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function gearImageSrc(image) {
  return assetUrl(image);
}

/** @deprecated use DEFAULT_GEAR_SECTIONS */
export const GEAR_CATEGORY = '母婴亲子';
/** @deprecated use DEFAULT_GEAR_SECTIONS */
export const GEAR_SUBCAT = '母婴装备';

export const DEFAULT_GEAR_SECTIONS = [
  { id: 'baby', label: '母婴装备', icon: 'ti-baby-carriage', cat: '母婴亲子', sub: '母婴装备' },
  { id: 'digital', label: '数码设备', icon: 'ti-device-laptop', cat: '数码电器', sub: '数码设备' },
];

/** @deprecated alias */
export const GEAR_SECTIONS = DEFAULT_GEAR_SECTIONS;

let gearLibrary = [];
let nextGearId = 1;
let customGearSections = [];
/** 用户隐藏的内置子分类 id */
let hiddenSectionIds = [];
let activeGearSection = DEFAULT_GEAR_SECTIONS[0].id;
let getAllData = () => [];
let onPersist = () => {};
let getCats = () => [];
let getSubcatsFor = () => [];
let ensureSubcat = () => {};

export function initGear(deps) {
  getAllData = deps.getAllData;
  onPersist = deps.onPersist;
  getCats = deps.getCats || (() => []);
  getSubcatsFor = deps.getSubcatsFor || (() => []);
  ensureSubcat = deps.ensureSubcat || (() => {});
}

function sectionKey(cat, sub) {
  return `${cat}\0${sub || ''}`;
}

export function loadGearState(state) {
  gearLibrary = state.gearLibrary || [];
  nextGearId = state.nextGearId || 1;
  hiddenSectionIds = Array.isArray(state.hiddenGearSectionIds)
    ? state.hiddenGearSectionIds.map(String)
    : [];
  const defaultKeys = new Set(DEFAULT_GEAR_SECTIONS.map(s => sectionKey(s.cat, s.sub)));
  customGearSections = Array.isArray(state.gearSections)
    ? state.gearSections
      .filter(s => s && s.id && s.cat)
      .map(s => ({
        id: String(s.id),
        label: String(s.label || s.sub || s.cat),
        icon: String(s.icon || 'ti-package'),
        cat: String(s.cat),
        sub: s.sub ? String(s.sub) : null,
        custom: true,
      }))
      // 清理历史上误加的「数码电器整类」标签（会吞掉手机/电脑等子分类）
      .filter(s => !(s.cat === '数码电器' && !s.sub))
      .filter(s => !defaultKeys.has(sectionKey(s.cat, s.sub)))
    : [];
}

export function getGearState() {
  return {
    gearLibrary,
    nextGearId,
    gearSections: customGearSections,
    hiddenGearSectionIds: hiddenSectionIds,
  };
}

export function getGearLibrary() {
  return gearLibrary;
}

function getAllGearSections() {
  const hidden = new Set(hiddenSectionIds);
  return [...DEFAULT_GEAR_SECTIONS, ...customGearSections].filter(s => !hidden.has(s.id));
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

function isExpenseRow(row) {
  return !!row && row['收支'] === '支出' && row['退款状态'] !== 'refunded';
}

/** 优先匹配带具体子分类的装备分区；整类分区仅收录未被其它标签占用的子分类 */
function sectionForRow(row) {
  if (!isExpenseRow(row)) return null;
  const cat = row['分类'];
  const sub = (row['子分类'] || '').trim();
  const sections = getAllGearSections();
  const exact = sections.find(s => s.cat === cat && s.sub && s.sub === sub);
  if (exact) return exact;
  const dedicatedSubs = new Set(
    sections.filter(s => s.cat === cat && s.sub).map(s => s.sub)
  );
  if (sub && dedicatedSubs.has(sub)) return null;
  return sections.find(s => s.cat === cat && !s.sub) || null;
}

function isGearRowForSection(row, section) {
  if (!section) return false;
  return sectionForRow(row)?.id === section.id;
}

function gearSectionId(gear) {
  const sections = getAllGearSections();
  if (gear.sectionId && sections.some(s => s.id === gear.sectionId)) {
    const row = txnById(gear.txnId);
    const live = sectionForRow(row);
    if (live) return live.id;
    return gear.sectionId;
  }
  const row = txnById(gear.txnId);
  return sectionForRow(row)?.id || getAllGearSections()[0]?.id || DEFAULT_GEAR_SECTIONS[0].id;
}

function gearItemsForSection(sectionId) {
  const section = getAllGearSections().find(s => s.id === sectionId);
  if (!section) return [];
  return gearLibrary.filter(g => {
    const row = txnById(g.txnId);
    return row && isGearRowForSection(row, section);
  });
}

/** 将各装备分类下的支出同步进装备库 */
export function syncGear() {
  let changed = 0;
  const sections = getAllGearSections();

  const beforeLen = gearLibrary.length;
  gearLibrary = gearLibrary.filter(g => {
    const row = txnById(g.txnId);
    return row && !!sectionForRow(row);
  });
  changed += beforeLen - gearLibrary.length;

  gearLibrary.forEach(g => {
    const row = txnById(g.txnId);
    const section = sectionForRow(row);
    if (section && g.sectionId !== section.id) {
      g.sectionId = section.id;
      g.category = section.cat;
      changed++;
    }
    if (g.sold == null) g.sold = false;
  });

  const linked = new Set(gearLibrary.map(g => g.txnId));
  getAllData().forEach(row => {
    const section = sectionForRow(row);
    if (!section) return;
    if (linked.has(row.id)) return;
    const name = row['产品名称'] || defaultGearName(row);
    if (!row['产品名称']) row['产品名称'] = name;
    gearLibrary.push({
      id: nextGearId++,
      txnId: row.id,
      sectionId: section.id,
      category: section.cat,
      name,
      image: null,
      sold: false,
    });
    linked.add(row.id);
    changed++;
  });

  gearLibrary.sort((a, b) => {
    const ta = txnById(a.txnId);
    const tb = txnById(b.txnId);
    if (!ta || !tb) return 0;
    return (tb['日期'] + tb['时间']).localeCompare(ta['日期'] + ta['时间']);
  });

  if (!sections.some(s => s.id === activeGearSection)) {
    activeGearSection = sections[0]?.id || DEFAULT_GEAR_SECTIONS[0].id;
  }
  return changed;
}

/** @deprecated */
export const syncBabyGear = syncGear;

export function selectGearTab(sectionId) {
  if (!getAllGearSections().some(s => s.id === sectionId)) return;
  activeGearSection = sectionId;
  renderGearGallery();
  document.querySelector(`.gear-section-chip[data-section="${sectionId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function setGearSoldState(gearId, sold) {
  const gear = gearLibrary.find(g => g.id === gearId);
  if (!gear || !!gear.sold === sold) return;
  gear.sold = sold;
  onPersist();
  renderGearGallery();
  if (openGearId === gearId) refreshGearModal(gearId);
}

export function markGearSold(gearId) {
  setGearSoldState(gearId, true);
}

export function markGearUnsold(gearId) {
  setGearSoldState(gearId, false);
}

export function markGearSoldFromModal() {
  if (!openGearId) return;
  const gear = gearLibrary.find(g => g.id === openGearId);
  if (!gear) return;
  setGearSoldState(openGearId, !gear.sold);
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

function isImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
}

function isLikelyImageBlob(blob) {
  if (!blob?.size) return false;
  const type = String(blob.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return !type || type === 'application/octet-stream';
}

async function fetchImageBlobInBrowser(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!isLikelyImageBlob(blob)) throw new Error('not-image');
    if (blob.size > 5 * 1024 * 1024) throw new Error('too-large');
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

function blobToUploadFile(blob, url) {
  const ext = (() => {
    try {
      const p = new URL(url).pathname.toLowerCase();
      const m = p.match(/\.(jpe?g|png|gif|webp|bmp|heif|heic)$/);
      if (m) return m[1].replace('jpeg', 'jpg');
    } catch { /* ignore */ }
    const t = blob.type || '';
    if (t.includes('png')) return 'png';
    if (t.includes('webp')) return 'webp';
    if (t.includes('gif')) return 'gif';
    return 'jpg';
  })();
  const type = blob.type?.startsWith('image/') ? blob.type : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return new File([blob], `gear-url.${ext}`, { type });
}

async function resolveGearImageFromUrl(gearId, url) {
  try {
    const blob = await fetchImageBlobInBrowser(url);
    const file = blobToUploadFile(blob, url);
    return uploadGearImage(gearId, file);
  } catch {
    return uploadGearImageFromUrl(gearId, url);
  }
}

export async function handleGearImageFromUrl(gearId, rawUrl) {
  const url = rawUrl?.trim();
  if (!url) {
    alert('请粘贴图片链接');
    return;
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid');
  } catch {
    alert('链接格式无效，请使用 http 或 https 开头的图片地址');
    return;
  }
  const gear = gearLibrary.find(g => g.id === gearId);
  if (!gear) return;
  const btn = document.getElementById('gearUrlBtn');
  const prev = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i> 获取中…';
  }
  try {
    const { url: imageUrl } = await resolveGearImageFromUrl(gearId, url);
    gear.image = imageUrl;
    onPersist();
    renderGearGallery();
    if (openGearId === gearId) {
      refreshGearModal(gearId);
      const urlInp = document.getElementById('gearUrlInp');
      if (urlInp) urlInp.value = '';
    }
  } catch (err) {
    alert(err.message || '从链接获取图片失败');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prev || '<i class="ti ti-link"></i> 获取';
    }
  }
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
    const { url: imageUrl } = await uploadGearImage(gearId, file);
    gear.image = imageUrl;
    onPersist();
    renderGearGallery();
    if (openGearId === gearId) refreshGearModal(gearId);
  } catch (err) {
    alert('上传失败：' + err.message);
  }
}

let gearImageMigrationPromise = null;

/** 将历史内嵌 base64 装备图迁移到服务端，避免整库同步体积过大 */
export function migrateGearEmbeddedImages() {
  if (gearImageMigrationPromise) return gearImageMigrationPromise;
  gearImageMigrationPromise = (async () => {
    let changed = false;
    for (const gear of gearLibrary) {
      const img = gear.image;
      if (!img || typeof img !== 'string' || !img.startsWith('data:')) continue;
      try {
        const blob = await fetch(img).then(res => res.blob());
        const ext = (blob.type || 'image/jpeg').split('/')[1] || 'jpg';
        const file = new File([blob], `gear-${gear.id}.${ext}`, { type: blob.type || 'image/jpeg' });
        const { url } = await uploadGearImage(gear.id, file);
        gear.image = url;
        changed = true;
      } catch (err) {
        console.warn('[gear] migrate embedded image failed', gear.id, err);
      }
    }
    return changed;
  })();
  return gearImageMigrationPromise;
}

let openGearId = null;

function gearMediaHtml(gear, { modal = false } = {}) {
  const img = gear.image
    ? `<img class="gear-card-img" src="${escAttr(gearImageSrc(gear.image))}" alt="${escAttr(gear.name)}">`
    : `<div class="gear-card-ph"><i class="ti ti-photo-plus"></i><span>上传图片</span></div>`;
  const sold = gear.sold
    ? `<div class="gear-sold-badge${modal ? ' gear-sold-badge--modal' : ''}">已卖出</div>`
    : '';
  return `${img}${sold}`;
}

function gearCardHtml(gear) {
  const row = txnById(gear.txnId);
  const subLabel = row?.['子分类'] ? ` · ${row['子分类']}` : '';
  const sub = row ? `${row['日期']}${subLabel}` : '';
  const amtHtml = row
    ? `<span class="gear-card-amt">${fmtMoney(row['金额'])}</span>`
    : '';
  const sellBtn = gear.sold
    ? `<button type="button" class="gear-card-sell gear-card-unsell" onclick="event.stopPropagation();markGearUnsold(${gear.id})">撤回</button>`
    : `<button type="button" class="gear-card-sell" onclick="event.stopPropagation();markGearSold(${gear.id})">卖出</button>`;
  return `<article class="gear-card${gear.sold ? ' is-sold' : ''}" onclick="openGearEdit(${gear.id})">
    <div class="gear-card-media">${gearMediaHtml(gear)}</div>
    <div class="gear-card-body">
      <div class="gear-card-name" title="${gear.name}">${gear.name}</div>
      <div class="gear-card-meta">${sub || ''}</div>
      <div class="gear-card-actions">${amtHtml}${sellBtn}</div>
    </div>
  </article>`;
}

function sectionMetaLabel(section) {
  return section.sub ? `${section.cat} · ${section.sub}` : `${section.cat}（整类）`;
}

function renderGearSectionsManager() {
  const el = document.getElementById('gearSectionsList');
  if (!el) return;
  const sections = getAllGearSections();
  if (!sections.length) {
    el.innerHTML = `<div class="gear-sections-empty">暂无子分类，请添加一个以收录装备支出。</div>`;
    return;
  }
  el.innerHTML = sections.map(section => {
    const count = gearItemsForSection(section.id).length;
    const on = section.id === activeGearSection ? ' on' : '';
    return `<div class="gear-section-chip${on}" role="button" tabindex="0" data-section="${section.id}" onclick="selectGearTab('${section.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectGearTab('${section.id}')}">
      <i class="ti ${section.icon} gear-section-chip-icon" aria-hidden="true"></i>
      <div class="gear-section-chip-text">
        <span class="gear-section-chip-label">${section.label}</span>
        <span class="gear-section-chip-meta">${sectionMetaLabel(section)}</span>
      </div>
      <span class="gear-section-chip-count">${fmtCount(count)} 件</span>
      <button type="button" class="gear-section-chip-del" title="删除子分类" onclick="event.stopPropagation();removeGearSection('${section.id}')"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('');
}

function renderGearTabs() {
  const tabsEl = document.getElementById('gearTabs');
  if (!tabsEl) return;
  const sections = getAllGearSections();
  tabsEl.innerHTML = sections.map(section => {
    const count = gearItemsForSection(section.id).length;
    const on = section.id === activeGearSection ? ' on' : '';
    return `<button type="button" class="gear-tab${on}" data-section="${section.id}" onclick="selectGearTab('${section.id}')">
      <i class="ti ${section.icon}"></i>
      <span class="gear-tab-label">${section.label}</span>
      <span class="gear-tab-count">${fmtCount(count)}</span>
    </button>`;
  }).join('');
}

function sectionEmptyHtml(section) {
  const hint = section.sub
    ? `「${section.cat} · ${section.sub}」子分类下的支出会自动收录至此`
    : `「${section.cat}」分类下、未单独建标签的支出会自动收录至此`;
  return `<div class="gear-empty"><i class="ti ${section.icon}"></i><p>暂无${section.label}</p><span>${hint}</span></div>`;
}

export function renderGearGallery() {
  const el = document.getElementById('gearGallery');
  const cnt = document.getElementById('gearCount');
  const sections = getAllGearSections();
  const section = sections.find(s => s.id === activeGearSection) || sections[0];
  const items = gearItemsForSection(section.id);
  renderGearSectionsManager();
  renderGearTabs();
  if (cnt) cnt.textContent = items.length ? `共 ${fmtCount(items.length)} 件` : '';
  if (!el) return;
  if (!items.length) {
    el.innerHTML = sectionEmptyHtml(section);
    return;
  }
  el.innerHTML = items.map(gearCardHtml).join('');
}

function fillGearCatOptions(selectedCat) {
  const catSel = document.getElementById('gearCatSel');
  if (!catSel) return;
  const cats = getCats();
  const cur = selectedCat && cats.includes(selectedCat) ? selectedCat : (cats[0] || '');
  catSel.innerHTML = cats.map(c =>
    `<option value="${c}"${c === cur ? ' selected' : ''}>${c}</option>`
  ).join('');
  fillGearSubOptions(cur, '');
}

function fillGearSubOptions(cat, selectedSub) {
  const subSel = document.getElementById('gearSubSel');
  if (!subSel) return;
  const subs = getSubcatsFor(cat);
  const cur = selectedSub || '';
  subSel.innerHTML = [
    '<option value="">未分类</option>',
    ...subs.map(s => `<option value="${s}"${s === cur ? ' selected' : ''}>${s}</option>`),
  ].join('');
}

export function onGearCatChange() {
  const cat = document.getElementById('gearCatSel')?.value || '';
  fillGearSubOptions(cat, '');
}

function refreshGearModal(gearId) {
  const gear = gearLibrary.find(g => g.id === gearId);
  const row = gear ? txnById(gear.txnId) : null;
  if (!gear) return;
  const preview = document.getElementById('gearImgPreview');
  const nameInp = document.getElementById('gearNameInp');
  const meta = document.getElementById('gearMeta');
  const sellBtn = document.getElementById('gearSellBtn');
  if (nameInp) nameInp.value = gear.name;
  if (preview) {
    preview.innerHTML = gearMediaHtml(gear, { modal: true });
    preview.onclick = () => triggerGearUpload();
  }
  if (sellBtn) {
    sellBtn.disabled = false;
    sellBtn.textContent = gear.sold ? '撤回卖出' : '卖出';
    sellBtn.classList.toggle('is-sold', !!gear.sold);
  }

  const cat = row?.['分类'] || '';
  const sub = row?.['子分类'] || '';
  fillGearCatOptions(cat);
  fillGearSubOptions(document.getElementById('gearCatSel')?.value || cat, sub);

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
  const urlInp = document.getElementById('gearUrlInp');
  if (urlInp) urlInp.value = '';
  document.getElementById('moGear')?.classList.add('hide');
}

export function saveGearEdit() {
  if (!openGearId) return;
  const gear = gearLibrary.find(g => g.id === openGearId);
  if (!gear) return;

  const name = document.getElementById('gearNameInp')?.value || '';
  const trimmed = name.trim();
  if (trimmed) {
    gear.name = trimmed;
    const row = txnById(gear.txnId);
    if (row) row['产品名称'] = trimmed;
  }

  const row = txnById(gear.txnId);
  if (row) {
    const cat = document.getElementById('gearCatSel')?.value || '';
    const sub = document.getElementById('gearSubSel')?.value || '';
    if (cat) {
      row['分类'] = cat;
      row['子分类'] = sub;
      const section = sectionForRow(row);
      if (section) {
        gear.sectionId = section.id;
        gear.category = section.cat;
        activeGearSection = section.id;
      } else {
        // 不再属于任何装备分区：从库中移除
        gearLibrary = gearLibrary.filter(g => g.id !== gear.id);
      }
    }
  }

  syncGear();
  onPersist();
  renderGearGallery();
  closeGearEdit();
}

export function submitGearImageUrl() {
  if (!openGearId) return;
  const url = document.getElementById('gearUrlInp')?.value || '';
  handleGearImageFromUrl(openGearId, url);
}

export function triggerGearUpload() {
  if (!openGearId) return;
  document.getElementById('gearFileInp')?.click();
}

function fillSectionAddCatOptions() {
  const catSel = document.getElementById('gearSectionCatSel');
  if (!catSel) return;
  const cats = getCats();
  catSel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  const preferred = cats.includes('数码电器')
    ? '数码电器'
    : cats.includes('母婴亲子')
      ? '母婴亲子'
      : cats[0] || '';
  if (preferred) catSel.value = preferred;
  onGearSectionCatChange();
}

export function onGearSectionCatChange() {
  const cat = document.getElementById('gearSectionCatSel')?.value || '';
  const subSel = document.getElementById('gearSectionSubSel');
  if (!subSel) return;
  const subs = getSubcatsFor(cat);
  subSel.innerHTML = [
    '<option value="">（整类收录，不限子分类）</option>',
    ...subs.map(s => `<option value="${s}">${s}</option>`),
    '<option value="__new__">＋ 新建子分类…</option>',
  ].join('');
  const newWrap = document.getElementById('gearSectionNewSubWrap');
  if (newWrap) newWrap.hidden = true;
  const newInp = document.getElementById('gearSectionNewSubInp');
  if (newInp) newInp.value = '';
}

export function onGearSectionSubChange() {
  const val = document.getElementById('gearSectionSubSel')?.value || '';
  const newWrap = document.getElementById('gearSectionNewSubWrap');
  if (newWrap) newWrap.hidden = val !== '__new__';
  if (val === '__new__') {
    document.getElementById('gearSectionNewSubInp')?.focus();
  }
}

export function openGearSectionAdd() {
  fillSectionAddCatOptions();
  document.getElementById('moGearSection')?.classList.remove('hide');
}

export function closeGearSectionAdd() {
  document.getElementById('moGearSection')?.classList.add('hide');
}

export function confirmGearSectionAdd() {
  const cat = document.getElementById('gearSectionCatSel')?.value || '';
  if (!cat) {
    alert('请选择分类');
    return;
  }
  let subSel = document.getElementById('gearSectionSubSel')?.value || '';
  let sub = null;
  if (subSel === '__new__') {
    const name = document.getElementById('gearSectionNewSubInp')?.value?.trim() || '';
    if (!name) {
      alert('请填写新的子分类名称');
      return;
    }
    ensureSubcat(cat, name);
    sub = name;
  } else if (subSel) {
    sub = subSel;
  }

  const sections = getAllGearSections();
  const dup = sections.find(s => s.cat === cat && (s.sub || null) === (sub || null));
  if (dup) {
    alert('该分类/子分类标签已存在');
    activeGearSection = dup.id;
    closeGearSectionAdd();
    renderGearGallery();
    return;
  }

  const id = `custom-${Date.now().toString(36)}`;
  const label = sub || `${cat}（全部）`;
  customGearSections.push({
    id,
    label,
    icon: 'ti-package',
    cat,
    sub,
    custom: true,
  });
  activeGearSection = id;
  syncGear();
  onPersist();
  closeGearSectionAdd();
  renderGearGallery();
}

export function removeGearSection(sectionId) {
  const sections = getAllGearSections();
  const section = sections.find(s => s.id === sectionId);
  if (!section) return;
  if (sections.length <= 1) {
    alert('至少保留一个子分类');
    return;
  }
  if (!confirm(`删除「${section.label}」？账本流水不受影响；符合其它子分类条件的装备会自动归入。`)) return;

  const customIdx = customGearSections.findIndex(s => s.id === sectionId);
  if (customIdx >= 0) {
    customGearSections.splice(customIdx, 1);
  } else if (!hiddenSectionIds.includes(sectionId)) {
    hiddenSectionIds.push(sectionId);
  }

  const remaining = getAllGearSections();
  if (!remaining.some(s => s.id === activeGearSection)) {
    activeGearSection = remaining[0]?.id || DEFAULT_GEAR_SECTIONS[0].id;
  }
  syncGear();
  onPersist();
  renderGearGallery();
}

export function setupGearUpload() {
  const inp = document.getElementById('gearFileInp');
  inp?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && openGearId) handleGearImageUpload(openGearId, file);
  });
  const urlInp = document.getElementById('gearUrlInp');
  urlInp?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitGearImageUrl();
    }
  });
  urlInp?.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text')?.trim();
    if (!text || !openGearId || !/^https?:\/\//i.test(text)) return;
    e.preventDefault();
    urlInp.value = text;
    handleGearImageFromUrl(openGearId, text);
  });
}

export function renderGearPage() {
  const added = syncGear();
  if (added > 0) onPersist();
  renderGearGallery();
  const intro = document.querySelector('.gear-intro');
  if (intro) {
    intro.textContent = '支出会按分类/子分类自动收录为装备。可添加子分类标签，点开明细可改名称、分类与子分类，并上传产品图、标记卖出。';
  }
}
