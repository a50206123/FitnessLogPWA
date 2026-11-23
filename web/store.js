/**
 * 健身記錄 PWA 資料儲存層模組
 * 提供示範模式（LocalStore）與雲端模式（FirestoreStore）兩種實作，以及 Firebase 設定存取輔助函式。
 */

import { makeId } from './logic.js';
import { buildDemoData } from './demo-data.js';

const DEMO_EQUIPMENT_KEY = 'fitness.demo.equipment';
const DEMO_LOGS_KEY = 'fitness.demo.logs';
const FIREBASE_CONFIG_KEY = 'fitness.firebaseConfig';

const FIREBASE_CDN_BASE = 'https://www.gstatic.com/firebasejs/13.4.0';
const FIRESTORE_APP_NAME = 'fitness-log-pwa';
const FIRESTORE_BATCH_LIMIT = 400;

/** 彈窗登入失敗時改用重新導向登入的錯誤碼清單 */
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-environment',
  'auth/web-storage-unsupported',
  'auth/cancelled-popup-request',
  'popup-blocked',
  'operation-not-supported-in-environment',
  'web-storage-unsupported',
  'cancelled-popup-request',
]);

/**
 * 取得可用的 localStorage 物件（在無瀏覽器環境如 Node 測試時回傳 null）
 * @returns {Storage | null}
 */
function getStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 遞迴清除物件與陣列中的 undefined 欄位，避免 Firestore 寫入失敗
 * @template T
 * @param {T} value
 * @returns {T}
 */
function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * 深拷貝一般資料物件，避免外部修改汙染快取
 * @template T
 * @param {T} data
 * @returns {T}
 */
function cloneData(data) {
  return structuredClone(data);
}

/**
 * 整理即將寫入的器材或紀錄物件（補齊 id 與時間戳記並清除 undefined）
 * @param {object} item
 * @param {string} prefix id 前綴
 * @param {object | null} [existing=null] 同 id 的舊資料（保留既有 createdAt）
 * @param {boolean} [preserveUpdatedAt=false] 匯入時保留原本的 updatedAt
 * @returns {object}
 */
function normalizeRecord(item, prefix, existing = null, preserveUpdatedAt = false) {
  const now = new Date().toISOString();
  const cleaned = stripUndefined(item || {});
  const id = cleaned.id || makeId(prefix);
  const createdAt = cleaned.createdAt || existing?.createdAt || now;
  const updatedAt = preserveUpdatedAt && cleaned.updatedAt ? cleaned.updatedAt : now;
  return {
    ...cleaned,
    id,
    createdAt,
    updatedAt,
  };
}

/**
 * 讀取已儲存於 localStorage 的 Firebase 設定物件
 * @returns {Record<string, any> | null}
 */
export function getSavedFirebaseConfig() {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(FIREBASE_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * 將 Firebase 設定物件儲存到 localStorage
 * @param {Record<string, any>} obj
 */
export function saveFirebaseConfig(obj) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(stripUndefined(obj)));
}

/**
 * 清除 localStorage 中的 Firebase 設定（切換回示範模式）
 */
export function clearFirebaseConfig() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(FIREBASE_CONFIG_KEY);
}

/**
 * 判斷目前網址是否帶有 ?demo=1 以強制啟用示範模式
 * @returns {boolean}
 */
export function isDemoForced() {
  if (typeof location === 'undefined' || !location.search) return false;
  const params = new URLSearchParams(location.search);
  return params.get('demo') === '1';
}

/**
 * 示範模式資料儲存層（使用 localStorage 儲存）
 */
export class LocalStore {
  constructor() {
    this._subscribers = new Set();
    this._equipment = this._readList(DEMO_EQUIPMENT_KEY);
    this._logs = this._readList(DEMO_LOGS_KEY);
  }

