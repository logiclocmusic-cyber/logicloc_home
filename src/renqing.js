/** 人情往来：按子分类（人物）查看往来款与收支 */
import { fmtMoney, fmtMoneySigned, fmtCount } from './format.js';
import { assetUrl } from './apiBase.js';
import { subCatSelectHtml } from './subcat-ui.js';

export const RENQING_CAT = '人情往来';

const AVATAR_COLORS = [
  '#2e90fa', '#12b76a', '#f79009', '#6941c6', '#ee46bc', '#0e9384',
  '#e31b54', '#4e5ba6', '#dc6803', '#7a5af8', '#1570ef', '#099250'
];

let getExpandedRows = () => [];
let getSubcatsFor = () => [];
let formatDayHeader = d => d;
let formatTimeShort = t => t;
let srcBadgeHtml = s => s;
let typeBadgeHtml = () => '';
let onPersist = () => {};
let onEditRow = () => {};

let renqingAvatars = {};
let activePerson = null;
let pendingUploadPerson = null;

export function initRenqing(deps) {
  getExpandedRows = deps.getExpandedRows || getExpandedRows;
  getSubcatsFor = deps.getSubcatsFor || getSubcatsFor;
  formatDayHeader = deps.formatDayHeader || formatDayHeader;
  formatTimeShort = deps.formatTimeShort || formatTimeShort;
  srcBadgeHtml = deps.srcBadgeHtml || srcBadgeHtml;
  typeBadgeHtml = deps.typeBadgeHtml || typeBadgeHtml;
  onPersist = deps.onPersist || onPersist;
  onEditRow = deps.onEditRow || onEditRow;
}

export function loadRenqingState(state) {
  renqingAvatars = state?.renqingAvatars || {};
}

export function getRenqingState() {
  return { renqingAvatars };
}

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatarLetter(name) {
  const t = (name || '').trim();
  if (!t || t === '未分类') return '?';
  return t[0];
}

function avatarSrc(name) {
  const raw = renqingAvatars[name];
  if (!raw) return '';
  return assetUrl(raw);
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || '');
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function avatarCircleHtml(name, size = 'card') {
  const color = hashColor(name);
  const src = avatarSrc(name);
  const letter = avatarLetter(name);
  const enc = encodeURIComponent(name);
  const inner = src
    ? `<img class="renqing-av-img" src="${src}" alt="">`
    : `<span class="renqing-av-letter">${letter}</span>`;
  return `<span class="renqing-av-circle renqing-av-circle--${size}" style="background:${src ? 'var(--surf2)' : color}">
    ${inner}
    <span class="renqing-av-upload" role="button" tabindex="0" title="上传头像" onclick="event.stopPropagation(); triggerRenqingAvatarUpload('${enc}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();triggerRenqingAvatarUpload('${enc}')}"><i class="ti ti-camera"></i></span>
  </span>`;
}

function renqingRows() {
  return getExpandedRows().filter(r => r['分类'] === RENQING_CAT);
}

function peopleList() {
  const rows = renqingRows();
  const configured = getSubcatsFor(RENQING_CAT);
  const used = [...new Set(rows.map(r => r['子分类'] || '未分类'))];
  const merged = [...configured];
  used.forEach(s => { if (!merged.includes(s)) merged.push(s); });
  const list = merged.filter(s => rows.some(r => (r['子分类'] || '未分类') === s));
  return list.sort((a, b) => {
    if (a === '未分类') return 1;
    if (b === '未分类') return -1;
    const ai = configured.indexOf(a), bi = configured.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'zh-CN');
  });
}

function personRows(sub) {
  return renqingRows()
    .filter(r => (r['子分类'] || '未分类') === sub)
    .sort((a, b) => (b['日期'] + b['时间']).localeCompare(a['日期'] + a['时间']));
}

function personStats(rows) {
  const inc = rows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
  const exp = rows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
  return { inc, exp, net: inc - exp, count: rows.length };
}

/** 净额 = 收到 − 送出；送出更多为对方欠我，收到更多为我欠对方 */
function netOweHint(net) {
  if (net > 0) return '我欠对方';
  if (net < 0) return '对方欠我';
  return '收支相抵';
}

