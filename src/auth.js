import { API } from './apiBase.js';

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

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    setToken(null);
    currentUser = null;
    return null;
  }
  const { user } = await res.json();
  currentUser = user;
  return user;
}

export async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
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
      await onSuccess();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => logout());
}

export async function ensureAuth(onAuthed) {
  setupLoginForm(onAuthed);
  const user = await fetchMe();
  if (user) {
    updateUserUI();
    hideLoginScreen();
    await onAuthed();
  } else {
    showLoginScreen();
  }
}
