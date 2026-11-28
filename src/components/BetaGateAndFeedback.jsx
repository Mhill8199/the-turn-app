import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const LEGACY_UNLOCK_KEY = 'the-turn-beta-unlocked';
const OLDER_UNLOCK_KEY = 'the-turn-beta-unlock';
const FEEDBACK_KEY = 'the-turn-beta-feedback';
const FEEDBACK_CAP = 50;

function userUnlockKey(userId) {
  return `the-turn-beta-unlocked:${userId}`;
}

function supabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function isMissingSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return true;
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find the');
}

function readUserUnlock(userId) {
  if (!userId) return false;
  try {
    const value = localStorage.getItem(userUnlockKey(userId));
    return value != null && value !== '';
  } catch {
    return false;
  }
}

function writeUserUnlock(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(userUnlockKey(userId), 'true');
    localStorage.removeItem(LEGACY_UNLOCK_KEY);
    localStorage.removeItem(OLDER_UNLOCK_KEY);
  } catch {
    /* storage can be blocked; the profile flag still unlocks Tour Pro */
  }
}

function clearUserUnlock(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(userUnlockKey(userId));
  } catch {
    /* ignore */
  }
}

function clearLegacyUnlockKeys() {
  try {
    localStorage.removeItem(LEGACY_UNLOCK_KEY);
    localStorage.removeItem(OLDER_UNLOCK_KEY);
  } catch {
    /* ignore */
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

async function lookupBetaAccess(userId) {
  let profileError = null;
  let profileData = null;
  let inviteError = null;
  let inviteRows = null;

  try {
    const profileRes = await supabase
      .from('profiles')
      .select('is_beta_tester')
      .eq('id', userId)
      .maybeSingle();
    profileError = profileRes.error;
    profileData = profileRes.data;
  } catch (err) {
    profileError = err;
  }

  try {
    const inviteRes = await supabase
      .from('beta_invites')
      .select('used_by')
      .eq('used_by', userId)
      .limit(1);
    inviteError = inviteRes.error;
    inviteRows = inviteRes.data;
  } catch (err) {
    inviteError = err;
  }

  const profileMissing = isMissingSchemaError(profileError);
  const inviteMissing = isMissingSchemaError(inviteError);
  const isTester = profileData?.is_beta_tester === true;
  const hasInvite = Array.isArray(inviteRows) && inviteRows.length > 0;

  if (isTester || hasInvite) return { status: 'tester' };

  const profileKnownFalse = !profileError && profileData?.is_beta_tester === false;
  const invitesKnownEmpty = !inviteError && Array.isArray(inviteRows) && inviteRows.length === 0;

  if (profileKnownFalse && (invitesKnownEmpty || inviteMissing)) {
    return { status: 'full' };
  }

  if (profileError && !profileMissing) return { status: 'unknown' };
  if (inviteError && !inviteMissing) return { status: 'unknown' };
  return { status: 'unknown' };
}

export default function BetaGateAndFeedback({ activeTab, holeNumber = null, onBetaAccess }) {
  const { user, profile, loading: authLoading, patchProfile, refreshProfile } = useAuth();
  const [access, setAccess] = useState('verifying');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const userIdRef = useRef(user?.id ?? null);
  const patchProfileRef = useRef(patchProfile);
  const refreshProfileRef = useRef(refreshProfile);
  const onBetaAccessRef = useRef(onBetaAccess);
  patchProfileRef.current = patchProfile;
  refreshProfileRef.current = refreshProfile;
  onBetaAccessRef.current = onBetaAccess;

  useEffect(() => {
    const previous = userIdRef.current;
    const next = user?.id ?? null;
    if (previous && previous !== next) {
      clearUserUnlock(previous);
      clearLegacyUnlockKeys();
      setAccess(next ? 'verifying' : 'signed_out');
    }
    userIdRef.current = next;
  }, [user?.id]);

  useEffect(() => {
    onBetaAccessRef.current?.(access);
  }, [access]);

  useEffect(() => {
    if (!user?.id || profile?.is_beta_tester !== true) return;
    writeUserUnlock(user.id);
    setAccess('tester');
  }, [user?.id, profile?.is_beta_tester]);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user?.id) {
      setAccess('signed_out');
      return undefined;
    }

    const userId = user.id;
    const cached = readUserUnlock(userId);
    if (cached) {
      setAccess('tester');
      patchProfileRef.current?.({ is_beta_tester: true });
    } else if (profile?.is_beta_tester !== true) {
      setAccess('verifying');
    }

    let cancelled = false;
    lookupBetaAccess(userId).then(async (result) => {
      if (cancelled) return;
      if (result.status === 'tester') {
        writeUserUnlock(userId);
        patchProfileRef.current?.({ is_beta_tester: true });
        setAccess('tester');
        try {
          await refreshProfileRef.current?.();
        } catch {
          /* profile refetch can fail offline; the local patch still unlocks Tour Pro */
        }
        if (cancelled) return;
        patchProfileRef.current?.({ is_beta_tester: true });
        return;
      }
      if (result.status === 'full') {
        clearUserUnlock(userId);
        patchProfileRef.current?.({ is_beta_tester: false });
        setAccess('full');
        return;
      }
      if (!readUserUnlock(userId)) setAccess('unknown');
    }).catch(() => {
      if (cancelled || readUserUnlock(userId)) return;
      setAccess('unknown');
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]);

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

  const cachedForUser = Boolean(user?.id && readUserUnlock(user.id) && access !== 'full');
  const tester = Boolean(user?.id) && (access === 'tester' || profile?.is_beta_tester === true || cachedForUser);
  const verifying = Boolean(user?.id) && !tester && access === 'verifying';

  return (
    <>
      {verifying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
          <div className="w-full max-w-sm rounded-3xl border p-5 space-y-3 text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <Loader2 size={22} className="mx-auto animate-spin" style={{ color: 'var(--accent-emerald)' }} />
            <p className="text-sm font-semibold">Verifying beta access...</p>
          </div>
        </div>
      )}

      {tester && (
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
      )}
    </>
  );
}
