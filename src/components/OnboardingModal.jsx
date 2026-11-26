import { useState } from 'react';
import { Compass, Briefcase, Shirt, ChevronRight, ChevronLeft, Check, X } from 'lucide-react';
import { COURSE_PRESETS } from '../lib/weatherPhysics';

export default function OnboardingModal({ clubs, setClubs, onComplete, onClose }) {
  const [step, setStep] = useState(1);
  const [driverCarry, setDriverCarry] = useState(clubs[0]?.carry_yards || 265);
  const [sevenIronCarry, setSevenIronCarry] = useState(
    clubs.find((c) => c.club_type === '7-Iron')?.carry_yards || 165
  );
  const [homeCourseId, setHomeCourseId] = useState(COURSE_PRESETS[0].id);
  const [weatherPref, setWeatherPref] = useState('warm');
  const [vibePref, setVibePref] = useState('classic');

  const applyYardagesToBag = () => {
    const d = Math.max(120, Number(driverCarry) || 260);
    const i7 = Math.max(80, Number(sevenIronCarry) || 160);
    const stepGap = Math.round((i7 - 95) / 5);

    const mapped = {
      'Driver': d,
      '3-Wood': Math.round(d * 0.905),
      '4-Hybrid': Math.round((d * 0.905 + (i7 + stepGap * 2)) / 2),
      '5-Iron': i7 + stepGap * 2,
      '6-Iron': i7 + stepGap,
      '7-Iron': i7,
      '8-Iron': i7 - stepGap,
      '9-Iron': i7 - stepGap * 2,
      'PW': i7 - stepGap * 3,
      '54° Wedge': Math.max(70, i7 - stepGap * 4 - 2),
      '58° Wedge': Math.max(60, i7 - stepGap * 5 - 3),
      '60° Wedge': Math.max(50, i7 - stepGap * 6 - 3),
    };

    const updated = clubs.map((c) => {
      const carry = mapped[c.club_type] ?? c.carry_yards;
      const rollout = c.club_type === 'Driver' ? 19 : c.club_type.includes('Wood') ? 14 : c.club_type.includes('Iron') ? 5 : 1;
      return { ...c, carry_yards: carry, total_yards: carry + rollout };
    });

    setClubs(updated);
    localStorage.setItem('the-turn-bag', JSON.stringify(updated));
  };

  const finishOnboarding = () => {
    applyYardagesToBag();
    localStorage.setItem('the-turn-home-course', homeCourseId);
    localStorage.setItem('the-turn-fit-prefs', JSON.stringify({ weather: weatherPref, vibe: vibePref }));
    localStorage.setItem('the-turn-onboarded', 'true');
    onComplete?.();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-3xl p-5 border space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            First-Launch Setup • Step {step} of 3
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center opacity-70 hover:opacity-100"
            aria-label="Skip Onboarding"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="grid grid-cols-3 gap-1.5">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className="h-1.5 rounded-full transition"
              style={{
                backgroundColor: step >= s ? 'var(--accent-emerald)' : 'var(--bg-elevated)',
              }}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-bold text-base">
              <Briefcase size={18} style={{ color: 'var(--accent-emerald)' }} />
              Dial In Your Stock Yardages
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Enter your average carry for Driver and 7-Iron. We&apos;ll gap your bag automatically so target arcs match your game on hole one.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Driver Carry (yds)</label>
                <input
                  type="number"
                  value={driverCarry}
                  onChange={(e) => setDriverCarry(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm font-mono font-bold border"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>7-Iron Carry (yds)</label>
                <input
                  type="number"
                  value={sevenIronCarry}
                  onChange={(e) => setSevenIronCarry(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm font-mono font-bold border"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-bold text-base">
              <Compass size={18} style={{ color: 'var(--accent-emerald)' }} />
              Pick Your Home Course
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Loads live temperature, dew point, wind, and course elevation to adjust carry and turf rollout automatically.
            </p>
            <div className="space-y-2 pt-1">
              {COURSE_PRESETS.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => setHomeCourseId(course.id)}
                  className="w-full text-left p-3 rounded-xl border transition flex items-center justify-between"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: homeCourseId === course.id ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold">{course.name}</div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{course.city}</div>
                  </div>
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{course.elevationFt} ft</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-bold text-base">
              <Shirt size={18} style={{ color: 'var(--accent-emerald)' }} />
              Set Pre-Round Fit Style
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Choose your usual morning weather and course style for fast pre-round outfit lineup suggestions.
            </p>
            <div className="space-y-2.5 pt-1">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Default Weather
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['cool', 'warm', 'hot'].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setWeatherPref(w)}
                      className={`py-2 rounded-xl text-xs font-semibold capitalize border ${
                        weatherPref === w ? 'bg-emerald-700 text-white border-emerald-700' : ''
                      }`}
                      style={weatherPref !== w ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Default Vibe
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['classic', 'resort', 'bold'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVibePref(v)}
                      className={`py-2 rounded-xl text-xs font-semibold capitalize border ${
                        vibePref === v ? 'bg-emerald-700 text-white border-emerald-700' : ''
                      }`}
                      style={vibePref !== v ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
            >
              <ChevronLeft size={15} /> Back
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1) applyYardagesToBag();
                setStep(step + 1);
              }}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1"
              style={{ backgroundColor: 'var(--accent-emerald)' }}
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishOnboarding}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'var(--accent-emerald)' }}
            >
              <Check size={15} /> Hit the First Tee
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
