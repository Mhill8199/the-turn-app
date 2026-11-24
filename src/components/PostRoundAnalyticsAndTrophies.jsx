import React, { useState } from 'react';
import { Trophy, Award, Crosshair, Flame } from 'lucide-react';

function RadialGauge({ label, valueText, percent, strokeColor = '#10B981', sublabel }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800">
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
        <span className="absolute text-sm font-black text-white">{valueText}</span>
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
      <section className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
        <div className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <Flame size={14} /> Top-Two Money Clubs Today
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {topClubs.map((item, idx) => (
            <div key={idx} className="p-3 rounded-xl bg-black/60 border border-zinc-800">
              <div className="text-[10px] font-mono text-zinc-400">#{idx + 1} PERFORMER</div>
              <div className="text-xs font-black text-white mt-0.5">{item.club}</div>
              <div className="text-[11px] text-emerald-400 font-bold mt-1">
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
            <Trophy size={15} className="text-amber-400" /> Trophy Room (Tap for Foil & Haptics)
          </h3>
        </div>

        <div className="space-y-3">
          {TROPHY_CARDS.map((card) => {
            const inspected = activeTrophyId === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => triggerHapticAndFlip(card.id)}
                className={`w-full text-left p-[2px] rounded-2xl bg-gradient-to-r ${card.gradient} transition-transform duration-300 ${
                  inspected ? 'scale-[1.02] shadow-2xl' : 'scale-100'
                }`}
              >
                <div className="p-4 rounded-[14px] bg-zinc-950/95 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-mono font-black tracking-widest uppercase px-2 py-0.5 rounded bg-white/10 text-amber-300">
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
    </div>
  );
}