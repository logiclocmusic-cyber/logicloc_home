let tags = [];
let groups = [];
let popRowId = null;
let hooks = {
  getRow: () => null,
  getRows: () => [],
  onChange: () => {},
  onFilter: () => {}
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeTag(raw) {
  const id = String(raw?.id || '').replace(/[^\w-]/g, '').slice(0, 40);
  const name = String(raw?.name || '').trim().slice(0, 40);
  if (!id || !name) return null;
  const usedAt = Number(raw?.usedAt);
  return {
    id,
    name,
    usedAt: Number.isFinite(usedAt) && usedAt > 0 ? usedAt : 0,
    hidden: raw?.hidden === true,
  };
}

export function loadEventTags(state) {
  const list = Array.isArray(state?.eventTags) ? state.eventTags : [];
  const seen = new Set();
  tags = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push(tag);
  }
}

export function getEventTags() {
  return tags.map(tag => {
    const item = { id: tag.id, name: tag.name };
    if (tag.usedAt) item.usedAt = tag.usedAt;
    if (tag.hidden) item.hidden = true;
    return item;
  });
}

function normalizeGroup(raw) {
  const id = String(raw?.id || '').replace(/[^\w-]/g, '').slice(0, 40);
  const name = String(raw?.name || '').trim().slice(0, 40);
  if (!id || !name) return null;
  const known = new Set(tags.map(tag => tag.id));
  const tagIds = [];
  for (const item of Array.isArray(raw.tagIds) ? raw.tagIds : []) {
    const tagId = String(item || '');
    if (!known.has(tagId) || tagIds.includes(tagId)) continue;
    tagIds.push(tagId);
  }
  return { id, name, tagIds };
}

export function loadEventTagGroups(state) {
  const list = Array.isArray(state?.eventTagGroups) ? state.eventTagGroups : [];
  const seen = new Set();
  const used = new Set();
  groups = [];
  for (const raw of list) {
    const group = normalizeGroup(raw);
    if (!group || seen.has(group.id) || seen.has(group.name)) continue;
    group.tagIds = group.tagIds.filter(id => {
      if (used.has(id)) return false;
      used.add(id);
      return true;
    });
    seen.add(group.id);
    seen.add(group.name);
    groups.push(group);
  }
}

export function getEventTagGroups() {
  return groups.map(group => ({ id: group.id, name: group.name, tagIds: [...group.tagIds] }));
}

/** 保存冲突后合并本机标签；名称以服务端为准，本机的隐藏状态和最新使用时间继续保留。 */
export function unionEventTags(incoming) {
  let changed = false;
  for (const raw of incoming || []) {
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const existing = tags.find(item => item.id === tag.id);
    if (existing) {
      if (existing.hidden !== tag.hidden) {
        existing.hidden = tag.hidden;
        changed = true;
      }
      if (tag.usedAt > existing.usedAt) {
        existing.usedAt = tag.usedAt;
        changed = true;
      }
      continue;
    }
    if (tags.some(item => item.name === tag.name)) continue;
    tags.push(tag);
    changed = true;
  }
  return changed;
}

/** 按 id 或名称合并分组，组内标签取并集，避免后保存的设备把分组清空。 */
export function unionEventTagGroups(incoming) {
  let changed = false;
  for (const raw of incoming || []) {
    const group = normalizeGroup(raw);
    if (!group) continue;
    const target = groups.find(item => item.id === group.id) || groups.find(item => item.name === group.name);
    if (!target) {
      groups.push(group);
      changed = true;
      continue;
    }
    const before = target.tagIds.join('\0');
    for (const id of group.tagIds) {
      if (target.tagIds.includes(id)) continue;
      if (groups.some(item => item !== target && item.tagIds.includes(id))) continue;
      target.tagIds.push(id);
    }
    if (target.tagIds.join('\0') !== before) changed = true;
  }
  return changed;
}

