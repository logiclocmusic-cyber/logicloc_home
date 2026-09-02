const THEME_KEY = 'ledger-theme';

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    next === 'light' ? '#eef0f7' : '#0b0b0f'
  );
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  }
  syncThemeToggle();
}

export function toggleTheme() {
  applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

export function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch { /* ignore */ }
  applyTheme(saved === 'light' ? 'light' : 'dark', { persist: false });
}

export function syncThemeToggle() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const light = getTheme() === 'light';
  btn.setAttribute('aria-pressed', light ? 'true' : 'false');
  btn.title = light ? '切换深色模式' : '切换浅色模式';
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = light
    ? '<i class="ti ti-moon"></i>'
    : '<i class="ti ti-sun"></i>';
}
