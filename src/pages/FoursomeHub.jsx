import { useState } from 'react';
import { Send, Share2, Check, Shirt } from 'lucide-react';

export default function FoursomeHub() {
  const [course, setCourse] = useState('Dos Lagos Golf Club');
  const [teeTime, setTeeTime] = useState('Saturday • 7:00 AM');
  const [sideGame, setSideGame] = useState('$5 Nassau (Auto-Press)');
  const [copied, setCopied] = useState(false);

  const [players, setPlayers] = useState([
    { id: '1', name: 'You', status: 'IN', fit: 'Navy Polo • Stone Shorts • FJ White', tee: 'Blue' },
    { id: '2', name: 'Jason', status: 'IN', fit: 'Grey Polo • Black Pants • Jordan Low', tee: 'Blue' },
    { id: '3', name: 'Rylie', status: 'IN', fit: 'White Polo • Navy Shorts', tee: 'Blue' },
    { id: '4', name: 'Ryan', status: 'MAYBE', fit: 'Pending fit lock', tee: 'Blue' },
  ]);

  const inviteUrl = `${window.location.origin}/?invite=dos-lagos-7am`;
  const smsBody = encodeURIComponent(
    `Tee time locked for ${course} (${teeTime}). Side game: ${sideGame}. Tap IN & check outfits on The Turn: ${inviteUrl}`
  );

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const cycleStatus = (id) => {
    const order = ['IN', 'MAYBE', 'OUT'];
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = order[(order.indexOf(p.status) + 1) % order.length];
        return { ...p, status: next };
      })
    );
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
            Active Foursome
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {players.filter((p) => p.status === 'IN').length}/4 Confirmed
          </span>
        </div>

        <input
          type="text"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className="w-full font-bold text-base bg-transparent border-b pb-1 focus:outline-none"
          style={{ borderColor: 'var(--border-subtle)' }}
        />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <input
            type="text"
            value={teeTime}
            onChange={(e) => setTeeTime(e.target.value)}
            className="rounded-xl px-3 py-2 border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="text"
            value={sideGame}
            onChange={(e) => setSideGame(e.target.value)}
            className="rounded-xl px-3 py-2 border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <a
            href={`sms:?&body=${smsBody}`}
            className="flex-1 py-2.5 rounded-xl font-semibold text-xs text-white flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Send size={14} /> Text Foursome Invite
          </a>
          <button
            onClick={copyInviteLink}
            className="px-3.5 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {copied ? <><Check size={14} className="text-emerald-500" /> Copied</> : <><Share2 size={14} /> Link</>}
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Shirt size={15} style={{ color: 'var(--accent-emerald)' }} /> Lineup & Outfit Check
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Tap status to toggle</span>
        </div>

        {players.map((p) => (
          <div
            key={p.id}
            className="p-3 rounded-xl border flex items-center justify-between"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            <div>
              <div className="font-semibold text-sm flex items-center gap-2">
                {p.name}
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  {p.tee} Tees
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{p.fit}</div>
            </div>

            <button
              onClick={() => cycleStatus(p.id)}
              className={`text-xs font-mono font-bold px-3 py-1 rounded-full ${
                p.status === 'IN'
                  ? 'bg-emerald-700/20 text-emerald-500'
                  : p.status === 'MAYBE'
                  ? 'bg-amber-500/20 text-amber-500'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {p.status}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