  /**
   * 從 localStorage 讀取陣列資料
   * @param {string} key
   * @returns {Array<object>}
   */
  _readList(key) {
    const storage = getStorage();
    if (!storage) return [];
    const raw = storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * 將目前器材與訓練紀錄寫回 localStorage
   */
  _persist() {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(DEMO_EQUIPMENT_KEY, JSON.stringify(this._equipment));
    storage.setItem(DEMO_LOGS_KEY, JSON.stringify(this._logs));
  }

  /**
   * 取得目前資料的深拷貝快照
   * @returns {{ equipment: Array<object>, logs: Array<object> }}
   */
  _snapshot() {
    return {
      equipment: cloneData(this._equipment),
      logs: cloneData(this._logs),
    };
  }

  /**
   * 通知所有訂閱者資料已更新
   */
  _notify() {
    for (const cb of this._subscribers) {
      cb(this._snapshot());
    }
  }

  /**
   * 訂閱資料變動；註冊時會立即回呼一次目前資料，並回傳取消訂閱函式
   * @param {(data: { equipment: Array<object>, logs: Array<object> }) => void} cb
   * @returns {() => void}
   */
  subscribe(cb) {
    this._subscribers.add(cb);
    cb(this._snapshot());
    return () => {
      this._subscribers.delete(cb);
    };
  }

  /**
   * 新增或更新單筆器材
   * @param {object} eq
   * @returns {Promise<object>}
   */
  async saveEquipment(eq) {
    const idx = eq?.id
      ? this._equipment.findIndex((item) => item.id === eq.id)
      : -1;
    const existing = idx >= 0 ? this._equipment[idx] : null;
    const saved = normalizeRecord(eq, 'eq_', existing, false);

    if (idx >= 0) {
      this._equipment[idx] = saved;
    } else {
      this._equipment.push(saved);
    }

    this._persist();
    this._notify();
    return cloneData(saved);
  }

  /**
   * 刪除指定 id 的器材
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteEquipment(id) {
    this._equipment = this._equipment.filter((item) => item.id !== id);
    this._persist();
    this._notify();
  }

  /**
   * 新增或更新單筆訓練紀錄
   * @param {object} log
   * @returns {Promise<object>}
   */
  async saveLog(log) {
    const idx = log?.id
      ? this._logs.findIndex((item) => item.id === log.id)
      : -1;
    const existing = idx >= 0 ? this._logs[idx] : null;
    const saved = normalizeRecord(log, 'log_', existing, false);

    if (idx >= 0) {
      this._logs[idx] = saved;
    } else {
      this._logs.push(saved);
    }

    this._persist();
    this._notify();
    return cloneData(saved);
  }

  /**
   * 刪除指定 id 的訓練紀錄
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteLog(id) {
    this._logs = this._logs.filter((item) => item.id !== id);
    this._persist();
    this._notify();
  }

  /**
   * 匯出全部器材與訓練紀錄
   * @returns {{ equipment: Array<object>, logs: Array<object> }}
   */
  exportAll() {
    return this._snapshot();
  }

  /**
   * 匯入資料（相同 id 覆蓋，不同 id 保留）
   * @param {{ equipment?: Array<object>, logs?: Array<object> }} data
   * @returns {Promise<void>}
   */
  async importAll(data) {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.equipment)) {
      const eqMap = new Map(this._equipment.map((item) => [item.id, item]));
      for (const rawEq of data.equipment) {
        if (!rawEq || typeof rawEq !== 'object') continue;
        const existing = rawEq.id ? eqMap.get(rawEq.id) : null;
        const normalized = normalizeRecord(rawEq, 'eq_', existing, true);
        eqMap.set(normalized.id, normalized);
      }
      this._equipment = Array.from(eqMap.values());
    }

    if (Array.isArray(data.logs)) {
      const logMap = new Map(this._logs.map((item) => [item.id, item]));
      for (const rawLog of data.logs) {
        if (!rawLog || typeof rawLog !== 'object') continue;
        const existing = rawLog.id ? logMap.get(rawLog.id) : null;
        const normalized = normalizeRecord(rawLog, 'log_', existing, true);
        logMap.set(normalized.id, normalized);
      }
      this._logs = Array.from(logMap.values());
    }

    this._persist();
    this._notify();
  }

  /**
   * 載入內建示範假資料
   * @param {Date | string | number} [today=new Date()]
   * @returns {{ equipment: Array<object>, logs: Array<object> }}
   */
  loadDemoData(today = new Date()) {
    const demo = buildDemoData(today);
    this._equipment = cloneData(demo.equipment);
    this._logs = cloneData(demo.logs);
    this._persist();
    this._notify();
    return this._snapshot();
  }

  /**
   * 清除全部示範資料
   */
  clearAll() {
    this._equipment = [];
    this._logs = [];
    this._persist();
    this._notify();
  }
}

/**
 * Firebase 雲端模式資料儲存層（Firestore 離線快取＋Google 登入）
 */
export class FirestoreStore {
  /**
   * 請透過 FirestoreStore.create(config) 建立實例
   */
  constructor({ app, auth, db, appMod, authMod, firestoreMod }) {
    this._app = app;
    this._auth = auth;
    this._db = db;
    this._appMod = appMod;
    this._authMod = authMod;
    this._firestoreMod = firestoreMod;

    /** 目前登入的使用者物件（未登入時為 null） */
    this.user = auth.currentUser || null;

    this._equipment = [];
    this._logs = [];
    this._dataSubscribers = new Set();
    this._authSubscribers = new Set();

    this._unsubEquipment = null;
    this._unsubLogs = null;

    // 監聽 Firebase 登入狀態變化，自動啟用或停止集合同步
    this._unsubAuth = authMod.onAuthStateChanged(auth, (user) => {
      this.user = user || null;
      if (this.user) {
        this._attachSnapshots(this.user.uid);
      } else {
        this._detachSnapshots();
        this._equipment = [];
        this._logs = [];
        this._notifyData();
      }
      this._notifyAuth();
    });
  }

