'use strict';

// Storage manager with automatic fallbacks for various browser environments
// Handles: localStorage, sessionStorage, in-memory fallback
// Features: quota exceeded handling, private mode detection, cross-tab sync
// Universal Module Definition (UMD) - works with CommonJS require() and ES module import()
// Also works as a browser script tag (<script src="..."></script>)

(function (root, factory) {
  // UMD pattern: works with CommonJS, AMD, and browser globals
  if (typeof define === 'function' && define.amd) {
    // AMD loader
    define(['exports'], factory);
  } else if (typeof module !== 'undefined' && module.exports) {
    // CommonJS/Node.js
    module.exports = factory(require, module, exports);
  } else {
    // Browser globals (root is window in browsers, self otherwise)
    root.StorageManager = factory();
  }
}(this, function () {

// Storage types
const STORAGE_TYPES = {
  LOCAL: 'local',
  SESSION: 'session',
  MEMORY: 'memory'
};

/**
 * StorageManager - Provides a unified interface for storage operations
 * with automatic fallback between localStorage, sessionStorage, and in-memory.
 * Detects private/incognito mode and handles quota exceeded errors gracefully.
 * @param {Object} [options] - Optional configuration
 * @param {String} [options.type] - Force a specific storage type (for testing)
 * @returns {StorageManager} The storage manager instance
 */
function StorageManager(options) {
  // Allow forced type for testing
  const forcedType = options && options.type ? options.type : null;

  // Determine storage type
  let type;
  if (forcedType) {
    if (STORAGE_TYPES[forcedType]) {
      type = forcedType;
    } else {
      console.debug(`Invalid forced storage type: ${forcedType}, detecting automatically`);
      type = this._detectStorageType();
    }
  } else {
    type = this._detectStorageType();
  }

  if (forcedType && forcedType !== type) {
    console.debug(`Storage type forced to ${forcedType} but detected as ${type}`);
  }

  this.type = type;
  this.isPersistent = this.type === STORAGE_TYPES.LOCAL;
  this.store = this._initStore(type);
  this.enabled = this._checkEnabled();
}

/**
 * Detect which storage type is available and appropriate
 * @returns {String}
 * @private
 */
StorageManager.prototype._detectStorageType = function () {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    if (localStorage.getItem(test) === test) {
      return STORAGE_TYPES.LOCAL;
    }
  } catch (e) {}

  try {
    const test = '__storage_test__';
    sessionStorage.setItem(test, test);
    sessionStorage.removeItem(test);
    if (sessionStorage.getItem(test) === test) {
      return STORAGE_TYPES.SESSION;
    }
  } catch (e) {}

  return STORAGE_TYPES.MEMORY;
};

/**
 * Initialize the storage backend based on detected type
 * @param {String} type
 * @returns {Storage}
 * @private
 */
StorageManager.prototype._initStore = function (type) {
  switch (type) {
    case STORAGE_TYPES.LOCAL: return localStorage;
    case STORAGE_TYPES.SESSION: return sessionStorage;
    case STORAGE_TYPES.MEMORY: return new Map();
    default: try { return localStorage; } catch (e) { return new Map(); }
  }
};

/**
 * Check if storage is enabled
 * @returns {Boolean}
 * @private
 */
StorageManager.prototype._checkEnabled = function () {
  try {
    const key = '__storage_test__';
    this.store.setItem(key, '1');
    this.store.removeItem(key);
    return true;
  } catch (e) { return false; }
};

/**
 * Get an item from storage
 * @param {String} key
 * @returns {*}
 */
StorageManager.prototype.getItem = function (key) {
  if (!this.enabled) return null;
  try {
    const value = this.store.getItem(key);
    return value !== null ? value : null;
  } catch (e) {
    if (this.type === STORAGE_TYPES.LOCAL) this._switchToMemory();
    return null;
  }
};

/**
 * Set an item in storage
 * @param {String} key
 * @param {*} value
 * @returns {Boolean}
 */
StorageManager.prototype.setItem = function (key, value) {
  if (!this.enabled) return false;
  try {
    this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch (e) {
    return this._handleQuotaError(key, value);
  }
};

/**
 * Remove an item from storage
 * @param {String} key
 * @returns {Boolean}
 */
StorageManager.prototype.removeItem = function (key) {
  if (!this.enabled) return false;
  try { this.store.removeItem(key); return true; } catch (e) { return false; }
};

/**
 * Handle quota exceeded errors
 * @param {String} key
 * @param {*} value
 * @returns {Boolean}
 * @private
 */
StorageManager.prototype._handleQuotaError = function (key, value) {
  console.warn('Storage quota exceeded, attempting recovery...');
  switch (this.type) {
    case STORAGE_TYPES.LOCAL:
      this._reduceLocalCache();
      try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e2) { this._switchToSession(); }
      try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e3) { this._switchToMemory(); try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e4) { return false; } }
    case STORAGE_TYPES.SESSION:
      this._reduceSessionCache();
      try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e2) { this._switchToMemory(); try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e3) { return false; } }
    case STORAGE_TYPES.MEMORY:
      this._trimMemoryCache();
      try { this.store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); return true; } catch (e2) { return false; }
    default: return false;
  }
};

/**
 * Reduce localStorage cache
 * @private
 */
