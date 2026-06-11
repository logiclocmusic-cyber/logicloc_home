// ── 账目拆分 ─────────────────────────────────────────────────────────────────
import { catPickBtnHtml } from './cat-picker.js';
import { SUBCAT_UNSET_LABEL, subCatSelectHtml } from './subcat-ui.js';

let getCats = () => [];
let getSubcatsFor = () => [];
let getAllData = () => [];
let onPersist = () => {};

const expandedSplitIds = new Set();

export function initSplits(deps) {
  getCats = deps.getCats;
  getSubcatsFor = deps.getSubcatsFor;
  getAllData = deps.getAllData;
  onPersist = deps.onPersist;
}

export function hasSplits(row) {
  return Array.isArray(row?.splits) && row.splits.length > 0;
}

export function splitSum(row) {
  if (!hasSplits(row)) return 0;
  return row.splits.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
}

/** 将含拆分的记录展开为统计用虚拟行 */
export function expandRowForStats(row) {
  if (!hasSplits(row)) return [row];
  return row.splits.map((sp, idx) => ({
    ...row,
    分类: sp.category || row['分类'],
    子分类: sp.subcategory || '',
    金额: Number(sp.amount) || 0,
    _splitOf: row.id,
    _splitIdx: idx
  }));
}

export function rowMatchesCat(row, cat) {
  if (!cat) return true;
  if (hasSplits(row)) return row.splits.some(sp => sp.category === cat);
  return row['分类'] === cat;
}

export function rowSearchHaystack(row) {
  const base = [
    row['交易对方'], row['商品说明'], row['产品名称'], row['分类'], row['子分类'],
    row['来源'], row['备注'], row['支付方式']
  ];
  if (hasSplits(row)) {
    row.splits.forEach(sp => {
      base.push(sp.category, sp.subcategory, sp.note);
    });
    base.push('已拆分');
  }
  return base.join(' ').toLowerCase();
}

export function splitSummaryLabel(row) {
  const n = row.splits.length;
  const cats = [...new Set(row.splits.map(sp => sp.category).filter(Boolean))];
  const catTxt = cats.length <= 2 ? cats.join('、') : `${cats[0]} 等${cats.length}类`;
  return `${catTxt} · ${n}项`;
}

export function toggleSplitExpand(id) {
  if (expandedSplitIds.has(id)) expandedSplitIds.delete(id);
  else expandedSplitIds.add(id);
  return expandedSplitIds.has(id);
}

export function isSplitExpanded(id) {
  return expandedSplitIds.has(id);
}

function splitLineHtml(sp, idx, parentId, parentType) {
  const subs = getSubcatsFor(sp.category);
  const catOpts = getCats().map(c =>
    `<option value="${c}"${c === sp.category ? ' selected' : ''}>${c}</option>`
  ).join('');
  const subOpts = subs.length
    ? ['<option value="">' + SUBCAT_UNSET_LABEL + '</option>', ...subs.map(s =>
      `<option value="${s}"${s === (sp.subcategory || '') ? ' selected' : ''}>${s}</option>`
    )].join('')
    : '<option value="">无</option>';
  const subUnset = subs.length && !(sp.subcategory || '');
  const sign = parentType === '收入' ? '+' : '-';
  return `<div class="split-line" data-idx="${idx}">
    <div class="split-line-amt">
      <label>金额</label>
      <input type="number" class="split-amt-inp" step="0.01" min="0" value="${sp.amount ?? ''}" data-idx="${idx}">
    </div>
    <div class="split-line-cat">
      <label>分类</label>
      <select class="split-cat-inp" data-idx="${idx}">${catOpts}</select>
    </div>
    <div class="split-line-sub">
      <label>子分类</label>
      <select class="split-sub-inp cs cs-sub${subUnset ? ' cs-sub-unset' : ''}" data-idx="${idx}">${subOpts}</select>
    </div>
    <div class="split-line-note">
      <label>备注</label>
      <input type="text" class="split-note-inp" data-idx="${idx}" value="${sp.note || ''}" placeholder="可选">
    </div>
    <button type="button" class="btn btn-sm split-rm" data-idx="${idx}" title="删除此行"><i class="ti ti-x"></i></button>
  </div>`;
}

function renderSplitEditorLines(lines, parentId, parentType) {
  const el = document.getElementById('splitLines');
  if (!el) return;
  el.innerHTML = lines.map((sp, i) => splitLineHtml(sp, i, parentId, parentType)).join('');
  bindSplitEditorEvents(parentId, parentType);
}