export function createEventTagGroup(name) {
  const next = String(name || '').trim().slice(0, 40);
  if (!next || groups.some(group => group.name === next)) return null;
  const group = {
    id: `grp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: next,
    tagIds: []
  };
  groups.push(group);
  return { id: group.id, name: group.name, tagIds: [] };
}

export function renameEventTagGroup(id, name) {
  const group = groups.find(item => item.id === id);
  if (!group) return false;
  const next = String(name || '').trim().slice(0, 40);
  if (!next) return false;
  if (groups.some(item => item.id !== id && item.name === next)) return false;
  group.name = next;
  return true;
}

export function deleteEventTagGroup(id) {
  if (!groups.some(group => group.id === id)) return false;
  groups = groups.filter(group => group.id !== id);
  return true;
}

export function moveEventTagToGroup(tagId, groupId, beforeTagId = null) {
  if (!eventTagById(tagId)) return false;
  const target = groupId ? groups.find(group => group.id === groupId) : null;
  if (groupId && !target) return false;
  const current = groups.find(group => group.tagIds.includes(tagId)) || null;
  if ((current?.id || '') === (target?.id || '')) {
    if (!target) return false;
    const without = target.tagIds.filter(id => id !== tagId);
    const at = beforeTagId ? without.indexOf(beforeTagId) : without.length;
    const insertAt = at < 0 ? without.length : at;
    if (target.tagIds.indexOf(tagId) === insertAt) return false;
    without.splice(insertAt, 0, tagId);
    target.tagIds = without;
    return true;
  }
  for (const group of groups) group.tagIds = group.tagIds.filter(id => id !== tagId);
  if (target) {
    const ids = target.tagIds.filter(id => id !== tagId);
    const at = beforeTagId ? ids.indexOf(beforeTagId) : -1;
    if (at >= 0) ids.splice(at, 0, tagId);
    else ids.push(tagId);
    target.tagIds = ids;
  }
  return true;
}

export function eventTagIds(row) {
  const known = new Set(tags.map(tag => tag.id));
  const raw = Array.isArray(row?.['事件标签']) ? row['事件标签'] : [];
  return [...new Set(raw.map(String))].filter(id => known.has(id));
}

export function eventTagById(id) {
  return tags.find(tag => tag.id === id) || null;
}

export function rowTagNames(row) {
  return eventTagIds(row).map(id => eventTagById(id)?.name || '').filter(Boolean);
}

export function createEventTag(name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return null;
  const existing = tags.find(tag => tag.name === n);
  if (existing) return existing;
  const tag = { id: `evt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n };
  tags.push(tag);
  return tag;
}

export function addRowTag(row, tagId) {
  if (!row || !eventTagById(tagId)) return;
  const ids = eventTagIds(row);
  if (ids.includes(tagId)) return;
  row['事件标签'] = [...ids, tagId];
  const tag = eventTagById(tagId);
  if (tag) tag.usedAt = Date.now();
}

export function removeRowTag(row, tagId) {
  if (!row) return;
  const ids = eventTagIds(row).filter(id => id !== tagId);
  if (ids.length) row['事件标签'] = ids;
  else delete row['事件标签'];
}

export function renameEventTag(id, name) {
  const tag = eventTagById(id);
  if (!tag) return false;
  const next = String(name || '').trim().slice(0, 40);
  if (!next) return false;
  if (tags.some(item => item.id !== id && item.name === next)) return false;
  tag.name = next;
  return true;
}

export function setEventTagHidden(id, hidden) {
  const tag = tags.find(item => item.id === id);
  if (!tag) return false;
  tag.hidden = hidden === true;
  return true;
}

export function deleteEventTag(id, rows) {
  if (!eventTagById(id)) return false;
  tags = tags.filter(tag => tag.id !== id);
  for (const group of groups) group.tagIds = group.tagIds.filter(tagId => tagId !== id);
  for (const row of rows || []) {
    if (Array.isArray(row?.['事件标签'])) removeRowTag(row, id);
  }
  return true;
}

