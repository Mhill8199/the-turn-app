import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const INVITE_CODE = 'TURN-BETA26';
const UNLOCK_KEY = 'the-turn-beta-unlock';
const FEEDBACK_KEY = 'the-turn-beta-feedback';
const FEEDBACK_CAP = 50;

function supabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function readUnlock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNLOCK_KEY) || 'null');
    if (String(parsed?.code || '').trim().toUpperCase() === INVITE_CODE) return parsed;
  } catch {
    /* ignore malformed unlock */
  }
  return null;
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

export default function BetaGateAndFeedback({ activeTab, holeNumber = null, onUnlocked }) {
  const { user, profile, patchProfile } = useAuth();
  const [unlocked, setUnlocked] = useState(() => Boolean(readUnlock()));
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!unlocked || profile?.is_beta_tester === true) return;
    patchProfile?.({ is_beta_tester: true });
  }, [unlocked, profile?.is_beta_tester, patchProfile]);

  useEffect(() => {
    if (!unlocked || !user?.id || !supabaseConfigured()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await supabase.from('profiles').update({ is_beta_tester: true }).eq('id', user.id);
      } catch {
        /* column missing, offline, or no session — local unlock still stands */
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, user?.id]);

  const handleUnlock = (event) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized !== INVITE_CODE) {
      setCodeError('That invite code is not valid.');
      return;
    }
    localStorage.setItem(
      UNLOCK_KEY,
      JSON.stringify({ code: INVITE_CODE, unlockedAt: new Date().toISOString() })
    );
    setCodeError('');
    setUnlocked(true);
    onUnlocked?.();
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
            className="w-full min-h-[44px] rounded-2xl font-semibold text-sm text-white"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            Unlock beta
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
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
