import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const UNLOCK_KEY = 'the-turn-beta-unlocked';
const LEGACY_UNLOCK_KEY = 'the-turn-beta-unlock';
const FEEDBACK_KEY = 'the-turn-beta-feedback';
const FEEDBACK_CAP = 50;

function supabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function parseUnlockRecord(raw) {
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        code: String(parsed.code || '').trim().toUpperCase(),
        unlockedAt: parsed.unlockedAt || null,
      };
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      return { code: parsed.trim().toUpperCase(), unlockedAt: null };
    }
  } catch {
    const code = String(raw).trim().toUpperCase();
    if (code) return { code, unlockedAt: null };
  }
  return { code: '', unlockedAt: null };
}

function readUnlock() {
  try {
    const current = parseUnlockRecord(localStorage.getItem(UNLOCK_KEY));
    if (current) return current;
  } catch {
    /* ignore unreadable storage */
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_UNLOCK_KEY);
    const legacy = parseUnlockRecord(legacyRaw);
    if (!legacy?.code) return null;
    const migrated = {
      code: legacy.code,
      unlockedAt: legacy.unlockedAt || new Date().toISOString(),
    };
    try {
      localStorage.setItem(UNLOCK_KEY, JSON.stringify(migrated));
    } catch {
      /* still honor the legacy unlock on this device */
    }
    return migrated;
  } catch {
    return null;
  }
}

function saveFeedbackLocally(entry) {
  let existing = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }
  const next = [...existing, entry].slice(-FEEDBACK_CAP);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(next));
}

export default function BetaGateAndFeedback({ activeTab, holeNumber = null, onUnlocked, onRequireAuth }) {
  const { user, profile, patchProfile, refreshProfile } = useAuth();
  const [storedUnlock] = useState(() => readUnlock());
  const [unlocked, setUnlocked] = useState(
    () => Boolean(storedUnlock) || profile?.is_beta_tester === true
  );
  const [redeemedCode, setRedeemedCode] = useState(() => storedUnlock?.code || '');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.is_beta_tester === true) setUnlocked(true);
  }, [profile?.is_beta_tester]);

  const handleUnlock = async (event) => {
    event.preventDefault();
    if (!user) {
      setCodeError('Sign in to redeem a beta key.');
      onRequireAuth?.();
      return;
    }

    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      setCodeError('Enter a beta key.');
      return;
    }

    setRedeeming(true);
    setCodeError('');
    try {
      const { data, error } = await supabase.rpc('redeem_beta_invite', { invite_code: normalizedCode });
      if (error || !data?.ok) {
        setCodeError(data?.error || error?.message || 'Could not redeem this beta key.');
        return;
      }

      const record = { code: normalizedCode, unlockedAt: new Date().toISOString() };
      localStorage.setItem(UNLOCK_KEY, JSON.stringify(record));
      patchProfile?.({ is_beta_tester: true });
      try {
        if (typeof refreshProfile === 'function') await refreshProfile();
      } catch {
        /* refetch can fail offline; the local patch still unlocks Tour Pro */
      }
      patchProfile?.({ is_beta_tester: true });
      setRedeemedCode(normalizedCode);
      setUnlocked(true);
      onUnlocked?.();
    } catch (err) {
      setCodeError(err?.message || 'Could not redeem this beta key.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleSubmitFeedback = async (event) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setNotice('Write a short note before sending.');
      return;
    }

    const entry = {
      message: trimmed,
      activeTab,
      holeNumber: holeNumber ?? null,
      deviceInfo: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
      createdAt: new Date().toISOString(),
      ...(user?.id ? { userId: user.id } : {}),
    };

    setSubmitting(true);
    let savedRemote = false;
    if (supabaseConfigured()) {
      try {
        const { error } = await supabase.from('beta_feedback').insert(entry);
        savedRemote = !error;
      } catch {
        savedRemote = false;
      }
    }
    if (!savedRemote) saveFeedbackLocally(entry);
    setMessage('');
    setNotice(savedRemote ? 'Thanks — feedback sent.' : 'Saved on this device.');
    setSubmitting(false);
  };

  if (!unlocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-sm rounded-3xl border p-5 space-y-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="space-y-1">
            <h2 className="text-lg font-bold">Beta invite</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Enter your invite code to open The Turn beta.
            </p>
          </div>
          {!user && (
            <div className="space-y-2">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Sign in to redeem a beta key.
              </p>
              <button
                type="button"
                onClick={() => onRequireAuth?.()}
                className="w-full min-h-[44px] rounded-2xl border font-semibold text-sm"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                Sign in
              </button>
            </div>
          )}
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Invite code
            </span>
            <input
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (codeError) setCodeError('');
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full min-h-[44px] px-3 rounded-2xl border text-sm"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </label>
          {codeError && <p className="text-xs text-amber-500">{codeError}</p>}
          <button
            type="submit"
            disabled={redeeming}
            className="w-full min-h-[44px] rounded-2xl font-semibold text-sm text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            {redeeming ? 'Checking…' : 'Unlock beta'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {redeemedCode && (
        <div
          className="fixed left-4 z-30 max-w-[46vw] truncate px-3 min-h-[32px] rounded-full border text-[11px] font-semibold tracking-wide inline-flex items-center"
          style={{
            bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--accent-emerald)',
            color: 'var(--accent-emerald)',
          }}
        >
          Beta {redeemedCode}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setNotice('');
          setDrawerOpen(true);
        }}
        className="fixed right-4 z-30 min-h-[44px] px-4 rounded-full border text-sm font-semibold inline-flex items-center gap-2 shadow-lg"
        style={{
          bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-primary)',
        }}
      >
        <MessageSquare size={16} />
        Beta Feedback
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={() => setDrawerOpen(false)}>
          <form
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmitFeedback}
            className="w-full max-w-md rounded-t-3xl border p-4 space-y-3"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              marginBottom: 'calc(4.5rem + env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">Beta Feedback</span>
              <button type="button" onClick={() => setDrawerOpen(false)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" aria-label="Close feedback">
                <X size={18} />
              </button>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="What should we fix or keep?"
              className="w-full rounded-2xl border p-3 text-sm"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            {notice && (
              <p className="text-xs" style={{ color: 'var(--accent-emerald)' }}>
                {notice}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] rounded-2xl font-semibold text-sm text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent-emerald)' }}
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
