const STORAGE_KEY = 'ledger_sb_collapsed';
const MOBILE_MQ = '(max-width:768px)';

function isMobileNav() {
  return window.matchMedia(MOBILE_MQ).matches;
}

function updateToggleBtn(btn, collapsed) {
  if (!btn) return;
  btn.innerHTML = collapsed
    ? '<i class="ti ti-chevrons-right"></i>'
    : '<i class="ti ti-chevrons-left"></i>';
  btn.title = collapsed ? '展开菜单' : '折叠菜单';
}

export function closeMobileSidebar() {
  document.documentElement.classList.remove('sb-open');
  document.getElementById('sbMenuBtn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('sbBackdrop')?.setAttribute('aria-hidden', 'true');
}

export function openMobileSidebar() {
  document.documentElement.classList.add('sb-open');
  document.getElementById('sbMenuBtn')?.setAttribute('aria-expanded', 'true');
  document.getElementById('sbBackdrop')?.setAttribute('aria-hidden', 'false');
  // 当前若在带下拉的子页，抽屉里自动展开子项，避免入口被收起
  document.querySelectorAll('.nav-dd.is-active').forEach(g => setNavDdOpen(g, true));
}

export function toggleMobileSidebar() {
  if (document.documentElement.classList.contains('sb-open')) closeMobileSidebar();
  else openMobileSidebar();
}

/** Scroll active nav item into view in the horizontal top nav. */
function scrollActiveNavIntoView() {
  if (isMobileNav()) return;
  const nav = document.querySelector('.sb .nav');
  const on = nav?.querySelector('.nav-dd.is-active > .nav-dd-trigger, .ni.on');
  if (!nav || !on) return;
  const navRect = nav.getBoundingClientRect();
  const onRect = on.getBoundingClientRect();
  if (onRect.left < navRect.left || onRect.right > navRect.right) {
    on.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }
}

function setNavDdOpen(group, open) {
  if (!group) return;
  group.classList.toggle('is-open', !!open);
  const trigger = group.querySelector('.nav-dd-trigger');
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeAllNavDd(except) {
  document.querySelectorAll('.nav-dd.is-open').forEach(g => {
    if (except && g === except) return;
    setNavDdOpen(g, false);
  });
}

function toggleNavDd(group) {
  if (!group) return;
  const next = !group.classList.contains('is-open');
  closeAllNavDd(next ? group : null);
  setNavDdOpen(group, next);
}

/** 下拉主项：点标签进主页；点箭头展开/收起子菜单（窄屏抽屉内同样）。 */
function onNavDdTriggerClick(ev, el, page) {
  const group = el?.closest?.('.nav-dd');
  const onChevron = !!(ev?.target?.closest?.('.nav-dd-chevron'));
  if (onChevron) {
    ev.preventDefault();
    ev.stopPropagation();
    toggleNavDd(group);
    return;
  }
  if (typeof window.sw === 'function') window.sw(page, el);
  else if (typeof sw === 'function') sw(page, el);
}

export function onTxnNavTriggerClick(ev, el) {
  onNavDdTriggerClick(ev, el, 'ledger');
}

export function onFamilyNavTriggerClick(ev, el) {
  onNavDdTriggerClick(ev, el, 'family');
}

function syncTxnNavActiveFromPage() {
  let name = '';
  try { name = sessionStorage.getItem('ledger_page') || ''; } catch { /* ignore */ }
  if (!name) {
    name = document.querySelector('.view.on')?.id?.replace(/^view-/, '') || '';
  }
  document.querySelectorAll('.nav-dd[data-pages]').forEach(g => {
    const pages = (g.dataset.pages || '').split(',').map(s => s.trim()).filter(Boolean);
    const active = pages.includes(name);
    g.classList.toggle('is-active', active);
    const trigger = g.querySelector('.nav-dd-trigger');
    if (active) trigger?.classList.add('on');
    if (active && isMobileNav()) setNavDdOpen(g, true);
  });
}

export function setupSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sbToggle');
  const menuBtn = document.getElementById('sbMenuBtn');
  const backdrop = document.getElementById('sbBackdrop');
  if (!sb) return;

  // Collapse toggle is unused in top-nav layout but kept if markup reappears.
  if (btn) {
    const apply = collapsed => {
      sb.classList.toggle('collapsed', collapsed);
      updateToggleBtn(btn, collapsed);
    };
    apply(localStorage.getItem(STORAGE_KEY) === '1');
    btn.addEventListener('click', () => {
      const collapsed = !sb.classList.contains('collapsed');
      apply(collapsed);
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    });
  }

  menuBtn?.addEventListener('click', e => {
    e.stopPropagation();
    toggleMobileSidebar();
  });
  backdrop?.addEventListener('click', closeMobileSidebar);

  sb.addEventListener('click', e => {
    if (e.target.closest('.nav-dd-chevron')) return;
    const ddItem = e.target.closest('.nav-dd-item');
    const ddTrigger = e.target.closest('.nav-dd-trigger');
    if (!isMobileNav()) {
      if (ddItem) closeAllNavDd();
      return;
    }
    // 窄屏：点箭头只展开，不关抽屉；点子项/其它一级项再关
    if (e.target.closest('.nav-dd-chevron')) return;
    if (ddTrigger && !e.target.closest('.nav-dd-chevron')) {
      // trigger 会走 sw→closeMobileSidebar
      return;
    }
    if (e.target.closest('.ni')) closeMobileSidebar();
  });

  document.addEventListener('click', e => {
    if (e.target.closest('.nav-dd')) return;
    closeAllNavDd();
  });

  // Keep active item visible when switching pages on desktop top nav.
  sb.addEventListener('click', e => {
    if (isMobileNav()) return;
    if (e.target.closest('.ni')) {
      requestAnimationFrame(scrollActiveNavIntoView);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.nav-dd.is-open')) {
      closeAllNavDd();
      return;
    }
    if (document.documentElement.classList.contains('sb-open')) closeMobileSidebar();
  });

  window.matchMedia(MOBILE_MQ).addEventListener('change', ev => {
    if (!ev.matches) closeMobileSidebar();
  });

  window.toggleMobileSidebar = toggleMobileSidebar;
  window.closeMobileSidebar = closeMobileSidebar;
  window.scrollActiveNavIntoView = scrollActiveNavIntoView;
  window.onTxnNavTriggerClick = onTxnNavTriggerClick;
  window.onFamilyNavTriggerClick = onFamilyNavTriggerClick;
  window.toggleNavDd = toggleNavDd;
  window.closeAllNavDd = closeAllNavDd;
  syncTxnNavActiveFromPage();
}
