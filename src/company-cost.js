import { fmtMoney } from './format.js';
import { assetUrl } from './apiBase.js';
import {
  fetchInvoices, fetchInvoiceAiStatus, scanInvoice, createInvoice, updateInvoice, deleteInvoice
} from './api.js';

const CATEGORIES = ['办公用品', '差旅', '餐饮', '设备', '服务', '租金', '其他'];

let invoices = [];
let openId = null;
let pendingFile = null;

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

function totalSum() {
  return invoices.reduce((s, inv) => s + (Number(inv.total) || 0), 0);
}

function formFieldsHtml(data = {}) {
  const catOpts = CATEGORIES.map(c =>
    `<option value="${c}"${data.category === c ? ' selected' : ''}>${c}</option>`
  ).join('');
  return `
    <div class="inv-form-grid">
      <div class="fg"><label>销售方</label><input id="invVendor" value="${esc(data.vendor)}"></div>
      <div class="fg"><label>购买方</label><input id="invBuyer" value="${esc(data.buyer)}"></div>
      <div class="fg"><label>发票号码</label><input id="invNo" value="${esc(data.invoiceNo)}"></div>
      <div class="fg"><label>开票日期</label><input id="invDate" type="date" value="${esc(data.invoiceDate)}"></div>
      <div class="fg"><label>不含税金额</label><input id="invAmount" type="number" step="0.01" value="${data.amount ?? ''}"></div>
      <div class="fg"><label>税额</label><input id="invTax" type="number" step="0.01" value="${data.taxAmount ?? ''}"></div>
      <div class="fg"><label>价税合计</label><input id="invTotal" type="number" step="0.01" value="${data.total ?? ''}"></div>
      <div class="fg"><label>费用类型</label><select id="invCategory">${catOpts}</select></div>
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

function renderTable() {
  const body = document.getElementById('invTableBody');
  const summary = document.getElementById('invSummary');
  if (!body) return;
  if (summary) {
    summary.textContent = invoices.length
      ? `共 ${invoices.length} 张发票，合计 ${fmtMoney(totalSum())}`
      : '上传发票图片，AI 自动识别内容';
  }
  if (!invoices.length) {
    body.innerHTML = `<tr><td colspan="7" class="inv-empty">暂无发票，拖拽或点击上方区域上传</td></tr>`;
    return;
  }
  body.innerHTML = invoices.map(inv => `
    <tr class="inv-row" onclick="openInvoiceEdit(${inv.id})">
      <td>${esc(inv.invoiceDate || '—')}</td>
      <td>${esc(inv.vendor || '—')}</td>
      <td>${esc(inv.invoiceNo || '—')}</td>
      <td><span class="inv-cat">${esc(inv.category || '其他')}</span></td>
      <td class="r">${inv.total != null ? fmtMoney(inv.total) : '—'}</td>
      <td>${inv.fileUrl ? '<i class="ti ti-paperclip"></i>' : '—'}</td>
      <td class="inv-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm" onclick="openInvoiceEdit(${inv.id})" title="编辑"><i class="ti ti-edit"></i></button>
        <button class="btn btn-sm btn-a" onclick="removeInvoice(${inv.id})" title="删除"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`).join('');
}

async function loadInvoices() {
  const data = await fetchInvoices();
  invoices = data.invoices || [];
  renderTable();
}

async function updateAiStatusBanner() {
  const intro = document.querySelector('.inv-intro');
  if (!intro) return;
  try {
    const st = await fetchInvoiceAiStatus();
    if (!st.configured) {
      intro.innerHTML = '上传公司成本发票进行管理。<span class="inv-ai-warn">AI 识别未启用：请在 Railway 配置 <code>DEEPSEEK_API_KEY</code> 后重新部署。</span>';
    } else if (st.mode === 'vision') {
      intro.textContent = '上传发票图片，由视觉模型 + DeepSeek 自动识别销售方、金额、日期等信息，识别后可手动校对保存。';
    } else {
      intro.textContent = '上传发票图片，先 OCR 识别文字再由 DeepSeek 解析字段，识别后可手动校对保存。';
    }
  } catch {
    intro.textContent = '上传公司成本发票，由 AI 识别销售方、金额、日期等信息。';
  }
}

export async function renderCompanyCostPage() {
  try {
    await Promise.all([loadInvoices(), updateAiStatusBanner()]);
  } catch (err) {
    alert('加载发票失败：' + err.message);
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
  const zone = document.getElementById('invDropZone');
  zone?.classList.add('scanning');
  try {
    const dataUrl = await readFileAsDataUrl(file);
    pendingFile = { dataUrl, file };
    openId = null;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      openInvoiceModal({ fileName: file.name, mimeType: file.type, notes: 'PDF 发票请手动填写信息' }, dataUrl);
      return;
    }
    const scanned = await scanInvoice(dataUrl, file.type, file.name);
    openInvoiceModal({ ...scanned, fileName: file.name, mimeType: file.type }, dataUrl);
  } catch (err) {
    alert('识别失败：' + err.message);
  } finally {
    zone?.classList.remove('scanning');
  }
}

function openInvoiceModal(data = {}, previewUrl = null) {
  const modal = document.getElementById('moInvoice');
  const title = document.getElementById('invModalTitle');
  const form = document.getElementById('invForm');
  const preview = document.getElementById('invPreview');
  if (title) title.textContent = openId ? '编辑发票' : '新增发票';
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

export function triggerInvoiceUpload() {
  document.getElementById('invFileInp')?.click();
}

export function setupCompanyCost() {
  const inp = document.getElementById('invFileInp');
  const zone = document.getElementById('invDropZone');
  inp?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processUpload(file);
  });
  if (!zone) return;
  zone.addEventListener('click', () => inp?.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) processUpload(file);
  });
}
