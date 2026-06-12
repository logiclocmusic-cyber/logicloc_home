/** 分类检索：付款/返款配对，用于确认探店等项目已完成 */

let pairs = [];

function normKeys(keyA, keyB) {
  return [keyA, keyB].sort();
}

export function loadTxnPairs(state) {
  pairs = Array.isArray(state?.txnPairs)
    ? state.txnPairs
      .map(p => ({ keys: normKeys(p.keys?.[0] ?? '', p.keys?.[1] ?? '') }))
      .filter(p => p.keys[0] && p.keys[1] && p.keys[0] !== p.keys[1])
    : [];
}

export function getTxnPairs() {
  return pairs;
}

export function findPairForKey(key) {
  return pairs.find(p => p.keys.includes(key)) || null;
}

export function getPartnerKey(key) {
  const p = findPairForKey(key);
  if (!p) return null;
  return p.keys.find(k => k !== key) || null;
}

export function validateTxnPair(rowA, rowB, keyA, keyB) {
  if (!rowA || !rowB) return '记录不存在';
  if (keyA === keyB) return '不能关联同一条记录';
  if (findPairForKey(keyA) || findPairForKey(keyB)) return '选中账目已有配对关系';
  if (rowA['收支'] === rowB['收支']) return '需选择一笔支出与一笔收入';
  const amtA = Number(rowA['金额']) || 0;
  const amtB = Number(rowB['金额']) || 0;
  if (Math.abs(amtA - amtB) > 0.009) return '两段金额需相等';
  return null;
}

export function addTxnPair(keyA, keyB) {
  pairs.push({ keys: normKeys(keyA, keyB) });
}

export function removeTxnPairByKey(key) {
  pairs = pairs.filter(p => !p.keys.includes(key));
}

export function removeTxnPair(keyA, keyB) {
  const norm = normKeys(keyA, keyB).join('|');
  pairs = pairs.filter(p => p.keys.join('|') !== norm);
}