function bindSplitEditorEvents(parentId, parentType) {
  const el = document.getElementById('splitLines');
  if (!el) return;
  el.querySelectorAll('.split-cat-inp').forEach(sel => {
    sel.onchange = () => {
      const idx = Number(sel.dataset.idx);
      const lines = readSplitEditorLines(parentType);
      lines[idx].category = sel.value;
      lines[idx].subcategory = '';
      renderSplitEditorLines(lines, parentId, parentType);
      updateSplitRemainder(parentId, parentType);
    };
  });
  el.querySelectorAll('.split-amt-inp, .split-sub-inp, .split-note-inp').forEach(inp => {
    inp.oninput = () => updateSplitRemainder(parentId, parentType);
  });
  el.querySelectorAll('.split-rm').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      const lines = readSplitEditorLines(parentType);
      if (lines.length <= 1) { alert('至少保留一行'); return; }
      lines.splice(idx, 1);
      renderSplitEditorLines(lines, parentId, parentType);
      updateSplitRemainder(parentId, parentType);
    };
  });
}

function readSplitEditorLines(parentType) {
  const el = document.getElementById('splitLines');
  if (!el) return [];
  return [...el.querySelectorAll('.split-line')].map(line => ({
    amount: parseFloat(line.querySelector('.split-amt-inp')?.value) || 0,
    category: line.querySelector('.split-cat-inp')?.value || '',
    subcategory: line.querySelector('.split-sub-inp')?.value || '',
    note: line.querySelector('.split-note-inp')?.value?.trim() || ''
  }));
}

function updateSplitRemainder(parentId, parentType) {
  const row = getAllData().find(r => r.id === parentId);
  const hint = document.getElementById('splitRemainder');
  if (!row || !hint) return;
  const lines = readSplitEditorLines(parentType);
  const sum = lines.reduce((s, sp) => s + sp.amount, 0);
  const diff = +(row['金额'] - sum).toFixed(2);
  if (Math.abs(diff) < 0.01) {
    hint.innerHTML = '<span class="split-ok"><i class="ti ti-check"></i> 金额已对齐</span>';
  } else if (diff > 0) {
    hint.innerHTML = `<span class="split-warn">还差 <strong>¥${diff.toFixed(2)}</strong> 未分配</span>`;
  } else {
    hint.innerHTML = `<span class="split-warn">超出 <strong>¥${Math.abs(diff).toFixed(2)}</strong></span>`;
  }
}

let splitEditId = null;

export function getSplitEditId() {
  return splitEditId;
}

export function openSplitEditor(id) {
  const row = getAllData().find(r => r.id === id);
  if (!row) return;
  splitEditId = id;
  const clearBtn = document.getElementById('splitClearBtn');
  if (clearBtn) clearBtn.style.display = hasSplits(row) ? '' : 'none';
  const meta = document.getElementById('splitMeta');
  if (meta) {
    meta.innerHTML = `
      <div><span>日期</span>${row['日期']} ${row['时间'] || ''}</div>
      <div><span>商户</span>${row['交易对方'] || '—'}</div>
      <div><span>原金额</span>¥${row['金额'].toFixed(2)}（${row['收支']}）</div>`;
  }
  const lines = hasSplits(row)
    ? row.splits.map(sp => ({ ...sp }))
    : [{ amount: row['金额'], category: row['分类'], subcategory: row['子分类'] || '', note: '' }];
  renderSplitEditorLines(lines, id, row['收支']);
  updateSplitRemainder(id, row['收支']);
  document.getElementById('moSplit')?.classList.remove('hide');
}

export function closeSplitEditor() {
  splitEditId = null;
  document.getElementById('moSplit')?.classList.add('hide');
}

export function addSplitLine() {
  if (!splitEditId) return;
  const row = getAllData().find(r => r.id === splitEditId);
  if (!row) return;
  const lines = readSplitEditorLines(row['收支']);
  const sum = lines.reduce((s, sp) => s + sp.amount, 0);
  const remain = Math.max(0, +(row['金额'] - sum).toFixed(2));
  lines.push({
    amount: remain || 0,
    category: row['分类'],
    subcategory: '',
    note: ''
  });
  renderSplitEditorLines(lines, splitEditId, row['收支']);
  updateSplitRemainder(splitEditId, row['收支']);
}

