/** 统计数字：≥10000 时用「万」为单位 */
function toWan(abs, maxDecimals = 2) {
  const wan = abs / 10000;
  if (wan >= 100) return wan.toFixed(1);
  if (wan >= 10) return wan.toFixed(1);
  return String(parseFloat(wan.toFixed(maxDecimals)));
}

export function fmtCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const abs = Math.abs(num);
  if (abs >= 10000) return `${num < 0 ? '-' : ''}${toWan(abs)}万`;
  return String(num);
}

export function fmtMoney(n, { decimals = 2, integer = false } = {}) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}¥${toWan(abs)}万`;
  if (integer) return `${sign}¥${abs.toFixed(0)}`;
  return `${sign}¥${abs.toFixed(decimals)}`;
}

export function fmtMoneySigned(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const abs = Math.abs(num);
  if (abs >= 10000) {
    const prefix = num >= 0 ? '+' : '-';
    return `${prefix}¥${toWan(abs)}万`;
  }
  return `${num >= 0 ? '+' : ''}¥${abs.toFixed(2)}`;
}

/** Chart.js 坐标轴 */
export function fmtChartAxis(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return v;
  const abs = Math.abs(num);
  if (abs >= 10000) return `¥${toWan(abs)}万`;
  return `¥${num}`;
}

/** Chart.js tooltip 金额 */
export const chartMoneyTooltip = {
  callbacks: {
    label(ctx) {
      const val = ctx.parsed?.y ?? ctx.parsed ?? ctx.raw;
      const prefix = ctx.dataset?.label ? `${ctx.dataset.label}: ` : '';
      return prefix + fmtMoney(val);
    }
  }
};
