import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

const SCORES_KEY = 'the-turn-scores-v2';
const BAG_KEY = 'the-turn-bag';

const SG_FIELDS = {
  'off-the-tee': ['offTheTee', 'off_the_tee', 'sgOffTheTee', 'sg_off_the_tee', 'ott'],
  approach: ['approach', 'sgApproach', 'sg_approach'],
  'around-the-green': ['aroundTheGreen', 'around_the_green', 'sgAroundTheGreen', 'sg_around_the_green', 'arg'],
  putting: ['putting', 'sgPutting', 'sg_putting'],
};

const FOCUS_LABEL = {
  'off-the-tee': 'Off the Tee',
  approach: 'Approach',
  'around-the-green': 'Around the Green',
  putting: 'Putting',
  balanced: 'Balanced',
};

const RANGE_FOCUS = ['off-the-tee', 'approach', 'around-the-green'];

function readJson(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

/** Active bag: archived clubs stay out. Matches activeBagClubs when that helper is present. */
export function activeBagClubs(clubs) {
  return (Array.isArray(clubs) ? clubs : []).filter((club) => club && club.archived !== true);
}

function clubLabel(club) {
  return String(club?.club_type || club?.name || '').trim();
}

function loftOf(club) {
  const direct = Number(club?.loft);
  if (Number.isFinite(direct)) return direct;
  const match = clubLabel(club).match(/(\d{2})(?:\.\d+)?/);
  return match ? Number(match[1]) : null;
}

function isWedge(club) {
  const name = clubLabel(club);
  const loft = loftOf(club);
  return /wedge|\bpw\b|\bgw\b|\bsw\b|\blw\b|pitching/i.test(name) || (loft != null && loft >= 46 && loft <= 64);
}

function findClub(clubs, pattern) {
  return clubs.find((club) => pattern.test(clubLabel(club))) || null;
}

function lobOrHighestWedge(clubs) {
  const wedges = clubs.filter(isWedge);
  const lobs = wedges.filter((club) => {
    const loft = loftOf(club);
    return loft === 58 || loft === 60;
  });
  const pool = lobs.length ? lobs : wedges;
  return pool.sort((a, b) => (loftOf(b) || 0) - (loftOf(a) || 0))[0] || null;
}

function longestClub(clubs) {
  return [...clubs].sort((a, b) => (Number(b.carry_yards) || 0) - (Number(a.carry_yards) || 0))[0] || null;
}

function named(club, fallback) {
  return club ? clubLabel(club) : fallback;
}

function parseSgNumber(value, key, host) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (key === 'putting' && Number.isInteger(value) && value >= 0 && (host?.putts != null || host?.strokes != null)) {
      return null;
    }
    if (Math.abs(value) > 8) return null;
    return value;
  }
  if (typeof value === 'string') {
    const number = Number(value.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(number) && Math.abs(number) <= 8 && /[+-]|sg/i.test(value)) return number;
  }
  return null;
}

function readSgBlock(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return null;
  const found = {};
  let any = false;
  for (const [category, keys] of Object.entries(SG_FIELDS)) {
    for (const key of keys) {
      if (obj[key] == null || typeof obj[key] === 'object') continue;
      const number = parseSgNumber(obj[key], key, obj);
      if (number == null) continue;
      found[category] = number;
      any = true;
      break;
    }
  }
  for (const nestKey of ['strokesGained', 'strokes_gained', 'sg']) {
    const nested = obj[nestKey];
    if (!nested || typeof nested !== 'object') continue;
    const inner = readSgBlock(nested, depth + 1);
    if (!inner) continue;
    Object.assign(found, inner);
    any = true;
  }
  return any ? found : null;
}

function isHoleLog(hole) {
  return hole.strokes != null || hole.putts != null || hole.fir != null || hole.gir != null;
}

export function collectRoundEvidence(scores) {
  const sgSamples = [];
  const holes = [];
  if (!scores || typeof scores !== 'object') return { sgSamples, holes };
  for (const course of Object.values(scores)) {
    if (!course || typeof course !== 'object' || Array.isArray(course)) continue;
    const courseSg = readSgBlock(course);
    if (courseSg) sgSamples.push(courseSg);
    for (const [key, hole] of Object.entries(course)) {
      if (typeof hole === 'number' && /^\d+$/.test(key)) {
        holes.push({ strokes: hole });
        continue;
      }
      if (!hole || typeof hole !== 'object' || Array.isArray(hole)) continue;
      const sg = readSgBlock(hole);
      if (sg) sgSamples.push(sg);
      if (isHoleLog(hole)) holes.push(hole);
    }
  }
  return { sgSamples, holes };
}

