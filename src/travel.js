import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { deleteTravelFile, fetchTravel, geocodeTravelPlaces, resolveTravelMaps, saveTravel, uploadTravelFile, uploadTravelImageFromUrl } from './api.js';

const ROUTE_COLORS = ['#3b82f6', '#f43f5e', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
const TITLE = '10月11日香港旅游';
const RANGE = '10月11日 – 10月15日';
const PREP = '行程前准备';
const TRAVEL_CATEGORIES = ['交通', '住宿', '用餐', '景点', '购物', '任务'];
const categoryFilter = new Set(['', ...TRAVEL_CATEGORIES]);
let categoryMenuOpen = false;
const LEGACY_PLAN_ID = 'plan-hk-20261011';
/** 1 港币兑人民币；默认取出行首日（2026-10-11）中间价约 85.27/100 */
const DEFAULT_HKD_CNY = 0.8527;

const SEED = [
  { id: 'prep-1', date: '行程前准备', time: '', event: '汇丰 One 申请', note: '已申请，抵港激活', cost: null, done: true },
  { id: 'prep-2', date: '行程前准备', time: '', event: '嘉信出金测试', note: '', cost: null, done: false },
  { id: 'prep-3', date: '行程前准备', time: '', event: '兑换港币', note: '', cost: null, done: false },
  { id: 'prep-4', date: '行程前准备', time: '', event: '准备流量卡', note: '长桥流量卡 / 电信流量兑换', cost: null, done: false },
  { id: 'd11-1', date: '2026-10-11', time: '09:00', event: '前往巴士站，出发天府机场', note: '', cost: null, done: false },
  { id: 'd11-2', date: '2026-10-11', time: '12:05', event: '成都出发香港', note: '西藏航空 TV9701 天府 T1 – 香港 T1', cost: 1564.92, done: true },
  { id: 'd11-3', date: '2026-10-11', time: '14:30', event: '抵达香港：下飞机，取行李', note: '', cost: null, done: false },
  { id: 'd11-4', date: '2026-10-11', time: '15:30', event: '前往巴士站，城巴「机场快线」A11', note: '', cost: null, done: false },
  { id: 'd11-5', date: '2026-10-11', time: '16:30', event: '入住富豪香港酒店', note: '富豪香港酒店 (Regal HongKong Hotel)\n预订编号：1779858916、1779858917', cost: 3719.69, done: true },
  { id: 'd11-6', date: '2026-10-11', time: '17:30', event: '出发坐地铁去旺角', note: '', cost: null, done: false },
  { id: 'd11-7', date: '2026-10-11', time: '18:30', event: '购买手机', note: '', cost: null, done: false },
  { id: 'd11-8', date: '2026-10-11', time: '19:00', event: '探店：老荔冰室', note: '', cost: 0, done: true },
  { id: 'd12-1', date: '2026-10-12', time: '09:30', event: '苏哥清汤腩冰室', note: '九龙弥敦道', cost: null, done: true },
  { id: 'd12-2', date: '2026-10-12', time: '10:00', event: '乐高探索中心', note: '尖沙咀，暂定', cost: null, done: false },
  { id: 'd12-3', date: '2026-10-12', time: '13:00', event: '探店：神灯海鲜酒楼（铜锣湾）', note: '', cost: 0, done: true },
  { id: 'd12-4', date: '2026-10-12', time: '14:00', event: '香港动植物园', note: '中环', cost: null, done: false },
  { id: 'd12-5', date: '2026-10-12', time: '18:00', event: '晚餐待定 stubli', note: '坚尼地城', cost: null, done: false },
  { id: 'd13-1', date: '2026-10-13', time: '', event: '海洋公园', note: '预估行程，婴儿免票', cost: 595, done: false },
  { id: 'd14-1', date: '2026-10-14', time: '', event: '', note: '', cost: null, done: false },
  { id: 'd15-1', date: '2026-10-15', time: '11:30', event: '上环 – 蛇口', note: '', cost: 169.5, done: false },
  { id: 'd15-2', date: '2026-10-15', time: '12:20', event: '抵达蛇口', note: '', cost: null, done: false },
  { id: 'd15-3', date: '2026-10-15', time: '13:00', event: '海上世界 1 小时游玩', note: '', cost: null, done: false },
  { id: 'd15-4', date: '2026-10-15', time: '14:00', event: '出发去机场', note: '', cost: null, done: false },
  { id: 'd15-5', date: '2026-10-15', time: '14:30', event: '抵达深圳机场', note: '', cost: null, done: false },
  { id: 'd15-6', date: '2026-10-15', time: '16:35', event: '深圳出发', note: '深圳 T3 – 双流 T2', cost: 1688, done: true },
  { id: 'd15-7', date: '2026-10-15', time: '19:10', event: '抵达成都', note: '', cost: null, done: false },
];

let items = SEED.map(item => ({
  ...item,
  image: item.image || '',
  file: item.file || '',
  fileName: item.fileName || '',
  files: item.files || [],
}));
let plans = [{ id: LEGACY_PLAN_ID, title: TITLE, range: RANGE, items }];
let activePlanId = LEGACY_PLAN_ID;
let editing = null;
let editLock = false;
let imageLoadingId = '';
let fileLoadingId = '';
let filePicker = null;
let filePickerItemId = '';
let imageVersion = {};
let mapOpenTimer = 0;
let revision = 0;
let loaded = false;
let deletingRow = false;
let travelGridFitFrame = 0;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function isMapsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co') return true;
    if (/^maps\.google\./.test(host)) return true;
    return /^google\./.test(host) && url.pathname.startsWith('/maps');
  } catch {
    return false;
  }
}

function isShortMapsUrl(value) {
  try {
    const host = new URL(String(value || '').trim()).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co';
  } catch {
    return false;
  }
}

function mapsPoint(value) {
  const text = String(value || '').trim();
  if (!text || !isMapsUrl(text)) return text;
  try {
    const url = new URL(text);
    const pin = `${url.pathname}${url.search}${url.hash}`.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (pin) return `${pin[1]},${pin[2]}`;
    const query = url.searchParams.get('query')
      || url.searchParams.get('q')
      || url.searchParams.get('destination')
      || url.searchParams.get('daddr');
    if (query) return query;
    const at = `${url.pathname}${url.hash}`.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (at) return `${at[1]},${at[2]}`;
    const place = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
    if (place) return decodeURIComponent(place[1].replace(/\+/g, ' '));
  } catch { /* 短链接无法解析时保留原文 */ }
  return text;
}

function splitMapValues(location, destination) {
  const from = String(location || '').trim();
  const to = String(destination || '').trim();
  if (to) return { location: from, destination: to };
  const urls = from.split(/[\s\n]+/).map(part => part.trim()).filter(isMapsUrl);
  if (urls.length >= 2) return { location: urls[0], destination: urls[1] };
  return { location: from, destination: to };
}

function mapsLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!isMapsUrl(text)) return text;
  const point = mapsPoint(text);
  return point && point !== text ? point : '地图位置';
}

function mapsHref(location, destination) {
  const from = String(location || '').trim();
  const to = String(destination || '').trim();
  if (from && to) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(mapsPoint(from))}&destination=${encodeURIComponent(mapsPoint(to))}`;
  }
  const one = from || to;
  if (!one) return '';
  if (isMapsUrl(one)) return one;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(one)}`;
}

