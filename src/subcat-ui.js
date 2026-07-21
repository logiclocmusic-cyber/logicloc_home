/** 未分类子分类展示 */

import { hasSplits } from './splits.js';

export const SUBCAT_UNSET_LABEL = '未分类';

export function subCatSelectHtml({ subs, sub, onchange, extraClass = '' }) {
  if (!subs.length) return '';
  const unset = !sub;
  const cls = ['cs', 'cs-sub', extraClass, unset ? 'cs-sub-unset' : ''].filter(Boolean).join(' ');
  const opts = [
    `<option value="">${SUBCAT_UNSET_LABEL}</option>`,
    ...subs.map(s => `<option value="${s}"${s === sub ? ' selected' : ''}>${s}</option>`),
  ].join('');
  return `<select class="${cls}" onchange="${onchange}">${opts}</select>`;
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
