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

const CHART_THEME_DARK = {
  pieBorder: '#17171f',
  inc: '#34d399',
  exp: '#f472b6',
  grid: 'rgba(255,255,255,.05)',
  gridY: 'rgba(255,255,255,.07)',
  tick: 'rgba(242,242,247,.45)',
  tooltip: {
    backgroundColor: '#1e1e28',
    titleColor: '#f2f2f7',
    bodyColor: '#a8a8b8',
    borderColor: 'rgba(91,140,255,.28)',
    borderWidth: 1,
    padding: 10
  }
};

const CHART_THEME_LIGHT = {
  pieBorder: '#ffffff',
  inc: '#059669',
  exp: '#db2777',
  grid: 'rgba(28,29,40,.06)',
  gridY: 'rgba(28,29,40,.08)',
  tick: 'rgba(28,29,40,.45)',
  tooltip: {
    backgroundColor: '#ffffff',
    titleColor: '#1a1b27',
    bodyColor: '#5a5d72',
    borderColor: 'rgba(61,110,245,.28)',
    borderWidth: 1,
    padding: 10
  }
};

/** Chart.js 仪表盘主题（随浅色/深色切换更新） */
export const CHART_THEME = { ...CHART_THEME_DARK, tooltip: { ...CHART_THEME_DARK.tooltip } };

export function applyChartTheme() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const next = light ? CHART_THEME_LIGHT : CHART_THEME_DARK;
  CHART_THEME.pieBorder = next.pieBorder;
  CHART_THEME.inc = next.inc;
  CHART_THEME.exp = next.exp;
  CHART_THEME.grid = next.grid;
  CHART_THEME.gridY = next.gridY;
  CHART_THEME.tick = next.tick;
  Object.assign(CHART_THEME.tooltip, next.tooltip);
  Object.assign(chartMoneyTooltip, next.tooltip);
  chartDarkScalesY.grid.color = CHART_THEME.gridY;
  chartDarkScalesY.ticks.color = CHART_THEME.tick;
  chartDarkScalesXY.x.grid.color = CHART_THEME.grid;
  chartDarkScalesXY.x.ticks.color = CHART_THEME.tick;
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = CHART_THEME.tick;
    Chart.defaults.borderColor = CHART_THEME.grid;
  }
}

export const chartDarkScalesY = {
  grid: { color: CHART_THEME.gridY },
  ticks: { color: CHART_THEME.tick, callback: fmtChartAxis }
};

export const chartDarkScalesXY = {
  x: { grid: { color: CHART_THEME.grid }, ticks: { color: CHART_THEME.tick } },
  y: chartDarkScalesY
};

/** Chart.js tooltip 金额 */
export const chartMoneyTooltip = {
  ...CHART_THEME.tooltip,
  callbacks: {
    label(ctx) {
      const val = ctx.parsed?.y ?? ctx.parsed ?? ctx.raw;
      const prefix = ctx.dataset?.label ? `${ctx.dataset.label}: ` : '';
      return prefix + fmtMoney(val);
    }
  }
};
