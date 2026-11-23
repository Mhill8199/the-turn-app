import { useState, useEffect } from 'react';
import { Wand2, AlertTriangle, Plus, Trash2, Check, RefreshCw, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export const DEFAULT_CUSTOM_BAG = [
  { id: '1', club_type: 'Driver', loft: '10.5°', carry_yards: 265, total_yards: 284, shot_shape: 'Fade', bounce_grind: '', grip_model: 'MCC Plus4', rounds_on_grip: 24 },
  { id: '2', club_type: '3-Wood', loft: '15°', carry_yards: 240, total_yards: 254, shot_shape: 'Straight', bounce_grind: '', grip_model: 'MCC Plus4', rounds_on_grip: 24 },
  { id: '3', club_type: '4-Hybrid', loft: '22°', carry_yards: 212, total_yards: 220, shot_shape: 'Draw', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 18 },
  { id: '4', club_type: '5-Iron', loft: '25°', carry_yards: 192, total_yards: 199, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 32 },
  { id: '5', club_type: '6-Iron', loft: '28°', carry_yards: 178, total_yards: 184, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 32 },
  { id: '6', club_type: '7-Iron', loft: '32°', carry_yards: 165, total_yards: 170, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '7', club_type: '8-Iron', loft: '36°', carry_yards: 152, total_yards: 156, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '8', club_type: '9-Iron', loft: '41°', carry_yards: 140, total_yards: 143, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '9', club_type: 'PW', loft: '46°', carry_yards: 128, total_yards: 130, shot_shape: 'Straight', bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 38 },
  { id: '10', club_type: '54° Wedge', loft: '54°', carry_yards: 112, total_yards: 113, shot_shape: 'Straight', bounce_grind: '10 S-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 41 },
  { id: '11', club_type: '58° Wedge', loft: '58°', carry_yards: 98, total_yards: 99, shot_shape: 'Straight', bounce_grind: '12 D-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 43 },
  { id: '12', club_type: '60° Wedge', loft: '60°', carry_yards: 85, total_yards: 86, shot_shape: 'Straight', bounce_grind: '04 T-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 29 },
];

export default function StockBag({ clubs, setClubs }) {
  const { user } = useAuth();
  const [driverInput, setDriverInput] = useState(265);
  const [sevenIronInput, setSevenIronInput] = useState(165);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [addClubOpen, setAddClubOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [newClubName, setNewClubName] = useState('');
  const [newLoft, setNewLoft] = useState('');
  const [newCarry, setNewCarry] = useState(200);
  const [newTotal, setNewTotal] = useState(208);
  const [newShape, setNewShape] = useState('Straight');

  useEffect(() => {
    localStorage.setItem('the-turn-bag', JSON.stringify(clubs));
  }, [clubs]);

  // Load user's saved clubs from Supabase when signed in
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('golf_clubs')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setClubs(
            data.map((row) => ({
              id: row.id,
              club_type: row.club_type,
              loft: row.loft ? `${row.loft}°` : '',
              carry_yards: row.carry_yards,
              total_yards: row.total_yards || row.carry_yards,
              shot_shape: row.shot_shape || 'Straight',
              bounce_grind: row.bounce_grind || '',
              grip_model: row.grip_model || 'Tour Velvet',
              rounds_on_grip: row.rounds_on_grip || 0,
            }))
          );
        }
      });
  }, [user?.id, setClubs]);

  const syncBagToSupabase = async (updatedList) => {
    if (!user?.id) return;
    setSyncMsg('Syncing bag...');
    await supabase.from('golf_clubs').delete().eq('user_id', user.id);
    const rows = updatedList.map((c, idx) => ({
      user_id: user.id,
      club_type: c.club_type,
      loft: parseFloat(String(c.loft).replace('°', '')) || null,
      bounce_grind: c.bounce_grind || null,
      carry_yards: c.carry_yards,
      total_yards: c.total_yards,
      shot_shape: (c.shot_shape || 'straight').toLowerCase(),
      grip_model: c.grip_model || null,
      rounds_on_grip: c.rounds_on_grip || 0,
      sort_order: idx + 1,
    }));
    await supabase.from('golf_clubs').insert(rows);
    setSyncMsg('Synced to cloud');
    setTimeout(() => setSyncMsg(''), 2000);
  };

  const runQuickFill = () => {
    const d = Number(driverInput) || 260;
    const i7 = Number(sevenIronInput) || 160;
    const step = Math.round((i7 - 95) / 5);

    const mapped = {
      'Driver': d,
      '3-Wood': Math.round(d * 0.905),
      '4-Hybrid': Math.round((d * 0.905 + (i7 + step * 2)) / 2),
      '5-Iron': i7 + step * 2,
      '6-Iron': i7 + step,
      '7-Iron': i7,
      '8-Iron': i7 - step,
      '9-Iron': i7 - step * 2,
      'PW': i7 - step * 3,
      '54° Wedge': Math.max(70, i7 - step * 4 - 2),
      '58° Wedge': Math.max(60, i7 - step * 5 - 3),
      '60° Wedge': Math.max(50, i7 - step * 6 - 3),
    };

    const next = clubs.map((c) => {
      const carry = mapped[c.club_type] ?? c.carry_yards;
      const rollout = c.club_type === 'Driver' ? 19 : c.club_type.includes('Wood') ? 14 : c.club_type.includes('Iron') ? 5 : 1;
      return { ...c, carry_yards: carry, total_yards: carry + rollout };
    });

    setClubs(next);
    syncBagToSupabase(next);
    setWizardOpen(false);
  };

  const handleAddClub = (e) => {
    e.preventDefault();
    if (!newClubName.trim()) return;
    const carry = Number(newCarry) || 150;
    const total = Math.max(carry, Number(newTotal) || carry);
    const created = {
      id: crypto.randomUUID(),
      club_type: newClubName.trim(),
      loft: newLoft.trim(),
      carry_yards: carry,
      total_yards: total,
      shot_shape: newShape,
      bounce_grind: '',
      grip_model: 'Custom Grip',
      rounds_on_grip: 0,
    };
    const next = [...clubs, created].sort((a, b) => b.carry_yards - a.carry_yards);
    setClubs(next);
    syncBagToSupabase(next);
    setNewClubName('');
    setNewLoft('');
    setAddClubOpen(false);
  };

  const updateClubField = (id, field, value) => {
    const next = clubs.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    setClubs(next);
  };

  const removeClub = (id) => {
    const next = clubs.filter((c) => c.id !== id);
    setClubs(next);
    syncBagToSupabase(next);
  };

  const logRoundPlayed = () => {
    const next = clubs.map((c) => ({ ...c, rounds_on_grip: (c.rounds_on_grip || 0) + 1 }));
    setClubs(next);
    syncBagToSupabase(next);
  };

  const regripWornClubs = () => {
    const next = clubs.map((c) => (c.rounds_on_grip >= 40 ? { ...c, rounds_on_grip: 0 } : c));
    setClubs(next);
    syncBagToSupabase(next);
  };

  const wornGripsCount = clubs.filter((c) => c.rounds_on_grip >= 40).length;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">My Custom Golf Bag ({clubs.length}/14)</h2>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {syncMsg || 'Live-synced to Course Caddie & Target Rings'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => { setAddClubOpen(!addClubOpen); setWizardOpen(false); }}
            className="px-2.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            <Plus size={14} /> Club
          </button>
          <button
            onClick={() => { setWizardOpen(!wizardOpen); setAddClubOpen(false); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Wand2 size={14} /> Wizard
          </button>
        </div>
      </div>

      {/* Round Counter & Cloud Save Strip */}
      <div className="flex gap-2">
        <button
          onClick={logRoundPlayed}
          className="flex-1 py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <RefreshCw size={13} /> +1 Round to All Grips
        </button>
        {user && (
          <button
            onClick={() => syncBagToSupabase(clubs)}
            className="px-3 py-2 rounded-xl border text-xs font-semibold"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}
          >
            Save Cloud
          </button>
        )}
      </div>

      {addClubOpen && (
        <form onSubmit={handleAddClub} className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
            Add Custom Club
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              required
              placeholder="e.g., 7-Wood"
              value={newClubName}
              onChange={(e) => setNewClubName(e.target.value)}
              className="col-span-2 rounded-xl px-3 py-2 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
            <input
              type="text"
              placeholder="Loft (21°)"
              value={newLoft}
              onChange={(e) => setNewLoft(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] block mb-1" style={{ color: 'var(--text-secondary)' }}>Carry (yds)</label>
              <input
                type="number"
                value={newCarry}
                onChange={(e) => setNewCarry(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-[10px] block mb-1" style={{ color: 'var(--text-secondary)' }}>Total (yds)</label>
              <input
                type="number"
                value={newTotal}
                onChange={(e) => setNewTotal(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-[10px] block mb-1" style={{ color: 'var(--text-secondary)' }}>Stock Shape</label>
              <select
                value={newShape}
                onChange={(e) => setNewShape(e.target.value)}
                className="w-full rounded-xl px-2 py-1.5 text-xs border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="Straight">Straight</option>
                <option value="Fade">Fade</option>
                <option value="Draw">Draw</option>
              </select>
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5" style={{ backgroundColor: 'var(--accent-emerald)' }}>
            <Check size={14} /> Add to Bag
          </button>
        </form>
      )}

      {wizardOpen && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
            2-Club Gapping Wizard
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Driver Carry (yds)</label>
              <input
                type="number"
                value={driverInput}
                onChange={(e) => setDriverInput(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>7-Iron Carry (yds)</label>
              <input
                type="number"
                value={sevenIronInput}
                onChange={(e) => setSevenIronInput(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>
          <button
            onClick={runQuickFill}
            className="w-full py-2.5 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            Auto-Populate Full Bag Gapping
          </button>
        </div>
      )}

      {wornGripsCount > 0 && (
        <div className="rounded-2xl p-3 border flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-gold)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: 'var(--accent-gold)' }} />
            <span className="text-xs font-medium">{wornGripsCount} clubs over 40 rds</span>
          </div>
          <button
            onClick={regripWornClubs}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1 shrink-0"
            style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
          >
            <RotateCcw size={11} /> Log Regrip
          </button>
        </div>
      )}

      <div className="space-y-2">
        {clubs.map((club, idx) => {
          const prevCarry = idx > 0 ? clubs[idx - 1].carry_yards : null;
          const gap = prevCarry ? prevCarry - club.carry_yards : null;

          return (
            <div
              key={club.id}
              className="rounded-xl p-3 border flex items-center justify-between gap-2"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm truncate">{club.club_type}</span>
                  {club.loft && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {club.loft}
                    </span>
                  )}
                  {club.bounce_grind && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {club.bounce_grind}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                  <select
                    value={club.shot_shape || 'Straight'}
                    onChange={(e) => updateClubField(club.id, 'shot_shape', e.target.value)}
                    className="rounded px-1.5 py-0.5 text-[10px] border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <option value="Straight">Straight</option>
                    <option value="Fade">Fade</option>
                    <option value="Draw">Draw</option>
                  </select>
                  <span className={club.rounds_on_grip >= 40 ? 'text-amber-500 font-semibold' : ''}>{club.rounds_on_grip} rds</span>
                  {gap !== null && gap > 18 && <span className="text-amber-500 font-semibold">{gap}y gap</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Carry</span>
                    <input
                      type="number"
                      value={club.carry_yards}
                      onChange={(e) => updateClubField(club.id, 'carry_yards', parseInt(e.target.value, 10) || 0)}
                      className="w-13 text-right font-mono font-bold text-xs rounded-lg px-1.5 py-1 border"
                      style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                    />
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Total</span>
                    <input
                      type="number"
                      value={club.total_yards}
                      onChange={(e) => updateClubField(club.id, 'total_yards', parseInt(e.target.value, 10) || 0)}
                      className="w-13 text-right font-mono text-[11px] rounded-lg px-1.5 py-0.5 border"
                      style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeClub(club.id)}
                  className="p-1.5 opacity-40 hover:opacity-100 hover:text-red-400"
                  title="Remove club"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
