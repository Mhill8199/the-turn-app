import { useState, useEffect } from 'react';
import { Briefcase, Plus, Trash2, AlertTriangle, CheckCircle2, Layers, Compass, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useUnits } from '../utils/distanceUnits';

export const DEFAULT_CUSTOM_BAG = [
  { id: '1', club_type: 'Driver', loft: 10.5, bounce_grind: 'Std', carry_yards: 265, total_yards: 284, shot_shape: 'Straight', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14 },
  { id: '2', club_type: '3-Wood', loft: 15, bounce_grind: 'Std', carry_yards: 240, total_yards: 254, shot_shape: 'Fade', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14 },
  { id: '3', club_type: '4-Hybrid', loft: 22, bounce_grind: 'Std', carry_yards: 215, total_yards: 225, shot_shape: 'Straight', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14 },
  { id: '4', club_type: '5-Iron', loft: 25, bounce_grind: 'Std', carry_yards: 196, total_yards: 204, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '5', club_type: '6-Iron', loft: 28, bounce_grind: 'Std', carry_yards: 184, total_yards: 191, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '6', club_type: '7-Iron', loft: 32, bounce_grind: 'Std', carry_yards: 172, total_yards: 178, shot_shape: 'Draw', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '7', club_type: '8-Iron', loft: 36, bounce_grind: 'Std', carry_yards: 160, total_yards: 165, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '8', club_type: '9-Iron', loft: 41, bounce_grind: 'Std', carry_yards: 148, total_yards: 152, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '9', club_type: 'PW', loft: 46, bounce_grind: '10F', carry_yards: 135, total_yards: 138, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22 },
  { id: '10', club_type: '54° Wedge', loft: 54, bounce_grind: '10S', carry_yards: 112, total_yards: 114, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31 },
  { id: '11', club_type: '58° Wedge', loft: 58, bounce_grind: '12D', carry_yards: 98, total_yards: 100, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31 },
  { id: '12', club_type: '60° Wedge', loft: 60, bounce_grind: '04T', carry_yards: 84, total_yards: 85, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31 },
];

function parseBounceDeg(bounceGrind = '') {
  const match = String(bounceGrind).match(/(\d{1,2})/);
  return match ? Number(match[1]) : null;
}

