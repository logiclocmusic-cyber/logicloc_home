// ── CSV / Excel 解析工具 ─────────────────────────────────────────────────────
import * as XLSX from 'xlsx';

export const Parsers = (() => {
  function readText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'UTF-8');
    });
  }

  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function isExcelFile(file) {
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.xlsx') || name.endsWith('.xls');
  }

  function normalizeCell(cell) {
    if (cell == null || cell === '') return '';
    if (cell instanceof Date) {
      const pad = n => String(n).padStart(2, '0');
      return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())} ${pad(cell.getHours())}:${pad(cell.getMinutes())}:${pad(cell.getSeconds())}`;
    }
    return String(cell).trim();
  }

  function normalizeRows(rows) {
    return rows.map(row => (Array.isArray(row) ? row : Object.values(row)).map(normalizeCell));
  }

  async function parseExcel(file) {
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('Excel 文件中没有工作表');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const normalized = normalizeRows(rows);
    if (!normalized.length) throw new Error('Excel 文件为空或无法解析');
    return normalized;
  }

  async function readRows(file) {
    if (isExcelFile(file)) return parseExcel(file);
    const buf = new Uint8Array(await readArrayBuffer(file));
    return parseCSV(decodeCsvBytes(buf));
  }

  function stripBOM(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  function countReplacementChars(text) {
    const m = text.match(/\uFFFD/g);
    return m ? m.length : 0;
  }

  /**
   * 国内银行/账单 CSV 编码不一（支付宝、微信多为 UTF-8，工行等银行流水常为 GBK）。
   * UTF-8 解码 GBK 字节会产生替换字符（U+FFFD），据此判断是否改用 GB18030。
   */
  function decodeCsvBytes(bytes) {
    const utf8 = stripBOM(new TextDecoder('utf-8').decode(bytes));
    const utf8Bad = countReplacementChars(utf8);
    if (utf8Bad === 0) return utf8;
    try {
      const gb = stripBOM(new TextDecoder('gb18030').decode(bytes));
      if (countReplacementChars(gb) < utf8Bad) return gb;
    } catch (_) { /* 部分环境不支持 gb18030 */ }
    return utf8;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' || ch === '\n') {
        row.push(field.trim());
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && next === '\n') i++;
      } else {
        field += ch;
      }
    }

    if (field.length || row.length) {
      row.push(field.trim());
      if (row.some(c => c !== '')) rows.push(row);
    }
    return rows;
  }

  function findHeaderRow(rows, required) {
    for (let i = 0; i < Math.min(rows.length, 80); i++) {
      const joined = rows[i].join(',');
      if (required.every(k => joined.includes(k))) return i;
    }
    return -1;
  }

  function colMap(header) {
    const map = {};
    header.forEach((h, i) => {
      map[h.replace(/\s/g, '')] = i;
      map[h] = i;
    });
    return map;
  }

  function cleanField(val) {
    return String(val ?? '').replace(/\t/g, '').trim();
  }

  function pick(map, row, ...keys) {
    for (const k of keys) {
      if (map[k] !== undefined && row[map[k]] !== undefined) return cleanField(row[map[k]]);
    }
    return '';
  }

  function parseDateTime(raw) {
    if (!raw) return { date: '', time: '00:00' };
    if (raw instanceof Date) {
      const pad = n => String(n).padStart(2, '0');
      return {
        date: `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`,
        time: `${pad(raw.getHours())}:${pad(raw.getMinutes())}:${pad(raw.getSeconds())}`
      };
    }
    const s = String(raw).replace(/\//g, '-').trim();
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      return {
        date: `${compact[1]}-${compact[2]}-${compact[3]}`,
        time: '00:00'
      };
    }
    const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (!m) return { date: '', time: '00:00' };
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    let time = m[4] || '00:00';
    if (time.length === 5) time += ':00';
    return { date, time: time.slice(0, 8) };
  }

  function parseSignedAmount(raw) {
    if (raw == null || raw === '') return { amount: 0, sign: 0 };
    const n = parseFloat(String(raw).replace(/[¥,，元\s]/g, ''));
    if (isNaN(n) || n === 0) return { amount: 0, sign: 0 };
    if (n < 0) return { amount: Math.abs(n), sign: -1 };
    return { amount: n, sign: 1 };
  }

  function parseAmount(raw) {
    if (!raw) return 0;
    const n = parseFloat(String(raw).replace(/[¥,，元\s]/g, ''));
    return isNaN(n) ? 0 : Math.abs(n);
  }

  function parseType(raw, amountHint) {
    const s = (raw || '').trim();
    if (s === '不计收支' || s === '其他') return '';
    if (/^收入$|^转入$|^贷$/.test(s)) return '收入';
    if (/^支出$|^转出$|^借$/.test(s)) return '支出';
    if (/收入|转入|贷/.test(s) && !/支出|支|借/.test(s)) return '收入';
    if (/支出|转出|借/.test(s)) return '支出';
    if (amountHint < 0) return '支出';
    return '支出';
  }

  function normalizeTimeForDedup(time) {
    if (!time) return '00:00';
    const parts = String(time).trim().split(':');
    const h = (parts[0] || '0').padStart(2, '0');
    const m = (parts[1] || '0').padStart(2, '0');
    return `${h}:${m}`;
  }

  function isMidnightPlaceholder(time) {
    return normalizeTimeForDedup(time) === '00:00';
  }

  function timeToMinutes(time) {
    const t = normalizeTimeForDedup(time);
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function timesHighlyConsistent(a, b) {
    const na = normalizeTimeForDedup(a);
    const nb = normalizeTimeForDedup(b);
    if (na === nb) return true;
    if (isMidnightPlaceholder(a) || isMidnightPlaceholder(b)) return false;
    return Math.abs(timeToMinutes(a) - timeToMinutes(b)) <= 5;
  }

  function sourcePlatform(source) {
    const s = String(source || '');
    if (s.startsWith('微信')) return 'wechat';
    if (s.startsWith('支付宝')) return 'alipay';
    if (s.startsWith('银行') || s.startsWith('建行')) return 'bank';
    if (s.startsWith('京东')) return 'jd';
    return s || 'other';
  }

  function peersLooselyMatch(a, b) {
    const pa = String(a || '').replace(/\*/g, '').trim();
    const pb = String(b || '').replace(/\*/g, '').trim();
    if (!pa || !pb) return false;
    if (pa === pb) return true;
    const generic = /^(转账|转账支取|消费|充值|还款|利息|汇兑|银联|支付|其他|无名|未知)$/;
    if (generic.test(pa) || generic.test(pb)) return false;
    if (pa.length < 2 || pb.length < 2) return false;
    if (pa.includes(pb) || pb.includes(pa)) return true;
    const na = pa.replace(/[\s*]/g, '');
    const nb = pb.replace(/[\s*]/g, '');
    return na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na));
  }

  function paymentSuggestsCrossRecord(row, other) {
    const pay = String(row['支付方式'] || '');
    const otherPlat = sourcePlatform(other['来源']);
    const rowPlat = sourcePlatform(row['来源']);
    if (otherPlat === 'bank' && rowPlat === 'wechat' && /银行|建行|工商|农业|交通|储蓄|信用|借记|贷记|\(\d{4}\)/.test(pay)) return true;
    if (otherPlat === 'wechat' && rowPlat === 'bank' && /微信/.test(`${other['商品说明'] || ''}${other['备注'] || ''}${other['交易对方'] || ''}`)) return true;
    if (otherPlat === 'bank' && rowPlat === 'alipay' && /支付宝|花呗|余额宝/.test(pay)) return true;
    if (otherPlat === 'alipay' && rowPlat === 'bank' && /银行|建行|工商|农业|交通|储蓄|信用|借记|贷记|\(\d{4}\)/.test(other['支付方式'] || '')) return true;
    return false;
  }

  function descSuggestsSameTxn(a, b) {
    const ad = `${a['商品说明'] || ''}${a['摘要'] || ''}`;
    const bd = `${b['商品说明'] || ''}${b['摘要'] || ''}`;
    if (/转账/.test(ad) && /转账/.test(bd)) return true;
    return peersLooselyMatch(ad, bd);
  }

  function isCrossSourceMatch(a, b) {
    if (!a?.['日期'] || !b?.['日期'] || a['日期'] !== b['日期']) return false;
    if (a['收支'] !== b['收支']) return false;
    if (Number(a['金额'] || 0).toFixed(2) !== Number(b['金额'] || 0).toFixed(2)) return false;
    if (sourcePlatform(a['来源']) === sourcePlatform(b['来源'])) return false;

    const aMid = isMidnightPlaceholder(a['时间']);
    const bMid = isMidnightPlaceholder(b['时间']);
    const peerHint = peersLooselyMatch(a['交易对方'], b['交易对方'])
      || peersLooselyMatch(a['商品说明'], b['交易对方'])
      || peersLooselyMatch(b['商品说明'], a['交易对方']);
    const payHint = paymentSuggestsCrossRecord(a, b) || paymentSuggestsCrossRecord(b, a);
    const descHint = descSuggestsSameTxn(a, b);

    if (!aMid && !bMid) return timesHighlyConsistent(a['时间'], b['时间']);
    if (payHint && (peerHint || descHint)) return true;
    return false;
  }

  function crossSourceBucketKey(row) {
    if (!row?.['日期'] || row['金额'] == null) return '';
    return [row['日期'], row['收支'], Number(row['金额'] || 0).toFixed(2)].join('|');
  }

  function buildCrossSourceIndex(records) {
    const buckets = new Map();
    for (const row of records || []) {
      const key = crossSourceBucketKey(row);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    return buckets;
  }

  function addToCrossSourceIndex(index, row) {
    const key = crossSourceBucketKey(row);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }

  function findCrossSourceDuplicate(row, index) {
    const key = crossSourceBucketKey(row);
    if (!key) return null;
    for (const cand of index.get(key) || []) {
      if (row.id != null && cand.id != null && row.id === cand.id) continue;
      if (isCrossSourceMatch(row, cand)) return cand;
    }
    return null;
  }

  function summarizeDupMatch(row) {
    return {
      id: row.id,
      来源: row['来源'] || '',
      日期: row['日期'] || '',
      时间: row['时间'] || '',
      交易对方: row['交易对方'] || '',
      金额: row['金额']
    };
  }

  /** 业务去重键：兼容旧数据（无秒、无交易单号）与新导入账单 */
  function txnDedupKey(row) {
    return [
      row['日期'],
      normalizeTimeForDedup(row['时间']),
      row['来源'],
      (row['交易对方'] || '').trim(),
      row['收支'],
      Number(row['金额'] || 0).toFixed(2)
    ].join('|');
  }

  function txnHash(row) {
    const orderId = String(row['交易单号'] || '').trim();
    if (orderId) return `oid:${orderId}`;
    return txnDedupKey(row);
  }

  function buildDedupSet(records) {
    const set = new Set();
    for (const row of records) addToDedupSet(set, row);
    return set;
  }

  function addToDedupSet(set, row) {
    set.add(txnDedupKey(row));
    const orderId = String(row['交易单号'] || '').trim();
    if (orderId) set.add(`oid:${orderId}`);
    const stored = row._hash;
    if (stored) set.add(stored);
  }

  function isDuplicate(row, dedupSet) {
    if (dedupSet.has(txnDedupKey(row))) return true;
    const orderId = String(row['交易单号'] || '').trim();
    if (orderId && dedupSet.has(`oid:${orderId}`)) return true;
    return false;
  }

  function makeRow(fields) {
    return {
      日期: fields.date || '',
      时间: fields.time || '00:00',
      来源: fields.source || '',
      交易对方: fields.peer || '',
      商品说明: fields.desc || '',
      分类: fields.category || '其他',
      子分类: fields.subCat || '',
      产品名称: fields.productName || '',
      收支: fields.type || '支出',
      金额: fields.amount || 0,
      支付方式: fields.pay || '',
      备注: fields.note || '',
      退款状态: fields.refund || 'normal',
      统计状态: 'normal',
      交易单号: fields.orderId || '',
      原始分类: fields.rawCategory || ''
    };
  }

  const PLATFORM_PREFIX = { wechat: '微信', alipay: '支付宝', bank: '银行', ccb: '建行', jd: '京东' };
  const FORMAT_LABELS = { wechat: '微信支付', alipay: '支付宝', bank: '银行流水', ccb: '建设银行流水' };

  /** 文件名/表头中的公司关键词 → 账本来源名称 */
  const COMPANY_SOURCE_HINTS = [
    { keys: ['乐极客', '乐极客科技', '成都乐极客'], source: '乐极客公司' },
    { keys: ['小河帮', '小河帮电子商务', '成都小河帮'], source: '小河帮公司' }
  ];

  function isCorporateBankStatement(rows) {
    const head = rows.slice(0, 8).map(r => r.join(',')).join('\n');
    if (/账户历史明细/.test(head)
      && /交易日期/.test(head)
      && /(收入|贷方)/.test(head)
      && /(支出|借方)/.test(head)) return true;
    // 长城华西银行等：户名 + 借方金额/贷方金额 + 对方名称
    return /户名/.test(head)
      && /借方金额/.test(head)
      && /贷方金额/.test(head)
      && /交易日期/.test(head);
  }

  function matchCompanySource(file, rows, sources) {
    const text = [(file?.name || ''), ...extractFileHints(file, rows)].join(' ');
    for (const { keys, source } of COMPANY_SOURCE_HINTS) {
      if (!keys.some(k => text.includes(k))) continue;
      const found = sources.find(s => s.name === source);
      if (found) return source;
    }
    if (isCorporateBankStatement(rows)) {
      const companySources = sources.filter(s => /公司$/.test(s.name));
      if (companySources.length === 1) return companySources[0].name;
    }
    return null;
  }

  function isCcbBankStatement(rows) {
    const head = rows.slice(0, 8).map(r => r.join(',')).join('\n');
    return /中国建设银行/.test(head)
      && /交易日期/.test(head)
      && /交易金额/.test(head)
      && /对方账号与户名/.test(head);
  }

  function findCcbHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 80); i++) {
      const joined = rows[i].join(',');
      if (/序号/.test(joined) && /摘要/.test(joined) && /交易日期/.test(joined) && /交易金额/.test(joined)) {
        return i;
      }
    }
    return -1;
  }

  function parseCcbPeer(raw) {
    const s = cleanField(raw);
    if (!s) return '';
    const slash = s.indexOf('/');
    return slash >= 0 ? (s.slice(slash + 1).trim() || s) : s;
  }

  function isBankRefundRow(summary, extra = '') {
    const s = `${summary || ''} ${extra || ''}`;
    return /消费退货|退货|退款|撤销|冲正|退汇|返还/.test(s);
  }

  function detectFormat(rows) {
    const sample = rows.slice(0, 50).map(r => r.join(',')).join('\n');
    if (/微信支付账单明细|微信昵称/.test(sample)) return 'wechat';
    if (/支付宝.*账单|支付宝（中国）|支付宝支付科技|导出信息：|支付宝账户：/.test(sample)) return 'alipay';
    if (/交易时间,交易分类,交易对方/.test(sample)) return 'alipay';
    if (/交易时间,交易类型,交易对方/.test(sample)) return 'wechat';
    if (isCcbBankStatement(rows)) return 'ccb';
    if (/记账日期|交易日期|摘要|对方户名|借贷/.test(sample)) return 'bank';
    return 'unknown';
  }

  /** 从账单文件头、文件名提取姓名/昵称等线索 */
  function extractFileHints(file, rows) {
    const hints = new Set();
    const fname = (file?.name || '').replace(/\.[^.]+$/i, '');
    if (fname) {
      hints.add(fname);
      for (const { keys } of COMPANY_SOURCE_HINTS) {
        for (const k of keys) {
          if (fname.includes(k)) hints.add(k);
        }
      }
    }

    for (let i = 0; i < Math.min(rows.length, 35); i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = String(row[j] ?? '').trim();
        const next = String(row[j + 1] ?? '').trim();
        if (/微信昵称|^姓名$|支付宝账户|账户名称|户名|客户名称/.test(cell) && next) hints.add(next);
        const kv = cell.match(/^(微信昵称|姓名|支付宝账户|账户名称|户名|客户名称)[：:]\s*(.+)$/);
        if (kv?.[2]) hints.add(kv[2].trim());
      }
      const joined = row.join(',');
      const inline = joined.match(/微信昵称[：:]\s*([^,]+)/);
      if (inline?.[1]) hints.add(inline[1].trim());
    }
    return [...hints].filter(Boolean);
  }

  /** 根据文件格式与内容自动匹配 SOURCES 中的账本名称 */
  function resolveSourceName(file, rows, format, sources) {
    if (!sources?.length) throw new Error('请先在系统中配置账单来源');

    if (format === 'bank' || format === 'ccb') {
      const companySource = matchCompanySource(file, rows, sources);
      if (companySource) return companySource;
    }

    const prefix = PLATFORM_PREFIX[format] || '';
    const hints = extractFileHints(file, rows);

    const candidates = prefix
      ? sources.filter(s => s.name.startsWith(`${prefix}-`) || s.name === prefix)
      : [...sources];

    let best = null;
    let bestScore = 0;

    for (const s of candidates) {
      const person = s.name.includes('-') ? s.name.split('-').slice(1).join('-') : s.name;
      let score = 0;
      if (prefix && s.name.startsWith(prefix)) score += 5;

      for (const h of hints) {
        if (h.includes(s.name)) score += 50;
        if (s.name.includes(h) && h.length >= 2) score += 30;
        if (person.length >= 2 && h.includes(person)) score += 40;
        if (person.length >= 2 && person.includes(h) && h.length >= 2) score += 25;
        for (const { keys, source } of COMPANY_SOURCE_HINTS) {
          if (s.name !== source) continue;
          if (keys.some(k => h.includes(k))) score += 60;
        }
      }

      if (format === 'bank' || format === 'ccb') {
        if (/信用|信用卡/.test(hints.join(' ')) && /信用/.test(s.name)) score += 30;
        if (/储蓄|借记/.test(hints.join(' ')) && /储蓄/.test(s.name)) score += 30;
      }

      if (score > bestScore) {
        bestScore = score;
        best = s.name;
      }
    }

    if (best && bestScore >= 25) return best;
    if (candidates.length === 1) return candidates[0].name;

    if (prefix) {
      const platformOnly = sources.filter(s => s.name.startsWith(`${prefix}-`));
      if (platformOnly.length === 1) return platformOnly[0].name;
    }

    const label = prefix || format || '账单';
    throw new Error(
      `无法从文件自动识别${label}账本。请确认账单内的姓名/昵称或文件名与已配置来源一致（如「${prefix || '微信'}-陈橙」）。`
    );
  }

  function isNeutralWeChatType(typeRaw) {
    const s = (typeRaw || '').trim();
    return s === '/' || s === '／';
  }

  function parseWeChat(rows, sourceName) {
    const hi = findHeaderRow(rows, ['交易时间', '交易类型']);
    if (hi < 0) throw new Error('未识别到微信账单表头，请确认导出的是「微信支付账单明细」CSV 或 Excel');

    const map = colMap(rows[hi]);
    const out = [];

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length || !pick(map, row, '交易时间')) continue;

      const typeRaw = pick(map, row, '收/支', '收支');
      if (isNeutralWeChatType(typeRaw)) continue;

      const dt = parseDateTime(pick(map, row, '交易时间'));
      const status = pick(map, row, '当前状态', '交易状态');
      const amount = parseAmount(pick(map, row, '金额(元)', '金额'));
      if (!amount || !dt.date) continue;

      const type = parseType(typeRaw, 0);
      const peer = pick(map, row, '交易对方');
      const goods = pick(map, row, '商品', '商品说明');
      const txType = pick(map, row, '交易类型');
      const desc = goods && goods !== '/' ? goods : txType;
      const pay = pick(map, row, '支付方式');
      const noteRaw = pick(map, row, '备注');
      const note = noteRaw && noteRaw !== '/' ? noteRaw : '';
      const orderId = pick(map, row, '交易单号');

      out.push(makeRow({
        date: dt.date, time: dt.time, source: sourceName,
        peer, desc, type, amount, pay, note, orderId,
        rawCategory: txType,
        refund: /退款|已全额退款|已部分退款/.test(status) ? 'refunded' : 'normal'
      }));
    }
    return out;
  }

  function isAlipaySuccessStatus(status) {
    return status === '交易成功' || status === '转账成功';
  }

  function alipayBaseOrderId(orderId) {
    const id = cleanField(orderId);
    const idx = id.indexOf('_');
    return idx > 0 ? id.slice(0, idx) : id;
  }

  function parseAlipay(rows, sourceName) {
    const hi = findHeaderRow(rows, ['交易时间', '交易分类']) >= 0
      ? findHeaderRow(rows, ['交易时间', '交易分类'])
      : findHeaderRow(rows, ['交易时间', '交易对方', '收/支']);
    if (hi < 0) throw new Error('未识别到支付宝账单表头，请确认导出的是「支付宝交易明细」CSV');

    const map = colMap(rows[hi]);
    const refundOrderIds = new Set();

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length || !pick(map, row, '交易时间')) continue;
      const status = pick(map, row, '交易状态', '当前状态');
      if (!/退款成功/.test(status)) continue;
      const orderId = pick(map, row, '交易订单号', '交易单号');
      if (!orderId) continue;
      refundOrderIds.add(orderId);
      refundOrderIds.add(alipayBaseOrderId(orderId));
    }

    const out = [];

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length || !pick(map, row, '交易时间')) continue;

      const typeRaw = pick(map, row, '收/支', '收支');
      if (!typeRaw || typeRaw === '不计收支' || typeRaw === '/') continue;

      const status = pick(map, row, '交易状态', '当前状态');
      if (/退款成功/.test(status)) continue;
      if (!isAlipaySuccessStatus(status)) continue;

      const dt = parseDateTime(pick(map, row, '交易时间'));
      const type = parseType(typeRaw, 0);
      if (!type) continue;

      const amount = parseAmount(pick(map, row, '金额'));
      if (!amount || !dt.date) continue;

      const rawCat = pick(map, row, '交易分类');
      const peer = pick(map, row, '交易对方');
      const desc = pick(map, row, '商品说明', '商品') || rawCat;
      const pay = pick(map, row, '收/付款方式', '支付方式');
      const note = pick(map, row, '备注');
      const orderId = pick(map, row, '交易订单号', '交易单号');
      const baseId = alipayBaseOrderId(orderId);
      const isRefunded = refundOrderIds.has(orderId) || (baseId && refundOrderIds.has(baseId));

      out.push(makeRow({
        date: dt.date, time: dt.time, source: sourceName,
        peer, desc, type, amount, pay, note, orderId,
        rawCategory: rawCat,
        refund: isRefunded ? 'refunded' : 'normal'
      }));
    }
    return out;
  }

  function parseCcbBank(rows, sourceName) {
    const hi = findCcbHeaderRow(rows);
    if (hi < 0) throw new Error('未识别到建设银行流水表头，请确认导出的是「个人活期账户全部交易明细」');

    const map = colMap(rows[hi]);
    const out = [];

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length) continue;

      const seq = pick(map, row, '序号');
      if (!seq || !/^\d+$/.test(seq)) continue;

      const dt = parseDateTime(pick(map, row, '交易日期'));
      const { amount, sign } = parseSignedAmount(pick(map, row, '交易金额'));
      if (!amount || !dt.date) continue;

      const summary = pick(map, row, '摘要');
      const place = pick(map, row, '交易地点/附言', '交易地点', '附言');
      if (isBankRefundRow(summary, place)) continue;

      const type = sign < 0 ? '支出' : '收入';
      const peer = parseCcbPeer(pick(map, row, '对方账号与户名', '对方户名', '交易对方'));
      const desc = [summary, place].filter(v => v && v !== '***').join(' · ') || summary || peer;
      const note = pick(map, row, '账户余额') ? `余额 ${pick(map, row, '账户余额')}` : '';

      out.push(makeRow({
        date: dt.date, time: dt.time, source: sourceName,
        peer, desc, type, amount, pay: sourceName, note,
        rawCategory: summary
      }));
    }
    return out;
  }

  function parseBank(rows, sourceName) {
    const hi = findHeaderRow(rows, ['交易日期']) >= 0
      ? findHeaderRow(rows, ['交易日期'])
      : findHeaderRow(rows, ['记账日期', '摘要']) >= 0
        ? findHeaderRow(rows, ['记账日期', '摘要'])
        : findHeaderRow(rows, ['交易时间']);

    if (hi < 0) throw new Error('未识别到银行流水表头，请确认 CSV 包含日期、金额等列');

    const map = colMap(rows[hi]);
    const out = [];

    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length) continue;

      const dateRaw = pick(map, row, '交易日期', '记账日期', '交易时间');
      const timeRaw = pick(map, row, '交易时间');
      const dt = parseDateTime(dateRaw + (timeRaw && !dateRaw.includes(':') ? ' ' + timeRaw : ''));

      const income = parseAmount(pick(map, row, '收入', '贷方发生额', '贷方金额'));
      const expense = parseAmount(pick(map, row, '支出', '借方发生额', '借方金额'));
      let amount = parseAmount(pick(map, row, '交易金额', '金额', '发生额'));
      let type = '支出';

      const signed = parseSignedAmount(pick(map, row, '交易金额'));
      if (signed.amount && signed.sign) {
        amount = signed.amount;
        type = signed.sign < 0 ? '支出' : '收入';
      } else if (income && !expense) { amount = income; type = '收入'; }
      else if (expense && !income) { amount = expense; type = '支出'; }
      else if (!amount) continue;
      else {
        const flag = pick(map, row, '借贷标志', '收/支', '借贷');
        type = parseType(flag, 0);
      }

      const peer = pick(map, row, '对方户名', '对方名称', '交易对方', '对方账号与户名', '对方账号');
      const summary = pick(map, row, '摘要', '交易类型', '业务类型');
      const noteExtra = pick(map, row, '备注', '备注信息', '附言', '交易地点/附言');
      if (isBankRefundRow(summary, noteExtra)) continue;
      const genericSummary = /^(转账|转账转入|转账转出)$/;
      let desc = genericSummary.test(summary) && noteExtra
        ? noteExtra
        : [summary, noteExtra].filter(Boolean).join(' · ');
      if (!desc) desc = pick(map, row, '用途', '交易说明', '商品说明') || peer;
      const pay = pick(map, row, '交易渠道', '支付方式', '交易类型') || sourceName;
      const note = noteExtra;
      const orderId = pick(map, row, '交易流水号', '流水号', '交易单号');

      out.push(makeRow({
        date: dt.date, time: dt.time, source: sourceName,
        peer, desc, type, amount, pay, note, orderId,
        rawCategory: pick(map, row, '交易类型', '业务类型')
      }));
    }
    return out;
  }

  async function parseFile(file, sourceName, formatHint, sources) {
    const rows = await readRows(file);
    if (!rows.length) throw new Error('文件为空或无法解析');

    const format = formatHint === 'auto'
      ? (isExcelFile(file) && /微信支付账单明细|微信昵称/.test(rows.slice(0, 20).map(r => r.join(',')).join('\n'))
        ? 'wechat'
        : detectFormat(rows))
      : formatHint;

    const resolvedSource = sourceName || resolveSourceName(file, rows, format, sources);
    let records;

    switch (format) {
      case 'wechat': records = parseWeChat(rows, resolvedSource); break;
      case 'alipay': records = parseAlipay(rows, resolvedSource); break;
      case 'ccb': records = parseCcbBank(rows, resolvedSource); break;
      case 'bank': records = parseBank(rows, resolvedSource); break;
      default:
        throw new Error('无法识别账单格式，请手动选择：微信 / 支付宝 / 银行流水');
    }

    if (!records.length) throw new Error('未解析到有效交易记录，请检查文件内容');
    return { format, records, sourceName: resolvedSource };
  }

  return {
    parseFile, detectFormat, resolveSourceName, extractFileHints, FORMAT_LABELS,
    txnHash, txnDedupKey, buildDedupSet, addToDedupSet, isDuplicate,
    buildCrossSourceIndex, addToCrossSourceIndex, findCrossSourceDuplicate, summarizeDupMatch,
    readText, parseCSV, readRows, isExcelFile
  };
})();