StorageManager.prototype._reduceLocalCache = function () {
  try {
    const cacheKey = 'tickr.agent.cache.v1';
    let cache = {};
    try { const raw = localStorage.getItem(cacheKey); if (raw) cache = JSON.parse(raw); } catch (e) {}
    if (typeof cache === 'object' && !Array.isArray(cache)) {
      const keys = Object.keys(cache).sort();
      const keepCount = Math.max(1, Math.ceil(keys.length / 4));
      const reduced = {};
      for (let i = keys.length - keepCount; i < keys.length; i++) { const k = keys[i]; if (k) reduced[k] = cache[k]; }
      try { localStorage.setItem(cacheKey, JSON.stringify(reduced)); } catch (e) { localStorage.removeItem(cacheKey); }
    }
  } catch (e) { console.debug('Error reducing localStorage cache:', e); }
};

/**
 * Reduce sessionStorage cache
 * @private
 */
StorageManager.prototype._reduceSessionCache = function () {
  try {
    const cacheKey = 'tickr.agent.cache.v1';
    let cache = {};
    try { const raw = sessionStorage.getItem(cacheKey); if (raw) cache = JSON.parse(raw); } catch (e) {}
    if (typeof cache === 'object' && !Array.isArray(cache)) {
      const keys = Object.keys(cache).sort();
      const keepCount = Math.max(1, Math.min(20, keys.length));
      const reduced = {};
      for (let i = keys.length - keepCount; i < keys.length; i++) { const k = keys[i]; if (k) reduced[k] = cache[k]; }
      try { sessionStorage.setItem(cacheKey, JSON.stringify(reduced)); } catch (e) { sessionStorage.removeItem(cacheKey); }
    }
  } catch (e) { console.debug('Error reducing sessionStorage cache:', e); }
};

/**
 * Trim in-memory cache
 * @private
 */
StorageManager.prototype._trimMemoryCache = function () {
  // Managed elsewhere
};

/**
 * Switch to sessionStorage
 * @private
 */
StorageManager.prototype._switchToSession = function () {
  try {
    const cacheKey = 'tickr.agent.cache.v1';
    let cache = {};
    try { const raw = localStorage.getItem(cacheKey); if (raw) cache = JSON.parse(raw); } catch (e) {}
    if (typeof cache === 'object' && !Array.isArray(cache)) { sessionStorage.setItem(cacheKey, JSON.stringify(cache)); }
    this.type = STORAGE_TYPES.SESSION;
  } catch (e) { console.debug('Error switching to sessionStorage:', e); }
};

/**
 * Switch to in-memory Map
 * @private
 */
StorageManager.prototype._switchToMemory = function () {
  try {
    const memoryStore = new Map();
    const cacheKey = 'tickr.agent.cache.v1';
    try { const raw = this.store.getItem(cacheKey); if (raw) { const parsed = JSON.parse(raw); if (typeof parsed === 'object' && !Array.isArray(parsed)) { Object.entries(parsed).forEach(([k, v]) => memoryStore.set(k, v)); } } } catch (e) { }
    const prefKeys = ['tickr.agent.url', 'tickr.agent.mode'];
    prefKeys.forEach(key => { try { const val = this.store.getItem(key); if (val !== null) memoryStore.set(key, val); } catch (e) {} });
    this.type = STORAGE_TYPES.MEMORY;
    this.store = memoryStore;
  } catch (e) { console.debug('Error switching to memory:', e); }
};

/**
 * Check for private mode
 * @returns {Boolean}
 */
StorageManager.prototype.isPrivateMode = function () {
  try {
    const test = '__private_mode_test__';
    localStorage.setItem(test, '1');
    const result = localStorage.getItem(test) === '1';
    localStorage.removeItem(test);
    return !result;
  } catch (e) { return true; }
};

/**
 * Get item (wrapper)
 * @param {String} key
 * @returns {*}
 */
StorageManager.prototype.get = function (key) { return this.getItem(key); };

/**
 * Set item (wrapper)
 * @param {String} key
 * @param {*} value
 * @returns {Boolean}
 */
StorageManager.prototype.set = function (key, value) { return this.setItem(key, value); };

/**
 * Remove item (wrapper)
 * @param {String} key
 * @returns {Boolean}
 */
StorageManager.prototype.remove = function (key) { return this.removeItem(key); };

/**
 * Storage utilities namespace
 * @namespace storageUtils
 */
const storageUtils = {
  get: function (key) {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.get(key);
    } catch (e) { return null; }
  },
  set: function (key, value) {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.set(key, value);
    } catch (e) { return false; }
  },
  remove: function (key) {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.remove(key);
    } catch (e) { return false; }
  },
  isEnabled: function () {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.enabled;
    } catch (e) { return false; }
  },
  getType: function () {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.type;
    } catch (e) { return STORAGE_TYPES.MEMORY; }
  },
  isPersistent: function () {
    try {
      const mgr = typeof window !== 'undefined' && window.storage ? window.storage : new StorageManager();
      return mgr.isPersistent;
    } catch (e) { return false; }
  },
  getKeys: function () {
    try {
      const keys = [];
      if (typeof localStorage !== 'undefined') { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); }
      return keys;
    } catch (e) { return []; }
  },
  clear: function () {
    try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch (e) {}
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.clear(); } catch (e) {}
    return true;
  }
};

// Export object for CommonJS/Node.js
const exports = {
  StorageManager,
  storageUtils,
  STORAGE_TYPES
};

// Also add a default instance for convenience
const defaultStorage = new StorageManager();
Object.assign(exports, {
  storage: defaultStorage,
  defaultStorage
});

// Return the exports object.
// The caller (CommonJS: module.exports = exports; ES module: import { ... } from ...)
// will receive this object.
return exports;

}));