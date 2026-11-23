import { useState, useEffect } from 'react';
import { Wind, Droplets, Thermometer, Mountain, Compass, AlertTriangle, CheckCircle2, Sparkles, Watch, Glasses } from 'lucide-react';
import { COURSE_PRESETS, fetchCourseWeather, degreesToCompass, calculateShotPhysics } from '../lib/weatherPhysics';

export default function CourseLayout({ clubs = [], isPro = false, onOpenPaywall }) {
  const [courseId, setCourseId] = useState(COURSE_PRESETS[0].id);
  const [holeIdx, setHoleIdx] = useState(0);
  const [selectedClubId, setSelectedClubId] = useState(clubs[1]?.id || clubs[0]?.id || '1');

  const [weather, setWeather] = useState({
    tempF: 68,
    dewPointF: 52,
    humidity: 56,
    windSpeedMph: 9,
    windGustMph: 14,
    windDirDeg: 145,
    isLive: false,
  });

  const activeCourse = COURSE_PRESETS.find((c) => c.id === courseId) || COURSE_PRESETS[0];
  const activeHole = activeCourse.holes[holeIdx] || activeCourse.holes[0];

  useEffect(() => {
    let cancelled = false;
    fetchCourseWeather(activeCourse.lat, activeCourse.lon)
      .then((live) => {
        if (!cancelled) setWeather(live);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCourse.lat, activeCourse.lon]);

  // Evaluate every club in the user's custom bag for this hole & weather
  const evaluatedClubs = clubs.map((club) => {
    const physics = calculateShotPhysics({
      stockCarry: club.carry_yards,
      stockTotal: club.total_yards,
      windSpeedMph: weather.windSpeedMph,
      windDirDeg: weather.windDirDeg,
      holeBearingDeg: activeHole.bearingDeg,
      tempF: weather.tempF,
      dewPointF: weather.dewPointF,
      elevationFt: activeCourse.elevationFt,
    });

    const hitsBunker = activeHole.bunkerStart && physics.effectiveCarry >= activeHole.bunkerStart - 5 && physics.effectiveCarry <= activeHole.bunkerEnd + 5;
    const missesWater = !activeHole.waterCarry || physics.effectiveCarry >= activeHole.waterCarry + 8;
    const remainingToPin = Math.max(0, activeHole.yards - physics.effectiveTotal);

    // Score each club: for Par 3s, match pin yardage; for Par 4/5s, avoid hazards & leave ideal approach distance
    let score = 100;
    if (activeHole.par === 3) {
      score -= Math.abs(physics.effectiveCarry - activeHole.yards) * 2.5;
    } else {
      if (hitsBunker) score -= 50;
      if (!missesWater) score -= 70;
      if (physics.effectiveTotal > activeHole.yards - 15) score -= 40;
      // Reward leaving a clean full-wedge approach (85–115 yds) or maximizing safe fairway distance
      const idealApproach = remainingToPin >= 80 && remainingToPin <= 125 ? 18 : 0;
      score += idealApproach + Math.min(260, physics.effectiveCarry) * 0.1;
    }

    return { ...club, ...physics, hitsBunker, missesWater, remainingToPin, score };
  });

  const bestClub = [...evaluatedClubs].sort((a, b) => b.score - a.score)[0];
  const activeClub = evaluatedClubs.find((c) => c.id === selectedClubId) || bestClub || evaluatedClubs[0];

  const handleSelectCourse = (newId) => {
    setCourseId(newId);
    setHoleIdx(0);
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Course & Hole Switcher */}
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between gap-2">
          <select
            value={courseId}
            onChange={(e) => handleSelectCourse(e.target.value)}
            className="font-bold text-sm rounded-xl px-3 py-2 border flex-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {COURSE_PRESETS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.elevationFt} ft)</option>
            ))}
          </select>
          <span className="text-[11px] font-mono px-2.5 py-1.5 rounded-xl border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-emerald)' }}>
            {weather.isLive ? 'LIVE WX' : 'SIM WX'}
          </span>
        </div>

        {/* Hole Number Pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {activeCourse.holes.map((h, idx) => (
            <button
              key={h.number}
              onClick={() => setHoleIdx(idx)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border shrink-0 transition ${
                holeIdx === idx ? 'bg-emerald-700 text-white border-emerald-700' : ''
              }`}
              style={holeIdx !== idx ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
            >
              #{h.number} • Par {h.par} ({h.yards}y)
            </button>
          ))}
        </div>
      </div>

      {/* Live Atmospheric Telemetry Strip (Temp, Dew Point, Wind, Elevation) */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Thermometer size={14} className="mx-auto mb-1" style={{ color: 'var(--accent-emerald)' }} />
          <div className="font-mono font-bold text-sm">{weather.tempF}°F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Temp</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Droplets size={14} className="mx-auto mb-1 text-sky-400" />
          <div className="font-mono font-bold text-sm">{weather.dewPointF}°F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Dew Pt</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Wind size={14} className="mx-auto mb-1" style={{ color: 'var(--accent-gold)' }} />
          <div className="font-mono font-bold text-sm">{weather.windSpeedMph} mph</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{degreesToCompass(weather.windDirDeg)} (G{weather.windGustMph})</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Mountain size={14} className="mx-auto mb-1 opacity-75" />
          <div className="font-mono font-bold text-sm">{activeCourse.elevationFt}′</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Elev</div>
        </div>
      </div>

      {/* Best-Chance Caddie Recommendation Banner */}
      {bestClub && (
        <div
          onClick={() => setSelectedClubId(bestClub.id)}
          className="rounded-2xl p-3.5 border cursor-pointer flex items-center justify-between"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}
        >
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
              <Sparkles size={13} /> Highest-Percentage Play
            </div>
            <div className="font-bold text-sm">
              Pull {bestClub.club_type} ({bestClub.effectiveCarry}y carry / {bestClub.effectiveTotal}y total)
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {activeHole.par === 3
                ? `Dialed for ${activeHole.yards}y pin • Green: ${activeHole.greenSlope}`
                : `Leaves ${bestClub.remainingToPin}y approach • ${bestClub.turfCondition}`}
            </div>
          </div>
          <CheckCircle2 size={20} style={{ color: 'var(--accent-emerald)' }} className="shrink-0" />
        </div>
      )}

      {/* Overhead Course Visualizer with Custom Bag Target Arcs */}
      {activeClub && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">Hole {activeHole.number} • {activeHole.yards} yds • Green: {activeHole.greenSlope}</span>
            <span className="font-mono" style={{ color: 'var(--accent-gold)' }}>
              {activeClub.headwindMph >= 0 ? `${activeClub.headwindMph} mph Into` : `${Math.abs(activeClub.headwindMph)} mph Helping`}
            </span>
          </div>

          <svg viewBox="0 0 260 310" className="w-full h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            {/* Fairway */}
            <path d="M92,285 Q82,165 112,42 L156,42 Q178,165 148,285 Z" fill="#1E6B4B" opacity="0.35" />
            {/* Green */}
            <ellipse cx="134" cy="40" rx="28" ry="18" fill="#23865D" />
            <circle cx="136" cy="37" r="3" fill="#FFFFFF" />
            <text x="166" y="42" fontSize="9" fill="currentColor" opacity="0.8">{activeHole.yards}y Pin</text>

            {/* Water Hazard if present */}
            {activeHole.waterCarry && (() => {
              const waterY = Math.max(65, 285 - (activeHole.waterCarry / activeHole.yards) * 243);
              return (
                <>
                  <rect x="75" y={waterY - 6} width="115" height="12" rx="4" fill="#38BDF8" opacity="0.65" />
                  <text x="194" y={waterY + 3} fontSize="8" fill="#38BDF8">Creek {activeHole.waterCarry}y</text>
                </>
              );
            })()}

            {/* Fairway Bunker */}
            {activeHole.bunkerStart && (() => {
              const bY = Math.max(60, 285 - (activeHole.bunkerStart / activeHole.yards) * 243);
              return (
                <>
                  <ellipse cx="156" cy={bY} rx="13" ry="16" fill="#D6CFC2" stroke="#9E7B34" strokeWidth="1.5" />
                  <text x="173" y={bY + 3} fontSize="8" fill="currentColor" opacity="0.75">Bunker {activeHole.bunkerStart}y</text>
                </>
              );
            })()}

            {/* Carry Arc + Total Rollout Dot */}
            {(() => {
              const carryY = Math.max(36, 285 - (activeClub.effectiveCarry / activeHole.yards) * 243);
              const totalY = Math.max(32, 285 - (activeClub.effectiveTotal / activeHole.yards) * 243);
              const danger = activeClub.hitsBunker || !activeClub.missesWater;
              const strokeCol = danger ? '#EF4444' : '#C8A96A';

              return (
                <>
                  <path
                    d={`M 74 ${carryY + 12} Q 130 ${carryY - 12} 186 ${carryY + 12}`}
                    fill="none"
                    stroke={strokeCol}
                    strokeWidth="2.5"
                    strokeDasharray="5 4"
                  />
                  {/* Rollout line */}
                  <line x1="130" y1={carryY} x2="130" y2={totalY} stroke={strokeCol} strokeWidth="2" />
                  <circle cx="130" cy={carryY} r="4.5" fill={strokeCol} />
                  <circle cx="130" cy={totalY} r="3" fill="#FFFFFF" stroke={strokeCol} strokeWidth="1.5" />
                  <text x="140" y={carryY + 3} fontSize="9.5" fontWeight="bold" fill={strokeCol}>
                    {activeClub.club_type}: {activeClub.effectiveCarry}y carry ({activeClub.effectiveTotal}y)
                  </text>
                </>
              );
            })()}

            {/* Tee Box */}
            <rect x="110" y="283" width="26" height="10" rx="3" fill="#97A39C" />
          </svg>

          {/* Horizontal Scrollable Custom Bag Selector */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {evaluatedClubs.slice(0, 8).map((club) => (
              <button
                key={club.id}
                onClick={() => {
                  if (!isPro && club.id !== clubs[0]?.id && club.id !== bestClub?.id) {
                    onOpenPaywall('Full-Bag Interactive Shot Simulation');
                    return;
                  }
                  setSelectedClubId(club.id);
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border shrink-0 transition ${
                  activeClub.id === club.id ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={activeClub.id !== club.id ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
              >
                <div>{club.club_type}</div>
                <div className="text-[10px] font-mono opacity-80">Stock {club.carry_yards}y → {club.effectiveCarry}y</div>
              </button>
            ))}
          </div>

          {(activeClub.hitsBunker || !activeClub.missesWater) && (
            <div className="text-xs text-red-400 font-medium flex items-center gap-1.5">
              <AlertTriangle size={14} /> Hazard Alert: Adjusted carry ({activeClub.effectiveCarry}y) brings trouble into play.
            </div>
          )}

          <p className="text-xs pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <strong>Caddie Note:</strong> {activeHole.note}
          </p>
        </div>
      )}

      {/* Wearable Sync Status */}
      <div className="rounded-2xl p-3.5 border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2 text-xs">
          <Watch size={15} style={{ color: 'var(--accent-gold)' }} />
          <Glasses size={15} style={{ color: 'var(--accent-gold)' }} />
          <span>Watch & Meta Glasses Sync: <strong>{bestClub?.club_type} ({bestClub?.effectiveCarry}y)</strong></span>
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{activeClub?.turfCondition.split(' ')[0]}</span>
      </div>
    </div>
  );
}
