import { useMemo, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { COURSE_PRESETS } from '../lib/weatherPhysics';

const DEMO_HOLES = [
  { number: 1, par: 4, strokes: 4 },
  { number: 2, par: 4, strokes: 5 },
  { number: 3, par: 3, strokes: 3 },
  { number: 4, par: 5, strokes: 5 },
  { number: 5, par: 4, strokes: 4 },
  { number: 6, par: 4, strokes: 6 },
  { number: 7, par: 3, strokes: 4 },
  { number: 8, par: 5, strokes: 5 },
  { number: 9, par: 4, strokes: 4 },
];

function loadLiveCard() {
  try {
    const scoresMap = JSON.parse(localStorage.getItem('the-turn-scores-v2') || '{}');
    const customCourses = JSON.parse(localStorage.getItem('the-turn-custom-courses') || '[]');
    const allCourses = [...customCourses, ...COURSE_PRESETS];
    const homeId = localStorage.getItem('the-turn-home-course');

    let best = null;
    for (const [courseKey, holeMap] of Object.entries(scoresMap)) {
      if (!holeMap || typeof holeMap !== 'object') continue;
      const course = allCourses.find((c) => c.id === courseKey);
      const holes = Object.keys(holeMap)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b)
        .map((number) => {
          const meta = course?.holes?.find((h) => h.number === number) || { par: 4 };
          const entry = holeMap[number];
          const strokes = typeof entry === 'number' ? entry : Number(entry?.strokes ?? meta.par);
          return { number, par: meta.par, strokes };
        });
      if (holes.length === 0) continue;
      const candidate = { courseName: course?.name || 'Your Course', holes, home: courseKey === homeId };
      if (!best || candidate.home || candidate.holes.length > best.holes.length) best = candidate;
    }
    return best;
  } catch {
    return null;
  }
}

function sum(holes, key) {
  return holes.reduce((total, hole) => total + hole[key], 0);
}

function relToPar(holes) {
  const rel = sum(holes, 'strokes') - sum(holes, 'par');
  if (rel === 0) return 'E';
  return rel > 0 ? `+${rel}` : `${rel}`;
}

export default function SocialScorecardGenerator({
  playerName = 'You',
  courseName,
  holes,
}) {
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const live = useMemo(() => (holes ? null : loadLiveCard()), [holes]);
  const cardHoles = holes || live?.holes || DEMO_HOLES;
  const cardCourse = courseName || live?.courseName || 'Glen Ivy Golf Club';
  const usingDemo = !holes && !live;

  const front = cardHoles.filter((h) => h.number <= 9);
  const back = cardHoles.filter((h) => h.number > 9);
  const rows = back.length ? [front, back] : [cardHoles];

  const caption = [
    `THE TURN • ${cardCourse}`,
    `${playerName}: ${sum(cardHoles, 'strokes')} (${relToPar(cardHoles)})`,
    ...rows.map((row, idx) => {
      const label = rows.length === 1 ? 'Holes' : idx === 0 ? 'Out' : 'In';
      return `${label} ${sum(row, 'strokes')} (${relToPar(row)})`;
    }),
    `Tracked on ${window.location.origin}`,
  ].join('\n');

  const shareCard = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'The Turn Scorecard', text: caption });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setShareNote('');
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setShareNote(caption);
    }
  };

  return (
    <section className="rounded-2xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-emerald)' }}>
            Social Scorecard
          </div>
          <div className="font-bold">{cardCourse}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {playerName} • {cardHoles.length} holes{usingDemo ? ' • sample card' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black font-mono">{sum(cardHoles, 'strokes')}</div>
          <div className="text-xs font-semibold" style={{ color: 'var(--accent-gold)' }}>{relToPar(cardHoles)}</div>
        </div>
      </div>

      {rows.map((row, idx) => (
        <div key={idx} className="overflow-x-auto">
          <table className="w-full text-center text-xs font-mono">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left font-medium py-1"> </th>
                {row.map((h) => <th key={h.number} className="font-medium px-1">{h.number}</th>)}
                <th className="font-semibold px-1">{rows.length === 1 ? 'Tot' : idx === 0 ? 'Out' : 'In'}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-left py-1" style={{ color: 'var(--text-secondary)' }}>Par</td>
                {row.map((h) => <td key={h.number}>{h.par}</td>)}
                <td className="font-semibold">{sum(row, 'par')}</td>
              </tr>
              <tr className="font-bold">
                <td className="text-left py-1">Score</td>
                {row.map((h) => (
                  <td key={h.number} style={{ color: h.strokes < h.par ? 'var(--accent-emerald)' : h.strokes > h.par ? 'var(--accent-gold)' : 'inherit' }}>
                    {h.strokes}
                  </td>
                ))}
                <td>{sum(row, 'strokes')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <button
        type="button"
        onClick={shareCard}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5"
        style={{ backgroundColor: 'var(--accent-emerald)' }}
      >
        {copied ? <><Check size={15} /> Caption Copied</> : <><Share2 size={15} /> Share Scorecard</>}
      </button>
      {shareNote && (
        <pre className="text-[11px] whitespace-pre-wrap rounded-xl p-3" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{shareNote}</pre>
      )}
    </section>
  );
}
