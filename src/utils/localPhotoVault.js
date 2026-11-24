const KEY_DB = 'the-turn-vault-keys';
const KEY_STORE = 'the-turn-vault-keys';
const KEY_ID = 'aes-gcm-256';

const PHOTO_DB = 'the-turn-photo-vault';
const PHOTO_STORE = 'photos';

function openDatabase(name, storeName, { keyPath } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, keyPath ? { keyPath } : undefined);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function getOrCreateKey() {
  const db = await openDatabase(KEY_DB, KEY_STORE);
  try {
    const existing = await requestToPromise(db.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(KEY_ID));
    if (existing) return existing;

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put(key, KEY_ID);
    await transactionDone(tx);
    return key;
  } finally {
    db.close();
  }
}

export async function saveEncryptedPhoto(slotId, dataUrl, metadata = {}) {
  if (!slotId) throw new Error('slotId is required');
  if (typeof dataUrl !== 'string' || !dataUrl) throw new Error('dataUrl is required');

  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(dataUrl);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const record = {
    id: slotId,
    iv,
    ciphertext,
    metadata,
    updatedAt: new Date().toISOString(),
  };

  const db = await openDatabase(PHOTO_DB, PHOTO_STORE, { keyPath: 'id' });
  try {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).put(record);
    await transactionDone(tx);
  } finally {
    db.close();
  }

  return { id: record.id, metadata: record.metadata, updatedAt: record.updatedAt };
}

export async function loadEncryptedPhoto(slotId) {
  const db = await openDatabase(PHOTO_DB, PHOTO_STORE, { keyPath: 'id' });
  try {
    const record = await requestToPromise(db.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE).get(slotId));
    if (!record?.ciphertext || !record?.iv) return null;

    const key = await getOrCreateKey();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      key,
      record.ciphertext,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function listVaultEntries() {
  const db = await openDatabase(PHOTO_DB, PHOTO_STORE, { keyPath: 'id' });
  try {
    const records = await requestToPromise(db.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE).getAll());
    return (records || []).map((record) => ({
      id: record.id,
      metadata: record.metadata || {},
      updatedAt: record.updatedAt,
    }));
  } finally {
    db.close();
  }
}

export async function deleteEncryptedPhoto(slotId) {
  const db = await openDatabase(PHOTO_DB, PHOTO_STORE, { keyPath: 'id' });
  try {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).delete(slotId);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

export async function wipePhotoVault() {
  const photoDb = await openDatabase(PHOTO_DB, PHOTO_STORE, { keyPath: 'id' });
  try {
    const tx = photoDb.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).clear();
    await transactionDone(tx);
  } finally {
    photoDb.close();
  }

  const keyDb = await openDatabase(KEY_DB, KEY_STORE);
  try {
    const tx = keyDb.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).clear();
    await transactionDone(tx);
  } finally {
    keyDb.close();
  }

  await deleteDatabase(PHOTO_DB);
  await deleteDatabase(KEY_DB);
}