function netOweClass(net) {
  if (net > 0) return 'neg';
  if (net < 0) return 'pos';
  return '';
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function renderPersonListItem(name) {
  const rows = personRows(name);
  const { net } = personStats(rows);
  const active = activePerson === name;
  const displayName = name === '未分类' ? '未分类' : name;
  const netCls = netOweClass(net);
  const amtTxt = rows.length ? fmtMoneySigned(net) : '暂无往来';
  return `<div class="renqing-person${active ? ' on' : ''}" role="button" tabindex="0" data-person="${esc(name)}" onclick="selectRenqingPerson(this.dataset.person)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectRenqingPerson(this.dataset.person)}">
    ${avatarCircleHtml(name, 'list')}
    <div class="renqing-person-info">
      <div class="renqing-person-name">${esc(displayName)}</div>
      <div class="renqing-person-amt ${netCls}">${esc(amtTxt)}</div>
    </div>
  </div>`;
}

function renqingSubsForRow(row) {
  const configured = getSubcatsFor(RENQING_CAT);
  const sub = row['子分类'] || '';
  const merged = [...configured];
  if (sub && !merged.includes(sub)) merged.push(sub);
  return merged;
}

function renderTxnSubSelect(row) {
  const subs = renqingSubsForRow(row);
  const sub = row['子分类'] || '';
  if (!subs.length) {
    return `<div class="renqing-txn-sub renqing-txn-sub--text">${esc(sub || '未分类')}</div>`;
  }
  const onchange = row._splitOf != null && row._splitIdx != null
    ? `updRenqingSplitSub(${row._splitOf},${row._splitIdx},this.value)`
    : `updRenqingSubCat(${row._splitOf ?? row.id},this.value)`;
  return `<div class="renqing-txn-sub" onclick="event.stopPropagation()">${subCatSelectHtml({ subs, sub, onchange, extraClass: 'renqing-sub-sel' })}</div>`;
}

function renderTxnRow(row) {
  const isInc = row['收支'] === '收入';
  const desc = (row['商品说明'] || row['交易对方'] || '—').trim() || '—';
  const editId = row._splitOf ?? row.id;
  return `<div class="renqing-txn editable" data-edit-id="${editId}" title="双击编辑">
    <div class="renqing-txn-time">${formatTimeShort(row['时间']) || '—'}</div>
    <div class="renqing-txn-src">${srcBadgeHtml(row['来源'])}</div>
    ${renderTxnSubSelect(row)}
    <div class="renqing-txn-desc" title="${esc(desc)}">${esc(desc)}</div>
    <div class="renqing-txn-type">${typeBadgeHtml(row['收支'], row['退款状态'], row['分类'])}</div>
    <div class="renqing-txn-amt ${isInc ? 'inc' : 'exp'}">${isInc ? '+' : '-'}${fmtMoney(row['金额'])}</div>
  </div>`;
}

function renderPersonDetail(name) {
  const rows = personRows(name);
  const { inc, exp, net } = personStats(rows);
  const head = document.getElementById('renqingHead');
  if (head) {
    head.innerHTML = `
      <div class="renqing-head-av-wrap">
        ${avatarCircleHtml(name, 'head')}
      </div>
      <div class="renqing-head-meta">
        <div class="renqing-head-name">${esc(name === '未分类' ? '未分类' : name)}</div>
        <div class="renqing-head-sub">人情往来 · 共 ${fmtCount(rows.length)} 笔</div>
      </div>`;
  }

  const kpi = document.getElementById('renqingKpi');
  if (kpi) {
    const expN = fmtCount(rows.filter(r => r['收支'] === '支出').length);
    const incN = fmtCount(rows.filter(r => r['收支'] === '收入').length);
    const netHint = netOweHint(net);
    kpi.innerHTML = `
      <div class="renqing-kpi-card">
        <div class="renqing-kpi-label"><i class="ti ti-arrow-down-right"></i>送出（支出）</div>
        <div class="renqing-kpi-value c-red">${fmtMoney(exp)}</div>
        <div class="renqing-kpi-sub">${expN} 笔</div>
      </div>
      <div class="renqing-kpi-card">
        <div class="renqing-kpi-label"><i class="ti ti-arrow-up-right"></i>收到（收入）</div>
        <div class="renqing-kpi-value c-grn">${fmtMoney(inc)}</div>
        <div class="renqing-kpi-sub">${incN} 笔</div>
      </div>
      <div class="renqing-kpi-card">
        <div class="renqing-kpi-label"><i class="ti ti-scale"></i>净往来</div>
        <div class="renqing-kpi-value ${net > 0 ? 'c-red' : net < 0 ? 'c-grn' : 'c-blu'}">${fmtMoneySigned(net)}</div>
        <div class="renqing-kpi-sub">${netHint}</div>
      </div>`;
  }

  const list = document.getElementById('renqingList');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="renqing-empty">暂无往来记录</div>';
    return;
  }

  const dayMap = new Map();
  rows.forEach(r => {
    const d = r['日期'];
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d).push(r);
  });

  list.innerHTML = [...dayMap.entries()].map(([date, dayRows]) => {
    const dayInc = dayRows.filter(r => r['收支'] === '收入').reduce((s, r) => s + r['金额'], 0);
    const dayExp = dayRows.filter(r => r['收支'] === '支出').reduce((s, r) => s + r['金额'], 0);
    return `<section class="renqing-day">
      <header class="renqing-day-head">
        <span>${formatDayHeader(date)}</span>
        <span class="renqing-day-sum">
          ${dayInc ? `<span class="inc">+${fmtMoney(dayInc)}</span>` : ''}
          ${dayExp ? `<span class="exp">-${fmtMoney(dayExp)}</span>` : ''}
        </span>
      </header>
      <div class="renqing-day-rows">${dayRows.map(renderTxnRow).join('')}</div>
    </section>`;
  }).join('');
}

