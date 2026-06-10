const STORAGE_KEY = 'ledger_sb_collapsed';

function updateToggleBtn(btn, collapsed) {
  btn.innerHTML = collapsed
    ? '<i class="ti ti-chevrons-right"></i>'
    : '<i class="ti ti-chevrons-left"></i>';
  btn.title = collapsed ? '展开侧栏' : '折叠侧栏';
}

export function setupSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sbToggle');
  if (!sb || !btn) return;

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
