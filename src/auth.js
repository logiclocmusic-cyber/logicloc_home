import { API, API_BASE } from './apiBase.js';

const TOKEN_KEY = 'ledger_session_token';

let currentUser = null;

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getCurrentUser() {
  return currentUser;
}

export function setCurrentUser(user) {
  currentUser = user;
  updateUserUI();
}

function avatarLetter(name) {
  if (!name) return '?';
  const t = name.trim();
  return t[0]?.toUpperCase() || '?';
}

export function updateUserUI() {
  const name = currentUser?.username || '';
  const pill = document.getElementById('userDisplayName');
  const av = document.getElementById('userAvatar');
  if (pill) pill.textContent = name || '本地账本';
  if (av) {
    const img = av.querySelector('img');
    if (img) {
      img.alt = name || '用户头像';
    } else {
      av.textContent = avatarLetter(name);
    }
  }
}

function networkLoginHint() {
  if (API_BASE) {
    return `无法连接后端（${API_BASE}）。请确认服务是否在线。`;
  }
  return '无法连接后端。请确认应用已启动，或通过 npm run dev 在本地运行。';
}

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401 && getToken() === token) {
        setToken(null);
        currentUser = null;
      }
      return null;
    }
    const { user } = await res.json();
    if (getToken() !== token) return currentUser;
    currentUser = user;
    return user;
  } catch {
    return null;
  }
}

export async function loginWithPin(pin) {
  let res;
  try {
    res = await fetch(`${API}/auth/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
  } catch {
    throw new Error(networkLoginHint());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '密码错误');
  setToken(data.token);
  currentUser = data.user;
  updateUserUI();
  return data.user;
}

export async function logout() {
  const token = getToken();
  if (token) {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
  setToken(null);
  currentUser = null;
  showLoginScreen();
}

export function showLoginScreen() {
  document.getElementById('loginScreen')?.classList.remove('hide');
  document.querySelector('.app')?.classList.add('locked');
  resetPinInput();
  loadMobileAccessHint();
  requestAnimationFrame(() => focusPinInput());
}

export function hideLoginScreen() {
  document.getElementById('loginScreen')?.classList.add('hide');
  document.querySelector('.app')?.classList.remove('locked');
}

let sessionBooted = false;

function getPinInput() {
  return document.getElementById('loginPin');
}

function updatePinDots(len) {
  document.querySelectorAll('#pinDots span').forEach((dot, i) => {
    dot.classList.toggle('filled', i < len);
  });
}

function resetPinInput() {
  const inp = getPinInput();
  if (inp) inp.value = '';
  updatePinDots(0);
}

function pinScreenVisible() {
  return !document.getElementById('loginScreen')?.classList.contains('hide');
}

function focusPinInput() {
  const inp = getPinInput();
  if (inp && pinScreenVisible()) inp.focus({ preventScroll: true });
}

function handlePinKeydown(e) {
  if (!pinScreenVisible()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const errEl = document.getElementById('loginError');
  if (/^\d$/.test(e.key)) {
    e.preventDefault();
    if (errEl) errEl.textContent = '';
    appendPinDigit(e.key);
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (errEl) errEl.textContent = '';
    backspacePin();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Escape') {
    e.preventDefault();
    if (errEl) errEl.textContent = '';
    resetPinInput();
    return;
  }
  if (e.key === 'Enter') {
    const pin = getPinInput()?.value || '';
    if (pin.length === 4) {
      e.preventDefault();
      document.getElementById('loginForm')?.requestSubmit();
    }
  }
}

function appendPinDigit(digit) {
  const inp = getPinInput();
  if (!inp || inp.value.length >= 4) return;
  inp.value += digit;
  updatePinDots(inp.value.length);
  if (inp.value.length === 4) {
    document.getElementById('loginForm')?.requestSubmit();
  }
}

function backspacePin() {
  const inp = getPinInput();
  if (!inp || !inp.value.length) return;
  inp.value = inp.value.slice(0, -1);
  updatePinDots(inp.value.length);
}

async function loadMobileAccessHint() {
  const el = document.getElementById('loginMobileHint');
  if (!el) return;
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) return;
    const data = await res.json();
    const urls = (data.mobileUrls || []).filter(Boolean);
    if (!urls.length) {
      el.textContent = '';
      return;
    }
    const primary = urls[0];
    el.innerHTML = `手机访问（同一 WiFi）：<a href="${primary}" target="_blank" rel="noopener">${primary}</a>`;
  } catch {
    el.textContent = '';
  }
}

export function setupLoginForm(onSuccess) {
  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const pad = document.getElementById('pinPad');

  pad?.addEventListener('click', e => {
    const keyBtn = e.target.closest('.pin-key');
    if (!keyBtn) return;
    e.preventDefault();
    errEl.textContent = '';
    const key = keyBtn.dataset.key;
    if (key === 'clear') resetPinInput();
    else if (key === 'back') backspacePin();
    else if (/^\d$/.test(key)) appendPinDigit(key);
    focusPinInput();
  });

  document.getElementById('pinDots')?.addEventListener('click', () => focusPinInput());
  document.addEventListener('keydown', handlePinKeydown);

  getPinInput()?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    updatePinDots(e.target.value.length);
    errEl.textContent = '';
    if (e.target.value.length === 4) {
      document.getElementById('loginForm')?.requestSubmit();
    }
  });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    const pin = getPinInput()?.value || '';
    if (pin.length !== 4) {
      errEl.textContent = '请输入 4 位密码';
      return;
    }
    btn.disabled = true;
    try {
      await loginWithPin(pin);
      hideLoginScreen();
      sessionBooted = true;
      await onSuccess();
    } catch (err) {
      showLoginScreen();
      errEl.textContent = err.message || '密码错误，请重试';
      resetPinInput();
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    sessionBooted = false;
    logout();
  });
}

export async function ensureAuth(onAuthed) {
  setupLoginForm(onAuthed);
  const user = await fetchMe();
  if (sessionBooted) return;

  const authed = user || currentUser || getToken();
  if (authed) {
    updateUserUI();
    hideLoginScreen();
    try {
      sessionBooted = true;
      await onAuthed();
    } catch (err) {
      sessionBooted = false;
      console.error(err);
      showLoginScreen();
      const errEl = document.getElementById('loginError');
      if (errEl) errEl.textContent = err.message || '加载应用失败，请重新登录';
    }
  } else {
    showLoginScreen();
  }
}