export default function StockBag({ clubs, setClubs }) {
  const { user } = useAuth();
  const { formatDistance, tabularNumsClass } = useUnits();
  const [newClubName, setNewClubName] = useState('');
  const [newCarry, setNewCarry] = useState(122);
  const [newTotal, setNewTotal] = useState(125);
  const [newBounce, setNewBounce] = useState('08M');
  const [turfCondition, setTurfCondition] = useState('balanced');

  useEffect(() => {
    localStorage.setItem('the-turn-bag', JSON.stringify(clubs));
  }, [clubs]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('golf_clubs')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setClubs(data);
      });
  }, [user?.id, setClubs]);

  const updateField = async (id, field, value) => {
    const updated = clubs.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    setClubs(updated);

    if (user?.id) {
      await supabase.from('golf_clubs').update({ [field]: value }).eq('id', id).eq('user_id', user.id);
    }
  };

  const addClub = async (e) => {
    e.preventDefault();
    if (!newClubName.trim()) return;

    const newItem = {
      id: crypto.randomUUID(),
      club_type: newClubName.trim(),
      loft: 50,
      bounce_grind: newBounce.trim() || 'Std',
      carry_yards: Number(newCarry) || 120,
      total_yards: Number(newTotal) || Number(newCarry) + 3,
      shot_shape: 'Straight',
      grip_model: 'Golf Pride MCC',
      rounds_on_grip: 0,
    };

    const next = [...clubs, newItem].sort((a, b) => b.carry_yards - a.carry_yards);
    setClubs(next);
    setNewClubName('');

    if (user?.id) {
      await supabase.from('golf_clubs').insert({
        user_id: user.id,
        club_type: newItem.club_type,
        loft: newItem.loft,
        bounce_grind: newItem.bounce_grind,
        carry_yards: newItem.carry_yards,
        total_yards: newItem.total_yards,
        shot_shape: newItem.shot_shape,
        grip_model: newItem.grip_model,
        rounds_on_grip: 0,
        sort_order: next.length,
      });
    }
  };

  const removeClub = async (id) => {
    setClubs((prev) => prev.filter((c) => c.id !== id));
    if (user?.id) {
      await supabase.from('golf_clubs').delete().eq('id', id).eq('user_id', user.id);
    }
  };

  // Yardage Gap & Overlap Diagnostic
  const sortedClubs = [...clubs].sort((a, b) => (Number(b.carry_yards) || 0) - (Number(a.carry_yards) || 0));
  const gapAlerts = [];
  for (let i = 0; i < sortedClubs.length - 1; i++) {
    const upper = sortedClubs[i];
    const lower = sortedClubs[i + 1];
    const diff = (Number(upper.carry_yards) || 0) - (Number(lower.carry_yards) || 0);
    if (diff > 18) {
      gapAlerts.push({
        type: 'deadzone',
        pair: `${upper.club_type} -> ${lower.club_type}`,
        diff,
        midTarget: Math.round(((Number(upper.carry_yards) || 0) + (Number(lower.carry_yards) || 0)) / 2),
        advice: `${formatDistance(diff)} dead zone (${formatDistance(lower.carry_yards)} to ${formatDistance(upper.carry_yards)}). Consider strengthening ${lower.club_type} or adding a ~${formatDistance(Math.round(((Number(upper.carry_yards) || 0) + (Number(lower.carry_yards) || 0)) / 2))} gap club.`,
      });
    } else if (diff < 7) {
      gapAlerts.push({
        type: 'overlap',
        pair: `${upper.club_type} / ${lower.club_type}`,
        diff,
        advice: `Only ${formatDistance(diff)} separation — redundant slot you could free up for a specialty wedge or hybrid.`,
      });
    }
  }

  // Wedge Bounce & Turf-Firmness Advisor
  const wedges = sortedClubs.filter(
    (c) => /wedge|pw|gw|sw|lw|50|52|54|56|58|60|62/i.test(c.club_type) || (Number(c.loft) >= 45 && Number(c.loft) <= 64)
  );

  const scoredWedges = wedges.map((w) => {
    const bounce = parseBounceDeg(w.bounce_grind);
    const bVal = bounce ?? 10;
    let fitScore = 50;
    if (turfCondition === 'soft') {
      fitScore = bVal >= 10 ? 95 : bVal >= 8 ? 70 : 35;
    } else if (turfCondition === 'firm') {
      fitScore = bVal <= 6 ? 95 : bVal <= 10 ? 72 : 38;
    } else {
      fitScore = bVal >= 8 && bVal <= 12 ? 92 : 70;
    }
    return { ...w, bounceDeg: bounce, fitScore };
  });

  const leadWedge = [...scoredWedges].sort((a, b) => b.fitScore - a.fitScore)[0];

  const turfSummary =
    turfCondition === 'soft'
      ? 'Morning Dew / Soft Turf: Higher bounce (10°-14°, D/S/K grinds) prevents leading-edge digging on pitches and wet bunker shots.'
      : turfCondition === 'firm'
      ? 'Dry & Firm / Tight Lies: Low bounce (04°-08°, T/M/L grinds) keeps the leading edge under the ball without skidding.'
      : 'Balanced Fairway Turf: Mid-bounce (08°-12°, S/M/F grinds) handles full swings, square pitches, and open-face bunker shots cleanly.';

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-3xl p-4 border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div>
          <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Personal Stock Bag • {clubs.length}/14 Clubs
          </span>
          <h2 className="text-lg font-semibold mt-0.5 flex items-center gap-2">
            <Briefcase size={18} style={{ color: 'var(--accent-emerald)' }} /> Custom Carry & Rollout
          </h2>
        </div>
        <span className="text-xs font-mono px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {user ? 'Cloud Synced' : 'Local Bag'}
        </span>
      </div>

      {/* Yardage Gap & Dead-Zone Detector */}
      <div className="rounded-3xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: gapAlerts.length > 0 ? 'var(--border-subtle)' : 'var(--accent-emerald)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: gapAlerts.length > 0 ? 'var(--text-primary)' : 'var(--accent-emerald)' }}>
            <Layers size={14} /> Yardage Gap & Dead-Zone Detector
          </span>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            Target 10–15y gaps
          </span>
        </div>

        {gapAlerts.length === 0 ? (
          <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <CheckCircle2 size={14} /> Clean gapping across your entire bag — zero dead zones over 18 yards.
          </div>
        ) : (
          <div className="space-y-1.5">
            {gapAlerts.slice(0, 4).map((g, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl border text-xs space-y-0.5"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="font-semibold flex items-center gap-1.5 tabular-nums" style={{ color: g.type === 'deadzone' ? 'var(--text-primary)' : '#B91C1C' }}>
                  <AlertTriangle size={13} /> {g.pair} ({formatDistance(g.diff)} gap)
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{g.advice}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wedge Bounce & Turf-Firmness Advisor */}
      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <Compass size={14} /> Wedge Bounce & Turf Advisor
          </span>
          <div className="flex gap-1">
            {[
              { id: 'soft', label: 'Dew / Soft' },
              { id: 'balanced', label: 'Balanced' },
              { id: 'firm', label: 'Dry / Firm' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTurfCondition(t.id)}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition ${
                  turfCondition === t.id ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={turfCondition !== t.id ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {turfSummary}
        </p>

        {leadWedge && (
          <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--accent-emerald)' }}>
            <span className="flex items-center gap-1.5">
              <Sparkles size={13} style={{ color: 'var(--accent-emerald)' }} />
              <strong>Primary Greenside Wedge:</strong> {leadWedge.club_type} ({leadWedge.bounce_grind})
            </span>
            <span className={`font-mono text-[11px] ${tabularNumsClass}`} style={{ color: 'var(--accent-emerald)' }}>
              {formatDistance(leadWedge.carry_yards)} carry
            </span>
          </div>
        )}

        {scoredWedges.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {scoredWedges.map((w) => (
              <div
                key={w.id}
                className="p-2 rounded-xl border flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: w.fitScore >= 85 ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                }}
              >
                <div>
                  <div className="font-semibold">{w.club_type}</div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    Bounce/Grind: {w.bounce_grind}
                  </div>
                </div>
                <span
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: w.fitScore >= 85 ? 'rgba(16,185,129,0.18)' : 'var(--bg-surface)',
                    color: w.fitScore >= 85 ? 'var(--accent-emerald)' : 'var(--text-primary)',
                  }}
                >
                  {w.fitScore >= 85 ? 'Ideal' : w.fitScore >= 65 ? 'Playable' : 'Dig/Skid Risk'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Custom Club Form */}
      <form onSubmit={addClub} className="rounded-3xl p-3.5 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Add Club or Wedge to Bag
        </div>
        <div className="grid grid-cols-12 gap-1.5">
          <input
            type="text"
            placeholder="e.g., 50° Gap"
            value={newClubName}
            onChange={(e) => setNewClubName(e.target.value)}
            className="col-span-4 rounded-xl px-2.5 py-2 text-xs border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="text"
            placeholder="08M"
            value={newBounce}
            onChange={(e) => setNewBounce(e.target.value)}
            className="col-span-2 rounded-xl px-2 py-2 text-xs font-mono border text-center"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="number"
            placeholder="Carry"
            value={newCarry}
            onChange={(e) => setNewCarry(e.target.value)}
            className="col-span-2 rounded-xl px-2 py-2 text-xs font-mono border text-center"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="number"
            placeholder="Total"
            value={newTotal}
            onChange={(e) => setNewTotal(e.target.value)}
            className="col-span-2 rounded-xl px-2 py-2 text-xs font-mono border text-center"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <button
            type="submit"
            className="col-span-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Plus size={15} />
          </button>
        </div>
      </form>

      {/* Club List */}
      <div className="space-y-2.5">
        {sortedClubs.map((club) => {
          const gripDue = (club.rounds_on_grip || 0) >= 30;
          return (
            <div
              key={club.id}
              className="rounded-3xl p-3.5 border space-y-2.5"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm">{club.club_type}</span>
                  <span className="ml-2 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                    ({club.bounce_grind})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={club.shot_shape || 'Straight'}
                    onChange={(e) => updateField(club.id, 'shot_shape', e.target.value)}
                    className="text-xs rounded-lg px-2 py-1 border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <option value="Straight">Straight</option>
                    <option value="Draw">Draw</option>
                    <option value="Fade">Fade</option>
                  </select>

                  <button onClick={() => removeClub(club.id)} className="opacity-50 hover:opacity-100 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs" data-numeric>
                <div>
                  <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>Carry · <span className={tabularNumsClass}>{formatDistance(club.carry_yards)}</span></label>
                  <input
                    type="number"
                    value={club.carry_yards}
                    onChange={(e) => updateField(club.id, 'carry_yards', Number(e.target.value))}
                    className={`w-full font-mono font-bold rounded-lg px-2 py-1 border ${tabularNumsClass}`}
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>Total · <span className={tabularNumsClass}>{formatDistance(club.total_yards)}</span></label>
                  <input
                    type="number"
                    value={club.total_yards}
                    onChange={(e) => updateField(club.id, 'total_yards', Number(e.target.value))}
                    className={`w-full font-mono font-bold rounded-lg px-2 py-1 border ${tabularNumsClass}`}
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>Grip Rounds</label>
                  <input
                    type="number"
                    value={club.rounds_on_grip || 0}
                    onChange={(e) => updateField(club.id, 'rounds_on_grip', Number(e.target.value))}
                    className={`w-full font-mono font-bold rounded-lg px-2 py-1 border ${tabularNumsClass}`}
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{club.grip_model}</span>
                {gripDue ? (
                  <span className="text-amber-500 font-medium flex items-center gap-1">
                    <AlertTriangle size={12} /> Fresh grip due
                  </span>
                ) : (
                  <span className="flex items-center gap-1" style={{ color: 'var(--accent-emerald)' }}>
                    <CheckCircle2 size={12} /> Tack OK
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}