/** 分类网格选择器：点击当前分类展开全部选项 */

import { CARTOON_ICON_QUICK, renderCatIcon } from './cat-icons.js';

export const EMOJI_QUICK = [
  '🍔', '🍭', '🥡', '🥬', '🍊', '🍺', '🥤', '☕', '✈️', '🧻', '🏋️', '💇',
  '📌', '💰', '🎁', '🎯', '📦', '🚌', '🚕', '🏦', '💳', '🎬', '🎵', '📚', '🧸', '💊', '🐕', '🐈',
  '🍎', '🥛', '🍳', '🍕', '🍱', '🧋', '🛍️', '👔', '👟', '💄', '🧴', '🔋', '💻', '📺', '🎮', '🏖️',
];

let getCats = () => [];
let getEmoji = () => '📌';
let getCatColor = () => '#98a2b3';
let onSelect = () => {};
let onFilterSelect = () => {};
let popEl = null;
let activeRowId = null;
let activeSplitIdx = null;
let activeMode = 'row';
let emojiPopEl = null;
let emojiOnPick = null;

function ensurePop() {
  if (popEl) return popEl;
  popEl = document.createElement('div');
  popEl.id = 'catPickerPop';
  popEl.className = 'cat-picker-pop hide';
  popEl.innerHTML = '<div class="cat-picker-head">选择分类</div><div class="cat-picker-grid"></div>';
  document.body.appendChild(popEl);

  popEl.querySelector('.cat-picker-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    if (activeMode === 'filter') {
      const cat = btn.dataset.cat || '';
      closeCatPicker();
      onFilterSelect(cat);
      return;
    }
    if (activeRowId == null) return;
    const cat = btn.dataset.cat;
    const rowId = activeRowId;
    const splitIdx = activeSplitIdx;
    closeCatPicker();
    onSelect(rowId, cat, splitIdx);
  });

  document.addEventListener('click', e => {
    if (!popEl || popEl.classList.contains('hide')) return;
    if (e.target.closest('.cat-picker-pop') || e.target.closest('.cat-pick-btn') || e.target.closest('.cat-filter-btn')) return;
    closeCatPicker();
  });

  popEl.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  window.addEventListener('scroll', e => {
    if (!popEl || popEl.classList.contains('hide')) return;
    if (popEl === e.target || popEl.contains(e.target)) return;
    closeCatPicker();
  }, true);
  window.addEventListener('resize', closeCatPicker);

  return popEl;
}

export function initCatPicker(deps) {
  getCats = deps.getCats || getCats;
  getEmoji = deps.getEmoji || getEmoji;
  getCatColor = deps.getCatColor || getCatColor;
  onSelect = deps.onSelect || onSelect;
  onFilterSelect = deps.onFilterSelect || onFilterSelect;
  ensurePop();

  document.addEventListener('click', e => {
    const filterBtn = e.target.closest('.cat-filter-btn');
    if (filterBtn) {
      e.stopPropagation();
      openCatPickerForFilter(filterBtn);
      return;
    }
    const btn = e.target.closest('.cat-pick-btn');
    if (!btn) return;
    e.stopPropagation();
    openCatPicker(btn);
  });
}

export function catPickBtnHtml(rowId, cat, opts = {}) {
  const icon = getEmoji(cat);
  const label = cat || '选择';
  const splitAttr = opts.splitIdx != null ? ` data-split-idx="${opts.splitIdx}"` : '';
  const on = cat ? ' on' : '';
  const catAttr = cat ? ` data-current-cat="${cat}"` : '';
  return `<button type="button" class="cat-pick-btn cs cs-main${on}" data-row-id="${rowId}"${splitAttr}${catAttr} title="${cat || '选择分类'}">
    <span class="cat-pick-emoji">${renderCatIcon(icon, { size: 16, wrapClass: 'cat-pick-emoji-wrap' })}</span><span class="cat-pick-label">${label}</span>
  </button>`;
}

export function catCellInnerHtml(rowId, cat, subSelHtml = '', opts = {}) {
  const icon = getEmoji(cat);
  const label = cat || '选择';
  const on = cat ? ' on' : '';
  const splitAttr = opts.splitIdx != null ? ` data-split-idx="${opts.splitIdx}"` : '';
  const catAttr = cat ? ` data-current-cat="${cat}"` : '';
  const attrs = `data-row-id="${rowId}"${splitAttr}${catAttr} title="${cat || '选择分类'}"`;
  const btnCls = `cat-pick-btn cs cs-main${on}`;
  const subPart = subSelHtml
    ? `<span class="cat-cell-sep">·</span>${subSelHtml}`
    : '';
  return `<div class="cat-cell-inner">
    <button type="button" class="${btnCls} cat-pick-btn--icon" ${attrs}>
      ${renderCatIcon(icon, { size: 18, wrapClass: 'cat-pick-emoji-wrap' })}
    </button>
    <div class="cat-cell-text">
      <button type="button" class="${btnCls} cat-pick-btn--label" ${attrs}>
        <span class="cat-pick-label">${label}</span>
      </button>${subPart}
    </div>
  </div>`;
}

