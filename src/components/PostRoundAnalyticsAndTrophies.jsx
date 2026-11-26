import React, { useState } from 'react';
import { Trophy, Award, Crosshair, Flame } from 'lucide-react';
import SocialScorecardGenerator from './SocialScorecardGenerator';
import { pinScoutTier, usePinScout } from '../utils/pinScout';

function RadialGauge({ label, valueText, percent, strokeColor = '#10B981', sublabel }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center p-3 rounded-3xl bg-zinc-900/80 border border-zinc-800">
      <div className="relative w-22 h-22 flex items-center justify-center">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r={radius} stroke="#27272A" strokeWidth="7" fill="none" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            stroke={strokeColor}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            fill="none"
          />
        </svg>
        <span className="absolute text-sm font-black text-white tabular-nums">{valueText}</span>
      </div>
      <span className="mt-1 text-[11px] font-bold text-zinc-200">{label}</span>
      {sublabel && <span className="text-[10px] text-zinc-400">{sublabel}</span>}
    </div>
  );
}

const TROPHY_CARDS = [
  {
    id: 'tr1',
    title: 'First Break-80 Round',
    course: 'Dos Lagos Golf Club • 78 (+6)',
    rarity: 'PLATINUM FOIL',
    gradient: 'from-emerald-400 via-teal-200 to-amber-300',
  },
  {
    id: 'tr2',
    title: 'Zero 3-Putts • 18 Holes',
    course: 'Oak Valley Golf Club • 28 Putts',
    rarity: 'TOUR GOLD',
    gradient: 'from-amber-400 via-yellow-200 to-orange-400',
  },
  {
    id: 'tr3',
    title: 'Back-to-Back Birdies',
    course: 'Glen Ivy Golf Club • Holes 14 & 15',
    rarity: 'EMERALD EDITION',
    gradient: 'from-emerald-500 via-lime-300 to-cyan-300',
  },
];

function PinScoutTrophyCard({ inspected, onInspect }) {
  const stats = usePinScout();
  const tier = pinScoutTier(stats.pinsMarked);
  const unlocked = tier.unlocked;
  const silver = tier.foil === 'silver';
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, px: 50, py: 40 });
  const progress = Math.max(0, Math.min(100, (stats.pinsMarked / 18) * 100));
  const foil = !unlocked
    ? 'rgba(255,255,255,0.16)'
    : silver
      ? 'linear-gradient(115deg, #8E939A 0%, #F8F9FA 35%, #C5C9CE 55%, #9AA0A6 100%)'
      : 'linear-gradient(115deg, #8A6A1A 0%, #D4AF37 32%, #F8E7B0 50%, #D4AF37 70%, #8A6A1A 100%)';
  const badgeColor = !unlocked ? '#9CA3AF' : silver ? '#E8EAED' : '#D4AF37';

  const onMove = (event) => {
    if (!unlocked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    setTilt({
      rx: ((50 - py) / 50) * 9,
      ry: ((px - 50) / 50) * 11,
      px,
      py,
    });
  };

  return (
    <button
      type="button"
      onClick={onInspect}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt({ rx: 0, ry: 0, px: 50, py: 40 })}
      className="w-full min-h-[44px] text-left"
      style={{ perspective: '900px' }}
    >
      <div
        className="rounded-3xl p-[2px] transition-transform duration-150"
        style={{
          background: foil,
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${inspected ? 1.02 : 1})`,
          boxShadow: inspected ? '0 18px 40px rgba(0,0,0,0.35)' : undefined,
        }}
      >
        <div className="relative flex items-center justify-between overflow-hidden rounded-[14px] p-4" style={{ backgroundColor: '#0B0D0C' }}>
          {unlocked && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.38) 48%, transparent 62%), radial-gradient(circle at ${tilt.px}% ${tilt.py}%, rgba(255,255,255,0.35), transparent 46%)`,
                mixBlendMode: 'screen',
              }}
            />
          )}
          <div className="relative min-w-0 flex-1">
            <span className="rounded bg-white/10 px-2 py-0.5 text-[9px] font-mono font-black uppercase tracking-widest" style={{ color: badgeColor }}>
              {unlocked ? tier.label : 'Locked'}
            </span>
            <div className="mt-1.5 text-base font-black text-white">Pin Scout</div>
            <div className="text-xs text-zinc-400">
              {unlocked ? 'Daily pins logged' : 'Mark 1 daily pin to unlock'}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: '#1C211E' }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: '#10B981' }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-400">
              <span>{stats.pinsMarked} / 18 pins</span>
              <span>{stats.scoutXp} XP</span>
            </div>
          </div>
          <Award
            size={32}
            className={`relative shrink-0 transition-transform duration-500 ${inspected ? 'rotate-12' : ''}`}
            style={{ color: unlocked ? badgeColor : '#71717A' }}
          />
        </div>
      </div>
    </button>
  );
}