export function eventTagTotals(rows) {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const row of rows || []) {
    count += 1;
    if (row['退款状态'] === 'refunded') continue;
    const amt = Math.abs(Number(row['金额']) || 0);
    if (row['收支'] === '收入') income += amt;
    else expense += amt;
  }
  return { income, expense, net: income - expense, count };
}

export function convertSubcategoryToEventTag(rows, cat, subName, replacement) {
  const tag = createEventTag(subName);
  if (!tag) return { tag: null, count: 0 };
  const repl = String(replacement || '').trim();
  let count = 0;
  for (const row of rows || []) {
    let hit = false;
    if (row['分类'] === cat && String(row['子分类'] || '') === subName) {
      row['子分类'] = repl;
      hit = true;
    }
    if (Array.isArray(row.splits)) {
      for (const sp of row.splits) {
        if (sp.category === cat && String(sp.subcategory || '') === subName) {
          sp.subcategory = repl;
          hit = true;
        }
      }
    }
    if (!hit) continue;
    addRowTag(row, tag.id);
    count += 1;
  }
  return { tag, count };
}

export function eventTagRowHtml(row) {
  if (!row || row.id == null) return '';
  const pills = eventTagIds(row).map(id => {
    const name = eventTagById(id)?.name || '';
    if (!name) return '';
    return `<span class="event-tag-pill">
      <button type="button" class="event-tag-pill-name" data-event-tag-filter="${esc(id)}" title="查看这个事件的收支">${esc(name)}</button>
      <button type="button" class="event-tag-pill-x" data-event-tag-remove="${esc(id)}" data-txn-id="${esc(row.id)}" title="从这笔账目去掉" aria-label="去掉标签">×</button>
    </span>`;
  }).join('');
  return `<div class="event-tag-row">${pills}<button type="button" class="event-tag-add" data-event-tag-add="${esc(row.id)}" title="添加事件标签" aria-label="添加事件标签"><i class="ti ti-plus"></i></button></div>`;
}

function ensurePop() {
  let pop = document.getElementById('eventTagPop');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'eventTagPop';
  pop.className = 'event-tag-pop hide';
  pop.innerHTML = `
    <input type="text" class="event-tag-pop-inp" placeholder="搜索或新建事件标签" maxlength="40" aria-label="事件标签">
    <div class="event-tag-pop-list"></div>`;
  document.body.appendChild(pop);
  const inp = pop.querySelector('input');
  inp.addEventListener('input', () => renderPopList());
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePop();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = inp.value.trim();
    if (!name || popRowId == null) return;
    const tag = createEventTag(name);
    if (!tag) return;
    const row = hooks.getRow(popRowId);
    addRowTag(row, tag.id);
    inp.value = '';
    hooks.onChange();
    reopenPop(popRowId);
  });
  return pop;
}

function tagRecencyMap() {
  const score = new Map(tags.map(tag => [tag.id, Number(tag.usedAt) || 0]));
  for (const row of hooks.getRows() || []) {
    const raw = row?.['事件标签'];
    if (!Array.isArray(raw) || !raw.length) continue;
    const time = String(row['时间'] || '00:00').trim();
    const clock = time.length === 5 ? `${time}:00` : time;
    const stamp = Date.parse(`${row['日期']}T${clock}`);
    if (!Number.isFinite(stamp)) continue;
    for (const id of raw) {
      const key = String(id);
      if (stamp > (score.get(key) || 0)) score.set(key, stamp);
    }
  }
  return score;
}