function renderGrid(currentCat, mode = 'row') {
  const grid = ensurePop().querySelector('.cat-picker-grid');
  const allTile = mode === 'filter'
    ? `<button type="button" class="cat-picker-tile${!currentCat ? ' on' : ''}" data-cat="" title="全部分类">
        <span class="cat-picker-icon cat-picker-icon--all"><i class="ti ti-apps"></i></span>
        <span class="cat-picker-name">全部</span>
      </button>`
    : '';
  grid.innerHTML = allTile + getCats().map(c => {
    const on = c === currentCat ? ' on' : '';
    const em = getEmoji(c);
    return `<button type="button" class="cat-picker-tile${on}" data-cat="${c}" title="${c}">
      <span class="cat-picker-icon">${renderCatIcon(em, { size: 18 })}</span>
      <span class="cat-picker-name">${c}</span>
    </button>`;
  }).join('');
}

function positionPop(anchor) {
  const pop = ensurePop();
  pop.classList.remove('hide');
  const rect = anchor.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - popW / 2;
  if (top + popH > window.innerHeight - 12) top = rect.top - popH - 8;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 12) left = 12;
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.left = `${left}px`;
}

export function openCatPicker(anchor) {
  const rowId = Number(anchor.dataset.rowId);
  const splitRaw = anchor.dataset.splitIdx;
  const splitIdx = splitRaw != null && splitRaw !== '' ? Number(splitRaw) : null;
  const currentCat = anchor.dataset.currentCat || anchor.querySelector('.cat-pick-label')?.textContent?.trim() || '';

  if (!popEl?.classList.contains('hide') && activeMode === 'row' && activeRowId === rowId && activeSplitIdx === splitIdx) {
    closeCatPicker();
    return;
  }

  activeMode = 'row';
  activeRowId = rowId;
  activeSplitIdx = splitIdx;
  renderGrid(currentCat === '选择分类' ? '' : currentCat, 'row');
  positionPop(anchor);
}

export function openCatPickerForFilter(anchor) {
  const currentCat = anchor.dataset.currentCat || '';

  if (!popEl?.classList.contains('hide') && activeMode === 'filter') {
    closeCatPicker();
    return;
  }

  activeMode = 'filter';
  activeRowId = null;
  activeSplitIdx = null;
  renderGrid(currentCat, 'filter');
  positionPop(anchor);
}

export function closeCatPicker() {
  if (!popEl) return;
  popEl.classList.add('hide');
  activeRowId = null;
  activeSplitIdx = null;
  activeMode = 'row';
}

function ensureEmojiPop() {
  if (emojiPopEl) return emojiPopEl;
  emojiPopEl = document.createElement('div');
  emojiPopEl.id = 'emojiPickerPop';
  emojiPopEl.className = 'emoji-picker-pop hide';
  emojiPopEl.innerHTML = `
    <div class="emoji-picker-head">卡通图标</div>
    <div class="emoji-picker-grid emoji-picker-cartoon"></div>
    <div class="emoji-picker-head">Emoji</div>
    <div class="emoji-picker-grid emoji-picker-emoji"></div>
    <div class="emoji-picker-custom">
      <input type="text" class="emoji-picker-inp" placeholder="粘贴 emoji 或 icon:1F374…" maxlength="16">
      <button type="button" class="btn btn-p emoji-picker-ok">确定</button>
    </div>`;
  document.body.appendChild(emojiPopEl);

  emojiPopEl.querySelector('.emoji-picker-cartoon').innerHTML = CARTOON_ICON_QUICK.map(em => (
    `<button type="button" class="emoji-picker-tile emoji-picker-tile-cartoon" data-emoji="${em}" title="${em}">${renderCatIcon(em, { size: 22 })}</button>`
  )).join('');
  emojiPopEl.querySelector('.emoji-picker-emoji').innerHTML = EMOJI_QUICK.map(em => (
    `<button type="button" class="emoji-picker-tile" data-emoji="${em}" title="${em}">${em}</button>`
  )).join('');

  emojiPopEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn || !emojiOnPick) return;
    emojiOnPick(btn.dataset.emoji);
    closeEmojiPicker();
  });

  const inp = emojiPopEl.querySelector('.emoji-picker-inp');
  const ok = emojiPopEl.querySelector('.emoji-picker-ok');
  const applyCustom = () => {
    const em = inp.value.trim();
    if (!em || !emojiOnPick) return;
    emojiOnPick(em);
    closeEmojiPicker();
  };
  ok.addEventListener('click', applyCustom);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') applyCustom(); });

  document.addEventListener('click', e => {
    if (!emojiPopEl || emojiPopEl.classList.contains('hide')) return;
    if (e.target.closest('.emoji-picker-pop') || e.target.closest('.cat-emoji-btn')) return;
    closeEmojiPicker();
  });

  emojiPopEl.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  return emojiPopEl;
}

function positionEmojiPop(anchor) {
  const pop = ensureEmojiPop();
  pop.classList.remove('hide');
  const rect = anchor.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - popW / 2;
  if (top + popH > window.innerHeight - 12) top = rect.top - popH - 8;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 12) left = 12;
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.left = `${left}px`;
}

export function openEmojiPicker(anchor, current, onPick) {
  closeCatPicker();
  emojiOnPick = onPick;
  const pop = ensureEmojiPop();
  pop.querySelector('.emoji-picker-inp').value = current || '';
  positionEmojiPop(anchor);
}

export function closeEmojiPicker() {
  if (!emojiPopEl) return;
  emojiPopEl.classList.add('hide');
  emojiOnPick = null;
}
