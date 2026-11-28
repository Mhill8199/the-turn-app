import { useState } from 'react';
import { X, Mail, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthModal({ onClose }) {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMsg('');

    const { error } = isSignUp
      ? await signUpWithEmail(email, password, displayName)
      : await signInWithEmail(email, password);

    setSubmitting(false);
    if (error) {
      setStatusMsg(error.message);
    } else if (isSignUp) {
      setStatusMsg('Account created! Check your inbox if email confirmation is enabled, or sign in now.');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-end sm:items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl p-5 border space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">{isSignUp ? 'Join The Turn' : 'Sign In to The Turn'}</h3>
          <button type="button" onClick={onClose} className="p-1 opacity-75 hover:opacity-100"><X size={18} /></button>
        </div>

        {isSignUp && (
          <div className="relative">
            <User size={15} className="absolute left-3 top-3 opacity-60" />
            <input
              type="text"
              required
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        )}

        <div className="relative">
          <Mail size={15} className="absolute left-3 top-3 opacity-60" />
          <input
            type="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
        </div>

        <div className="relative">
          <Lock size={15} className="absolute left-3 top-3 opacity-60" />
          <input
            type="password"
            required
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
        </div>

        {statusMsg && <p className="text-xs text-amber-500">{statusMsg}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl font-semibold text-sm text-white"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          {submitting ? 'Please wait...' : isSignUp ? 'Create Free Clubhouse Account' : 'Sign In'}
        </button>

        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setStatusMsg(''); }}
          className="w-full text-xs text-center underline opacity-80"
        >
          {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Create Free Profile'}
        </button>
      </form>
    </div>
  );
}
