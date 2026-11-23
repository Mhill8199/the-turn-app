import { useState } from 'react';
import { Wand2, AlertTriangle } from 'lucide-react';

const DEFAULT_BAG = [
  { id: '1', club_type: 'Driver', carry_yards: 265, total_yards: 282, bounce_grind: '', grip_model: 'MCC Plus4', rounds_on_grip: 24 },
  { id: '2', club_type: '3-Wood', carry_yards: 240, total_yards: 254, bounce_grind: '', grip_model: 'MCC Plus4', rounds_on_grip: 24 },
  { id: '3', club_type: '4-Hybrid', carry_yards: 212, total_yards: 220, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 18 },
  { id: '4', club_type: '5-Iron', carry_yards: 192, total_yards: 199, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 32 },
  { id: '5', club_type: '6-Iron', carry_yards: 178, total_yards: 184, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 32 },
  { id: '6', club_type: '7-Iron', carry_yards: 165, total_yards: 170, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '7', club_type: '8-Iron', carry_yards: 152, total_yards: 156, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '8', club_type: '9-Iron', carry_yards: 140, total_yards: 143, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 35 },
  { id: '9', club_type: 'PW (46°)', carry_yards: 128, total_yards: 130, bounce_grind: '', grip_model: 'Tour Velvet', rounds_on_grip: 38 },
  { id: '10', club_type: '54° Wedge', carry_yards: 112, total_yards: 113, bounce_grind: '10 S-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 41 },
  { id: '11', club_type: '58° Wedge', carry_yards: 98, total_yards: 99, bounce_grind: '12 D-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 43 },
  { id: '12', club_type: '60° Wedge', carry_yards: 85, total_yards: 86, bounce_grind: '04 T-Grind', grip_model: 'Tour Velvet', rounds_on_grip: 29 },
];

export default function StockBag() {
  const [clubs, setClubs] = useState(DEFAULT_BAG);
  const [driverInput, setDriverInput] = useState(265);
  const [sevenIronInput, setSevenIronInput] = useState(165);
  const [wizardOpen, setWizardOpen] = useState(false);

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
      'PW (46°)': i7 - step * 3,
      '54° Wedge': Math.max(70, i7 - step * 4 - 2),
      '58° Wedge': Math.max(60, i7 - step * 5 - 3),
      '60° Wedge': Math.max(50, i7 - step * 6 - 3),
    };

    setClubs((prev) =>
      prev.map((c) => {
        const carry = mapped[c.club_type] ?? c.carry_yards;
        const rollout = c.club_type === 'Driver' ? 17 : c.club_type.includes('Wood') ? 12 : c.club_type.includes('Iron') ? 5 : 1;
        return { ...c, carry_yards: carry, total_yards: carry + rollout };
      })
    );
    setWizardOpen(false);
  };

  const updateCarry = (id, newCarry) => {
    const val = parseInt(newCarry, 10) || 0;
    setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, carry_yards: val } : c)));
  };

  const wornGripsCount = clubs.filter((c) => c.rounds_on_grip >= 40).length;

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Stock Yardages & Bag</h2>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Feeds Course Target Rings & Wearable Caddie</p>
        </div>
        <button
          onClick={() => setWizardOpen(!wizardOpen)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          <Wand2 size={14} /> Quick-Fill
        </button>
      </div>

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
            Auto-Populate Full 12-Club Gapping
          </button>
        </div>
      )}

      {wornGripsCount > 0 && (
        <div className="rounded-2xl p-3.5 border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-gold)' }}>
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} style={{ color: 'var(--accent-gold)' }} />
            <div>
              <div className="text-xs font-semibold">{wornGripsCount} Clubs Over 40 Rounds</div>
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Fresh grips restore ~2–3 mph control & tackiness</div>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border" style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}>
            Log Regrip
          </span>
        </div>
      )}

      <div className="space-y-2">
        {clubs.map((club, idx) => {
          const prevCarry = idx > 0 ? clubs[idx - 1].carry_yards : null;
          const gap = prevCarry ? prevCarry - club.carry_yards : null;

          return (
            <div
              key={club.id}
              className="rounded-xl p-3 border flex items-center justify-between"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{club.club_type}</span>
                  {club.bounce_grind && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      {club.bounce_grind}
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {club.grip_model} • <span className={club.rounds_on_grip >= 40 ? 'text-amber-500 font-semibold' : ''}>{club.rounds_on_grip} rds</span>
                  {gap !== null && gap > 18 && <span className="ml-2 text-amber-500">• {gap}y gap</span>}
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={club.carry_yards}
                    onChange={(e) => updateCarry(club.id, e.target.value)}
                    className="w-14 text-right font-mono font-bold text-sm rounded-lg px-1.5 py-1 border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>yds</span>
                </div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Total: {club.total_yards}y
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