function averageSg(samples) {
  const sums = {};
  const counts = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      sums[key] = (sums[key] || 0) + value;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.keys(sums)
    .map((key) => ({ key, value: sums[key] / counts[key] }))
    .sort((a, b) => a.value - b.value);
}

function inferFromHoles(holes) {
  let firHit = 0;
  let firN = 0;
  let girHit = 0;
  let girN = 0;
  let puttSum = 0;
  let puttN = 0;
  let argHoles = 0;
  for (const hole of holes) {
    const fir = hole.fir;
    if (fir && fir !== 'na') {
      firN += 1;
      if (fir === 'hit' || fir === true) firHit += 1;
    }
    if (typeof hole.gir === 'boolean') {
      girN += 1;
      if (hole.gir) girHit += 1;
    }
    const putts = Number(hole.putts);
    const strokes = Number(hole.strokes);
    if (Number.isFinite(putts)) {
      puttN += 1;
      puttSum += putts;
    }
    const nonPutt = Number.isFinite(strokes) && Number.isFinite(putts) ? strokes - putts : null;
    const firHitFlag = fir === 'hit' || fir === true;
    if (hole.gir === false && firHitFlag && nonPutt != null && nonPutt >= 4) argHoles += 1;
  }
  const ranked = [
    firN ? { key: 'off-the-tee', value: (firN - firHit) / firN } : null,
    girN ? { key: 'approach', value: (girN - girHit) / girN } : null,
    puttN ? { key: 'putting', value: Math.max(0, Math.min(1, (puttSum / puttN - 1.7) / 1.2)) } : null,
    holes.length ? { key: 'around-the-green', value: argHoles / holes.length } : null,
  ]
    .filter((item) => item && item.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!ranked.length) return [];
  const [best, second] = ranked;
  if (best.value < 0.22 && holes.length < 6) return [];
  if (second && best.value - second.value < 0.05 && best.value < 0.35) return [];
  return ranked;
}

export function pickWarmupFocus(scores) {
  const { sgSamples, holes } = collectRoundEvidence(scores);
  if (!sgSamples.length && !holes.length) {
    return {
      weakness: 'balanced',
      rangeFocus: 'balanced',
      summary: 'No logged rounds yet. This is a balanced 12-minute routine.',
    };
  }
  if (sgSamples.length) {
    const ranked = averageSg(sgSamples);
    const worst = ranked[0];
    const best = ranked[ranked.length - 1];
    const flat = ranked.length > 1 && Math.abs(worst.value - best.value) < 0.15 && worst.value > -0.2;
    if (!flat) {
      const range = ranked.find((item) => RANGE_FOCUS.includes(item.key));
      return {
        weakness: worst.key,
        rangeFocus: worst.key === 'putting' ? (range?.key || 'balanced') : worst.key,
        summary: `Strokes Gained splits from logged rounds point to ${FOCUS_LABEL[worst.key]}.`,
      };
    }
  }
  const inferred = inferFromHoles(holes);
  if (!inferred.length) {
    return {
      weakness: 'balanced',
      rangeFocus: 'balanced',
      summary: holes.length
        ? 'Logged scores do not show a clear leak, so this stays a balanced routine.'
        : 'No logged rounds yet. This is a balanced 12-minute routine.',
    };
  }
  const worst = inferred[0];
  const range = inferred.find((item) => RANGE_FOCUS.includes(item.key));
  return {
    weakness: worst.key,
    rangeFocus: worst.key === 'putting' ? (range?.key || 'balanced') : worst.key,
    summary: `No Strokes Gained splits stored. Fairways, greens, and putts point to ${FOCUS_LABEL[worst.key]}.`,
  };
}

function stretchSteps() {
  return [
    { id: 'hips', title: 'Hip rotations', detail: 'Slow open-and-close turns, lead hip toward the target.', seconds: 45 },
    { id: 'thoracic', title: 'Thoracic spine turns', detail: 'Club across the chest. Rotate the upper back, hips quiet.', seconds: 45 },
    { id: 'shoulders', title: 'Shoulder passes', detail: 'Pass a club front to back overhead. Stay tall.', seconds: 45 },
    { id: 'wrists', title: 'Wrist and forearm mobility', detail: 'Figure-eights and easy hinge-to-release swings.', seconds: 45 },
  ];
}

