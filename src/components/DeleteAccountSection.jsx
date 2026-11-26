import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { wipePhotoVault } from '../utils/localPhotoVault';

const KNOWN_APP_DATABASES = [
  'the-turn-photo-vault',
  'the-turn-vault-keys',
  'the-turn-course-cache',
  'the-turn-global-courses',
];

function clearTurnLocalStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith('the-turn-')) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function clearObjectStores(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.open(name);
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames || []);
      if (stores.length === 0) {
        db.close();
        resolve();
        return;
      }
      try {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((storeName) => {
          tx.objectStore(storeName).clear();
        });
        const finish = () => {
          db.close();
          resolve();
        };
        tx.oncomplete = finish;
        tx.onerror = finish;
        tx.onabort = finish;
      } catch {
        db.close();
        resolve();
      }
    };
  });
}

async function listAppDatabases() {
  const names = new Set(KNOWN_APP_DATABASES);
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    try {
      const existing = await indexedDB.databases();
      (existing || []).forEach((entry) => {
        if (typeof entry?.name === 'string' && entry.name.startsWith('the-turn-')) {
          names.add(entry.name);
        }
      });
    } catch {
      /* indexedDB.databases() is unavailable in some browsers */
    }
  }
  return [...names];
}

async function wipeAllAppDatabases() {
  await wipePhotoVault();
  const names = await listAppDatabases();
  for (const name of names) {
    await clearObjectStores(name);
    await deleteDatabase(name);
  }
}

export default function DeleteAccountSection() {
  const [localBusy, setLocalBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState('');
  const [localError, setLocalError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteReady = confirmText === 'DELETE' && !deleteBusy;

  const handleLocalWipe = async () => {
    setLocalBusy(true);
    setLocalNotice('');
    setLocalError('');
    try {
      await wipePhotoVault();
      clearTurnLocalStorage();
      setLocalNotice('Local vault and the-turn cache cleared on this device.');
    } catch (err) {
      setLocalError(err?.message || 'Could not clear the local vault.');
    } finally {
      setLocalBusy(false);
    }
  };

  const closeConfirm = () => {
    if (deleteBusy) return;
    setConfirmOpen(false);
    setConfirmText('');
    setDeleteError('');
  };

  const handleDeleteAccount = async (event) => {
    event.preventDefault();
    if (confirmText !== 'DELETE' || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError('');
    try {
      const { error } = await supabase.rpc('delete_own_account');
      if (error) {
        setDeleteError(error.message || 'Account deletion failed.');
        setDeleteBusy(false);
        return;
      }
    } catch (err) {
      setDeleteError(err?.message || 'Account deletion failed.');
      setDeleteBusy(false);
      return;
    }

    try {
      await wipeAllAppDatabases();
    } catch {
      /* Account is already deleted; still clear what we can and sign out. */
    }
    try {
      clearTurnLocalStorage();
    } catch {
      /* Storage can throw in private mode. */
    }
    try {
      await supabase.auth.signOut();
    } catch {
      /* Session may already be invalid after the account is removed. */
    }
    window.location.assign('/');
  };

  return (
    <section
      className="rounded-3xl border-2 p-4 space-y-3"
      style={{ borderColor: '#b45309', backgroundColor: 'var(--bg-elevated)' }}
      aria-label="Danger zone"
    >
      <div>
        <h4 className="text-xs font-extrabold uppercase tracking-wider" style={{ color: '#b91c1c' }}>
          Danger zone
        </h4>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Local wipe stays on this device. Account deletion removes your Solis Noir LLC data and cannot be undone.
        </p>
      </div>

      <button
        type="button"
        onClick={handleLocalWipe}
        disabled={localBusy}
        className="w-full min-h-[44px] px-3 rounded-xl border-2 text-sm font-semibold"
        style={{ borderColor: '#b45309', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}
      >
        {localBusy ? 'Clearing local vault…' : 'Wipe Local Vault & Cache'}
      </button>
      {localNotice && (
        <p className="text-xs" style={{ color: 'var(--text-primary)' }} role="status">
          {localNotice}
        </p>
      )}
      {localError && (
        <p className="text-xs" style={{ color: '#b91c1c' }} role="alert">
          {localError}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setDeleteError('');
          setConfirmText('');
          setConfirmOpen(true);
        }}
        className="w-full min-h-[44px] px-3 rounded-xl border-2 text-sm font-semibold text-white"
        style={{ borderColor: '#991b1b', backgroundColor: '#b91c1c' }}
      >
        Delete My Account & All Data
      </button>

      <a
        href="/privacy-policy"
        className="min-h-[44px] inline-flex items-center text-[11px] font-semibold underline"
        style={{ color: 'var(--text-secondary)' }}
      >
        Solis Noir LLC • Privacy Policy & Terms
      </a>

      {confirmOpen && (
        <div className="fixed inset-0 z-[80] bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleDeleteAccount}
            className="w-full max-w-md rounded-3xl border-2 p-5 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: '#b91c1c' }}
          >
            <h4 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Delete My Account & All Data
            </h4>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              This calls delete_own_account, wipes on-device vault and cache data, and signs you out. Type DELETE to confirm.
            </p>
            <label className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Type DELETE
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="mt-1 w-full min-h-[44px] rounded-xl border-2 px-3 text-sm"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: '#b45309',
                  color: 'var(--text-primary)',
                }}
              />
            </label>
            {deleteError && (
              <p className="text-xs" style={{ color: '#b91c1c' }} role="alert">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!deleteReady}
                className="flex-1 min-h-[44px] rounded-xl border-2 text-sm font-semibold text-white disabled:opacity-40"
                style={{ borderColor: '#991b1b', backgroundColor: '#b91c1c' }}
              >
                {deleteBusy ? 'Deleting…' : 'Confirm deletion'}
              </button>
              <button
                type="button"
                onClick={closeConfirm}
                disabled={deleteBusy}
                className="min-h-[44px] px-4 rounded-xl border text-sm"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
