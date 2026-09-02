/** 账目合并统计：多笔流水在明细中保留，分类统计按净额计入指定分类 */

let merges = [];

function uniqKeys(keys) {
  return [...new Set((keys || []).map(k => String(k).trim()).filter(Boolean))];
}

function normalizeMerge(raw) {
  const keys = uniqKeys(raw?.keys);
  if (keys.length < 2) return null;
  const category = String(raw?.category || '').trim();
  if (!category) return null;
  return {
    id: String(raw?.id || `merge-${keys.join('-')}`),
    keys,
    category,
    subcategory: String(raw?.subcategory || '').trim()
  };
}

export function loadTxnMerges(state) {
  merges = Array.isArray(state?.txnMerges)
    ? state.txnMerges.map(normalizeMerge).filter(Boolean)
    : [];
}

export function getTxnMerges() {
  return merges.map(m => ({ ...m, keys: [...m.keys] }));
}

export function findMergeForKey(key) {
  const k = String(key);
  return merges.find(m => m.keys.includes(k)) || null;
}

export function findMergeById(id) {
  return merges.find(m => m.id === id) || null;
}

export function mergedKeySet() {
  const set = new Set();
  merges.forEach(m => m.keys.forEach(k => set.add(String(k))));
  return set;
}

export function rowInMerge(row, merge) {
  if (!row || !merge) return false;
  return merge.keys.includes(String(row.id));
}

function mergeHasOverlap(keys) {
  const set = new Set(keys.map(String));
  return merges.some(m => m.keys.some(k => set.has(k)));
}

export function validateTxnMerge(keys, rows) {
  const norm = uniqKeys(keys);
  if (norm.length < 2) return '请至少选择 2 笔账目';
  if (rows.length !== norm.length) return '部分记录不存在';
  if (mergeHasOverlap(norm)) return '选中账目已有合并统计，请先取消原合并';
  return null;
}

export function addTxnMerge({ keys, category, subcategory }) {
  const norm = uniqKeys(keys);
  if (norm.length < 2) throw new Error('至少需要 2 条记录');
  const cat = String(category || '').trim();
  if (!cat) throw new Error('请选择计入的分类');
  if (mergeHasOverlap(norm)) throw new Error('选中账目已有合并统计');
  const id = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    keys: norm,
    category: cat,
    subcategory: String(subcategory || '').trim()
  };
  merges.push(item);
  return id;
}

export function removeTxnMergeById(id) {
  merges = merges.filter(m => m.id !== id);
}

export function pruneTxnMerges(existingIds) {
  const set = new Set([...existingIds].map(String));
  const before = merges.length;
  merges = merges
    .map(m => ({ ...m, keys: m.keys.filter(k => set.has(k)) }))
    .filter(m => m.keys.length >= 2);
  return before !== merges.length;
}

export function computeMergeNet(rows) {
  let exp = 0;
  let inc = 0;
  (rows || []).forEach(r => {
    const amt = Number(r['金额']) || 0;
    if (r['收支'] === '收入') inc += amt;
    else exp += amt;
  });
  const net = inc - exp;
  return { exp, inc, net, abs: Math.abs(net) };
}

export function mergeStatsAnchor(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const expRows = list
    .filter(r => r['收支'] === '支出')
    .sort((a, b) => (a['日期'] + a['时间']).localeCompare(b['日期'] + b['时间']));
  const pool = expRows.length
    ? expRows
    : [...list].sort((a, b) => (a['日期'] + a['时间']).localeCompare(b['日期'] + b['时间']));
  return pool[0] || null;
}

export function mergeStatsRow(merge, rows) {
  const counted = (rows || []).filter(Boolean);
  if (!counted.length) return null;
  const { net, abs, inc, exp } = computeMergeNet(counted);
  if (abs < 0.009) return null;
  const anchor = mergeStatsAnchor(counted);
  const peer = (anchor?.['交易对方'] || counted[0]?.['交易对方'] || '').trim() || '合并净额';
  const sources = [...new Set(counted.map(r => r['来源']).filter(Boolean))];
  return {
    id: `merge:${merge.id}`,
    _statsMerge: true,
    _mergeId: merge.id,
    日期: anchor?.['日期'] || '',
    时间: anchor?.['时间'] || '00:00',
    来源: sources.length === 1 ? sources[0] : '合并统计',
    交易对方: peer,
    商品说明: `合并净额 ${counted.length}笔（支 ${exp.toFixed(2)} / 收 ${inc.toFixed(2)}）`,
    产品名称: '',
    分类: merge.category,
    子分类: merge.subcategory || '',
    收支: net > 0 ? '收入' : '支出',
    金额: abs,
    支付方式: '',
    备注: '合并统计',
    退款状态: 'normal',
    统计状态: 'normal'
  };
}
