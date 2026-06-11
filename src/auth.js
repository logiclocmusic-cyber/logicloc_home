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
  if (pill) pill.textContent = name || '未登录';
  if (av) av.textContent = avatarLetter(name);
}

function networkLoginHint() {
  if (API_BASE) {
    return `无法连接后端（${API_BASE}）。请检查 Railway 是否在线，以及 Vercel 的 VITE_API_BASE、FRONTEND_URL 是否配置正确。`;
  }
  return '无法连接后端。请确认已运行 npm run dev，并通过 http://localhost:5173 访问。';
}

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      // 仅当会话仍是发起请求时的 token 才清除，避免与登录表单的竞态互相覆盖
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

export async function login(email, password) {
  let res;
  try {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  } catch {
    throw new Error(networkLoginHint());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '登录失败');
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
}

export function hideLoginScreen() {
  document.getElementById('loginScreen')?.classList.add('hide');
  document.querySelector('.app')?.classList.remove('locked');
}

let sessionBooted = false;

export function setupLoginForm(onSuccess) {
  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await login(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPassword').value
      );
      hideLoginScreen();
      sessionBooted = true;
      await onSuccess();
    } catch (err) {
      showLoginScreen();
      errEl.textContent = err.message || '登录失败，请重试';
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
  // 用户已在等待 fetchMe 期间通过表单完成登录并引导进应用，避免重复 init 把页面打回登录页
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
