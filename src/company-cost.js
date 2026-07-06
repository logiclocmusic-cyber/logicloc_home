import { fmtMoney } from './format.js';
import { assetUrl } from './apiBase.js';
import {
  fetchInvoices, fetchInvoiceAiStatus, scanInvoice, createInvoice, updateInvoice, deleteInvoice
} from './api.js';

const CATEGORIES = ['办公用品', '差旅', '餐饮', '设备', '服务', '租金', '其他'];
const COMPANY_BUYERS = [
  '成都小河帮电子商务有限公司',
  '成都乐极客科技有限公司'
];
const BUYER_DOT_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
const BUYER_ROW_BG = [
  'rgba(239,68,68,.06)', 'rgba(59,130,246,.06)', 'rgba(34,197,94,.06)',
  'rgba(245,158,11,.06)', 'rgba(139,92,246,.06)', 'rgba(236,72,153,.06)'
];

function currentYear() {
  return String(new Date().getFullYear());
}

function currentQuarter() {
  return String(Math.ceil((new Date().getMonth() + 1) / 3));
}

let invoices = [];
let openId = null;
let pendingFile = null;
let uploadMode = 'ai';
let buyerColorMap = new Map();
let filters = { buyer: '', search: '', year: currentYear(), quarter: currentQuarter(), status: '' };