  /**
   * 動態載入 Firebase 13.4.0 CDN 模組並初始化 Firestore（含多頁籤離線持久快取）
   * @param {Record<string, any>} config Firebase 設定物件
   * @returns {Promise<FirestoreStore>}
   */
  static async create(config) {
    const [appMod, authMod, firestoreMod] = await Promise.all([
      import(`${FIREBASE_CDN_BASE}/firebase-app.js`),
      import(`${FIREBASE_CDN_BASE}/firebase-auth.js`),
      import(`${FIREBASE_CDN_BASE}/firebase-firestore.js`),
    ]);

    // 若先前已初始化同名 App，先釋放後再重建，確保可重新套用設定
    const existingApp = appMod
      .getApps()
      .find((a) => a.name === FIRESTORE_APP_NAME);
    if (existingApp) {
      await appMod.deleteApp(existingApp);
    }

    const app = appMod.initializeApp(config, FIRESTORE_APP_NAME);
    const auth = authMod.getAuth(app);

    // 啟用離線持久快取與多分頁同步管理
    let db;
    try {
      db = firestoreMod.initializeFirestore(app, {
        localCache: firestoreMod.persistentLocalCache({
          tabManager: firestoreMod.persistentMultipleTabManager(),
        }),
      });
    } catch {
      // 若環境不支援 IndexedDB 持久快取，退回預設記憶體快取
      db = firestoreMod.getFirestore(app);
    }

    // 啟動時處理先前透過 signInWithRedirect 導回的登入結果
    try {
      await authMod.getRedirectResult(auth);
    } catch (err) {
      console.warn('處理 Google 重新導向登入結果時發生錯誤：', err);
    }

    return new FirestoreStore({ app, auth, db, appMod, authMod, firestoreMod });
  }

  /**
   * 確認已登入並回傳使用者 UID，未登入時丟出錯誤
   * @returns {string}
   */
  _requireUid() {
    if (!this.user || !this.user.uid) {
      throw new Error('請先登入 Google 帳號');
    }
    return this.user.uid;
  }

  /**
   * 取得目前快取資料的深拷貝快照
   * @returns {{ equipment: Array<object>, logs: Array<object> }}
   */
  _snapshot() {
    return {
      equipment: cloneData(this._equipment),
      logs: cloneData(this._logs),
    };
  }

  /**
   * 通知所有資料訂閱者
   */
  _notifyData() {
    for (const cb of this._dataSubscribers) {
      cb(this._snapshot());
    }
  }

  /**
   * 通知所有登入狀態訂閱者
   */
  _notifyAuth() {
    for (const cb of this._authSubscribers) {
      cb(this.user);
    }
  }

  /**
   * 登入後監聽使用者的 equipment 與 logs 兩個集合
   * @param {string} uid
   */
  _attachSnapshots(uid) {
    this._detachSnapshots();
    const { collection, onSnapshot } = this._firestoreMod;

    const eqCol = collection(this._db, 'users', uid, 'equipment');
    const logsCol = collection(this._db, 'users', uid, 'logs');

    this._unsubEquipment = onSnapshot(
      eqCol,
      (snap) => {
        this._equipment = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        this._notifyData();
      },
      (err) => {
        console.error('監聽器材資料失敗：', err);
      }
    );

    this._unsubLogs = onSnapshot(
      logsCol,
      (snap) => {
        this._logs = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        this._notifyData();
      },
      (err) => {
        console.error('監聽訓練紀錄失敗：', err);
      }
    );
  }

  /**
   * 取消 Firestore 集合的即時監聽
   */
  _detachSnapshots() {
    if (this._unsubEquipment) {
      this._unsubEquipment();
      this._unsubEquipment = null;
    }
    if (this._unsubLogs) {
      this._unsubLogs();
      this._unsubLogs = null;
    }
  }

  /**
   * 訂閱登入狀態變化；註冊時立即回呼一次目前使用者狀態
   * @param {(user: object | null) => void} cb
   * @returns {() => void}
   */
  onAuth(cb) {
    this._authSubscribers.add(cb);
    cb(this.user);
    return () => {
      this._authSubscribers.delete(cb);
    };
  }

  /**
   * 使用 Google 帳號登入：優先採用彈窗，若環境限制則自動改用頁面重新導向
   * @returns {Promise<any>}
   */
  async signIn() {
    const provider = new this._authMod.GoogleAuthProvider();
    try {
      return await this._authMod.signInWithPopup(this._auth, provider);
    } catch (err) {
      if (POPUP_FALLBACK_CODES.has(err?.code)) {
        return this._authMod.signInWithRedirect(this._auth, provider);
      }
      throw err;
    }
  }

