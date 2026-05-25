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