function invoiceNoFromFilename(fileName) {
  const m = String(fileName || '').match(/(\d{18,22})/);
  return m ? m[1] : '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function isInvoiceFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/') || file.type === 'application/pdf') return true;
  return /\.(jpe?g|png|gif|webp|bmp|pdf)$/i.test(file.name || '');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function trunc(s, n = 28) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function invoiceYear(dateStr) {
  const y = String(dateStr || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
}

function invoiceQuarter(dateStr) {
  const m = Number(String(dateStr || '').slice(5, 7));
  if (!m) return null;
  return Math.ceil(m / 3);
}

function uniqueBuyers(list) {
  const set = new Set();
  list.forEach(inv => {
    const b = (inv.buyer || '').trim();
    if (b) set.add(b);
  });
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

function rebuildBuyerColors(list) {
  buyerColorMap = new Map();
  uniqueBuyers(list).forEach((buyer, i) => {
    buyerColorMap.set(buyer, i % BUYER_DOT_COLORS.length);
  });
}

function buyerStyle(buyer) {
  const idx = buyerColorMap.get((buyer || '').trim());
  if (idx == null) return { dot: 'var(--txt3)', bg: 'transparent' };
  return { dot: BUYER_DOT_COLORS[idx], bg: BUYER_ROW_BG[idx] };
}

function normalizeInvoiceNo(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function findLocalDuplicate(invoiceNo, excludeId = null) {
  const key = normalizeInvoiceNo(invoiceNo);
  if (!key) return null;
  return invoices.find(inv => {
    if (excludeId != null && inv.id === excludeId) return false;
    return normalizeInvoiceNo(inv.invoiceNo) === key;
  }) || null;
}

function duplicateInvoiceMessage(inv) {
  const no = inv?.invoiceNo || '—';
  const extras = [];
  if (inv?.vendor) extras.push(`销售方：${inv.vendor}`);
  if (inv?.invoiceDate) extras.push(`开票日期：${inv.invoiceDate}`);
  const tail = extras.length ? `（${extras.join('，')}）` : '';
  return `发票号码 ${no} 已上传过${tail}，请勿重复上传。`;
}

function itemSummary(inv) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  if (!items.length) {
    return { name: inv.category || '其他', count: 0 };
  }
  const first = items[0]?.name || inv.category || '其他';
  return { name: first, count: items.length };
}

function filteredInvoices() {
  const q = filters.search.trim().toLowerCase();
  return invoices.filter(inv => {
    if (filters.buyer && (inv.buyer || '').trim() !== filters.buyer) return false;
    if (filters.year && invoiceYear(inv.invoiceDate) !== filters.year) return false;
    if (filters.quarter && String(invoiceQuarter(inv.invoiceDate) || '') !== filters.quarter) return false;
    if (filters.status === 'printed' && !inv.printed) return false;
    if (filters.status === 'unprinted' && inv.printed) return false;
    if (!q) return true;
    const hay = [
      inv.invoiceNo, inv.vendor, inv.buyer, inv.fileName, inv.category, inv.notes
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function resolveFormBuyer(buyer) {
  const b = String(buyer || '').trim();
  if (COMPANY_BUYERS.includes(b)) return b;
  if (/小河帮/.test(b)) return COMPANY_BUYERS[0];
  if (/乐极客/.test(b)) return COMPANY_BUYERS[1];
  return COMPANY_BUYERS[0];
}

function formFieldsHtml(data = {}) {
  const catOpts = CATEGORIES.map(c =>
    `<option value="${c}"${data.category === c ? ' selected' : ''}>${c}</option>`
  ).join('');
  const buyerVal = resolveFormBuyer(data.buyer);
  const buyerOpts = COMPANY_BUYERS.map(b =>
    `<option value="${esc(b)}"${buyerVal === b ? ' selected' : ''}>${esc(b)}</option>`
  ).join('');
  return `
    <div class="inv-form-grid">
      <div class="inv-form-row inv-form-row--1">
        <div class="fg fg-vendor"><label>销售方</label><input id="invVendor" value="${esc(data.vendor)}" title="${esc(data.vendor)}"></div>
        <div class="fg fg-no"><label>发票号码</label><input id="invNo" value="${esc(data.invoiceNo)}" title="${esc(data.invoiceNo)}"></div>
        <div class="fg fg-date"><label>开票日期</label><input id="invDate" type="date" value="${esc(data.invoiceDate)}"></div>
      </div>
      <div class="inv-form-row inv-form-row--2">
        <div class="fg fg-buyer"><label>购买方</label><select id="invBuyer" title="${esc(buyerVal)}">${buyerOpts}</select></div>
        <div class="fg fg-amt"><label>不含税金额</label><input id="invAmount" type="number" step="0.01" value="${data.amount ?? ''}"></div>
        <div class="fg fg-amt"><label>税额</label><input id="invTax" type="number" step="0.01" value="${data.taxAmount ?? ''}"></div>
        <div class="fg fg-amt"><label>价税合计</label><input id="invTotal" type="number" step="0.01" value="${data.total ?? ''}"></div>
      </div>
      <div class="inv-form-row inv-form-row--3">
        <div class="fg fg-cat"><label>费用类型</label><select id="invCategory">${catOpts}</select></div>
      </div>
      <div class="fg full"><label>备注</label><textarea id="invNotes" rows="2">${esc(data.notes)}</textarea></div>
    </div>`;
}

function readForm() {
  return {
    vendor: document.getElementById('invVendor')?.value?.trim() || '',
    buyer: document.getElementById('invBuyer')?.value?.trim() || '',
    invoiceNo: document.getElementById('invNo')?.value?.trim() || '',
    invoiceDate: document.getElementById('invDate')?.value || '',
    amount: parseFloat(document.getElementById('invAmount')?.value) || null,
    taxAmount: parseFloat(document.getElementById('invTax')?.value) || null,
    total: parseFloat(document.getElementById('invTotal')?.value) || null,
    category: document.getElementById('invCategory')?.value || '其他',
    notes: document.getElementById('invNotes')?.value?.trim() || ''
  };
}

function yearCompanyStats(year) {
  const y = String(year);
  return COMPANY_BUYERS.map((company, i) => {
    const list = invoices.filter(inv =>
      resolveFormBuyer(inv.buyer) === company && invoiceYear(inv.invoiceDate) === y
    );
    const total = list.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
    return { company, count: list.length, total, color: BUYER_DOT_COLORS[i], bg: BUYER_ROW_BG[i] };
  });
}

function renderYearCards() {
  const el = document.getElementById('invYearCards');
  if (!el) return;
  const year = new Date().getFullYear();
  const stats = yearCompanyStats(year);
  el.innerHTML = stats.map(s => {
    const active = filters.buyer === s.company && filters.year === String(year) ? ' on' : '';
    const short = s.company.replace(/^成都/, '');
    return `<button type="button" class="inv-year-card${active}" data-buyer="${esc(s.company)}" data-year="${year}" style="--inv-card-accent:${s.color};--inv-card-bg:${s.bg}">
      <div class="inv-year-card-top">
        <i class="inv-company-dot" style="background:${s.color}"></i>
        <span class="inv-year-card-name" title="${esc(s.company)}">${esc(short)}</span>
        <span class="inv-year-card-year">${year} 年</span>
      </div>
      <div class="inv-year-card-amt">${fmtMoney(s.total)}</div>
      <div class="inv-year-card-meta">${s.count} 张成本发票</div>
    </button>`;
  }).join('');
  el.querySelectorAll('.inv-year-card').forEach(card => {
    card.addEventListener('click', () => {
      const buyer = card.dataset.buyer || '';
      const yearVal = card.dataset.year || '';
      const same = filters.buyer === buyer && filters.year === yearVal;
      filters.buyer = same ? '' : buyer;
      filters.year = same ? '' : yearVal;
      const yearSel = document.getElementById('invFilterYear');
      if (yearSel) yearSel.value = filters.year;
      renderAll();
    });
  });
}

function renderCompanyTabs() {
  const el = document.getElementById('invCompanyTabs');
  if (!el) return;
  const buyers = uniqueBuyers(invoices);
  const tabs = [{ id: '', label: '全部' }, ...buyers.map(b => ({ id: b, label: b }))];
  el.innerHTML = tabs.map(tab => {
    const active = filters.buyer === tab.id ? ' on' : '';
    const dot = tab.id
      ? `<i class="inv-company-dot" style="background:${buyerStyle(tab.id).dot}"></i>`
      : '';
    return `<button type="button" class="inv-company-tab${active}" data-buyer="${esc(tab.id)}" title="${esc(tab.label)}">${dot}<span>${esc(trunc(tab.label, 22))}</span></button>`;
  }).join('');
  el.querySelectorAll('.inv-company-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      filters.buyer = btn.dataset.buyer || '';
      renderAll();
    });
  });
}

function renderYearFilter() {
  const sel = document.getElementById('invFilterYear');
  if (!sel) return;
  const years = [...new Set(invoices.map(inv => invoiceYear(inv.invoiceDate)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const cur = filters.year;
  sel.innerHTML = `<option value="">全部年份</option>${years.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('')}`;
}

function renderSummary(list) {
  const summary = document.getElementById('invSummary');
  if (!summary) return;
  const printed = list.filter(inv => inv.printed).length;
  const total = list.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
  summary.textContent = list.length
    ? `共 ${list.length} 张 · 已打印 ${printed} · 合计 ${fmtMoney(total)}`
    : '暂无发票';
}

function renderTable() {
  const body = document.getElementById('invTableBody');
  if (!body) return;
  const list = filteredInvoices();
  renderSummary(list);
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="inv-empty">暂无发票，点击「AI 识别上传」或「手动录入」添加</td></tr>`;
    return;
  }
  body.innerHTML = list.map(inv => {
    const style = buyerStyle(inv.buyer);
    const item = itemSummary(inv);
    const fileUrl = inv.fileUrl ? assetUrl(inv.fileUrl) : '';
    const printIcon = inv.printed
      ? '<i class="ti ti-circle-check inv-printed"></i>'
      : '<i class="ti ti-circle inv-print-pending"></i>';
    return `<tr class="inv-row" style="background:${style.bg}" data-id="${inv.id}">
      <td class="inv-date">${esc(inv.invoiceDate || '—')}</td>
      <td class="inv-item">
        <div class="inv-item-name" title="${esc(item.name)}">${esc(trunc(item.name, 18))}</div>
        ${item.count ? `<div class="inv-item-count">共 ${item.count} 项</div>` : ''}
      </td>
      <td class="inv-vendor-cell">
        <div class="inv-no" title="${esc(inv.invoiceNo)}">${esc(inv.invoiceNo || '—')}</div>
        <div class="inv-vendor" title="${esc(inv.vendor)}">${esc(trunc(inv.vendor, 24))}</div>
      </td>
      <td class="inv-buyer" title="${esc(inv.buyer)}">${esc(trunc(inv.buyer, 20))}</td>
      <td class="r">${inv.taxAmount != null ? fmtMoney(inv.taxAmount) : '—'}</td>
      <td class="r inv-total">${inv.total != null ? fmtMoney(inv.total) : '—'}</td>
      <td class="c inv-print-cell" onclick="event.stopPropagation()">
        <button type="button" class="inv-icon-btn" onclick="toggleInvoicePrinted(${inv.id})" title="${inv.printed ? '已打印' : '标记已打印'}">${printIcon}</button>
      </td>
      <td class="c inv-actions" onclick="event.stopPropagation()">
        <button type="button" class="inv-icon-btn" onclick="openInvoiceEdit(${inv.id})" title="查看/编辑"><i class="ti ti-eye"></i></button>
        <button type="button" class="inv-icon-btn" onclick="printInvoiceFile(${inv.id})" title="打印"${fileUrl ? '' : ' disabled'}><i class="ti ti-printer"></i></button>
        <button type="button" class="inv-icon-btn" onclick="downloadInvoiceFile(${inv.id})" title="下载"${fileUrl ? '' : ' disabled'}><i class="ti ti-download"></i></button>
        <button type="button" class="inv-icon-btn inv-icon-btn--danger" onclick="removeInvoice(${inv.id})" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.inv-row').forEach(row => {
    row.addEventListener('click', () => openInvoiceEdit(Number(row.dataset.id)));
  });
}

function syncQuarterFilter() {
  const sel = document.getElementById('invFilterQuarter');
  if (sel) sel.value = filters.quarter;
}

function renderAll() {
  renderYearCards();
  renderCompanyTabs();
  renderYearFilter();
  syncQuarterFilter();
  renderTable();
}

async function loadInvoices() {
  const data = await fetchInvoices();
  invoices = data.invoices || [];
  rebuildBuyerColors(invoices);
  renderAll();
}

async function updateAiStatusBanner() {
  const intro = document.querySelector('.inv-intro');
  if (!intro) return;
  try {
    const st = await fetchInvoiceAiStatus();
    if (!st.configured) {
      intro.innerHTML = '按公司分别查看、打印、下载发票。<span class="inv-ai-warn">AI 识别未启用：请在 Railway 配置 <code>DEEPSEEK_API_KEY</code>。</span>';
    } else if (st.mode === 'vision') {
      intro.textContent = '按公司分别查看、打印、下载发票。上传后由视觉 AI 自动识别，可手动校对保存。';
    } else {
      intro.textContent = '按公司分别查看、打印、下载发票。上传后由 AI 自动识别，可手动校对保存。';
    }
  } catch {
    intro.textContent = '按公司分别查看、打印、下载发票';
  }
}

export async function renderCompanyCostPage() {
  try {
    await Promise.all([loadInvoices(), updateAiStatusBanner()]);
  } catch (err) {
    alert('加载发票失败：' + err.message);
  }
}

async function processManualUpload(file) {
  if (!isInvoiceFile(file)) {
    alert('请上传图片或 PDF 发票');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('文件不能超过 10MB');
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingFile = { dataUrl, file };
    openId = null;
    const invoiceNo = invoiceNoFromFilename(file.name);
    const dup = invoiceNo ? findLocalDuplicate(invoiceNo) : null;
    if (dup) {
      alert(duplicateInvoiceMessage(dup));
      pendingFile = null;
      return;
    }
    openInvoiceModal({
      invoiceNo,
      fileName: file.name,
      mimeType: file.type,
      category: '其他'
    }, dataUrl, '手动录入发票');
  } catch (err) {
    alert('读取文件失败：' + err.message);
    pendingFile = null;
  }
}

async function processUpload(file) {
  if (!isInvoiceFile(file)) {
    alert('请上传图片或 PDF 发票');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('文件不能超过 10MB');
    return;
  }
  const btn = document.querySelector('.inv-upload-btn');
  btn?.classList.add('scanning');
  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingFile = { dataUrl, file };
    openId = null;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const scanned = await scanInvoice(dataUrl, file.type || (isPdf ? 'application/pdf' : ''), file.name);
    const dup = findLocalDuplicate(scanned.invoiceNo);
    if (dup) {
      alert(duplicateInvoiceMessage(dup));
      pendingFile = null;
      return;
    }
    openInvoiceModal({ ...scanned, fileName: file.name, mimeType: file.type }, dataUrl);
  } catch (err) {
    alert('识别失败：' + err.message);
  } finally {
    btn?.classList.remove('scanning');
  }
}

function openInvoiceModal(data = {}, previewUrl = null, modalTitle = null) {
  const modal = document.getElementById('moInvoice');
  const title = document.getElementById('invModalTitle');
  const form = document.getElementById('invForm');
  const preview = document.getElementById('invPreview');
  if (title) {
    title.textContent = modalTitle || (openId ? '编辑发票' : '新增发票');
  }
  if (form) form.innerHTML = formFieldsHtml(data);
  if (preview) {
    const url = previewUrl || (data.fileUrl ? assetUrl(data.fileUrl) : null);
    preview.innerHTML = url
      ? (url.includes('.pdf') || data.mimeType === 'application/pdf'
        ? `<div class="inv-pdf-ph"><i class="ti ti-file-type-pdf"></i><span>${esc(data.fileName || '发票文件')}</span></div>`
        : `<img src="${url}" alt="发票预览">`)
      : `<div class="inv-preview-ph"><i class="ti ti-receipt"></i><span>无附件</span></div>`;
  }
  modal?.classList.remove('hide');
}

export function openInvoiceEdit(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  openId = id;
  pendingFile = null;
  openInvoiceModal(inv, inv.fileUrl ? assetUrl(inv.fileUrl) : null);
}

export function closeInvoiceEdit() {
  openId = null;
  pendingFile = null;
  document.getElementById('moInvoice')?.classList.add('hide');
}

export async function saveInvoiceEdit() {
  const fields = readForm();
  const dup = findLocalDuplicate(fields.invoiceNo, openId);
  if (dup) {
    alert(duplicateInvoiceMessage(dup));
    return;
  }
  try {
    if (openId) {
      await updateInvoice(openId, fields);
    } else {
      const payload = { ...fields };
      if (pendingFile) {
        payload.data = pendingFile.dataUrl;
        payload.mime = pendingFile.file.type;
        payload.fileName = pendingFile.file.name;
      }
      await createInvoice(payload);
    }
    closeInvoiceEdit();
    await loadInvoices();
  } catch (err) {
    alert('保存失败：' + err.message);
  }
}

export async function removeInvoice(id) {
  if (!confirm('确定删除这张发票？')) return;
  try {
    await deleteInvoice(id);
    if (openId === id) closeInvoiceEdit();
    await loadInvoices();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

export async function toggleInvoicePrinted(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  try {
    await updateInvoice(id, { printed: !inv.printed });
    await loadInvoices();
  } catch (err) {
    alert('更新失败：' + err.message);
  }
}

export function downloadInvoiceFile(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv?.fileUrl) return;
  const a = document.createElement('a');
  a.href = assetUrl(inv.fileUrl);
  a.download = inv.fileName || `invoice-${inv.invoiceNo || id}`;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function printInvoiceFile(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv?.fileUrl) return;
  const w = window.open(assetUrl(inv.fileUrl), '_blank', 'noopener');
  if (w) w.addEventListener('load', () => { try { w.print(); } catch { /* pdf */ } });
  toggleInvoicePrinted(id).catch(() => {});
}

export function triggerInvoiceUpload() {
  uploadMode = 'ai';
  document.getElementById('invFileInp')?.click();
}

export function triggerManualInvoiceUpload() {
  uploadMode = 'manual';
  document.getElementById('invFileInp')?.click();
}

export function setupCompanyCost() {
  const inp = document.getElementById('invFileInp');
  inp?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (uploadMode === 'manual') processManualUpload(file);
    else processUpload(file);
  });

  document.getElementById('invSearch')?.addEventListener('input', e => {
    filters.search = e.target.value || '';
    renderTable();
  });
  document.getElementById('invFilterYear')?.addEventListener('change', e => {
    filters.year = e.target.value || '';
    renderTable();
  });
  document.getElementById('invFilterQuarter')?.addEventListener('change', e => {
    filters.quarter = e.target.value || '';
    renderTable();
  });
  document.getElementById('invFilterStatus')?.addEventListener('change', e => {
    filters.status = e.target.value || '';
    renderTable();
  });

  const page = document.getElementById('view-company');
  page?.addEventListener('dragover', e => { e.preventDefault(); page.classList.add('inv-drag'); });
  page?.addEventListener('dragleave', e => {
    if (!page.contains(e.relatedTarget)) page.classList.remove('inv-drag');
  });
  page?.addEventListener('drop', e => {
    e.preventDefault();
    page.classList.remove('inv-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) processUpload(file);
  });
}