export default function PostRoundAnalyticsAndTrophies({
  strokesGainedTotal = '+2.4',
  girPercent = 61,
  firPercent = 71,
  topClubs = [
    { club: 'Vokey SM9 58° D-Grind', proximity: '11 ft avg', strokesGained: '+1.4 SG' },
    { club: '6 Iron (175y Stock)', proximity: '83% GIR', strokesGained: '+0.9 SG' },
  ],
}) {
  const [activeTrophyId, setActiveTrophyId] = useState(null);

  const triggerHapticAndFlip = (id) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([18, 30, 24]); // Tactile double-tap haptic pulse
    }
    setActiveTrophyId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-5 pb-6">
      {/* Radial Performance Gauges */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wider flex items-center gap-1.5">
            <Crosshair size={15} className="text-emerald-400" /> Round Dispersion & Strokes Gained
          </h3>
          <span className="text-[11px] font-mono text-emerald-400">VS 10 HCP</span>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <RadialGauge
            label="Strokes Gained"
            valueText={strokesGainedTotal}
            percent={78}
            strokeColor="#10B981"
            sublabel="Total Round"
          />
          <RadialGauge
            label="Greens (GIR)"
            valueText={`${girPercent}%`}
            percent={girPercent}
            strokeColor="#38BDF8"
            sublabel="11 / 18 Holes"
          />
          <RadialGauge
            label="Fairways (FIR)"
            valueText={`${firPercent}%`}
            percent={firPercent}
            strokeColor="#F59E0B"
            sublabel="10 / 14 Drives"
          />
        </div>
      </section>

      {/* Top-Two Clubs Highlight */}
      <section className="p-4 rounded-3xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
        <div className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <Flame size={14} /> Top-Two Money Clubs Today
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {topClubs.map((item, idx) => (
            <div key={idx} className="p-3 rounded-xl bg-black/60 border border-zinc-800">
              <div className="text-[10px] font-mono text-zinc-400">#{idx + 1} PERFORMER</div>
              <div className="text-xs font-black text-white mt-0.5">{item.club}</div>
              <div className="text-[11px] font-bold mt-1 tabular-nums" style={{ color: '#10B981' }}>
                {item.proximity} • {item.strokesGained}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3D Foil Trophy Room Cards */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold uppercase tracking-wider flex items-center gap-1.5">
            <Trophy size={15} style={{ color: '#D4AF37' }} /> Trophy Room (Tap for Foil & Haptics)
          </h3>
        </div>

        <div className="space-y-3">
          <PinScoutTrophyCard
            inspected={activeTrophyId === 'pin-scout'}
            onInspect={() => triggerHapticAndFlip('pin-scout')}
          />
          {TROPHY_CARDS.map((card) => {
            const inspected = activeTrophyId === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => triggerHapticAndFlip(card.id)}
                className={`w-full text-left p-[2px] rounded-3xl bg-gradient-to-r ${card.gradient} transition-transform duration-300 ${
                  inspected ? 'scale-[1.02] shadow-2xl' : 'scale-100'
                }`}
              >
                <div className="p-4 rounded-[14px] bg-zinc-950/95 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-mono font-black tracking-widest uppercase px-2 py-0.5 rounded bg-white/10" style={{ color: '#D4AF37' }}>
                      {card.rarity}
                    </span>
                    <div className="text-base font-black text-white mt-1.5">{card.title}</div>
                    <div className="text-xs text-zinc-400">{card.course}</div>
                  </div>
                  <Award
                    size={32}
                    className={`transition-transform duration-500 ${
                      inspected ? 'rotate-12 text-amber-300' : 'text-zinc-500'
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <SocialScorecardGenerator />
    </div>
  );
}