function rangeSteps(rangeFocus, clubs) {
  const active = activeBagClubs(clubs).filter((club) => !/putter/i.test(clubLabel(club)));
  const driver = findClub(active, /driver/i) || longestClub(active);
  const wood = findClub(active, /3[\s-]*wood|\b3w\b/i);
  const iron = findClub(active, /7[\s-]*iron/i) || findClub(active, /iron/i);
  const pw = findClub(active, /^pw\b|pitching/i) || active.find((club) => {
    const loft = loftOf(club);
    return loft != null && loft >= 42 && loft <= 49;
  });
  const wedge = lobOrHighestWedge(active);
  const wedgeName = named(wedge, 'your highest-loft wedge');
  const driverName = named(driver, 'your driver');
  const woodName = named(wood, driver ? null : 'your 3-wood');
  const ironName = named(iron, 'your 7-iron');
  const pwName = named(pw, 'your pitching wedge');

  if (rangeFocus === 'off-the-tee') {
    const steps = [
      {
        id: 'tee-driver',
        title: `3-quarter tempo fairway finder — ${driverName}`,
        detail: driver
          ? `Eight balls with your stocked ${driverName}. A 20-yard start window, smooth tempo.`
          : 'No driver is in the active bag. Use your longest stocked club for eight fairway-finder balls.',
        seconds: null,
      },
    ];
    if (wood) {
      steps.push({
        id: 'tee-wood',
        title: `Same window — ${woodName}`,
        detail: `Six balls with your stocked ${woodName}. Same start line, three-quarter tempo.`,
        seconds: null,
      });
    }
    steps.push({ id: 'tee-rest', title: 'Rest', detail: 'Shake out the hands, then one more committed tee ball on the same line.', seconds: 20 });
    return steps;
  }

  if (rangeFocus === 'approach') {
    return [
      {
        id: 'gate-7',
        title: `Start-line gate — ${ironName}`,
        detail: iron
          ? `Two tees just wider than the clubhead. Six balls with your stocked ${ironName} at its stock carry.`
          : 'No 7-iron is stocked. Use the iron closest to a 7-iron for six start-line gate balls.',
        seconds: null,
      },
      {
        id: 'gate-pw',
        title: `Start-line gate — ${pwName}`,
        detail: pw
          ? `Same gate. Six balls with your stocked ${pwName}. Hold the start line through impact.`
          : 'No pitching wedge is stocked. Use the next highest-loft club for six start-line balls.',
        seconds: null,
      },
      { id: 'app-rest', title: 'Rest', detail: 'Twenty seconds, then one more ball with each club on the same gate.', seconds: 20 },
    ];
  }

  if (rangeFocus === 'around-the-green') {
    const lobNote = wedge && (loftOf(wedge) === 58 || loftOf(wedge) === 60)
      ? `your stocked ${wedgeName}`
      : wedge
        ? `your highest-loft wedge, ${wedgeName}`
        : 'your highest-loft club';
    return [
      {
        id: 'ladder',
        title: `50-yard wedge ladder — ${wedgeName}`,
        detail: `Land 50, then 40, then 30 yards with ${lobNote}.`,
        seconds: null,
      },
      {
        id: 'bump',
        title: `Bump-and-run — ${wedgeName}`,
        detail: `Four balls with ${lobNote}. Ball back, quiet wrists, run it to the hole.`,
        seconds: null,
      },
      { id: 'arg-rest', title: 'Rest', detail: 'Twenty seconds, then one more 50-yard ladder rung.', seconds: 20 },
    ];
  }

  return [
    {
      id: 'bal-tee',
      title: `3-quarter fairway finder — ${driverName}`,
      detail: driver ? `Six balls with your stocked ${driverName}.` : 'Six easy tee balls with your longest stocked club.',
      seconds: null,
    },
    {
      id: 'bal-iron',
      title: `Start-line gate — ${ironName}`,
      detail: iron ? `Six balls with your stocked ${ironName}.` : 'Six mid-iron balls through a start-line gate.',
      seconds: null,
    },
    {
      id: 'bal-wedge',
      title: `One ladder rung — ${wedgeName}`,
      detail: `Four balls at 50 yards with ${wedge ? `your stocked ${wedgeName}` : 'your highest-loft club'}.`,
      seconds: null,
    },
    { id: 'bal-rest', title: 'Rest', detail: 'Twenty seconds before you head to the putting green.', seconds: 20 },
  ];
}

function puttingSteps(emphasize) {
  const steps = [
    { id: 'lag-20', title: 'Lag ladder — 20 ft', detail: 'Two balls. Finish inside a 3-foot circle.', seconds: 40 },
    { id: 'lag-30', title: 'Lag ladder — 30 ft', detail: 'Two balls. Speed first, then line.', seconds: 40 },
    { id: 'lag-40', title: 'Lag ladder — 40 ft', detail: 'Two balls. Commit to the pace before you look up.', seconds: 40 },
    { id: 'start-4', title: '4-foot start-line putts', detail: 'Eight putts. Hold the start line for the first foot.', seconds: 45 },
  ];
  if (emphasize) {
    steps.push({
      id: 'start-4-extra',
      title: 'Extra 4-foot start line',
      detail: 'Putting is the leak in your logged rounds. One more set of eight before you leave.',
      seconds: null,
    });
  }
  return steps;
}

