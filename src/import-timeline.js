// ── 导入时间轴预览 ───────────────────────────────────────────────────────────
export const ImportTimeline = (() => {
  function parseMonth(s) {
    if (!s || s.length < 7) return null;
    const [y, m] = s.slice(0, 7).split('-').map(Number);
    return y * 12 + (m - 1);
  }

  function monthKey(idx) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    const [, m] = key.split('-');
    return `${parseInt(m, 10)}月`;
  }

  function yearMonthLabel(key) {
    const [y, m] = key.split('-');
    return `${y}年${parseInt(m, 10)}月`;
  }

  function monthRangeFromRecords(records) {
    let min = Infinity, max = -Infinity;
    records.forEach(r => {
      const idx = parseMonth(r['日期']);
      if (idx === null) return;
      min = Math.min(min, idx);
      max = Math.max(max, idx);
    });
    if (!isFinite(min)) return { months: [], start: '', end: '' };
    const months = [];
    for (let i = min; i <= max; i++) months.push(monthKey(i));
    return { months, start: monthKey(min) + '-01', end: monthKey(max) + '-28' };
  }

  function coverageBySource(records) {
    const map = {};
    records.forEach(r => {
      if (!r['日期'] || !r['来源']) return;
      const src = r['来源'];
      const month = r['日期'].slice(0, 7);
      if (!map[src]) map[src] = {};
      if (!map[src][month]) map[src][month] = 0;
      map[src][month]++;
    });
    return map;
  }

  function countBySourceMonth(records) {
    const map = {};
    records.forEach(r => {
      if (!r['日期'] || !r['来源']) return;
      const key = r['来源'] + '|' + r['日期'].slice(0, 7);
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }

  function mergeMonthSpan(existingMonths, pendingMonths) {
    const set = new Set([...existingMonths, ...pendingMonths]);
    if (!set.size) {
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return [cur];
    }
    const indices = [...set].map(parseMonth).filter(v => v !== null);
    const min = Math.min(...indices);
    const max = Math.max(...indices);
    const months = [];
    for (let i = min; i <= max; i++) months.push(monthKey(i));
    return months;
  }

  function groupMonthsByYear(months) {
    const groups = [];
    let cur = null;
    months.forEach(m => {
      const y = m.slice(0, 4);
      if (!cur || cur.year !== y) {
        cur = { year: y, months: [] };
        groups.push(cur);
      }
      cur.months.push(m);
    });
    return groups;
  }

  function detectGaps(months, coveredSet) {
    if (months.length < 2) return [];
    const gaps = [];
    for (let i = 1; i < months.length; i++) {
      const prev = parseMonth(months[i - 1]);
      const curr = parseMonth(months[i]);
      if (curr - prev > 1) {
        const missing = [];
        for (let j = prev + 1; j < curr; j++) {
          const mk = monthKey(j);
          if (!coveredSet.has(mk)) missing.push(mk);
        }
        if (missing.length) gaps.push({ after: months[i - 1], before: months[i], missing });
      }
    }
    return gaps;
  }

  function cellState(existingCount, pendingNew, pendingDup) {
    if (pendingNew > 0 && existingCount > 0) return 'overlap';
    if (pendingNew > 0) return 'new';
    if (existingCount > 0) return 'existing';
    if (pendingDup > 0) return 'overlap';
    return 'gap';
  }

  function render(options) {
    const {
      containerId,
      existingData = [],
      pendingRecords = [],
      pendingAllRecords = [],
      pendingNewRecords = [],
      activeSource = '',
      fileName = ''
    } = options;

    const el = document.getElementById(containerId);
    if (!el) return;

    const existingCov = coverageBySource(existingData);
    const pendingAll = pendingAllRecords.length ? pendingAllRecords : pendingRecords;
    const pendingNew = pendingNewRecords.length ? pendingNewRecords : pendingRecords;

    const pendingAllCov = coverageBySource(pendingAll);
    const pendingNewCov = coverageBySource(pendingNew);

    const existingMonths = Object.values(existingCov).flatMap(obj => Object.keys(obj));
    const pendingMonths = Object.values(pendingAllCov).flatMap(obj => Object.keys(obj));
    const timelineMonths = mergeMonthSpan(existingMonths, pendingMonths);

    const allSources = [...new Set([
      ...Object.keys(existingCov),
      ...Object.keys(pendingAllCov),
      activeSource
    ].filter(Boolean))];

    if (!allSources.length && activeSource) allSources.push(activeSource);
    allSources.sort((a, b) => {
      if (a === activeSource) return -1;
      if (b === activeSource) return 1;
      return a.localeCompare(b, 'zh-CN');
    });

    const fileRange = monthRangeFromRecords(pendingAll);
    const newRange = monthRangeFromRecords(pendingNew);
    const activeExisting = existingCov[activeSource] || {};
    const activePendingAll = pendingAllCov[activeSource] || {};
    const activePendingNew = pendingNewCov[activeSource] || {};

    const coveredForGaps = new Set([
      ...Object.keys(activeExisting),
      ...Object.keys(activePendingNew)
    ]);
    const gaps = detectGaps(
      timelineMonths.filter(m => m >= (fileRange.months[0] || '') && m <= (fileRange.months[fileRange.months.length - 1] || '')),
      coveredForGaps
    );

    const yearGroups = groupMonthsByYear(timelineMonths);
    const colCount = timelineMonths.length;

    let gridHtml = `<div class="tl-grid" style="grid-template-columns:minmax(88px,128px) repeat(${colCount}, minmax(28px, 1fr));grid-template-rows:auto auto repeat(${allSources.length}, 22px)">`;

    gridHtml += `<div class="tl-corner">来源</div>`;

    let colStart = 2;
    yearGroups.forEach(g => {
      gridHtml += `<div class="tl-year-h" style="grid-row:1;grid-column:${colStart} / span ${g.months.length}">${g.year}年</div>`;
      colStart += g.months.length;
    });

    timelineMonths.forEach((m, i) => {
      gridHtml += `<div class="tl-month-h" style="grid-row:2;grid-column:${i + 2}" title="${yearMonthLabel(m)}">${monthLabel(m)}</div>`;
    });

    let rowNum = 3;
    allSources.forEach(src => {
      const isActive = src === activeSource;
      const color = typeof srcColor === 'function' ? srcColor(src) : '#98a2b3';
      gridHtml += `<div class="tl-src" style="grid-row:${rowNum};grid-column:1" title="${src}"><span class="tl-src-dot" style="background:${color}"></span>${src}${isActive ? ' ◀' : ''}</div>`;

      timelineMonths.forEach((month, i) => {
        const exCnt = (existingCov[src] && existingCov[src][month]) || 0;
        const pAll = (pendingAllCov[src] && pendingAllCov[src][month]) || 0;
        const pNew = (pendingNewCov[src] && pendingNewCov[src][month]) || 0;
        const pDup = Math.max(0, pAll - pNew);
        const state = isActive ? cellState(exCnt, pNew, pDup) : (exCnt > 0 ? 'existing' : 'gap');
        const title = isActive
          ? `${yearMonthLabel(month)}\n已有 ${exCnt} 笔 · 本次新增 ${pNew} 笔 · 重复 ${pDup} 笔`
          : exCnt > 0 ? `${yearMonthLabel(month)} · 已有 ${exCnt} 笔` : `${yearMonthLabel(month)} · 无数据`;
        gridHtml += `<div class="tl-cell ${state}${isActive ? ' pending-row' : ''}" style="grid-row:${rowNum};grid-column:${i + 2}" title="${title}"></div>`;
      });
      rowNum++;
    });

    gridHtml += `</div>`;

    const gapText = gaps.length
      ? `检测到 ${gaps.length} 处月份空档：${gaps.map(g => g.missing.map(m => yearMonthLabel(m)).join('、')).join('；')}`
      : '';

    const summaryHtml = pendingAll.length ? `
      <div class="tl-summary">
        <div class="import-stat"><div class="n">${pendingAll.length}</div><div class="l">文件解析</div></div>
        <div class="import-stat"><div class="n">${pendingNew.length}</div><div class="l">将新增</div></div>
        <div class="import-stat"><div class="n">${fileRange.months.length}</div><div class="l">覆盖月份</div></div>
        <div class="import-stat"><div class="n">${Object.keys(activeExisting).length}</div><div class="l">已有月份</div></div>
      </div>` : '';

    el.innerHTML = `
      <div class="tl-head">
        <div>
          <h3><i class="ti ti-timeline" style="color:var(--blu-t);margin-right:6px"></i>账本覆盖时间轴</h3>
          ${pendingAll.length ? `<div class="tl-range">
            本次文件${fileName ? ` <strong>${fileName}</strong>` : ''}：
            <strong>${fileRange.start ? yearMonthLabel(fileRange.start.slice(0, 7)) : '—'}</strong> 至 <strong>${fileRange.end ? yearMonthLabel(fileRange.end.slice(0, 7)) : '—'}</strong>
            · 来源 <strong>${activeSource || '—'}</strong>
            ${newRange.months.length ? ` · 可新增 <strong>${yearMonthLabel(newRange.months[0])}</strong>–<strong>${yearMonthLabel(newRange.months[newRange.months.length - 1])}</strong>` : ''}
          </div>` : `<div class="tl-range">上传 CSV 后，将在此展示该账单覆盖的月份，以及与已导入账本的对比。</div>`}
        </div>
      </div>
      <div class="tl-legend">
        <span class="tl-leg"><span class="tl-swatch" style="background:#dcfce7;border-color:#86efac"></span>已导入</span>
        <span class="tl-leg"><span class="tl-swatch" style="background:#dbeafe;border-color:#93c5fd"></span>本次新增</span>
        <span class="tl-leg"><span class="tl-swatch" style="background:repeating-linear-gradient(-45deg,#dcfce7,#dcfce7 3px,#fef9c3 3px,#fef9c3 6px)"></span>重叠/重复</span>
        <span class="tl-leg"><span class="tl-swatch" style="background:var(--surf2)"></span>空白</span>
      </div>
      ${summaryHtml}
      <div class="tl-gap-banner${gaps.length ? ' show' : ''}">${gapText || '本次文件月份连续，无空档。'}</div>
      <div class="tl-scroll">${gridHtml}</div>
      ${yearGroups.length ? `<div class="tl-footer">时间跨度：${yearMonthLabel(timelineMonths[0])} — ${yearMonthLabel(timelineMonths[timelineMonths.length - 1])}（${timelineMonths.length} 个月${yearGroups.length > 1 ? '，跨 ' + yearGroups.length + ' 年' : ''}）</div>` : ''}
    `;
  }

  function formatLabel(fmt) {
    return { wechat: '微信', alipay: '支付宝', bank: '银行', ccb: '建设银行', citic: '中信银行', cmb: '招商银行', manual: '手动' }[fmt] || fmt || '';
  }

  function renderHistoryItem(h) {
    const fname = h.fileName || '未命名文件';
    const fmt = formatLabel(h.format);
    const range = h.startMonth && h.endMonth
      ? `${yearMonthLabel(h.startMonth)} — ${yearMonthLabel(h.endMonth)}`
      : '—';
    const date = (h.importedAt || '').slice(0, 10) || '—';
    const color = typeof srcColor === 'function' ? srcColor(h.source) : '#98a2b3';
    const bid = encodeURIComponent(String(h.id));
    return `<div class="import-history-item">
      <span class="ih-date">${date}</span>
      <span class="tl-src-dot" style="background:${color};margin-top:4px"></span>
      <div class="ih-main">
        <div class="ih-file" title="${fname}">${fname}</div>
        <div class="ih-meta">${fmt ? fmt + ' · ' : ''}${range} · ${h.count || 0} 笔</div>
      </div>
      <button class="ih-edit" data-edit-batch="${bid}" title="修改来源"><i class="ti ti-edit"></i></button>
      <button class="ih-del" data-del-batch="${bid}" title="删除此文件及关联账目"><i class="ti ti-trash"></i></button>
    </div>`;
  }

  function sortSourceNames(names, sourceOrder = []) {
    const order = sourceOrder.length ? sourceOrder : names;
    return [...names].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
  }

  function renderHistory(containerId, history, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const limit = opts.limit || 50;
    const list = history.slice(0, limit);

    if (!list.length) {
      el.innerHTML = `<div class="import-history-empty">${opts.emptyText || '暂无导入记录<br><span style="font-size:11px">上传 CSV 并确认导入后，会在此显示文件名与时间范围</span>'}</div>`;
      return;
    }

    if (opts.groupBySource) {
      const groups = {};
      list.forEach(h => {
        const src = h.source || '未知来源';
        if (!groups[src]) groups[src] = [];
        groups[src].push(h);
      });

      sortSourceNames(Object.keys(groups), opts.sourceOrder).forEach(src => {
        const items = groups[src];
        items.sort((a, b) => (b.importedAt || b.endMonth || '').localeCompare(a.importedAt || a.endMonth || ''));
      });

      el.innerHTML = sortSourceNames(Object.keys(groups), opts.sourceOrder).map(src => {
        const items = groups[src];
        const totalCount = items.reduce((s, h) => s + (h.count || 0), 0);
        const color = typeof srcColor === 'function' ? srcColor(src) : '#98a2b3';
        return `<div class="ih-source-group">
          <div class="ih-source-head">
            <span class="tl-src-dot" style="background:${color}"></span>
            <span class="ih-source-name">${src}</span>
            <span class="ih-source-meta">${items.length} 个文件 · ${totalCount} 笔</span>
          </div>
          <div class="ih-source-list">${items.map(renderHistoryItem).join('')}</div>
        </div>`;
      }).join('');
      return;
    }

    el.innerHTML = list.map(h => {
      const fname = h.fileName || '未命名文件';
      const fmt = formatLabel(h.format);
      const range = h.startMonth && h.endMonth
        ? `${yearMonthLabel(h.startMonth)} — ${yearMonthLabel(h.endMonth)}`
        : '—';
      const date = (h.importedAt || '').slice(0, 10) || '—';
      const color = typeof srcColor === 'function' ? srcColor(h.source) : '#98a2b3';
      const bid = encodeURIComponent(String(h.id));
      return `<div class="import-history-item">
        <span class="ih-date">${date}</span>
        <span class="tl-src-dot" style="background:${color};margin-top:4px"></span>
        <div class="ih-main">
          <div class="ih-file" title="${fname}">${fname}</div>
          <div class="ih-meta">${h.source}${fmt ? ' · ' + fmt : ''} · ${range} · ${h.count || 0} 笔</div>
        </div>
        <button class="ih-edit" data-edit-batch="${bid}" title="修改来源"><i class="ti ti-edit"></i></button>
        <button class="ih-del" data-del-batch="${bid}" title="删除此文件及关联账目"><i class="ti ti-trash"></i></button>
      </div>`;
    }).join('');
  }

  function renderHistoryAll(history, sourceOrder = []) {
    const groupOpts = { groupBySource: true, sourceOrder };
    renderHistory('importHistoryMain', history, { ...groupOpts, limit: 100 });
    const cnt = document.getElementById('importHistoryCount');
    if (cnt) {
      const srcCount = new Set(history.map(h => h.source).filter(Boolean)).size;
      cnt.textContent = history.length
        ? `共 ${history.length} 个文件 · ${srcCount} 个来源`
        : '';
    }
  }

  return { render, renderHistory, renderHistoryAll, monthRangeFromRecords, coverageBySource, yearMonthLabel };
})();