const WEEKDAYS = ['星期天', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function canonicalDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (!match) return text;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const weekday = WEEKDAYS.findIndex(name => text.includes(name));
  const year = new Date().getFullYear();
  const years = [year, year + 1, year - 1, year + 2];
  for (const candidate of years) {
    const date = new Date(candidate, month - 1, day);
    if (date.getFullYear() !== candidate || date.getMonth() !== month - 1 || date.getDate() !== day) continue;
    if (weekday < 0 || date.getDay() === weekday) {
      return `${candidate}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return text;
}

function formatTravelDate(value) {
  const iso = canonicalDate(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '').trim();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

function timeMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isPrep(item) {
  return String(item?.date || '').trim() === PREP;
}

function pinPrep(list) {
  const prep = [];
  const rest = [];
  list.forEach(item => (isPrep(item) ? prep : rest).push(item));
  return prep.concat(rest);
}

function orderByTime(list, date) {
  const key = String(date || '').trim();
  if (!key) return list;
  const indexes = [];
  list.forEach((item, index) => {
    if (String(item.date || '').trim() === key) indexes.push(index);
  });
  if (indexes.length < 2) return list;
  const sorted = indexes
    .map(index => ({ item: list[index], index }))
    .sort((a, b) => {
      const left = timeMinutes(a.item.time);
      const right = timeMinutes(b.item.time);
      if (left == null && right == null) return a.index - b.index;
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right || a.index - b.index;
    })
    .map(entry => entry.item);
  const next = list.slice();
  indexes.forEach((index, offset) => { next[index] = sorted[offset]; });
  return next;
}

function money(n) {
  if (n === null || n === undefined || n === '') return '';
  return `¥${Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function itemCurrency(item) {
  return String(item?.currency || '').toUpperCase() === 'HKD' ? 'HKD' : 'CNY';
}

function moneyAmount(n, currency = 'CNY') {
  if (n === null || n === undefined || n === '') return '';
  const formatted = Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'HKD' ? `HK$${formatted}` : `¥${formatted}`;
}

function moneyCost(item) {
  if (item?.cost == null || item.cost === '') return '';
  return moneyAmount(item.cost, itemCurrency(item));
}

function tripRateDate(plan = activePlan()) {
  const saved = String(plan?.hkdRateDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
  const dates = (plan?.items || items || [])
    .map(item => canonicalDate(item.date))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates[0] || '';
}

function hkdRate(plan = activePlan()) {
  const rate = Number(plan?.hkdRate);
  if (Number.isFinite(rate) && rate > 0) return rate;
  return DEFAULT_HKD_CNY;
}

function ensurePlanFx(plan = activePlan()) {
  if (!plan) return;
  if (!Number.isFinite(Number(plan.hkdRate)) || Number(plan.hkdRate) <= 0) plan.hkdRate = DEFAULT_HKD_CNY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(plan.hkdRateDate || ''))) {
    const date = tripRateDate(plan);
    if (date) plan.hkdRateDate = date;
  }
}

function costInCny(item, plan = activePlan()) {
  if (!Number.isFinite(item?.cost)) return 0;
  if (itemCurrency(item) !== 'HKD') return item.cost;
  return Math.round(item.cost * hkdRate(plan) * 100) / 100;
}

function formatRateDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function rateLabel(plan = activePlan()) {
  ensurePlanFx(plan);
  const rate = hkdRate(plan);
  const date = formatRateDate(tripRateDate(plan));
  const rateText = rate.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 5 });
  return date ? `${date} 1港币 = ¥${rateText}` : `1港币 = ¥${rateText}`;
}

function categorySelect(item) {
  const current = TRAVEL_CATEGORIES.includes(item.category) ? item.category : '';
  const options = ['<option value="">未分类</option>'].concat(TRAVEL_CATEGORIES.map(name => (
    `<option value="${esc(name)}"${name === current ? ' selected' : ''}>${esc(name)}</option>`
  )));
  return `<select class="travel-category-select${current ? ' is-set' : ''}" data-travel-category="${esc(item.id)}" aria-label="分类">${options.join('')}</select>`;
}

function isVisit(item) {
  return !!item?.visit;
}

function statusSelect(item) {
  const visit = isVisit(item);
  const done = !!item.done && !visit;
  const mark = visit ? ' is-visit' : done ? ' is-done' : '';
  return `<select class="travel-status-select${mark}" data-travel-status="${esc(item.id)}" aria-label="完成状态">
    <option value="0"${done || visit ? '' : ' selected'}>未完成</option>
    <option value="1"${done ? ' selected' : ''}>已完成</option>
    <option value="2"${visit ? ' selected' : ''}>探店预约</option>
  </select>`;
}

function totalCost() {
  const plan = activePlan();
  return items.reduce((sum, item) => sum + (!isVisit(item) && Number.isFinite(item.cost) ? costInCny(item, plan) : 0), 0);
}

function savedCost() {
  const plan = activePlan();
  return items.reduce((sum, item) => sum + (isVisit(item) && Number.isFinite(item.cost) ? costInCny(item, plan) : 0), 0);
}

function placeItem(list, updated) {
  const prev = list.find(item => item.id === updated.id);
  if (prev && prev.date === updated.date) {
    return list.map(item => item.id === updated.id ? updated : item);
  }
  const rest = list.filter(item => item.id !== updated.id);
  let last = -1;
  rest.forEach((item, index) => {
    if (item.date && item.date === updated.date) last = index;
  });
  if (last >= 0) rest.splice(last + 1, 0, updated);
  else rest.push(updated);
  return rest;
}

function categoryFilterKey(item) {
  return TRAVEL_CATEGORIES.includes(item?.category) ? item.category : '';
}

function itemMatchesCategory(item) {
  return categoryFilter.has(categoryFilterKey(item));
}

function categoryFilterActive() {
  return categoryFilter.size < TRAVEL_CATEGORIES.length + 1;
}

function placeCategoryMenu() {
  if (!categoryMenuOpen) return;
  const btn = document.querySelector('#travelBoard [data-travel-cat-filter]');
  const menu = document.querySelector('#travelBoard .travel-cat-menu');
  if (!btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  const width = menu.offsetWidth || 148;
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.style.right = 'auto';
}

function categoryFilterMenu() {
  const options = [{ key: '', label: '未分类' }].concat(TRAVEL_CATEGORIES.map(name => ({ key: name, label: name })));
  const checks = options.map(option => `<label class="travel-cat-option">
      <input type="checkbox" data-cat-filter="${esc(option.key)}"${categoryFilter.has(option.key) ? ' checked' : ''}>
      <span>${esc(option.label)}</span>
    </label>`).join('');
  return `<div class="travel-cat-filter${categoryFilterActive() ? ' is-on' : ''}">
    <button type="button" class="travel-cat-filter-btn" data-travel-cat-filter aria-expanded="${categoryMenuOpen ? 'true' : 'false'}" aria-label="筛选分类" title="筛选分类">
      <i class="ti ti-filter" aria-hidden="true"></i>
    </button>
    <div class="travel-cat-menu" role="group" aria-label="显示的分类"${categoryMenuOpen ? '' : ' hidden'}>
      ${checks}
    </div>
  </div>`;
}

function dateSpans(list = items) {
  const editingDateId = editing?.field === 'date' ? editing.id : '';
  const spans = list.map(() => 0);
  let i = 0;
  while (i < list.length) {
    const key = String(list[i].date || '').trim();
    if (!key || list[i].id === editingDateId) {
      spans[i] = 1;
      i += 1;
      continue;
    }
    let span = 1;
    while (i + span < list.length) {
      const next = list[i + span];
      if (String(next.date || '').trim() !== key || next.id === editingDateId) break;
      span += 1;
    }
    spans[i] = span;
    i += span;
  }
  return spans;
}

function fieldEditor(item, field) {
  if (field === 'date') {
    const iso = canonicalDate(item.date);
    const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
    return `<input class="travel-inp" data-field="date" type="date" value="${esc(value)}" aria-label="日期">`;
  }
  if (field === 'time') {
    return `<input class="travel-inp" data-field="time" type="time" value="${esc(item.time)}" aria-label="时间">`;
  }
  if (field === 'event') {
    return `<input class="travel-inp" data-field="event" value="${esc(item.event)}" maxlength="80" aria-label="事项">`;
  }
  if (field === 'place') {
    return `<div class="travel-place-edit">
      <input class="travel-inp" data-field="location" value="${esc(item.location)}" maxlength="500" placeholder="起点：地址或地图链接" aria-label="起点">
      <input class="travel-inp" data-field="destination" value="${esc(item.destination)}" maxlength="500" placeholder="终点：再贴一个链接，生成路线" aria-label="终点">
    </div>`;
  }
  if (field === 'note') {
    const lines = Math.max(1, String(item.note || '').split('\n').length);
    return `<textarea class="travel-inp" data-field="note" rows="${lines}" maxlength="400" aria-label="信息">${esc(item.note)}</textarea>`;
  }
  if (field === 'image') {
    return `<input class="travel-inp" data-field="image" value="" placeholder="粘贴图片链接" maxlength="500" aria-label="图片链接">`;
  }
  if (field === 'fileName') {
    const current = itemFiles(item).find(file => file.name === editing?.fileKey);
    return `<input class="travel-inp" data-field="fileName" value="${esc(current?.fileName || '')}" maxlength="120" aria-label="文件名">`;
  }
  if (field === 'cost') {
    const currency = itemCurrency(item);
    return `<div class="travel-cost-edit">
      <select class="travel-currency-select" data-field="currency" aria-label="币种">
        <option value="CNY"${currency === 'CNY' ? ' selected' : ''}>¥</option>
        <option value="HKD"${currency === 'HKD' ? ' selected' : ''}>HK$</option>
      </select>
      <input class="travel-inp" data-field="cost" type="number" step="0.01" value="${item.cost == null ? '' : esc(item.cost)}" aria-label="费用">
    </div>`;
  }
  return `<input class="travel-inp" data-field="cost" type="number" step="0.01" value="${item.cost == null ? '' : esc(item.cost)}" aria-label="费用">`;
}

function viewCell(item, field, className, html) {
  if (editing?.id === item.id && editing.field === field) {
    return `<td class="${className}">${fieldEditor(item, field)}</td>`;
  }
  return `<td class="${className} travel-cell" data-id="${esc(item.id)}" data-field="${field}" title="双击编辑">${html}</td>`;
}

function imageCell(item) {
  if (editing?.id === item.id && editing.field === 'image') {
    return `<td class="travel-photo">${fieldEditor(item, 'image')}</td>`;
  }
  const version = imageVersion[item.id] ? `?v=${imageVersion[item.id]}` : '';
  const body = imageLoadingId === item.id
    ? '<span class="travel-empty">下载中…</span>'
    : item.image
      ? `<span class="travel-photo-wrap"><img src="${esc(item.image)}${version}" alt=""><button type="button" class="travel-photo-clear" data-travel-clear-image="${esc(item.id)}" aria-label="移除图片">×</button></span>`
      : '<span class="travel-empty">粘贴链接</span>';
  return `<td class="travel-photo travel-cell" tabindex="0" data-id="${esc(item.id)}" data-field="image" title="粘贴图片链接">${body}</td>`;
}

function cleanFileName(raw) {
  let base = String(raw || '').split(/[/\\]/).pop() || '';
  base = base.replace(/[\u0000-\u001f]/g, '').replace(/[\\/:*?"<>|]/g, '').trim();
  if (!base) return '';
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  if (base.length > 120) base = `${base.slice(0, 116).replace(/\.pdf$/i, '')}.pdf`;
  return base;
}

function itemFiles(item) {
  if (Array.isArray(item?.files) && item.files.length) {
    return item.files.map(file => ({
      name: String(file.name || '').trim(),
      fileName: file.fileName || '文件.pdf',
      url: file.url || (file.name ? `/travel-files/${file.name}` : ''),
    })).filter(file => file.name && file.url);
  }
  if (!item?.file) return [];
  const name = String(item.file).split('?')[0].split('/').pop();
  return [{ name, fileName: item.fileName || '文件.pdf', url: String(item.file).split('?')[0] }];
}

function withFiles(item, files) {
  return {
    ...item,
    files,
    file: files[0]?.url || '',
    fileName: files[0]?.fileName || '',
  };
}

function fileCell(item) {
  if (fileLoadingId === item.id) {
    return `<td class="travel-file"><span class="travel-empty">上传中…</span></td>`;
  }
  const files = itemFiles(item);
  if (!files.length) {
    return `<td class="travel-file travel-cell" data-id="${esc(item.id)}" data-field="file" title="点击上传 PDF，可多选"><span class="travel-empty">上传 PDF</span></td>`;
  }
  const rows = files.map(file => {
    if (editing?.id === item.id && editing.field === 'fileName' && editing.fileKey === file.name) {
      return `<div class="travel-file-wrap">${fieldEditor(item, 'fileName')}</div>`;
    }
    const href = `${file.url}?name=${encodeURIComponent(file.fileName)}`;
    return `<div class="travel-file-wrap" data-file-name="${esc(file.name)}"><a class="travel-file-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-file-type-pdf"></i><span>${esc(file.fileName)}</span></a><button type="button" class="travel-file-clear" data-travel-clear-file="${esc(item.id)}" data-file-name="${esc(file.name)}" aria-label="移除文件">×</button></div>`;
  }).join('');
  return `<td class="travel-file travel-cell" data-id="${esc(item.id)}" data-field="file" title="双击文件名可修改"><div class="travel-file-list">${rows}</div><button type="button" class="travel-file-add" data-travel-add-file="${esc(item.id)}">添加</button></td>`;
}

function placeCell(item) {
  if (editing?.id === item.id && editing.field === 'place') {
    return `<td class="travel-place">${fieldEditor(item, 'place')}</td>`;
  }
  const from = String(item.location || '').trim();
  const to = String(item.destination || '').trim();
  const href = mapsHref(from, to);
  const icon = from && to ? 'ti-route' : 'ti-map-pin';
  const fromLabel = mapsLabel(from);
  const toLabel = mapsLabel(to);
  const label = from && to
    ? (fromLabel === '地图位置' && toLabel === '地图位置' ? '查看路线' : `${fromLabel} → ${toLabel}`)
    : mapsLabel(from || to);
  const body = href
    ? `<a class="travel-map-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><i class="ti ${icon}"></i><span>${esc(label)}</span></a>`
    : '<span class="travel-empty">填写位置</span>';
  return `<td class="travel-place travel-cell" data-id="${esc(item.id)}" data-field="place" title="双击编辑">${body}</td>`;
}

function rememberItems() {
  const plan = plans.find(row => row.id === activePlanId);
  if (plan) plan.items = items;
}

function activePlan() {
  return plans.find(row => row.id === activePlanId) || plans[0] || null;
}

function travelIsMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function fitTravelGridToScreen() {
  cancelAnimationFrame(travelGridFitFrame);
  travelGridFitFrame = requestAnimationFrame(() => {
    const scroll = document.querySelector('#travelBoard .travel-scroll');
    const grid = scroll?.querySelector('.travel-grid');
    if (!scroll || !grid) return;

    grid.style.transform = '';
    scroll.style.height = '';
    scroll.classList.remove('is-scaled');

    const available = scroll.clientWidth;
    const natural = Math.max(grid.scrollWidth, grid.offsetWidth);
    if (!available || !natural || natural <= available + 1) return;

    const scale = available / natural;
    grid.style.transform = `scale(${scale})`;
    scroll.style.height = `${Math.ceil(grid.offsetHeight * scale) + 1}px`;
    scroll.classList.add('is-scaled');
  });
}

function asBlock(html) {
  return html.replace(/^<td\b/, '<div').replace(/<\/td>$/, '</div>');
}

function refreshCostTotals() {
  ensurePlanFx();
  const totalEl = document.getElementById('travelTotal');
  if (totalEl) totalEl.textContent = money(totalCost()) || '¥0.00';
  const savedWrap = document.getElementById('travelSaved');
  const savedEl = document.getElementById('travelSavedAmount');
  const saved = savedCost();
  if (savedWrap) savedWrap.hidden = !saved;
  if (savedEl) savedEl.textContent = money(saved) || '¥0.00';
  const fxEl = document.getElementById('travelFxRate');
  const fxWrap = document.getElementById('travelFx');
  if (fxEl) fxEl.textContent = rateLabel();
  if (fxWrap) fxWrap.hidden = false;
}

function renderPlanBar() {
  const el = document.getElementById('travelPlans');
  const kicker = document.getElementById('travelKicker');
  const plan = activePlan();
  if (kicker) kicker.textContent = plan?.range || '';
  if (kicker) kicker.hidden = !plan?.range;
  refreshCostTotals();
  if (!el) return;
  const tabs = plans.map(row => {
    const on = row.id === activePlanId;
    const del = on && plans.length > 1
      ? `<button type="button" class="travel-plan-del" data-travel-plan-del="${esc(row.id)}" title="删除计划" aria-label="删除计划">×</button>`
      : '';
    return `<div class="travel-plan${on ? ' on' : ''}" data-travel-plan="${esc(row.id)}" title="双击重命名"><span>${esc(row.title)}</span>${del}</div>`;
  }).join('');
  el.innerHTML = `<div class="travel-plan-tabs">${tabs}</div><button type="button" class="btn travel-plan-add" data-travel-plan-add title="新的旅行计划" aria-label="新的旅行计划"><i class="ti ti-plus"></i></button>`;
}

function focusName(item) {
  return String(item?.event || '').trim().replace(/^探店[:：]\s*/, '');
}

function dayFocusMarkup(rows) {
  const sights = [];
  const meals = [];
  rows.forEach(item => {
    if (isPrep(item)) return;
    const name = focusName(item);
    if (!name) return;
    if (item.category === '景点') sights.push(name);
    else if (item.category === '用餐') meals.push(name);
  });
  const bits = [];
  if (sights.length) bits.push(`<span class="travel-day-focus"><b>景点</b>${esc(sights.join('、'))}</span>`);
  if (meals.length) bits.push(`<span class="travel-day-focus"><b>餐厅</b>${esc(meals.join('、'))}</span>`);
  return bits.join('');
}

function renderTravelCard(item) {
  const showTime = item.time || (editing?.id === item.id && editing.field === 'time');
  const showPlace = String(item.location || '').trim() || String(item.destination || '').trim() || (editing?.id === item.id && editing.field === 'place');
  const showNote = String(item.note || '').trim() || (editing?.id === item.id && editing.field === 'note');
  const showImage = item.image || imageLoadingId === item.id || (editing?.id === item.id && editing.field === 'image');
  const showFile = itemFiles(item).length || fileLoadingId === item.id || (editing?.id === item.id && editing.field === 'fileName');
  const showCost = item.cost != null && item.cost !== '' || (editing?.id === item.id && editing.field === 'cost');
  return `<article class="travel-card${item.visit ? ' is-visit' : item.done ? ' is-done' : ''}">
    ${editing?.id === item.id && editing.field === 'date' ? `<div class="travel-card-date">${fieldEditor(item, 'date')}</div>` : ''}
    <div class="travel-card-top">
      ${showTime ? asBlock(viewCell(item, 'time', 'travel-card-time', item.time ? esc(item.time) : '<span class="travel-empty">时间</span>')) : '<div></div>'}
      <div class="travel-card-status">${statusSelect(item)}${editing?.id === item.id ? `<button type="button" class="travel-row-del" data-travel-delete="${esc(item.id)}" title="删除事项" aria-label="删除事项"><i class="ti ti-trash"></i></button>` : ''}</div>
    </div>
    ${asBlock(viewCell(item, 'event', 'travel-card-event', item.event ? esc(item.event) : '<span class="travel-empty">暂无安排</span>'))}
    <div class="travel-card-category">${categorySelect(item)}</div>
    ${showPlace ? asBlock(placeCell(item)) : ''}
    ${showNote ? asBlock(viewCell(item, 'note', 'travel-card-note', item.note ? esc(item.note) : '')) : ''}
    ${showImage ? asBlock(imageCell(item)) : ''}
    ${showFile ? asBlock(fileCell(item)) : ''}
    ${showCost ? asBlock(viewCell(item, 'cost', `travel-card-cost${itemCurrency(item) === 'HKD' ? ' is-hkd' : ''}`, moneyCost(item))) : ''}
  </article>`;
}

function renderTravelCards() {
  const shown = items.filter(itemMatchesCategory);
  const groups = [];
  shown.forEach(item => {
    const key = String(item.date || '');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(item);
    else groups.push({ key, rows: [item] });
  });
  const days = groups.map(group => {
    const label = formatTravelDate(group.key) || '未定日期';
    const focus = dayFocusMarkup(group.rows);
    return `<section class="travel-day">
      <h3 class="travel-day-title">${esc(label)}</h3>
      ${focus ? `<p class="travel-day-brief">${focus}</p>` : ''}
      ${group.rows.map(renderTravelCard).join('')}
    </section>`;
  }).join('');
  const empty = items.length && !shown.length ? '没有符合筛选的事项' : '暂无事项';
  return `<div class="travel-cards-tools">${categoryFilterMenu()}</div><div class="travel-cards">${days || `<div class="travel-cards-empty">${empty}</div>`}</div>`;
}

function renderTravel() {
  rememberItems();
  renderPlanBar();
  renderPack();
  const board = document.getElementById('travelBoard');
  if (!board) return;
  const actions = `<div class="travel-actions">
    <button type="button" class="btn btn-p travel-add" data-travel-add>增加事项</button>
    <button type="button" class="btn travel-add-prep" data-travel-add-prep>行前准备</button>
  </div>`;
  if (travelIsMobile()) {
    board.innerHTML = `${renderTravelCards()}${actions}`;
    focusEditor();
    placeCategoryMenu();
    refreshTravelRoute();
    return;
  }

  const shown = items.filter(itemMatchesCategory);
  const spans = dateSpans(shown);
  const dayEnd = new Set();
  spans.forEach((span, index) => {
    if (span > 0 && index + span < shown.length) dayEnd.add(index + span - 1);
  });
  const rows = shown.length ? shown.map((item, index) => {
    const span = spans[index];
    const dateDone = span > 0 && shown.slice(index, index + span).every(row => row.done);
    const dateBreak = span > 0 && dayEnd.has(index + span - 1);
    const prep = isPrep(item);
    const dateHtml = span
      ? (editing?.id === item.id && editing.field === 'date' && !prep
        ? `<td class="travel-date${dateBreak ? ' travel-day-end' : ''}">${fieldEditor(item, 'date')}</td>`
        : `<td class="travel-date${prep ? ' is-prep' : ' travel-cell'}${dateDone ? ' is-done' : ''}${dateBreak ? ' travel-day-end' : ''}" rowspan="${span}" data-index="${index}" data-span="${span}"${prep ? '' : ` data-id="${esc(item.id)}" data-field="date" title="双击选择日期"`}>${formatTravelDate(item.date) ? esc(formatTravelDate(item.date)) : '<span class="travel-empty">选择日期</span>'}</td>`)
      : '';
    const focus = span && !prep ? dayFocusMarkup(shown.slice(index, index + span)) : '';
    const brief = focus ? `<tr class="travel-day-brief"><td colspan="10">${focus}</td></tr>` : '';
    return `${brief}<tr data-item-row data-item-id="${esc(item.id)}" class="${item.visit ? 'is-visit' : item.done ? 'is-done' : ''}${dayEnd.has(index) ? ' travel-day-end' : ''}">
      ${dateHtml}
      ${viewCell(item, 'time', 'travel-time', esc(item.time))}
      ${imageCell(item)}
      ${viewCell(item, 'event', 'travel-event', item.event ? esc(item.event) : '<span class="travel-empty">暂无安排</span>')}
      <td class="travel-category">${categorySelect(item)}</td>
      ${placeCell(item)}
      ${viewCell(item, 'note', 'travel-note', item.note ? esc(item.note) : '')}
      ${fileCell(item)}
      ${viewCell(item, 'cost', `travel-cost${itemCurrency(item) === 'HKD' ? ' is-hkd' : ''}`, moneyCost(item))}
      <td class="travel-status">${statusSelect(item)}${editing?.id === item.id ? `<button type="button" class="travel-row-del" data-travel-delete="${esc(item.id)}" title="删除事项" aria-label="删除事项"><i class="ti ti-trash"></i></button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td class="travel-filter-empty" colspan="10">没有符合筛选的事项</td></tr>';

  board.innerHTML = `<div class="travel-scroll"><table class="travel-grid">
    <colgroup>
      <col class="travel-col-date">
      <col class="travel-col-time">
      <col class="travel-col-photo">
      <col class="travel-col-event">
      <col class="travel-col-category">
      <col class="travel-col-place">
      <col class="travel-col-note">
      <col class="travel-col-file">
      <col class="travel-col-cost">
      <col class="travel-col-status">
    </colgroup>
    <thead>
      <tr>
        <th>日期</th>
        <th>时间</th>
        <th>图片</th>
        <th>事项</th>
        <th class="travel-th-category"><span>分类</span>${categoryFilterMenu()}</th>
        <th>位置</th>
        <th>信息</th>
        <th>文件</th>
        <th>费用</th>
        <th>状态</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${actions}`;
  focusEditor();
  fitTravelGridToScreen();
  placeCategoryMenu();
  refreshTravelRoute();
}

function paintDoneRows() {
  const rows = [...document.querySelectorAll('#travelBoard tbody tr[data-item-row]')];
  const itemOf = tr => items.find(row => row.id === tr.dataset.itemId);
  rows.forEach(tr => {
    const item = itemOf(tr);
    tr.classList.toggle('is-done', !!item?.done && !item?.visit);
    tr.classList.toggle('is-visit', !!item?.visit);
  });
  document.querySelectorAll('#travelBoard article.travel-card').forEach(card => {
    const id = card.querySelector('[data-travel-status]')?.getAttribute('data-travel-status');
    const item = items.find(row => row.id === id);
    card.classList.toggle('is-done', !!item?.done && !item?.visit);
    card.classList.toggle('is-visit', !!item?.visit);
  });
  document.querySelectorAll('#travelBoard select[data-travel-status]').forEach(sel => {
    const item = items.find(row => row.id === sel.getAttribute('data-travel-status'));
    sel.classList.toggle('is-done', !!item?.done && !item?.visit);
    sel.classList.toggle('is-visit', !!item?.visit);
  });
  document.querySelectorAll('#travelBoard td.travel-date[data-span]').forEach(td => {
    const span = Number(td.dataset.span || 1);
    const start = rows.findIndex(row => row.contains(td));
    const slice = start < 0 ? [] : rows.slice(start, start + span);
    td.classList.toggle('is-done', slice.length > 0 && slice.every(row => itemOf(row)?.done));
  });
}

function fitNoteEditor(el) {
  const box = el || document.querySelector('#travelBoard textarea.travel-inp');
  if (!box) return;
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight}px`;
}

function focusEditor() {
  const el = document.querySelector('#travelBoard .travel-inp');
  if (!el) return;
  if (el.tagName === 'TEXTAREA') fitNoteEditor(el);
  el.focus();
  if (el.type === 'date' || el.type === 'time') {
    try { el.showPicker(); } catch { /* 浏览器不允许时仍可手动点开 */ }
    return;
  }
  if (el.tagName !== 'TEXTAREA' && typeof el.select === 'function') el.select();
}

function itemIdFromCell(cell, clientY) {
  const span = Number(cell.dataset.span || 1);
  if (cell.dataset.field !== 'date' || span <= 1) return cell.dataset.id;
  const rows = [...document.querySelectorAll('#travelBoard tbody tr[data-item-row]')];
  const start = rows.findIndex(row => row.contains(cell));
  if (start < 0) return cell.dataset.id;
  for (let offset = 0; offset < span; offset += 1) {
    const row = rows[start + offset];
    const rect = row?.getBoundingClientRect();
    if (!rect || clientY <= rect.bottom || offset === span - 1) return row?.dataset.itemId || cell.dataset.id;
  }
  return cell.dataset.id;
}

function readEditorValue(item, field, raw) {
  if (field === 'cost') {
    let text = String(raw || '').trim();
    if (text === '') return { ok: true, value: null, currency: itemCurrency(item) };
    let currency = itemCurrency(item);
    const marked = text.match(/^(HK\$?|HKD|港币|港元)\s*(.+)$/i);
    if (marked) {
      currency = 'HKD';
      text = marked[2].trim();
    } else if (/^(¥|CNY|人民币|RMB)\s*/i.test(text)) {
      currency = 'CNY';
      text = text.replace(/^(¥|CNY|人民币|RMB)\s*/i, '').trim();
    }
    const n = Number(text);
    if (!Number.isFinite(n)) return { ok: false, message: '请填写数字' };
    return { ok: true, value: Math.round(n * 100) / 100, currency };
  }
  if (field === 'time') return { ok: true, value: raw.trim().slice(0, 5) };
  if (field === 'date') return { ok: true, value: canonicalDate(raw.trim()) };
  return { ok: true, value: raw.trim() };
}

function sameValue(item, field, value, currency) {
  if (field === 'cost') {
    return (item.cost ?? null) === value && itemCurrency(item) === (currency || itemCurrency(item));
  }
  return String(item[field] || '') === String(value || '');
}

async function persist() {
  rememberItems();
  const rev = ++revision;
  const snapshot = plans.map(plan => ({
    ...plan,
    items: plan.items.map(item => ({ ...item })),
  }));
  try {
    const saved = await saveTravel({ activeId: activePlanId, plans: snapshot });
    if (rev === revision && Array.isArray(saved?.itinerary?.plans)) {
      plans = saved.itinerary.plans;
      activePlanId = plans.some(plan => plan.id === saved.itinerary.activeId) ? saved.itinerary.activeId : (plans[0]?.id || '');
      items = activePlan()?.items || [];
    }
    return true;
  } catch (err) {
    if (rev !== revision) return true;
    alert(err.message || '保存失败');
    return false;
  }
}

export function isTravelEditing() {
  if (editing || editLock) return true;
  return !!document.activeElement?.closest?.('#travelPack');
}

export async function reloadTravelFromServer() {
  if (editing || editLock) return false;
  const data = await fetchTravel();
  const saved = data?.itinerary;
  if (!saved || !Array.isArray(saved.plans) || !saved.plans.length) return false;
  plans = saved.plans;
  activePlanId = plans.some(plan => plan.id === saved.activeId) ? saved.activeId : (plans[0]?.id || '');
  items = activePlan()?.items || [];
  loaded = true;
  renderTravel();
  return true;
}

export async function loadTravel() {
  if (!loaded) {
    let loadedLegacy = false;
    try {
      const data = await fetchTravel();
      const saved = data?.itinerary;
      if (saved && Array.isArray(saved.plans) && saved.plans.length) {
        plans = saved.plans;
        activePlanId = plans.some(plan => plan.id === saved.activeId) ? saved.activeId : plans[0].id;
        items = activePlan()?.items || [];
        loadedLegacy = !!data.legacy;
      }
    } catch (err) {
      console.warn(err);
    }
    let changed = loadedLegacy;
    plans = plans.map(plan => {
      const migrated = pinPrep((plan.items || []).map(item => ({
        ...item,
        date: canonicalDate(item.date),
        currency: String(item.currency || '').toUpperCase() === 'HKD' ? 'HKD' : 'CNY',
      })));
      const bags = packBags(plan);
      if (bags.split || migrated.some((item, index) => item.date !== plan.items[index]?.date || item.id !== plan.items[index]?.id)) changed = true;
      const next = { ...plan, items: migrated, bags };
      const beforeRate = next.hkdRate;
      const beforeDate = next.hkdRateDate;
      ensurePlanFx(next);
      if (next.hkdRate !== beforeRate || next.hkdRateDate !== beforeDate) changed = true;
      return next;
    });
    items = activePlan()?.items || [];
    loaded = true;
    if (changed) await persist();
  }
  renderTravel();
}

function editHkdRate() {
  const plan = activePlan();
  if (!plan) return;
  ensurePlanFx(plan);
  const current = hkdRate(plan);
  const typed = prompt(`港币兑人民币汇率（出行日 ${formatRateDate(tripRateDate(plan)) || '未定'}，1 港币 = ? 人民币）`, String(current));
  if (typed == null) return;
  const n = Number(String(typed).trim());
  if (!Number.isFinite(n) || n <= 0 || n > 10) {
    alert('请填写有效汇率，例如 0.8527');
    return;
  }
  plan.hkdRate = Math.round(n * 100000) / 100000;
  if (!plan.hkdRateDate) plan.hkdRateDate = tripRateDate(plan);
  refreshCostTotals();
  persist();
}

function cancelEdit() {
  if (!editing) return;
  editLock = true;
  editing = null;
  renderTravel();
  editLock = false;
}

function commitEdit() {
  if (!editing || editLock) return;
  const { id, field } = editing;
  const input = field === 'cost'
    ? document.querySelector('#travelBoard .travel-inp[data-field="cost"]')
    : document.querySelector('#travelBoard .travel-inp');
  if (!input) return;
  const item = items.find(row => row.id === id);
  if (!item) {
    cancelEdit();
    return;
  }
  if (field === 'place') {
    const typed = splitMapValues(
      document.querySelector('#travelBoard [data-field="location"]')?.value || '',
      document.querySelector('#travelBoard [data-field="destination"]')?.value || '',
    );
    const location = typed.location;
    const destination = typed.destination;
    if (location === String(item.location || '') && destination === String(item.destination || '')) {
      cancelEdit();
      return;
    }
    const next = { ...item, location, destination };
    editLock = true;
    editing = null;
    items = items.map(row => row.id === id ? next : row);
    renderTravel();
    editLock = false;
    persist();
    return;
  }
  const parsed = readEditorValue(item, field, input.value);
  if (!parsed.ok) {
    alert(parsed.message);
    input.focus();
    return;
  }
  if (field === 'cost') {
    const currencySel = document.querySelector('#travelBoard [data-field="currency"]');
    const typed = String(input.value || '').trim();
    const currency = (/^(HK\$?|HKD|港币|港元)\s*/i.test(typed) || currencySel?.value === 'HKD')
      ? 'HKD'
      : 'CNY';
    if (sameValue(item, 'cost', parsed.value, currency)) {
      cancelEdit();
      return;
    }
    const next = { ...item, cost: parsed.value, currency };
    editLock = true;
    editing = null;
    items = items.map(row => row.id === id ? next : row);
    ensurePlanFx();
    renderTravel();
    editLock = false;
    persist();
    return;
  }
  if (field === 'fileName') {
    const name = cleanFileName(parsed.value);
    if (!name) {
      alert('请填写 PDF 文件名');
      input.focus();
      return;
    }
    const currentName = itemFiles(item).find(file => file.name === editing.fileKey)?.fileName || '';
    if (currentName === name) {
      cancelEdit();
      return;
    }
    const files = itemFiles(item).map(file => file.name === editing.fileKey ? { ...file, fileName: name } : file);
    const next = withFiles(item, files);
    editLock = true;
    editing = null;
    items = items.map(row => row.id === id ? next : row);
    renderTravel();
    editLock = false;
    persist();
    return;
  }
  if (field === 'image') {
    const url = String(parsed.value || '').trim();
    if (!url) {
      cancelEdit();
      return;
    }
    saveImageFromUrl(id, url);
    return;
  }
  if (field === 'date' && !parsed.value && !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ''))) {
    cancelEdit();
    return;
  }
  if (sameValue(item, field, parsed.value)) {
    cancelEdit();
    return;
  }
  const next = { ...item, [field]: parsed.value };
  editLock = true;
  editing = null;
  if (field === 'date') items = pinPrep(orderByTime(placeItem(items, next), next.date));
  else if (field === 'time') items = pinPrep(orderByTime(items.map(row => row.id === id ? next : row), next.date));
  else items = items.map(row => row.id === id ? next : row);
  renderTravel();
  editLock = false;
  persist();
}

function pastedImageUrl(data) {
  const text = data?.getData('text/plain') || '';
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[),.;，。]+$/u, '') : '';
}

async function saveImageFromUrl(id, url) {
  if (!id || imageLoadingId) return;
  const item = items.find(row => row.id === id);
  if (!item) return;
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch {
    alert('链接格式无效');
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    alert('仅支持 http/https 链接');
    return;
  }
  imageLoadingId = id;
  editLock = true;
  editing = null;
  renderTravel();
  try {
    const saved = await uploadTravelImageFromUrl(id, parsed.href);
    const current = items.find(row => row.id === id);
    if (current && saved?.url) {
      current.image = saved.url;
      imageVersion[id] = Date.now();
    }
    imageLoadingId = '';
    editLock = false;
    renderTravel();
    await persist();
  } catch (err) {
    imageLoadingId = '';
    editLock = false;
    renderTravel();
    alert(err.message || '下载图片失败');
  }
}

function ensureFilePicker() {
  if (filePicker) return filePicker;
  filePicker = document.createElement('input');
  filePicker.type = 'file';
  filePicker.accept = 'application/pdf,.pdf';
  filePicker.multiple = true;
  filePicker.hidden = true;
  filePicker.addEventListener('change', () => {
    const files = [...(filePicker.files || [])];
    const id = filePickerItemId;
    filePicker.value = '';
    if (files.length && id) uploadTravelPdfs(id, files);
  });
  document.body.appendChild(filePicker);
  return filePicker;
}

function openFilePicker(id) {
  if (!id || fileLoadingId) return;
  filePickerItemId = id;
  ensureFilePicker().click();
}

async function uploadTravelPdfs(id, fileList) {
  if (!id || fileLoadingId) return;
  const item = items.find(row => row.id === id);
  if (!item) return;
  const pdfs = [];
  let skipped = 0;
  [...fileList].forEach(file => {
    const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
    if (!isPdf || file.size > 15 * 1024 * 1024) skipped += 1;
    else pdfs.push(file);
  });
  const room = Math.max(0, 8 - itemFiles(item).length);
  const batch = pdfs.slice(0, room);
  if (!batch.length) {
    alert(pdfs.length ? '最多 8 个 PDF' : '仅支持 PDF 文件，单个不超过 15MB');
    return;
  }
  fileLoadingId = id;
  editLock = true;
  editing = null;
  renderTravel();
  const savedFiles = [];
  let failed = '';
  try {
    for (const file of batch) {
      const saved = await uploadTravelFile(id, file);
      if (saved?.name) {
        savedFiles.push({
          name: saved.name,
          url: saved.url,
          fileName: saved.fileName || cleanFileName(file.name) || '文件.pdf',
        });
      }
    }
  } catch (err) {
    failed = err.message || '上传失败';
  }
  const current = items.find(row => row.id === id);
  if (current && savedFiles.length) {
    const next = withFiles(current, itemFiles(current).concat(savedFiles).slice(0, 8));
    items = items.map(row => row.id === id ? next : row);
  }
  fileLoadingId = '';
  editLock = false;
  renderTravel();
  if (savedFiles.length) await persist();
  if (failed) alert(failed);
  else if (skipped || pdfs.length > batch.length) alert('部分文件未上传：仅支持 PDF，单个不超过 15MB，每项最多 8 个');
}

async function clearTravelPdf(id, name) {
  const item = items.find(row => row.id === id);
  const files = itemFiles(item).filter(file => file.name !== name);
  if (!item || files.length === itemFiles(item).length) return;
  items = items.map(row => row.id === id ? withFiles(row, files) : row);
  renderTravel();
  try {
    await deleteTravelFile(id, name);
  } catch (err) {
    alert(err.message || '删除文件失败');
  }
  persist();
}

function deleteItem(id) {
  const item = items.find(row => row.id === id);
  if (!item) return;
  const label = String(item.event || '').trim() || '这一条事项';
  deletingRow = true;
  const ok = window.confirm(`删除「${label}」？`);
  deletingRow = false;
  if (!ok) return;
  const files = itemFiles(item);
  if (editing?.id === id) editing = null;
  items = pinPrep(items.filter(row => row.id !== id));
  renderTravel();
  persist();
  files.forEach(file => {
    if (file.name) deleteTravelFile(id, file.name).catch(() => {});
  });
}

async function openMapLink(link) {
  const item = items.find(row => row.id === link.closest('td')?.dataset.id);
  const from = String(item?.location || '').trim();
  const to = String(item?.destination || '').trim();
  const shorts = [from, to].filter(isShortMapsUrl);
  let popup = null;
  if (from && to && shorts.length) popup = window.open('', '_blank');
  try {
    let href = link.href;
    if (from && to && shorts.length) {
      const resolved = await resolveTravelMaps(shorts);
      const origin = mapsPoint(resolved[from] || from);
      const destination = mapsPoint(resolved[to] || to);
      if (/^https?:/i.test(origin) || /^https?:/i.test(destination)) {
        throw new Error('地图短链接无法解析，请改填地址，或从浏览器地址栏复制完整链接');
      }
      href = mapsHref(resolved[from] || from, resolved[to] || to);
    }
    if (popup) {
      popup.opener = null;
      popup.location.href = href;
    } else {
      window.open(href, '_blank', 'noopener');
    }
  } catch (err) {
    if (popup) popup.close();
    alert(err.message || '无法生成路线');
  }
}

function startEdit(id, field, extra = {}) {
  if (!id || !items.some(row => row.id === id)) return;
  if (editing && (editing.id !== id || editing.field !== field || editing.fileKey !== (extra.fileKey || ''))) commitEdit();
  if (editing) return;
  editing = { id, field, fileKey: extra.fileKey || '' };
  renderTravel();
}

function addItem() {
  if (editing) commitEdit();
  if (editing) return;
  const item = {
    id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40),
    date: '',
    time: '',
    event: '',
    note: '',
    image: '',
    location: '',
    destination: '',
    file: '',
    fileName: '',
    files: [],
    cost: null,
    currency: 'CNY',
    category: '',
    done: false,
    visit: false,
  };
  items = pinPrep(items.concat(item));
  editing = { id: item.id, field: travelIsMobile() ? 'event' : 'date' };
  renderTravel();
  persist();
}

function addPrepItem() {
  if (editing) commitEdit();
  if (editing) return;
  const item = {
    id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40),
    date: PREP,
    time: '',
    event: '',
    note: '',
    image: '',
    location: '',
    destination: '',
    file: '',
    fileName: '',
    files: [],
    cost: null,
    currency: 'CNY',
    category: '',
    done: false,
    visit: false,
  };
  const next = items.slice();
  let last = -1;
  next.forEach((row, index) => { if (isPrep(row)) last = index; });
  next.splice(last + 1, 0, item);
  items = next;
  editing = { id: item.id, field: 'event' };
  renderTravel();
  persist();
}

function selectPlan(id) {
  if (!id || id === activePlanId || !plans.some(plan => plan.id === id)) return;
  if (editing) commitEdit();
  if (editing) return;
  rememberItems();
  activePlanId = id;
  items = activePlan()?.items || [];
  renderTravel();
  persist();
}

function addPlan() {
  if (editing) commitEdit();
  if (editing) return;
  const typed = prompt('旅行计划名称', '新的旅行');
  if (typed == null) return;
  const title = typed.trim().slice(0, 40) || '新的旅行';
  rememberItems();
  const id = `plan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
  plans.push({ id, title, range: '', items: [], bags: blankBags(), hkdRate: DEFAULT_HKD_CNY, hkdRateDate: '' });
  activePlanId = id;
  items = plans[plans.length - 1].items;
  editing = null;
  renderTravel();
  persist();
}

function renamePlan(id) {
  const plan = plans.find(row => row.id === id);
  if (!plan) return;
  const typed = prompt('旅行计划名称', plan.title);
  if (typed == null) return;
  const title = typed.trim().slice(0, 40);
  if (!title || title === plan.title) return;
  plan.title = title;
  renderTravel();
  persist();
}

function deletePlan(id) {
  if (plans.length < 2) return;
  const plan = plans.find(row => row.id === id);
  if (!plan) return;
  if (!confirm(`删除旅行计划「${plan.title || '未命名'}」？此计划里的事项会一起删除。`)) return;
  if (editing) {
    editing = null;
    editLock = false;
  }
  plans = plans.filter(row => row.id !== id);
  if (activePlanId === id) {
    activePlanId = plans[0].id;
    items = plans[0].items;
  }
  renderTravel();
  persist();
}

let routeMap = null;
let routeLayer = null;
let routeCoords = new Map();
let routeStops = [];
let routeDate = '';
let routeToken = 0;
let travelPane = 'list';
let packEdit = null;
let packEditTimer = 0;

function setTravelPane(pane) {
  const next = pane === 'map' ? 'map' : pane === 'pack' ? 'pack' : 'list';
  travelPane = next;
  const view = document.getElementById('view-travel');
  view?.classList.toggle('is-map', next === 'map');
  view?.classList.toggle('is-list', next === 'list');
  view?.classList.toggle('is-pack', next === 'pack');
  document.querySelectorAll('[data-travel-pane]').forEach(button => {
    const on = button.getAttribute('data-travel-pane') === travelPane;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const visible = next === 'map'
    ? document.getElementById('travelRoute')
    : next === 'pack'
      ? document.getElementById('travelPack')
      : document.getElementById('travelBoard');
  const active = document.activeElement;
  if (active instanceof HTMLElement && view?.contains(active) && visible && !visible.contains(active)) {
    active.blur();
  }
  if (next !== 'map') return;
  requestAnimationFrame(() => {
    routeMap?.invalidateSize();
    drawTravelRoute();
  });
}

function blankBags() {
  return [
    { id: 'bag-1', name: '背包1', items: [] },
    { id: 'bag-2', name: '背包2', items: [] },
  ];
}

function packItemFromRaw(raw) {
  const id = String(raw?.id || '').replace(/[^\w-]/g, '').slice(0, 40);
  let name = String(raw?.name || '').trim().slice(0, 60);
  let group = String(raw?.group || '').trim().slice(0, 20);
  let split = false;
  if (!group && name.includes('：')) {
    const splitAt = name.indexOf('：');
    const head = name.slice(0, splitAt).trim().slice(0, 20);
    const rest = name.slice(splitAt + 1).trim().slice(0, 60);
    if (head && rest) {
      group = head;
      name = rest;
      split = true;
    }
  }
  if (!id || !name) return null;
  return {
    id,
    name,
    group,
    done: raw?.done === true || raw?.done === 1 || raw?.done === '1',
    split,
  };
}

function packGroups(items) {
  const groups = [];
  for (const item of items) {
    const name = item.group || '';
    let group = groups.find(row => row.name === name);
    if (!group) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function packBags(plan) {
  const source = Array.isArray(plan?.bags) ? plan.bags : [];
  const bags = blankBags().map((bag, index) => {
    const found = source.find(row => row?.id === bag.id) || source[index] || {};
    const items = Array.isArray(found.items)
      ? found.items.slice(0, 80).map(packItemFromRaw).filter(Boolean).map(({ split, ...item }) => item)
      : [];
    return { ...bag, items };
  });
  bags.split = source.some(bag => (bag?.items || []).some(item => packItemFromRaw(item)?.split));
  return bags;
}

function ensurePlanBags(plan) {
  if (!plan) return blankBags();
  plan.bags = packBags(plan);
  return plan.bags;
}

function packGroupOptions(names, current) {
  const options = names.map(name => `<option value="${esc(name)}"${name === current ? ' selected' : ''}>${esc(name || '未分组')}</option>`).join('');
  return `${options}<option value="__new__">新分组</option>`;
}

function renderPack() {
  const grid = document.getElementById('travelPackGrid');
  if (!grid) return;
  const bags = ensurePlanBags(activePlan());
  grid.innerHTML = bags.map(bag => {
    const groupNames = packGroups(bag.items).map(group => group.name);
    const groups = packGroups(bag.items).map(group => {
      const rows = group.items.map(item => {
        const editing = packEdit?.bagId === bag.id && packEdit?.itemId === item.id;
        const text = editing
          ? `<input class="travel-inp" data-pack-bag="${esc(bag.id)}" data-pack-id="${esc(item.id)}" value="${esc(item.name)}" maxlength="60" size="${Math.min(18, Math.max(2, [...item.name].length))}" aria-label="${esc(group.name || bag.name)}的物件">`
          : `<span class="travel-pack-label">${esc(item.name)}</span>`;
        const del = editing
          ? `<button type="button" class="travel-pack-del" data-pack-del="${esc(bag.id)}" data-pack-id="${esc(item.id)}" aria-label="删除${esc(item.name)}">×</button>`
          : '';
        return `<li class="travel-pack-item${item.done ? ' is-done' : ''}${editing ? ' is-editing' : ''}"${editing ? '' : ' title="双击编辑"'}>
          <input type="checkbox" class="travel-pack-check" data-pack-check="${esc(bag.id)}" data-pack-id="${esc(item.id)}"${item.done ? ' checked' : ''} aria-label="勾选${esc(item.name)}">
          ${text}
          ${del}
        </li>`;
      }).join('');
      return `<section class="travel-pack-group">
        <h4 class="travel-pack-group-name">${esc(group.name || '未分组')}</h4>
        <ul class="travel-pack-list">${rows}</ul>
      </section>`;
    }).join('');
    return `<section class="travel-pack-bag">
      <h3>${esc(bag.name)}</h3>
      <div class="travel-pack-groups">${groups}</div>
      <form class="travel-pack-add" data-pack-add="${esc(bag.id)}">
        <select class="travel-inp" name="group" aria-label="添加到${esc(bag.name)}的分组">${packGroupOptions(groupNames, groupNames[0] || '')}</select>
        <input class="travel-inp" name="groupName" maxlength="20" placeholder="新分组名称" hidden aria-label="新分组名称">
        <input class="travel-inp" name="item" maxlength="60" placeholder="物件名称" aria-label="添加到${esc(bag.name)}">
        <button type="submit" class="btn btn-p">添加</button>
      </form>
    </section>`;
  }).join('');
}

function packItemId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
}

function addPackItem(bagId, name, group) {
  let itemName = String(name || '').trim().slice(0, 60);
  let itemGroup = String(group || '').trim().slice(0, 20);
  if (!itemGroup && itemName.includes('：')) {
    const parsed = packItemFromRaw({ id: 'x', name: itemName });
    if (parsed?.group) {
      itemGroup = parsed.group;
      itemName = parsed.name;
    }
  }
  const bag = ensurePlanBags(activePlan()).find(row => row.id === bagId);
  if (!bag || bag.items.length >= 80 || !itemName) return;
  if (!itemGroup) itemGroup = [...bag.items].reverse().find(item => item.group)?.group || '';
  bag.items.push({ id: packItemId(), name: itemName, group: itemGroup, done: false });
  renderPack();
  persist();
  const form = document.querySelector(`#travelPack form[data-pack-add="${CSS.escape(bagId)}"]`);
  const groupInput = form?.querySelector('[name="group"]');
  if (groupInput && [...groupInput.options].some(option => option.value === itemGroup)) groupInput.value = itemGroup;
  form?.querySelector('[name="item"]')?.focus();
}

function openPackItem(bagId, itemId) {
  clearTimeout(packEditTimer);
  const open = document.querySelector('#travelPack .travel-pack-item.is-editing input[data-pack-id]');
  if (open && open.getAttribute('data-pack-id') !== itemId) {
    updatePackItem(open.getAttribute('data-pack-bag'), open.getAttribute('data-pack-id'), open.value);
  }
  packEdit = { bagId, itemId };
  renderPack();
  const input = document.querySelector(`#travelPack input[data-pack-id="${CSS.escape(itemId)}"]`);
  input?.focus();
  input?.select();
}

function updatePackItem(bagId, itemId, name) {
  const bag = ensurePlanBags(activePlan()).find(row => row.id === bagId);
  const item = bag?.items.find(row => row.id === itemId);
  if (!item) return;
  const next = String(name || '').trim().slice(0, 60);
  if (!next) {
    bag.items = bag.items.filter(row => row.id !== itemId);
    renderPack();
    persist();
    return;
  }
  if (item.name === next) return;
  item.name = next;
  persist();
}

function togglePackItem(bagId, itemId, done) {
  const bag = ensurePlanBags(activePlan()).find(row => row.id === bagId);
  const item = bag?.items.find(row => row.id === itemId);
  if (!item || item.done === done) return;
  item.done = done;
  const row = document.querySelector(`#travelPack [data-pack-check="${CSS.escape(bagId)}"][data-pack-id="${CSS.escape(itemId)}"]`)?.closest('.travel-pack-item');
  row?.classList.toggle('is-done', done);
  persist();
}

function removePackItem(bagId, itemId) {
  const bag = ensurePlanBags(activePlan()).find(row => row.id === bagId);
  if (!bag) return;
  const before = bag.items.length;
  bag.items = bag.items.filter(row => row.id !== itemId);
  if (bag.items.length === before) return;
  renderPack();
  persist();
}

function travelImageSrc(item) {
  const raw = String(item?.image || '').trim();
  if (!raw || /^javascript:/i.test(raw)) return '';
  const version = imageVersion[item.id] ? `?v=${imageVersion[item.id]}` : '';
  return `${raw}${version}`;
}

function pinImages(stops) {
  const seen = new Set();
  const images = [];
  for (const stop of stops) {
    if (!stop.image || seen.has(stop.image)) continue;
    seen.add(stop.image);
    images.push(stop.image);
    if (images.length >= 3) break;
  }
  return images;
}

function wrapPinEvent(text) {
  const source = String(text || '未命名事项');
  const lines = [];
  for (const part of source.split(/\n+/)) {
    const chars = [...part];
    for (let i = 0; i < chars.length; i += 7) lines.push(chars.slice(i, i + 7).join(''));
  }
  return lines.length ? lines : ['未命名事项'];
}

function pinGlyphWidth(ch) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch) ? 12 : 7;
}

function pinLineWidth(text) {
  let width = 0;
  for (const ch of text) width += pinGlyphWidth(ch);
  return width;
}

function pinThumbSize() {
  return window.matchMedia('(max-width: 768px)').matches ? 36 : 44;
}

function pinItemBox(stop, thumbPx) {
  const lines = wrapPinEvent(stop.event);
  const textW = Math.max(pinLineWidth(stop.time || '·'), ...lines.map(pinLineWidth)) + 2;
  const textH = 15 + lines.length * 15;
  const hasImage = Boolean(stop.image);
  return {
    width: (hasImage ? thumbPx + 6 : 0) + textW,
    height: Math.max(hasImage ? thumbPx : 0, textH),
  };
}

function collectRouteStops() {
  const stops = [];
  for (const [itemIndex, item] of items.entries()) {
    if (isPrep(item)) continue;
    const date = canonicalDate(item.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const places = [];
    const from = String(item.location || '').trim();
    const to = String(item.destination || '').trim();
    if (from) places.push(from);
    if (to && to !== from) places.push(to);
    places.forEach((query, placeIndex) => {
      stops.push({
        date,
        time: String(item.time || '').trim(),
        event: String(item.event || '').trim() || '未命名事项',
        query,
        image: placeIndex === places.length - 1 ? travelImageSrc(item) : '',
        order: itemIndex * 2 + placeIndex,
      });
    });
  }
  return stops.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate) return byDate;
    const byTime = (a.time || '99:99').localeCompare(b.time || '99:99');
    return byTime || a.order - b.order;
  });
}

function routeDatesOf(stops) {
  return [...new Set(stops.map(stop => stop.date))].sort();
}

function routeColor(date, dates) {
  const index = Math.max(0, dates.indexOf(date));
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

function ensureRouteMap() {
  const el = document.getElementById('travelRouteMap');
  if (!el) return null;
  if (!routeMap) {
    routeMap = L.map(el, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(routeMap);
    routeMap.setView([22.3, 114.17], 11);
  }
  requestAnimationFrame(() => routeMap?.invalidateSize());
  return routeMap;
}

function googleRouteUrl(points) {
  if (!points.length) return '';
  if (points.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${points[0].lat},${points[0].lng}`;
  }
  const origin = points[0];
  const dest = points[points.length - 1];
  const mids = points.slice(1, -1).slice(0, 9);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&travelmode=transit`;
  if (mids.length) url += `&waypoints=${encodeURIComponent(mids.map(point => `${point.lat},${point.lng}`).join('|'))}`;
  return url;
}

function renderRouteChrome(stops) {
  const dates = routeDatesOf(stops);
  const legend = document.getElementById('travelRouteLegend');
  if (legend) {
    const chips = [`<button type="button" class="travel-route-chip${routeDate ? '' : ' on'}" data-route-date="">全部</button>`];
    for (const date of dates) {
      const color = routeColor(date, dates);
      const on = routeDate === date ? ' on' : '';
      chips.push(`<button type="button" class="travel-route-chip${on}" data-route-date="${esc(date)}" style="background:${routeDate === date ? color : ''};color:${routeDate === date ? '#fff' : ''}"><i class="travel-route-swatch" style="background:${color}"></i>${esc(formatTravelDate(date))}</button>`);
    }
    legend.innerHTML = chips.join('');
  }
}

function drawTravelRoute() {
  const mapEl = document.getElementById('travelRouteMap');
  const note = document.getElementById('travelRouteNote');
  const google = document.getElementById('travelRouteGoogle');
  if (routeStops.length) mapEl?.classList.remove('is-empty');
  const map = routeStops.length ? ensureRouteMap() : null;
  const dates = routeDatesOf(routeStops);
  const visible = routeStops.filter(stop => !routeDate || stop.date === routeDate);
  renderRouteChrome(routeStops);
  const placed = [];
  const missedQueries = new Set();
  for (const stop of visible) {
    const point = routeCoords.get(stop.query);
    if (!point) {
      if (routeCoords.has(stop.query)) missedQueries.add(stop.query);
      continue;
    }
    const prev = placed[placed.length - 1];
    const same = prev
      && prev.date === stop.date
      && Math.abs(prev.lat - point.lat) < 0.0002
      && Math.abs(prev.lng - point.lng) < 0.0002;
    if (same) prev.stops.push(stop);
    else placed.push({ ...point, date: stop.date, stops: [stop] });
  }
  const sequenceByDate = new Map();
  for (const point of placed) {
    const sequence = (sequenceByDate.get(point.date) || 0) + 1;
    sequenceByDate.set(point.date, sequence);
    point.sequence = sequence;
  }
  if (!routeStops.length) {
    mapEl?.classList.add('is-empty');
    if (note) note.textContent = '在位置里填写地点或地图链接后，会按日期画在地图上。';
    if (google) google.hidden = true;
    return;
  }
  mapEl?.classList.remove('is-empty');
  if (note) {
    note.textContent = missedQueries.size
      ? `有 ${missedQueries.size} 个地点没能定位。把 Google 地图链接贴进位置，就可以标出来。`
      : '颜色区分日期，数字表示当天按时间排列的位置顺序。';
  }
  if (google) {
    const url = googleRouteUrl(placed);
    google.hidden = !url;
    if (url) google.href = url;
  }
  if (!map) return;
  if (routeLayer) routeLayer.remove();
  routeLayer = L.layerGroup().addTo(map);
  for (const date of dates) {
    const line = placed.filter(point => point.date === date);
    if (line.length < 2) continue;
    L.polyline(line.map(point => [point.lat, point.lng]), {
      color: routeColor(date, dates),
      weight: 4,
      opacity: 0.9,
    }).addTo(routeLayer);
  }
  for (const point of placed) {
    const color = routeColor(point.date, dates);
    const images = pinImages(point.stops);
    const thumbPx = pinThumbSize();
    const boxes = point.stops.map(stop => pinItemBox(stop, thumbPx));
    const rows = point.stops.map(stop => {
      const time = esc(stop.time || '·');
      const event = wrapPinEvent(stop.event).map(line => `<span>${esc(line)}</span>`).join('');
      const thumb = stop.image
        ? `<img class="travel-pin-thumb" src="${esc(stop.image)}" alt="" onerror="this.parentElement.classList.add('is-plain');this.remove()">`
        : '';
      return `<span class="travel-pin-item${thumb ? '' : ' is-plain'}">${thumb}<span class="travel-pin-copy"><b>${time}</b><i>${event}</i></span></span>`;
    }).join('');
    const width = Math.max(...boxes.map(box => box.width)) + 14;
    const height = boxes.reduce((sum, box) => sum + box.height, 0) + Math.max(0, boxes.length - 1) * 4 + 10;
    const icon = L.divIcon({
      className: 'travel-pin',
      html: `<span style="background:${color}"><strong class="travel-pin-sequence" style="color:${color};border-color:${color}">${point.sequence}</strong>${rows}</span>`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height / 2],
    });
    const popupImages = images.map(src => `<img class="travel-pin-popup-img" src="${esc(src)}" alt="" onerror="this.remove()">`).join('');
    const lines = point.stops.map(stop => `<div><strong>${esc(stop.time || '未定时间')}</strong> ${esc(stop.event)}</div>`).join('');
    L.marker([point.lat, point.lng], { icon })
      .bindPopup(`<div><div>${esc(formatTravelDate(point.date))} · 第 ${point.sequence} 站</div>${popupImages}${lines}</div>`)
      .addTo(routeLayer);
  }
  if (placed.length === 1) map.setView([placed[0].lat, placed[0].lng], 14);
  else if (placed.length > 1) map.fitBounds(placed.map(point => [point.lat, point.lng]), { padding: [28, 28] });
  requestAnimationFrame(() => map.invalidateSize());
}

function routeAnchor(query) {
  const index = routeStops.findIndex(stop => stop.query === query);
  if (index < 0) return null;
  for (let step = 1; step < routeStops.length; step += 1) {
    for (const at of [index - step, index + step]) {
      const point = routeCoords.get(routeStops[at]?.query);
      if (point) return { lat: point.lat, lng: point.lng };
    }
  }
  return null;
}

async function geocodeMissing(queries) {
  if (!queries.length) return {};
  const data = await geocodeTravelPlaces(queries.map(query => ({ query, near: routeAnchor(query) })));
  return data.places || {};
}

async function refreshTravelRoute() {
  const token = ++routeToken;
  routeStops = collectRouteStops();
  const dates = routeDatesOf(routeStops);
  if (routeDate && !dates.includes(routeDate)) routeDate = '';
  drawTravelRoute();
  const missing = [...new Set(routeStops.map(stop => stop.query))].filter(query => !routeCoords.has(query));
  if (!missing.length) return;
  const note = document.getElementById('travelRouteNote');
  if (note) note.textContent = '正在把地点标到地图上…';
  try {
    const links = missing.filter(query => isMapsUrl(query));
    const names = missing.filter(query => !isMapsUrl(query));
    const linked = await geocodeMissing(links);
    if (token !== routeToken) return;
    for (const [query, point] of Object.entries(linked)) routeCoords.set(query, point);
    for (const query of names) {
      const named = await geocodeMissing([query]);
      if (token !== routeToken) return;
      for (const [key, point] of Object.entries(named)) routeCoords.set(key, point);
    }
    const fallbacks = [];
    for (const stop of routeStops) {
      if (routeCoords.get(stop.query) || !isMapsUrl(stop.query)) continue;
      const name = stop.event.trim();
      if (!name || isMapsUrl(name) || name === '未命名事项') continue;
      fallbacks.push(name);
    }
    if (fallbacks.length) {
      const more = await geocodeMissing([...new Set(fallbacks)]);
      if (token !== routeToken) return;
      for (const stop of routeStops) {
        if (routeCoords.get(stop.query) || !more[stop.event]) continue;
        routeCoords.set(stop.query, more[stop.event]);
      }
    }
  } catch {
    if (token !== routeToken) return;
    const noteEl = document.getElementById('travelRouteNote');
    if (noteEl) noteEl.textContent = '地点定位失败，请稍后再打开旅行页。';
    return;
  }
  drawTravelRoute();
}

const REPORT_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const REPORT_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'];

function reportIssuedDate() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

function reportHasContent(item) {
  return !!(
    String(item?.event || '').trim()
    || String(item?.note || '').trim()
    || String(item?.time || '').trim()
    || String(item?.location || '').trim()
    || String(item?.destination || '').trim()
    || (item?.cost != null && item.cost !== '')
  );
}

function reportPlaceLabel(value) {
  const label = mapsLabel(value);
  if (!label || label === '地图位置') return '';
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(label)) return '';
  return label;
}

function reportPlaceHtml(item) {
  const from = reportPlaceLabel(item.location);
  const to = reportPlaceLabel(item.destination);
  const text = from && to ? `${from} → ${to}` : (from || to);
  const href = mapsHref(item.location, item.destination);
  if (!text && !href) return '—';
  const label = text || '地图位置';
  if (!href) return esc(label);
  return `<a href="${esc(href)}">${esc(label)}</a>`;
}

function reportDetail(item) {
  const parts = [];
  const note = String(item.note || '').trim();
  if (note) parts.push(esc(note));
  if (item.cost != null && item.cost !== '' && Number(item.cost) !== 0) {
    const label = moneyCost(item);
    const cny = itemCurrency(item) === 'HKD' ? `（约 ${money(costInCny(item))}）` : '';
    parts.push(`${item.visit ? '探店预约 ' : ''}费用 ${esc(label)}${esc(cny)}`);
  }
  const files = itemFiles(item).map(file => file.fileName).filter(Boolean);
  if (files.length) parts.push(`附件：${esc(files.join('、'))}`);
  return parts.join('\n') || '—';
}

function reportEvent(item) {
  const name = String(item.event || '').trim() || '（未填写事项）';
  const badge = item.visit
    ? '<span class="rpt-badge">探店预约</span>'
    : item.done ? '<span class="rpt-badge">已确认</span>' : '';
  return `<div class="rpt-event">${esc(name)}${badge}</div>`;
}

function reportDateHeading(value) {
  const iso = canonicalDate(value);
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '').trim() || '未定日期';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${Number(match[2])}月${Number(match[3])}日 ${REPORT_WEEKDAYS[date.getDay()]}`;
}

function reportFirstLine(value) {
  return String(value || '').split('\n').map(line => line.trim()).find(Boolean) || '';
}

function reportBuckets() {
  const prep = [];
  const pending = [];
  const days = [];
  items.forEach(item => {
    if (!reportHasContent(item)) return;
    if (isPrep(item)) {
      prep.push(item);
      return;
    }
    const key = canonicalDate(item.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      pending.push(item);
      return;
    }
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(item);
    else days.push({ key, rows: [item] });
  });
  return { prep, pending, days };
}

function reportScheduleTable(rows) {
  const body = rows.map(item => `<tr>
    <td class="c-time">${esc(item.time || '—')}</td>
    <td>${reportEvent(item)}</td>
    <td>${esc(item.category || '—')}</td>
    <td>${reportPlaceHtml(item)}</td>
    <td class="c-note">${reportDetail(item)}</td>
  </tr>`).join('');
  return `<table>
    <colgroup>
      <col class="col-time"><col class="col-event"><col class="col-cat"><col class="col-place"><col class="col-note">
    </colgroup>
    <thead><tr><th>时间</th><th>事项</th><th>分类</th><th>地点</th><th>说明</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function reportFacts(plan, buckets) {
  const hotel = items.find(item => reportHasContent(item) && !isPrep(item) && (item.category === '住宿' || /酒店|入住/.test(`${item.event || ''}`)));
  const flights = items.filter(item => reportHasContent(item) && !isPrep(item) && /航空|航班|[A-Z]{2}\d{3,4}/.test(`${item.event || ''} ${item.note || ''}`));
  const rows = [];
  if (plan?.range) rows.push(['出行时间', plan.range]);
  else if (buckets.days.length) rows.push(['出行时间', `${reportDateHeading(buckets.days[0].key)} 至 ${reportDateHeading(buckets.days[buckets.days.length - 1].key)}`]);
  if (hotel) {
    const event = String(hotel.event || '').trim();
    const note = String(hotel.note || '').trim();
    const bare = event.replace(/^入住/, '').trim();
    rows.push(['住宿', note.includes(bare) ? note : [event, note].filter(Boolean).join('\n')]);
  }
  flights.slice(0, 4).forEach((item, index) => {
    const when = [reportDateHeading(item.date), item.time].filter(Boolean).join(' ');
    const detail = reportFirstLine(item.note);
    const label = flights.length === 1 ? '交通' : `交通 ${index + 1}`;
    rows.push([label, [when, item.event, detail].filter(Boolean).join(' · ')]);
  });
  const scheduled = buckets.days.reduce((sum, day) => sum + day.rows.length, 0);
  const confirmed = items.filter(item => item.done && reportHasContent(item)).length;
  rows.push(['日程规模', `${buckets.days.length} 天，已排期 ${scheduled} 项，已确认 ${confirmed} 项`]);
  const cost = totalCost();
  if (cost) {
    const fx = items.some(item => itemCurrency(item) === 'HKD' && Number.isFinite(item.cost))
      ? `（按${rateLabel()}折算）`
      : '';
    rows.push(['费用合计', `${money(cost)}${fx}`]);
  }
  const saved = savedCost();
  if (saved) rows.push(['节省费用', money(saved)]);
  return rows;
}

function travelReportBody() {
  const plan = activePlan();
  const title = String(plan?.title || '行程汇报').trim() || '行程汇报';
  const buckets = reportBuckets();
  const facts = reportFacts(plan, buckets);
  let section = 0;
  const heading = (text) => {
    const mark = REPORT_NUMERALS[section] || String(section + 1);
    section += 1;
    return `<h2><span>${mark}、</span>${esc(text)}</h2>`;
  };
  const days = buckets.days.map(day => {
    const focus = dayFocusMarkup(day.rows);
    return `<section class="rpt-day">
    <h3>${esc(reportDateHeading(day.key))}</h3>
    ${focus ? `<p class="rpt-focus">${focus}</p>` : ''}
    ${reportScheduleTable(day.rows)}
  </section>`;
  }).join('');
  const priced = items.filter(item => Number.isFinite(Number(item.cost)) && Number(item.cost) !== 0 && reportHasContent(item));
  const costs = priced.filter(item => !item.visit);
  const savedItems = priced.filter(item => item.visit);
  const bags = ensurePlanBags(plan).filter(bag => bag.items.length);
  const parts = [
    `<header class="rpt-mast">
      <div class="rpt-kicker"><span>行程安排汇报</span><span>供出行查阅</span></div>
      <h1>${esc(title)}</h1>
      <p class="rpt-lead">现将本次出行的日程、预约、费用和行李安排整理如下。</p>
      <p class="rpt-issued">呈报日期　${esc(reportIssuedDate())}</p>
    </header>`,
    `<section class="rpt-facts"><table><tbody>${facts.map(([name, value]) => `<tr><th>${esc(name)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table></section>`,
    heading('分日安排'),
    days || '<p class="rpt-empty">当前没有已排期的事项。</p>',
  ];
  if (costs.length) {
    const total = costs.reduce((sum, item) => sum + costInCny(item), 0);
    const hasHkd = costs.some(item => itemCurrency(item) === 'HKD');
    parts.push(heading('费用明细'));
    if (hasHkd) parts.push(`<p class="rpt-note">港币金额按${esc(rateLabel())}折算为人民币后合计。</p>`);
    parts.push(`<table class="rpt-cost">
      <thead><tr><th>日期</th><th>事项</th><th>金额</th></tr></thead>
      <tbody>
        ${costs.map(item => {
          const shown = moneyCost(item);
          const approx = itemCurrency(item) === 'HKD' ? `<div class="rpt-approx">${esc(money(costInCny(item)))}</div>` : '';
          return `<tr><td>${esc(/^\d{4}-\d{2}-\d{2}$/.test(canonicalDate(item.date)) ? reportDateHeading(item.date) : (isPrep(item) ? '行前准备' : '未定日期'))}</td><td>${esc(item.event || '—')}</td><td class="num">${esc(shown)}${approx}</td></tr>`;
        }).join('')}
        <tr class="rpt-total"><td colspan="2">合计（人民币）</td><td class="num">${esc(money(total))}</td></tr>
      </tbody>
    </table>`);
  }
  if (savedItems.length) {
    const saved = savedItems.reduce((sum, item) => sum + costInCny(item), 0);
    parts.push(heading('节省费用'));
    parts.push('<p class="rpt-note">下列事项为探店预约，金额不计入费用合计。</p>');
    parts.push(`<table class="rpt-cost">
      <thead><tr><th>日期</th><th>事项</th><th>金额</th></tr></thead>
      <tbody>
        ${savedItems.map(item => `<tr><td>${esc(/^\d{4}-\d{2}-\d{2}$/.test(canonicalDate(item.date)) ? reportDateHeading(item.date) : (isPrep(item) ? '行前准备' : '未定日期'))}</td><td>${esc(item.event || '—')}</td><td class="num">${esc(moneyCost(item))}</td></tr>`).join('')}
        <tr class="rpt-total"><td colspan="2">节省费用（人民币）</td><td class="num">${esc(money(saved))}</td></tr>
      </tbody>
    </table>`);
  }
  if (buckets.prep.length) {
    parts.push(heading('行前准备'));
    parts.push(`<table><thead><tr><th>事项</th><th>说明</th><th>状态</th></tr></thead><tbody>${buckets.prep.map(item => `<tr><td>${esc(item.event || '—')}</td><td class="c-note">${esc(String(item.note || '').trim() || '—')}</td><td>${item.visit ? '探店预约' : item.done ? '已确认' : '进行中'}</td></tr>`).join('')}</tbody></table>`);
  }
  if (buckets.pending.length) {
    parts.push(heading('暂不安排'));
    parts.push('<p class="rpt-note">下列事项仍保留在行程中，本次暂不排入具体日期。</p>');
    parts.push(reportScheduleTable(buckets.pending));
  }
  if (bags.length) {
    parts.push(heading('行李清单'));
    parts.push(`<div class="rpt-bags">${bags.map(bag => `<section><h3>${esc(bag.name)}</h3>${packGroups(bag.items).map(group => `${group.name ? `<h4>${esc(group.name)}</h4>` : ''}<ul>${group.items.map(item => `<li${item.done ? ' class="is-ready"' : ''}>${esc(item.name)}${item.done ? '<em>已备</em>' : ''}</li>`).join('')}</ul>`).join('')}</section>`).join('')}</div>`);
  }
  parts.push('<footer class="rpt-end"><span>完</span><p>以上内容以导出时的行程为准。页面上若再有修改，请重新导出。</p></footer>');
  return parts.join('');
}

const TRAVEL_REPORT_STYLE = `
  @page { size: A4; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1c1917; }
  body {
    font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: 10.5pt; line-height: 1.55;
  }
  .noprint {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 16px; background: #1c1917; color: #faf7f2; font-size: 13px;
  }
  .noprint button {
    border: 0; border-radius: 8px; background: #faf7f2; color: #1c1917; font: inherit; font-weight: 700;
    padding: 8px 14px; cursor: pointer;
  }
  .rpt { max-width: 860px; margin: 0 auto; padding: 28px 8px 48px; }
  .rpt-mast { border-top: 4px solid #9f1239; padding-top: 16px; }
  .rpt-kicker {
    display: flex; justify-content: space-between; gap: 12px;
    font-size: 11px; letter-spacing: .18em; color: #78716c;
  }
  h1 {
    margin: 10px 0 0; font-family: "Songti SC", "STSong", "SimSun", serif;
    font-size: 26pt; font-weight: 700; letter-spacing: .04em; line-height: 1.25;
  }
  .rpt-lead { margin: 12px 0 0; color: #44403c; }
  .rpt-issued { margin: 6px 0 0; color: #57534e; font-size: 10pt; }
  h2 {
    margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #1c1917;
    font-family: "Songti SC", "STSong", "SimSun", serif; font-size: 14pt; font-weight: 700; letter-spacing: .06em;
    break-after: avoid;
  }
  h2 span { display: inline-block; margin-right: 8px; color: #9f1239; }
  h3 {
    margin: 14px 0 6px; font-size: 12pt; font-weight: 700; break-after: avoid;
  }
  .rpt-focus {
    margin: 0 0 8px; padding: 6px 10px; background: #faf7f2; border-left: 3px solid #9f1239;
    font-weight: 700; line-height: 1.5;
  }
  .rpt-focus .travel-day-focus { margin-right: 18px; }
  .rpt-focus b { color: #9f1239; font-weight: 700; margin-right: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 8px; }
  th, td { border: 1px solid #d6d3d1; padding: 5px 7px; vertical-align: top; text-align: left; }
  thead th { background: #f4f1ea; font-size: 9.5pt; font-weight: 700; color: #44403c; white-space: nowrap; }
  .rpt-facts { margin-top: 14px; }
  .rpt-facts th { width: 92px; background: #faf7f2; font-weight: 700; white-space: nowrap; }
  .rpt-facts td { white-space: pre-line; }
  .col-time { width: 58px; } .col-event { width: 22%; } .col-cat { width: 64px; } .col-place { width: 22%; }
  .c-time { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; }
  .c-note { white-space: pre-line; color: #292524; }
  .rpt-event { font-weight: 700; }
  .rpt-badge {
    display: inline-block; margin-left: 6px; vertical-align: 1px;
    border: 1px solid #9f1239; color: #9f1239; font-size: 8.5pt; font-weight: 700;
    letter-spacing: .04em; padding: 0 4px; line-height: 1.5;
  }
  a { color: #1c1917; text-decoration: none; border-bottom: 1px solid #a8a29e; }
  .rpt-cost td.num, .rpt-cost th:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rpt-total td { font-weight: 700; background: #faf7f2; }
  .rpt-note, .rpt-empty { margin: 0 0 8px; color: #57534e; }
  .rpt-approx { margin-top: 2px; font-size: 9pt; color: #78716c; font-weight: 600; }
  .rpt-day { break-inside: auto; }
  tr, .rpt-facts, .rpt-bags section { break-inside: avoid; }
  .rpt-bags { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .rpt-bags h3 { margin-top: 0; }
  .rpt-bags h4 { margin: 8px 0 2px; font-size: 10.5pt; }
  .rpt-bags ul { margin: 0 0 6px; padding-left: 1.2em; }
  .rpt-bags li { margin: 2px 0; }
  .rpt-bags em { margin-left: 6px; font-style: normal; font-size: 9pt; color: #9f1239; }
  .rpt-end { margin-top: 28px; text-align: center; color: #78716c; }
  .rpt-end span {
    display: inline-block; padding: 0 12px; border-top: 1px solid #1c1917; border-bottom: 1px solid #1c1917;
    letter-spacing: .4em; font-family: "Songti SC", "STSong", "SimSun", serif;
  }
  .rpt-end p { margin: 10px 0 0; font-size: 9pt; }
  @media print {
    .noprint { display: none !important; }
    .rpt { max-width: none; padding: 0; }
    a { border-bottom: 0; }
  }
`;

function travelReportDocument() {
  const plan = activePlan();
  const title = String(plan?.title || '行程汇报').trim() || '行程汇报';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${TRAVEL_REPORT_STYLE}</style></head><body><div class="noprint"><span>在打印对话框中选择「存储为 PDF」，并关闭页眉和页脚。</span><button type="button" onclick="print()">存储为 PDF</button></div><article class="rpt">${travelReportBody()}</article><script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});<\/script></body></html>`;
}

function exportTravelPdf() {
  const win = window.open('', '_blank');
  if (!win) {
    alert('浏览器拦截了导出窗口，请允许弹窗后再导出。');
    return;
  }
  win.document.open();
  win.document.write(travelReportDocument());
  win.document.close();
}

export function setupTravel() {
  const exportBtn = document.getElementById('travelExportPdf');
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1';
    exportBtn.addEventListener('click', exportTravelPdf);
  }
  const fxBtn = document.getElementById('travelFx');
  if (fxBtn && !fxBtn.dataset.bound) {
    fxBtn.dataset.bound = '1';
    fxBtn.addEventListener('click', editHkdRate);
  }
  document.getElementById('travelPanes')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-travel-pane]');
    if (!tab) return;
    setTravelPane(tab.getAttribute('data-travel-pane'));
  });
  setTravelPane(travelPane);
  document.getElementById('travelPack')?.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-pack-add]');
    if (!form) return;
    event.preventDefault();
    let group = form.querySelector('[name="group"]')?.value || '';
    if (group === '__new__') group = form.querySelector('[name="groupName"]')?.value || '';
    addPackItem(form.getAttribute('data-pack-add'), form.querySelector('[name="item"]')?.value || '', group);
  });
  const pack = document.getElementById('travelPack');
  pack?.addEventListener('dblclick', (event) => {
    if (event.target.closest('input, button, select, a')) return;
    const row = event.target.closest('.travel-pack-item');
    const check = row?.querySelector('[data-pack-check]');
    if (!check) return;
    openPackItem(check.getAttribute('data-pack-check'), check.getAttribute('data-pack-id'));
  });
  pack?.addEventListener('keydown', (event) => {
    const input = event.target.closest('input[data-pack-id]');
    if (!input) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = input.defaultValue;
      input.blur();
    }
  });
  pack?.addEventListener('focusout', (event) => {
    const input = event.target.closest?.('input[data-pack-id]');
    if (!input) return;
    if (event.relatedTarget?.closest?.('[data-pack-del]')) return;
    const bagId = input.getAttribute('data-pack-bag');
    const itemId = input.getAttribute('data-pack-id');
    const value = input.value;
    clearTimeout(packEditTimer);
    packEditTimer = setTimeout(() => {
      if (packEdit && packEdit.itemId !== itemId) return;
      packEdit = null;
      updatePackItem(bagId, itemId, value);
      renderPack();
    }, 400);
  });
  pack?.addEventListener('click', (event) => {
    const del = event.target.closest('[data-pack-del]');
    if (!del) return;
    clearTimeout(packEditTimer);
    packEdit = null;
    removePackItem(del.getAttribute('data-pack-del'), del.getAttribute('data-pack-id'));
  });
  pack?.addEventListener('change', (event) => {
    const addGroup = event.target.closest('form[data-pack-add] select[name="group"]');
    if (addGroup) {
      const extra = addGroup.form?.querySelector('[name="groupName"]');
      if (extra) {
        extra.hidden = addGroup.value !== '__new__';
        if (!extra.hidden) extra.focus();
      }
      return;
    }
    const check = event.target.closest('input[data-pack-check]');
    if (!check) return;
    togglePackItem(check.getAttribute('data-pack-check'), check.getAttribute('data-pack-id'), check.checked);
  });
  document.getElementById('travelRoute')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-route-date]');
    if (!chip) return;
    routeDate = chip.getAttribute('data-route-date') || '';
    drawTravelRoute();
  });
  const board = document.getElementById('travelBoard');
  if (!board || board.dataset.bound) return;
  board.dataset.bound = '1';
  board.addEventListener('change', (e) => {
    const catCheck = e.target.closest?.('input[data-cat-filter]');
    if (catCheck) {
      const key = catCheck.getAttribute('data-cat-filter') ?? '';
      if (catCheck.checked) categoryFilter.add(key);
      else categoryFilter.delete(key);
      if (editing && !itemMatchesCategory(items.find(row => row.id === editing.id))) editing = null;
      categoryMenuOpen = true;
      renderTravel();
      return;
    }
    if (e.target.matches?.('input[data-field="date"], input[data-field="time"]')) {
      commitEdit();
      return;
    }
    const category = e.target.closest('select[data-travel-category]');
    if (category) {
      const id = category.getAttribute('data-travel-category');
      const item = items.find(row => row.id === id);
      if (!item) return;
      const next = TRAVEL_CATEGORIES.includes(category.value) ? category.value : '';
      if ((item.category || '') === next) return;
      const prev = item.category || '';
      item.category = next;
      renderTravel();
      persist().then(ok => {
        if (ok !== false) return;
        item.category = prev;
        renderTravel();
      });
      return;
    }
    const currency = e.target.closest('select[data-field="currency"]');
    if (currency && editing?.field === 'cost') {
      const item = items.find(row => row.id === editing.id);
      if (item) item.currency = currency.value === 'HKD' ? 'HKD' : 'CNY';
      return;
    }
    const sel = e.target.closest('select[data-travel-status]');
    if (!sel) return;
    const id = sel.getAttribute('data-travel-status');
    const item = items.find(row => row.id === id);
    if (!item) return;
    const done = sel.value === '1';
    const visit = sel.value === '2';
    if (!!item.done === done && !!item.visit === visit) return;
    const prevDone = !!item.done;
    const prevVisit = !!item.visit;
    item.done = done;
    item.visit = visit;
    paintDoneRows();
    refreshCostTotals();
    persist().then(ok => {
      if (ok !== false || !sel.isConnected) return;
      item.done = prevDone;
      item.visit = prevVisit;
      sel.value = prevVisit ? '2' : prevDone ? '1' : '0';
      paintDoneRows();
      refreshCostTotals();
    });
  });
  board.addEventListener('mousedown', (e) => {
    const removeRow = e.target.closest('[data-travel-delete]');
    if (!removeRow) return;
    e.preventDefault();
    deleteItem(removeRow.getAttribute('data-travel-delete'));
  });
  board.addEventListener('dblclick', (e) => {
    clearTimeout(mapOpenTimer);
    if (e.target.closest('select, input, textarea, button')) return;
    const cell = e.target.closest('[data-field]');
    if (!cell) return;
    if (cell.dataset.field === 'date' && isPrep(items.find(row => row.id === itemIdFromCell(cell, e.clientY)))) return;
    if (cell.dataset.field === 'file') {
      const id = cell.dataset.id;
      const named = e.target.closest('[data-file-name]');
      if (named) startEdit(id, 'fileName', { fileKey: named.getAttribute('data-file-name') });
      else openFilePicker(id);
      return;
    }
    startEdit(itemIdFromCell(cell, e.clientY), cell.dataset.field);
  });
  document.addEventListener('click', (e) => {
    if (!categoryMenuOpen) return;
    if (e.target.closest?.('.travel-cat-filter')) return;
    categoryMenuOpen = false;
    document.querySelectorAll('.travel-cat-menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[data-travel-cat-filter]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  });
  window.addEventListener('resize', placeCategoryMenu);
  window.addEventListener('resize', () => {
    const cardsVisible = !!board.querySelector('.travel-cards');
    if (cardsVisible !== travelIsMobile()) renderTravel();
    else fitTravelGridToScreen();
  });
  document.getElementById('travelBoard')?.addEventListener('scroll', placeCategoryMenu, true);
  board.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-travel-cat-filter]');
    if (filterBtn) {
      e.preventDefault();
      categoryMenuOpen = !categoryMenuOpen;
      renderTravel();
      return;
    }
    const removeRow = e.target.closest('[data-travel-delete]');
    if (removeRow) return;
    const fileLink = e.target.closest('a.travel-file-link');
    if (fileLink) {
      e.preventDefault();
      const href = fileLink.href;
      clearTimeout(mapOpenTimer);
      mapOpenTimer = setTimeout(() => window.open(href, '_blank', 'noopener'), 250);
      return;
    }
    const addFile = e.target.closest('[data-travel-add-file]');
    if (addFile) {
      openFilePicker(addFile.getAttribute('data-travel-add-file'));
      return;
    }
    const clearFile = e.target.closest('[data-travel-clear-file]');
    if (clearFile) {
      clearTravelPdf(clearFile.getAttribute('data-travel-clear-file'), clearFile.getAttribute('data-file-name'));
      return;
    }
    const emptyFile = e.target.closest('[data-field="file"]');
    if (emptyFile && !e.target.closest('a, button, input')) {
      openFilePicker(emptyFile.dataset.id);
      return;
    }
    const link = e.target.closest('a.travel-map-link');
    if (link) {
      e.preventDefault();
      clearTimeout(mapOpenTimer);
      mapOpenTimer = setTimeout(() => { openMapLink(link); }, 250);
      return;
    }
    const clear = e.target.closest('[data-travel-clear-image]');
    if (clear) {
      const id = clear.getAttribute('data-travel-clear-image');
      const item = items.find(row => row.id === id);
      if (!item) return;
      item.image = '';
      renderTravel();
      persist();
      return;
    }
    if (e.target.closest('[data-travel-add-prep]')) {
      addPrepItem();
      return;
    }
    if (e.target.closest('[data-travel-add]')) addItem();
  });
  board.addEventListener('dragover', (e) => {
    if (!e.target.closest?.('[data-field="file"]')) return;
    e.preventDefault();
  });
  board.addEventListener('drop', (e) => {
    const cell = e.target.closest?.('[data-field="file"]');
    if (!cell) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    uploadTravelPdfs(cell.dataset.id, files);
  });
  board.addEventListener('paste', (e) => {
    const cell = e.target.closest?.('[data-field="image"]');
    const input = e.target.closest?.('input[data-field="image"]');
    if (!cell && !input) return;
    const url = pastedImageUrl(e.clipboardData);
    if (!url) return;
    e.preventDefault();
    saveImageFromUrl(input ? editing?.id : cell.dataset.id, url);
  });
  board.addEventListener('input', (e) => {
    if (e.target.matches('textarea.travel-inp')) {
      fitNoteEditor(e.target);
      fitTravelGridToScreen();
    }
  });
  board.addEventListener('focusout', (e) => {
    if (deletingRow) return;
    const fromCost = e.target.closest?.('.travel-cost-edit');
    if (!e.target.classList?.contains('travel-inp') && !(fromCost && e.target.matches?.('select[data-field="currency"]'))) return;
    if (e.relatedTarget?.closest?.('[data-travel-delete]')) return;
    const scope = e.target.closest('td') || e.target.closest('.travel-place-edit') || e.target.closest('.travel-cost-edit');
    if (e.relatedTarget && scope?.contains(e.relatedTarget)) return;
    commitEdit();
  });
  board.addEventListener('keydown', (e) => {
    if (!editing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === 'Enter' && e.target.dataset.field === 'location') {
      e.preventDefault();
      document.querySelector('#travelBoard [data-field="destination"]')?.focus();
      return;
    }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      commitEdit();
    }
  });
  const plansEl = document.getElementById('travelPlans');
  if (plansEl && !plansEl.dataset.bound) {
    plansEl.dataset.bound = '1';
    plansEl.addEventListener('click', (e) => {
      const del = e.target.closest('[data-travel-plan-del]');
      if (del) {
        e.stopPropagation();
        deletePlan(del.getAttribute('data-travel-plan-del'));
        return;
      }
      if (e.target.closest('[data-travel-plan-add]')) {
        addPlan();
        return;
      }
      const tab = e.target.closest('[data-travel-plan]');
      if (tab) selectPlan(tab.getAttribute('data-travel-plan'));
    });
    plansEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-travel-plan-del], [data-travel-plan-add]')) return;
      const tab = e.target.closest('[data-travel-plan]');
      if (tab) renamePlan(tab.getAttribute('data-travel-plan'));
    });
  }
  const mobileQuery = window.matchMedia('(max-width: 768px)');
  if (!mobileQuery._travelBound) {
    mobileQuery._travelBound = true;
    mobileQuery.addEventListener('change', () => {
      if (editing) return;
      renderTravel();
    });
  }
}