export function buildWarmupPlan({ clubs, scores } = {}) {
  const focus = pickWarmupFocus(scores);
  const bag = activeBagClubs(clubs);
  return {
    ...focus,
    minutes: 12,
    blocks: [
      { id: 'stretch', title: 'Dynamic Golf Stretches', minutes: 3, steps: stretchSteps() },
      { id: 'range', title: 'Targeted Range & Club Drills', minutes: 6, steps: rangeSteps(focus.rangeFocus, bag) },
      {
        id: 'green',
        title: 'Green Speed & Putting Calibration',
        minutes: 3,
        steps: puttingSteps(focus.weakness === 'putting'),
      },
    ],
  };
}

function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minute = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minute}:${String(rest).padStart(2, '0')}`;
}

export default function RoundWarmupModal({ open, onClose, clubs }) {
  const [checked, setChecked] = useState({});
  const [runningId, setRunningId] = useState(null);
  const [remaining, setRemaining] = useState(null);

  const plan = useMemo(() => {
    if (!open) return null;
    const bag = Array.isArray(clubs) && clubs.length ? clubs : readJson(BAG_KEY, []);
    const scores = readJson(SCORES_KEY, {});
    return buildWarmupPlan({ clubs: bag, scores });
  }, [open, clubs]);

  useEffect(() => {
    if (!open) return undefined;
    setChecked({});
    setRunningId(null);
    setRemaining(null);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!runningId || remaining == null) return undefined;
    if (remaining <= 0) {
      setChecked((prev) => ({ ...prev, [runningId]: true }));
      setRunningId(null);
      setRemaining(null);
      return undefined;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [runningId, remaining]);

  if (!open || !plan) return null;

  const steps = plan.blocks.flatMap((block) => block.steps);
  const done = steps.filter((step) => checked[step.id]).length;

  const startTimer = (step) => {
    if (!step.seconds) return;
    setRunningId(step.id);
    setRemaining(step.seconds);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ backgroundColor: 'rgba(11, 13, 12, 0.78)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-warmup-title"
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border sm:rounded-3xl"
        style={{
          backgroundColor: '#0B0D0C',
          borderColor: 'rgba(212, 175, 55, 0.55)',
          color: '#F8F7F4',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
              Round Warm-Up · <span className="tabular-nums">12:00</span>
            </div>
            <h2 id="round-warmup-title" className="text-lg font-semibold">Personalized 12-minute routine</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close warm-up"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border"
            style={{ borderColor: 'rgba(255,255,255,0.16)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-2">
          <div className="rounded-3xl border px-3 py-2 text-sm" style={{ borderColor: '#D4AF37' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
              Focus · {FOCUS_LABEL[plan.weakness]}
            </div>
            <p className="mt-1 text-[13px] leading-snug">{plan.summary}</p>
          </div>
          <div className="mt-2 text-[11px] tabular-nums" style={{ color: '#A7F3D0' }}>
            {done}/{steps.length} steps checked
          </div>
        </div>

        <div className="mt-3 space-y-3 overflow-y-auto px-4 pb-4">
          {plan.blocks.map((block) => (
            <section key={block.id} className="rounded-3xl border p-3" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{block.title}</h3>
                <span className="tabular-nums text-xs" style={{ color: '#10B981' }}>{block.minutes} min</span>
              </div>
              <ul className="space-y-2">
                {block.steps.map((step) => {
                  const on = Boolean(checked[step.id]);
                  const live = runningId === step.id;
                  return (
                    <li key={step.id} className="rounded-2xl border px-3 py-2" style={{ borderColor: on ? '#10B981' : 'rgba(255,255,255,0.08)' }}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => setChecked((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
                          className="mt-0.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border text-sm font-semibold"
                          style={{
                            borderColor: on ? '#10B981' : 'rgba(255,255,255,0.2)',
                            backgroundColor: on ? '#10B981' : 'transparent',
                            color: on ? '#0B0D0C' : '#F8F7F4',
                          }}
                        >
                          {on ? '✓' : ''}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{step.title}</div>
                          <p className="text-[12px] leading-snug" style={{ color: '#D1D5DB' }}>{step.detail}</p>
                          {step.seconds ? (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="tabular-nums text-sm font-semibold" style={{ color: '#D4AF37' }}>
                                {live ? formatClock(remaining) : formatClock(step.seconds)}
                              </span>
                              <button
                                type="button"
                                onClick={() => startTimer(step)}
                                className="min-h-[44px] rounded-full px-3 text-xs font-semibold text-white"
                                style={{ backgroundColor: '#10B981' }}
                              >
                                {live ? 'Restart' : 'Start countdown'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
