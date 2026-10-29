/** 未分类子分类展示。子分类用页面内浮层，避免原生下拉在滚动容器里一点就关。 */

import { hasSplits } from './splits.js';
import { closeCatPicker } from './cat-picker.js';

export const SUBCAT_UNSET_LABEL = '未分类';

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function parseSubChange(onchange) {
  const match = String(onchange || '').match(/^([A-Za-z_][\w]*)\((\d+)(?:,(\d+))?,this\.value\)$/);
  if (!match) return null;
  return { fn: match[1], id: match[2], idx: match[3] };
}

export function subCatSelectHtml({ subs, sub, onchange, extraClass = '' }) {
  if (!subs.length) return '';
  const parsed = parseSubChange(onchange);
  if (!parsed) {
    const unset = !sub;
    const cls = ['cs', 'cs-sub', extraClass, unset ? 'cs-sub-unset' : ''].filter(Boolean).join(' ');
    const opts = [
      `<option value="">${SUBCAT_UNSET_LABEL}</option>`,
      ...subs.map(s => `<option value="${escAttr(s)}"${s === sub ? ' selected' : ''}>${escAttr(s)}</option>`),
    ].join('');
    return `<select class="${cls}" onchange="${onchange}">${opts}</select>`;
  }
  const unset = !sub;
  const cls = ['cs', 'cs-sub', 'subcat-pop-btn', extraClass, unset ? 'cs-sub-unset' : ''].filter(Boolean).join(' ');
  const label = sub || SUBCAT_UNSET_LABEL;
  const idxAttr = parsed.idx != null ? ` data-subcat-idx="${parsed.idx}"` : '';
  return `<button type="button" class="${cls}" data-subcat-fn="${parsed.fn}" data-subcat-id="${parsed.id}"${idxAttr} data-subcat-value="${escAttr(sub || '')}" data-subcat-options="${encodeURIComponent(JSON.stringify(subs))}" aria-haspopup="listbox" aria-expanded="false">${escAttr(label)}</button>`;
}

let popEl = null;
let activeBtn = null;
let ignoreScroll = false;

function closeSubCatPop() {
  if (!popEl) return;
  popEl.classList.add('hide');
  activeBtn?.setAttribute('aria-expanded', 'false');
  activeBtn = null;
}

function positionSubCatPop(anchor) {
  const pop = popEl;
  pop.classList.remove('hide');
  const rect = anchor.getBoundingClientRect();
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  let top = rect.bottom + 6;
  let left = rect.left;
  if (top + popH > window.innerHeight - 8) top = rect.top - popH - 6;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.left = `${Math.max(8, left)}px`;
}

function openSubCatPop(btn) {
  closeCatPicker();
  const list = popEl.querySelector('.subcat-pop-list');
  let subs = [];
  try { subs = JSON.parse(decodeURIComponent(btn.dataset.subcatOptions || '%5B%5D')); } catch { subs = []; }
  const current = btn.dataset.subcatValue || '';
  list.replaceChildren();
  for (const value of ['', ...subs]) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = `subcat-pop-opt${value === current ? ' on' : ''}`;
    opt.dataset.subcatOpt = value;
    opt.textContent = value || SUBCAT_UNSET_LABEL;
    list.appendChild(opt);
  }
  activeBtn?.setAttribute('aria-expanded', 'false');
  activeBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  ignoreScroll = true;
  positionSubCatPop(btn);
  requestAnimationFrame(() => { ignoreScroll = false; });
}

function applySubCatOpt(opt) {
  const btn = activeBtn;
  if (!btn) return;
  const fn = btn.dataset.subcatFn;
  const id = Number(btn.dataset.subcatId);
  const idx = btn.dataset.subcatIdx;
  const value = opt.dataset.subcatOpt || '';
  closeSubCatPop();
  const handler = window[fn];
  if (typeof handler !== 'function') return;
  if (idx != null && idx !== '') handler(id, Number(idx), value);
  else handler(id, value);
}

export function setupSubCatPop() {
  if (popEl) return;
  popEl = document.createElement('div');
  popEl.id = 'subCatPop';
  popEl.className = 'subcat-pop hide';
  popEl.setAttribute('role', 'listbox');
  popEl.innerHTML = '<div class="subcat-pop-head">子分类</div><div class="subcat-pop-list"></div>';
  document.body.appendChild(popEl);

  document.addEventListener('click', (e) => {
    const opt = e.target.closest('#subCatPop [data-subcat-opt]');
    if (opt) {
      e.preventDefault();
      e.stopPropagation();
      applySubCatOpt(opt);
      return;
    }
    const btn = e.target.closest('.subcat-pop-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (activeBtn === btn && !popEl.classList.contains('hide')) closeSubCatPop();
      else openSubCatPop(btn);
      return;
    }
    if (!e.target.closest('#subCatPop')) closeSubCatPop();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSubCatPop();
  });

  window.addEventListener('scroll', (e) => {
    if (ignoreScroll || !popEl || popEl.classList.contains('hide')) return;
    if (popEl === e.target || popEl.contains(e.target)) return;
    closeSubCatPop();
  }, true);
  window.addEventListener('resize', closeSubCatPop);
}

export function subCatGroupTitleHtml(sub) {
  if (sub === SUBCAT_UNSET_LABEL) {
    return `<span class="subcat-unset-pill">${SUBCAT_UNSET_LABEL}</span>`;
  }
  return sub;
}

export function rowHasUnsetSub(row, getSubcatsFor) {
  const subs = getSubcatsFor(row['分类']);
  if (!subs.length) return false;
  if (row.splits?.length) {
    return row.splits.some(sp => !(sp.subcategory || '').trim());
  }
  return !(row['子分类'] || '').trim();
}

export function rowSubLabel(row, cat = '') {
  if (hasSplits(row)) {
    const parts = row.splits
      .filter(sp => !cat || sp.category === cat)
      .map(sp => (sp.subcategory || '').trim() || SUBCAT_UNSET_LABEL);
    return parts[0] || SUBCAT_UNSET_LABEL;
  }
  return (row['子分类'] || '').trim() || SUBCAT_UNSET_LABEL;
}

export function rowMatchesSubCat(row, sub, getSubcatsFor, cat = '') {
  if (!sub) return true;
  if (sub === SUBCAT_UNSET_LABEL) return rowHasUnsetSub(row, getSubcatsFor);
  if (hasSplits(row)) {
    return row.splits.some(sp => {
      if (cat && sp.category !== cat) return false;
      const label = (sp.subcategory || '').trim() || SUBCAT_UNSET_LABEL;
      return label === sub;
    });
  }
  if (cat && row['分类'] !== cat) return false;
  return rowSubLabel(row, cat) === sub;
}
