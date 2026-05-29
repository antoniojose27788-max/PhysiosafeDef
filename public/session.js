const SESSION_TOKEN_KEY = 'physiosafe_token';
const SESSION_USER_KEY = 'physiosafe_user';

const createStorageAdapter = () => {
  const memory = new Map();

  const canUseStorage = (storage) => {
    try {
      if (!storage) return false;
      const probeKey = '__physiosafe_probe__';
      storage.setItem(probeKey, '1');
      storage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  };

  const browserStorage =
    (typeof window !== 'undefined' && canUseStorage(window.localStorage) && window.localStorage) ||
    (typeof window !== 'undefined' && canUseStorage(window.sessionStorage) && window.sessionStorage) ||
    null;

  const readCookie = (name) => {
    if (typeof document === 'undefined') return null;
    const prefix = `${encodeURIComponent(name)}=`;
    const match = document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    return match ? decodeURIComponent(match.slice(prefix.length)) : null;
  };

  const writeCookie = (name, value) => {
    if (typeof document === 'undefined') return;
    const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secureFlag}`;
  };

  const deleteCookie = (name) => {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax`;
  };

  return {
    get(key) {
      if (browserStorage) {
        return browserStorage.getItem(key);
      }

      return readCookie(key) ?? memory.get(key) ?? null;
    },
    set(key, value) {
      const normalizedValue = String(value);
      if (browserStorage) {
        browserStorage.setItem(key, normalizedValue);
        return;
      }

      writeCookie(key, normalizedValue);
      memory.set(key, normalizedValue);
    },
    remove(key) {
      if (browserStorage) {
        browserStorage.removeItem(key);
      }

      deleteCookie(key);
      memory.delete(key);
    }
  };
};

const storageAdapter = createStorageAdapter();

window.physioSafeSession = {
  getToken() {
    return storageAdapter.get(SESSION_TOKEN_KEY);
  },
  setToken(token) {
    if (!token) {
      storageAdapter.remove(SESSION_TOKEN_KEY);
      return;
    }

    storageAdapter.set(SESSION_TOKEN_KEY, token);
  },
  getUser() {
    const serialized = storageAdapter.get(SESSION_USER_KEY);
    if (!serialized) return null;

    try {
      return JSON.parse(serialized);
    } catch {
      storageAdapter.remove(SESSION_USER_KEY);
      return null;
    }
  },
  setUser(user) {
    if (!user) {
      storageAdapter.remove(SESSION_USER_KEY);
      return;
    }

    storageAdapter.set(SESSION_USER_KEY, JSON.stringify(user));
  },
  persistSession({ token, user }) {
    this.setToken(token);
    this.setUser(user);
  },
  clear() {
    storageAdapter.remove(SESSION_TOKEN_KEY);
    storageAdapter.remove(SESSION_USER_KEY);
  }
};

/**
 * Global Toast Notification System
 * type can be: 'success', 'error', 'warning', 'info'
 */
window.showToast = (message, type = 'info') => {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `physio-toast physio-toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  let iconClass = 'fa-solid fa-circle-info';
  if (type === 'success') iconClass = 'fa-solid fa-circle-check';
  if (type === 'error') iconClass = 'fa-solid fa-circle-xmark';
  if (type === 'warning') iconClass = 'fa-solid fa-triangle-exclamation';

  toast.innerHTML = `
    <div class="physio-toast-icon">
      <i class="${iconClass}"></i>
    </div>
    <div class="physio-toast-content">${escapeHtml(message)}</div>
  `;

  // Use the escapeHtml from dashboard if available, else a fallback
  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => {
      toast.remove();
      if (container.childNodes.length === 0) {
        container.remove();
      }
    });
  }, 4000);
};