  /**
   * 登出 Google 帳號並停止雲端資料監聽
   * @returns {Promise<void>}
   */
  async signOut() {
    this._detachSnapshots();
    this._equipment = [];
    this._logs = [];
    this._notifyData();
    await this._authMod.signOut(this._auth);
  }

  /**
   * 訂閱資料變動；未登入時會先回呼空資料，回傳取消訂閱函式
   * @param {(data: { equipment: Array<object>, logs: Array<object> }) => void} cb
   * @returns {() => void}
   */
  subscribe(cb) {
    this._dataSubscribers.add(cb);
    cb(this._snapshot());
    return () => {
      this._dataSubscribers.delete(cb);
    };
  }

  /**
   * 新增或更新單筆器材至 Firestore
   * @param {object} eq
   * @returns {Promise<object>}
   */
  async saveEquipment(eq) {
    const uid = this._requireUid();
    const existing = eq?.id
      ? this._equipment.find((item) => item.id === eq.id)
      : null;
    const cleaned = normalizeRecord(eq, 'eq_', existing, false);

    const { doc, setDoc } = this._firestoreMod;
    const ref = doc(this._db, 'users', uid, 'equipment', cleaned.id);
    await setDoc(ref, cleaned);
    return cloneData(cleaned);
  }

  /**
   * 從 Firestore 刪除指定 id 的器材
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteEquipment(id) {
    const uid = this._requireUid();
    const { doc, deleteDoc } = this._firestoreMod;
    const ref = doc(this._db, 'users', uid, 'equipment', id);
    await deleteDoc(ref);
  }

  /**
   * 新增或更新單筆訓練紀錄至 Firestore
   * @param {object} log
   * @returns {Promise<object>}
   */
  async saveLog(log) {
    const uid = this._requireUid();
    const existing = log?.id
      ? this._logs.find((item) => item.id === log.id)
      : null;
    const cleaned = normalizeRecord(log, 'log_', existing, false);

    const { doc, setDoc } = this._firestoreMod;
    const ref = doc(this._db, 'users', uid, 'logs', cleaned.id);
    await setDoc(ref, cleaned);
    return cloneData(cleaned);
  }

  /**
   * 從 Firestore 刪除指定 id 的訓練紀錄
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteLog(id) {
    const uid = this._requireUid();
    const { doc, deleteDoc } = this._firestoreMod;
    const ref = doc(this._db, 'users', uid, 'logs', id);
    await deleteDoc(ref);
  }

  /**
   * 匯出目前同步的所有器材與訓練紀錄
   * @returns {{ equipment: Array<object>, logs: Array<object> }}
   */
  exportAll() {
    return this._snapshot();
  }

  /**
   * 批次匯入資料至 Firestore（同 id 覆蓋，每批最多 400 筆）
   * @param {{ equipment?: Array<object>, logs?: Array<object> }} data
   * @returns {Promise<void>}
   */
  async importAll(data) {
    const uid = this._requireUid();
    if (!data || typeof data !== 'object') return;

    const { doc, writeBatch } = this._firestoreMod;
    const eqMap = new Map(this._equipment.map((item) => [item.id, item]));
    const logMap = new Map(this._logs.map((item) => [item.id, item]));

    /** @type {Array<{ ref: any, data: object }>} */
    const ops = [];

    if (Array.isArray(data.equipment)) {
      for (const rawEq of data.equipment) {
        if (!rawEq || typeof rawEq !== 'object') continue;
        const existing = rawEq.id ? eqMap.get(rawEq.id) : null;
        const cleaned = normalizeRecord(rawEq, 'eq_', existing, true);
        ops.push({
          ref: doc(this._db, 'users', uid, 'equipment', cleaned.id),
          data: cleaned,
        });
      }
    }

    if (Array.isArray(data.logs)) {
      for (const rawLog of data.logs) {
        if (!rawLog || typeof rawLog !== 'object') continue;
        const existing = rawLog.id ? logMap.get(rawLog.id) : null;
        const cleaned = normalizeRecord(rawLog, 'log_', existing, true);
        ops.push({
          ref: doc(this._db, 'users', uid, 'logs', cleaned.id),
          data: cleaned,
        });
      }
    }

    // 依每批最多 400 筆切分送出 writeBatch
    for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = writeBatch(this._db);
      const chunk = ops.slice(i, i + FIRESTORE_BATCH_LIMIT);
      for (const op of chunk) {
        batch.set(op.ref, op.data);
      }
      await batch.commit();
    }
  }

  /**
   * 釋放所有監聽器（切換儲存層時使用）
   */
  destroy() {
    this._detachSnapshots();
    if (this._unsubAuth) {
      this._unsubAuth();
      this._unsubAuth = null;
    }
    this._dataSubscribers.clear();
    this._authSubscribers.clear();
  }
}