export function saveSplitEditor(onSaved) {
  if (!splitEditId) return;
  const row = getAllData().find(r => r.id === splitEditId);
  if (!row) return;
  const lines = readSplitEditorLines(row['收支']);
  if (!lines.length) { alert('至少添加一行'); return; }
  for (const sp of lines) {
    if (!sp.category) { alert('请为每行选择分类'); return; }
    if (!sp.amount || sp.amount <= 0) { alert('每行金额须大于 0'); return; }
  }
  const sum = lines.reduce((s, sp) => s + sp.amount, 0);
  if (Math.abs(sum - row['金额']) > 0.01) {
    alert(`拆分金额合计 ¥${sum.toFixed(2)}，须等于原金额 ¥${row['金额'].toFixed(2)}`);
    return;
  }
  row.splits = lines.map(sp => ({
    amount: +sp.amount.toFixed(2),
    category: sp.category,
    subcategory: sp.subcategory || '',
    note: sp.note || ''
  }));
  expandedSplitIds.add(row.id);
  onPersist();
  closeSplitEditor();
  onSaved?.();
}

export function clearSplits(id, onSaved) {
  const row = getAllData().find(r => r.id === id);
  if (!row || !hasSplits(row)) return;
  if (!confirm('取消拆分后，将恢复为单一分类记录，确定？')) return;
  delete row.splits;
  expandedSplitIds.delete(id);
  onPersist();
  onSaved?.();
}

export function updateSplitItem(parentId, idx, field, value) {
  const row = getAllData().find(r => r.id === parentId);
  if (!row || !hasSplits(row) || !row.splits[idx]) return;
  if (field === 'category') {
    row.splits[idx].category = value;
    row.splits[idx].subcategory = '';
  } else if (field === 'subcategory') {
    row.splits[idx].subcategory = value;
  }
  onPersist();
}

function splitSubRowCells(row, sp, idx, gridCls) {
  const subs = getSubcatsFor(sp.category);
  const mainBtn = catPickBtnHtml(row.id, sp.category, { splitIdx: idx });
  const subSel = subCatSelectHtml({
    subs,
    sub: sp.subcategory || '',
    onchange: `updSplitSub(${row.id},${idx},this.value)`,
    extraClass: 'split-sub-sel',
  });
  const sign = row['收支'] === '收入' ? '+' : '-';
  const note = sp.note ? `<span class="split-sub-note">${sp.note}</span>` : `<span class="split-sub-tag">子项 ${idx + 1}</span>`;
  const dateCell = gridCls === 'COL-NODATE' ? '' : `<div class="td dt-cell split-dt"><span class="split-sub-tag">子项 ${idx + 1}</span></div>`;
  const peerNote = gridCls === 'COL-NODATE' ? note : (sp.note ? `<span class="split-sub-note">${sp.note}</span>` : '');
  return `<div class="tr ${gridCls} ledger-split-row" data-parent-id="${row.id}">
    <div class="td td-check"><span class="split-tree-line"></span></div>
    ${dateCell}
    <div class="td split-empty"></div>
    <div class="td peer-desc split-peer">${peerNote}</div>
    <div class="td cat-cell split-cat-cell">${mainBtn}${subSel}</div>
    <div class="td type-cell split-empty"></div>
    <div class="td amt-cell ${row['收支'] === '收入' ? 'i' : 'e'} no-strike">
      <div class="amt-val">${sign}¥${Number(sp.amount).toFixed(2)}</div>
    </div>
    <div class="td td-actions split-empty"></div>
  </div>`;
}

export function splitSubRowHtml(row, sp, idx) {
  return splitSubRowCells(row, sp, idx, 'COL');
}

export function splitSubRowNoDateHtml(row, sp, idx) {
  return splitSubRowCells(row, sp, idx, 'COL-NODATE');
}

export function parentCatCellHtml(row) {
  const expanded = isSplitExpanded(row.id);
  const chevron = expanded ? 'ti-chevron-down' : 'ti-chevron-right';
  return `<div class="td no-strike cat-cell split-parent-cat">
    <button type="button" class="split-toggle" onclick="toggleSplitExpand(${row.id})" title="展开/折叠子账目">
      <i class="ti ${chevron}"></i>
      <span class="split-badge">已拆分</span>
      <span class="split-summary">${splitSummaryLabel(row)}</span>
    </button>
  </div>`;
}
