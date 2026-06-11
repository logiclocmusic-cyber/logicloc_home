/** 未分类子分类展示 */

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
