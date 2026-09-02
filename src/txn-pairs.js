/** 账目关联：多笔借还/付款返款等组合，支持命名与收支核对 */

let links = [];

function uniqKeys(keys) {
  return [...new Set((keys || []).map(k => String(k).trim()).filter(Boolean))];
}

function normalizeLink(raw) {
  const keys = uniqKeys(raw?.keys);
  if (keys.length < 2) return null;
  return {
    id: String(raw?.id || `link-${keys.join('-')}`),
    name: String(raw?.name || '').trim() || (keys.length === 2 ? '已完成配对' : '关联账目'),
    keys
  };
}

export function rowLinkKey(row) {
  const parentId = row?._splitOf ?? row?.id;
  if (parentId == null) return '';
  return row?._splitIdx != null ? `${parentId}:${row._splitIdx}` : String(parentId);
}

export function loadTxnPairs(state) {
  links = Array.isArray(state?.txnPairs)
    ? state.txnPairs.map(normalizeLink).filter(Boolean)
    : [];
}

export function getTxnPairs() {
  return links.map(l => ({ ...l, keys: [...l.keys] }));
}

export function findLinkForKey(key) {
  const k = String(key);
  return links.find(l => l.keys.includes(k)) || null;
}

export function findPairForKey(key) {
  return findLinkForKey(key);
}

export function findLinkById(id) {
  return links.find(l => l.id === id) || null;
}

export function getPartnerKey(key) {
  const link = findLinkForKey(key);
  if (!link || link.keys.length !== 2) return null;
  return link.keys.find(k => k !== String(key)) || null;
}

export function rowsForLinkKeys(keys, rows) {
  const list = Array.isArray(rows) ? rows : [];
  return keys.map(key => {
    const sep = String(key).indexOf(':');
    const parentId = Number(sep < 0 ? key : key.slice(0, sep));
    const splitIdx = sep < 0 ? null : Number(key.slice(sep + 1));
    if (splitIdx != null) {
      const parent = list.find(r => r.id === parentId);
      if (!parent?.splits?.[splitIdx]) return null;
      const sp = parent.splits[splitIdx];
      return {
        ...parent,
        收支: sp.type || parent['收支'],
        金额: Number(sp.amount) || 0,
        分类: sp.category || parent['分类'],
        子分类: sp.subcategory || parent['子分类'],
        _splitOf: parentId,
        _splitIdx: splitIdx
      };
    }
    return list.find(r => r.id === parentId && r._splitOf == null);
  }).filter(Boolean);
}

export function computeLinkStats(rows) {
  let exp = 0;
  let inc = 0;
  (rows || []).forEach(r => {
    const amt = Number(r['金额']) || 0;
    if (r['收支'] === '收入') inc += amt;
    else exp += amt;
  });
  const net = inc - exp;
  return { exp, inc, net, balanced: Math.abs(net) < 0.01 };
}

export function linkBalanceMeta(stats) {
  if (!stats) return { label: '—', cls: 'flat' };
  if (stats.balanced) return { label: '已平衡', cls: 'ok' };
  if (stats.net < 0) return { label: '亏损', cls: 'loss' };
  return { label: '盈利', cls: 'profit' };
}

export function rowInLink(row, link) {
  if (!row || !link) return false;
  return link.keys.includes(rowLinkKey(row));
}

function linkHasOverlap(keys) {
  const set = new Set(keys.map(String));
  return links.some(l => l.keys.some(k => set.has(k)));
}

export function validateTxnPair(rowA, rowB, keyA, keyB) {
  if (!rowA || !rowB) return '记录不存在';
  if (keyA === keyB) return '不能关联同一条记录';
  if (findLinkForKey(keyA) || findLinkForKey(keyB)) return '选中账目已有关联关系';
  if (rowA['收支'] === rowB['收支']) return '需选择一笔支出与一笔收入';
  const amtA = Number(rowA['金额']) || 0;
  const amtB = Number(rowB['金额']) || 0;
  if (Math.abs(amtA - amtB) > 0.009) return '两段金额需相等';
  return null;
}

export function validateTxnLink(keys, rows) {
  const norm = uniqKeys(keys);
  if (norm.length < 2) return '请至少选择 2 笔账目';
  if (rows.length !== norm.length) return '部分记录不存在';
  if (linkHasOverlap(norm)) return '选中账目已有关联关系，请先取消原关联';
  return null;
}

export function addTxnLink(name, keys) {
  const norm = uniqKeys(keys);
  if (norm.length < 2) throw new Error('至少需要 2 条记录');
  const err = linkHasOverlap(norm) ? '选中账目已有关联关系' : null;
  if (err) throw new Error(err);
  const id = `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  links.push({
    id,
    name: String(name || '').trim() || '关联账目',
    keys: norm
  });
  return id;
}

export function appendTxnLinkKeys(id, keys) {
  const link = links.find(l => l.id === id);
  if (!link) throw new Error('事件不存在');
  const add = uniqKeys(keys).filter(k => !link.keys.includes(k));
  if (!add.length) return 0;
  const others = links.filter(l => l.id !== id);
  for (const k of add) {
    if (others.some(l => l.keys.includes(k))) throw new Error('该账目已属于其他事件');
  }
  link.keys = [...link.keys, ...add];
  return add.length;
}

export function addTxnPair(keyA, keyB) {
  addTxnLink('已完成配对', [keyA, keyB]);
}

export function removeTxnLinkById(id) {
  links = links.filter(l => l.id !== id);
}

export function removeTxnLinkByKey(key) {
  const k = String(key);
  links = links.filter(l => !l.keys.includes(k));
}

export function removeTxnPairByKey(key) {
  removeTxnLinkByKey(key);
}

export function removeTxnPair(keyA, keyB) {
  const a = String(keyA);
  const b = String(keyB);
  links = links.filter(l => {
    const set = new Set(l.keys);
    return !(set.has(a) && set.has(b) && l.keys.length === 2);
  });
}

export function suggestTxnLinkName(rows) {
  const sorted = [...rows].sort((a, b) =>
    (a['日期'] + a['时间']).localeCompare(b['日期'] + b['时间']));
  const first = sorted[0];
  if (!first) return '关联账目';
  const peer = (first['子分类'] || first['交易对方'] || '').trim();
  const m = String(first['日期'] || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dateLabel = m ? `${m[1]}.${Number(m[2])}.${Number(m[3])}` : first['日期'];
  return peer ? `${dateLabel}${peer}借款` : `${dateLabel}关联`;
}