export function selectRenqingPerson(name) {
  activePerson = name;
  renderRenqingPage();
}

export function triggerRenqingAvatarUpload(encodedName) {
  pendingUploadPerson = decodeURIComponent(encodedName);
  document.getElementById('renqingFileInp')?.click();
}

export async function handleRenqingAvatarUpload(file) {
  const person = pendingUploadPerson;
  pendingUploadPerson = null;
  if (!person || !file) return;
  if (!isImageFile(file)) {
    alert('请选择图片文件');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('图片不能超过 5MB');
    return;
  }
  try {
    renqingAvatars[person] = await readImageAsDataUrl(file);
    onPersist();
    renderRenqingPage();
  } catch (err) {
    alert('上传失败：' + err.message);
  }
}

export function setupRenqingUpload() {
  const inp = document.getElementById('renqingFileInp');
  if (!inp || inp._bound) return;
  inp._bound = true;
  inp.addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleRenqingAvatarUpload(file);
  });

  const list = document.getElementById('renqingList');
  if (list && !list._editBound) {
    list._editBound = true;
    list.addEventListener('dblclick', e => {
      if (e.target.closest('select')) return;
      const el = e.target.closest('.renqing-txn[data-edit-id]');
      if (!el) return;
      const id = Number(el.dataset.editId);
      if (!Number.isFinite(id)) return;
      onEditRow(id);
    });
  }
}

export function renderRenqingPage() {
  const peopleEl = document.getElementById('renqingPeople');
  const panelEl = document.getElementById('renqingPanel');
  if (!peopleEl) return;

  const people = peopleList();
  if (!people.length) {
    peopleEl.innerHTML = '<div class="renqing-empty">暂无人情往来记录。请在账目中将分类设为「人情往来」，子分类填写对方姓名。</div>';
    panelEl?.classList.add('hide');
    return;
  }

  if (!activePerson || !people.includes(activePerson)) {
    activePerson = people[0];
  }

  peopleEl.innerHTML = people.map(renderPersonListItem).join('');
  panelEl?.classList.remove('hide');
  renderPersonDetail(activePerson);
}
