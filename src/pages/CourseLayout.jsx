import { useState } from 'react';
import { Wind, MapPin, Watch, Glasses } from 'lucide-react';

export default function CourseLayout({ isPro = false, onOpenPaywall }) {
  const [selectedClub, setSelectedClub] = useState({ name: '3-Wood', carry: 240 });
  const [windMph] = useState(10);

  const holeLength = 392;
  const bunkerStart = 252;
  const bunkerEnd = 278;

  const effectiveCarry = Math.round(selectedClub.carry * (1 - windMph * 0.01));
  const remainingToPin = Math.max(0, holeLength - effectiveCarry);
  const inHazard = effectiveCarry >= bunkerStart && effectiveCarry <= bunkerEnd;

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-2xl p-4 border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div>
          <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Dos Lagos • Hole 4</span>
          <h2 className="text-lg font-bold">Par 4 • {holeLength} yds</h2>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 text-xs font-mono" style={{ color: 'var(--accent-gold)' }}>
            <Wind size={14} /> {windMph} mph Headwind
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Leaves {remainingToPin} yds in</div>
        </div>
      </div>

      <div className="rounded-2xl p-4 border relative overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <svg viewBox="0 0 260 320" className="w-full h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <path d="M95,295 Q85,170 115,45 L155,45 Q175,170 145,295 Z" fill="#1E6B4B" opacity="0.35" />
          <ellipse cx="135" cy="42" rx="26" ry="18" fill="#23865D" />
          <circle cx="138" cy="39" r="3" fill="#FFFFFF" />

          <ellipse cx="156" cy="128" rx="14" ry="18" fill="#D6CFC2" stroke="#9E7B34" strokeWidth="1.5" />
          <text x="174" y="132" fontSize="9" fill="currentColor" opacity="0.7">Bunker 252y</text>

          {(() => {
            const arcY = Math.max(45, 295 - (effectiveCarry / holeLength) * 250);
            return (
              <>
                <path
                  d={`M 75 ${arcY + 12} Q 130 ${arcY - 12} 185 ${arcY + 12}`}
                  fill="none"
                  stroke={inHazard ? '#EF4444' : '#C8A96A'}
                  strokeWidth="2.5"
                  strokeDasharray="5 4"
                />
                <circle cx="130" cy={arcY} r="5" fill={inHazard ? '#EF4444' : '#C8A96A'} />
                <text x="140" y={arcY + 3} fontSize="10" fontWeight="bold" fill={inHazard ? '#EF4444' : '#C8A96A'}>
                  {selectedClub.name}: {effectiveCarry}y
                </text>
              </>
            );
          })()}

          <rect x="112" y="292" width="24" height="10" rx="3" fill="#97A39C" />
        </svg>

        <div className="flex gap-2 mt-3">
          {[
            { name: 'Driver', carry: 265 },
            { name: '3-Wood', carry: 240 },
            { name: '4-Hybrid', carry: 212 },
          ].map((club) => (
            <button
              key={club.name}
              onClick={() => {
                if (!isPro && club.name !== 'Driver') {
                  onOpenPaywall('Stock Yardage Target Rings & Club Simulation');
                  return;
                }
                setSelectedClub(club);
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                selectedClub.name === club.name ? 'bg-emerald-700 text-white border-emerald-700' : ''
              }`}
              style={selectedClub.name !== club.name ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
            >
              {club.name} ({club.carry}y)
            </button>
          ))}
        </div>

        {inHazard && (
          <div className="mt-3 text-xs text-red-400 font-medium flex items-center gap-1.5">
            <MapPin size={14} /> Caution: {selectedClub.name} carry lands inside the right fairway bunker zone (252–278y).
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 border space-y-2" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-gold)' }}>
            <Watch size={14} /> <Glasses size={14} /> Wearable Caddie Feed
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Live Sync</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          <strong>Watch / Meta Ray-Ban Cue:</strong> &ldquo;Hit {selectedClub.name} ({effectiveCarry}y net) to leave {remainingToPin}y — ideal 9-Iron or PW approach.&rdquo;
        </p>
      </div>
    </div>
  );
}