function renderPopList() {
  const pop = document.getElementById('eventTagPop');
  const list = pop?.querySelector('.event-tag-pop-list');
  if (!list) return;
  const q = pop.querySelector('input')?.value.trim().toLowerCase() || '';
  const row = hooks.getRow(popRowId);
  const on = new Set(eventTagIds(row));
  const order = new Map(tags.map((tag, index) => [tag.id, index]));
  const recent = tagRecencyMap();
  const shown = tags
    .filter(tag => !q || tag.name.toLowerCase().includes(q))
    .sort((a, b) => (recent.get(b.id) || 0) - (recent.get(a.id) || 0) || order.get(a.id) - order.get(b.id));
  if (!shown.length) {
    list.innerHTML = `<p class="event-tag-pop-empty">${q ? '回车即可新建这个标签' : '还没有事件标签，输入名称后回车新建'}</p>`;
    return;
  }
  list.innerHTML = shown.map(tag => `<div class="event-tag-pop-item${on.has(tag.id) ? ' on' : ''}">
    <button type="button" class="event-tag-pop-pick" data-event-tag-pick="${esc(tag.id)}">${esc(tag.name)}</button>
    <button type="button" class="event-tag-pop-del" data-event-tag-del="${esc(tag.id)}" title="删除标签" aria-label="删除标签">×</button>
  </div>`).join('');
}

function positionPop(anchor) {
  const pop = ensurePop();
  pop.classList.remove('hide');
  const rect = anchor.getBoundingClientRect();
  const width = 260;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  if (left < 8) left = 8;
  pop.style.width = `${width}px`;
  pop.style.left = `${left}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  const height = pop.offsetHeight;
  if (rect.bottom + 6 + height > window.innerHeight - 8) {
    pop.style.top = `${Math.max(8, rect.top - height - 6)}px`;
  }
}

function closePop() {
  popRowId = null;
  document.getElementById('eventTagPop')?.classList.add('hide');
}

function openPop(anchor) {
  const id = anchor.getAttribute('data-event-tag-add');
  if (popRowId != null && String(popRowId) === String(id) && !document.getElementById('eventTagPop')?.classList.contains('hide')) {
    closePop();
    return;
  }
  popRowId = id;
  const pop = ensurePop();
  const inp = pop.querySelector('input');
  if (inp) inp.value = '';
  renderPopList();
  positionPop(anchor);
  inp?.focus();
}

function reopenPop(rowId) {
  const btn = document.querySelector(`[data-event-tag-add="${CSS.escape(String(rowId))}"]`);
  if (!btn) {
    closePop();
    return;
  }
  popRowId = rowId;
  renderPopList();
  positionPop(btn);
}

function bindOnce() {
  if (document.body.dataset.eventTagsBound) return;
  document.body.dataset.eventTagsBound = '1';
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-event-tag-add]');
    if (add) {
      e.preventDefault();
      e.stopPropagation();
      openPop(add);
      return;
    }
    const filter = e.target.closest('[data-event-tag-filter]');
    if (filter) {
      e.preventDefault();
      e.stopPropagation();
      closePop();
      hooks.onFilter(filter.getAttribute('data-event-tag-filter'));
      return;
    }
    const remove = e.target.closest('[data-event-tag-remove]');
    if (remove) {
      e.preventDefault();
      e.stopPropagation();
      const row = hooks.getRow(remove.getAttribute('data-txn-id'));
      removeRowTag(row, remove.getAttribute('data-event-tag-remove'));
      hooks.onChange();
      return;
    }
    const pick = e.target.closest('[data-event-tag-pick]');
    if (pick) {
      e.preventDefault();
      e.stopPropagation();
      const row = hooks.getRow(popRowId);
      const id = pick.getAttribute('data-event-tag-pick');
      if (eventTagIds(row).includes(id)) removeRowTag(row, id);
      else addRowTag(row, id);
      const keep = popRowId;
      hooks.onChange();
      reopenPop(keep);
      return;
    }
    const del = e.target.closest('[data-event-tag-del]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      const id = del.getAttribute('data-event-tag-del');
      const tag = eventTagById(id);
      if (!tag) return;
      if (!window.confirm(`删除事件标签「${tag.name}」？已贴上的账目会去掉这个标签。`)) return;
      deleteEventTag(id, hooks.getRows());
      const keep = popRowId;
      hooks.onChange({ deletedId: id });
      if (keep != null) reopenPop(keep);
      return;
    }
    if (!e.target.closest('#eventTagPop')) closePop();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
  });
}

export function setupEventTags(nextHooks) {
  hooks = { ...hooks, ...nextHooks };
  bindOnce();
}
