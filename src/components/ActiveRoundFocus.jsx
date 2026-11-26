import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Minus, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDistance, formatSpeed, useUnits } from '../utils/distanceUnits';
import {
  CADDIE_VOICES,
  previewCaddieCallout,
  readCaddiePersonaId,
  resolveTtsLocale,
  saveCaddiePersonaId,
  speakCaddieCallout,
} from '../utils/wearableAndAudioCaddie';
import { closestActiveClub, clubSpecSubtitle } from '../utils/bagClubs';

/** Headwind is wind blowing into the shot (positive). Tailwind is negative. */
function relativeWind(windSpeedMph, windDirDeg, holeBearingDeg) {
  const windMph = Number.isFinite(Number(windSpeedMph)) ? Number(windSpeedMph) : 0;
  const relRad = (((Number(windDirDeg) || 0) - (Number(holeBearingDeg) || 0)) * Math.PI) / 180;
  const head = Math.cos(relRad) * windMph;
  const cross = Math.sin(relRad) * windMph;
  // deltaYards ≈ windMph * 1 for a pure headwind component (headwind adds yards, tailwind subtracts).
  const deltaYards = Math.round(head);
  let kind = 'cross-right';
  if (Math.abs(head) < 0.5 && Math.abs(cross) < 0.5) kind = 'calm';
  else if (Math.abs(head) >= Math.abs(cross)) kind = head >= 0 ? 'head' : 'tail';
  else kind = cross >= 0 ? 'cross-right' : 'cross-left';
  return { windMph, deltaYards, kind };
}

function WindArrow({ kind }) {
  const icons = {
    head: ArrowDown,
    tail: ArrowUp,
    'cross-left': ArrowLeft,
    'cross-right': ArrowRight,
    calm: Minus,
  };
  const labels = { head: 'Head', tail: 'Tail', 'cross-left': 'Cross', 'cross-right': 'Cross', calm: 'Calm' };
  const Icon = icons[kind] || Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-[#10B981]">
      <Icon size={14} aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-wide">{labels[kind] || 'Calm'}</span>
    </span>
  );
}

function yardsBetween(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat);
  const lon1 = Number(a.lon ?? a.lng);
  const lat2 = Number(b.lat);
  const lon2 = Number(b.lon ?? b.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))) / 0.9144;
}

function shiftYards(origin, bearingDeg, yards) {
  if (!origin || !Number.isFinite(yards)) return null;
  const lat = Number(origin.lat);
  const lon = Number(origin.lon ?? origin.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const meters = yards * 0.9144;
  const R = 6371000;
  const br = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ang = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

const LIE_OPTIONS = [
  { id: 'tee', label: 'Tee' },
  { id: 'fairway', label: 'Fairway' },
  { id: 'rough', label: 'Rough' },
  { id: 'bunker', label: 'Bunker' },
];

export default function ActiveRoundFocus({
  courseName = '',
  holeNumber = 1,
  par = 4,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onEndRound,
  onMarkShot,
  onSuggestedClub,
  onAimTarget,
  centerYards,
  pinYards,
  greenCenter = null,
  windSpeedMph = 0,
  windDirDeg = 0,
  holeBearingDeg = 0,
  elevationFt = null,
  shots = [],
  livePosition = null,
  clubs = [],
  fallbackClubName = '',
  fallbackCarryYards = null,
  suggestion = '',
  children,
}) {
  const { distanceUnit, toggleDistanceUnit, speedUnit } = useUnits();
  const { lang } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [personaId, setPersonaId] = useState(readCaddiePersonaId);
  const [lie, setLie] = useState('tee');
  const [pinChoice, setPinChoice] = useState('center');
  const shotList = Array.isArray(shots) ? shots : [];
  const lastShot = shotList[shotList.length - 1] || null;
  const liePoint = lastShot
    ? { lat: Number(lastShot.lat), lon: Number(lastShot.lng) }
    : (livePosition ? { lat: Number(livePosition.lat), lon: Number(livePosition.lon ?? livePosition.lng) } : null);
  const scoreCenter = Number.isFinite(Number(centerYards)) ? Number(centerYards) : (Number(pinYards) || 0);
  // Assumption: without surveyed green edges, the front is ~12 yards short of center and the back is ~14 yards past center, along the hole.
  const centerPoint = greenCenter && Number.isFinite(Number(greenCenter.lat)) ? greenCenter : null;
  const frontPoint = centerPoint ? shiftYards(centerPoint, Number(holeBearingDeg) + 180, 12) : null;
  const backPoint = centerPoint ? shiftYards(centerPoint, Number(holeBearingDeg), 14) : null;
  const centerDist = (liePoint && centerPoint ? yardsBetween(liePoint, centerPoint) : null) ?? scoreCenter;
  const frontDist = (liePoint && frontPoint ? yardsBetween(liePoint, frontPoint) : null) ?? Math.max(0, scoreCenter - 12);
  const backDist = (liePoint && backPoint ? yardsBetween(liePoint, backPoint) : null) ?? scoreCenter + 14;
  const { windMph, deltaYards, kind } = relativeWind(windSpeedMph, windDirDeg, holeBearingDeg);
  // rough +5 yards, bunker +10, tee uses full carry. Fairway uses stock carry.
  const lieAdjust = lie === 'rough' ? 5 : lie === 'bunker' ? 10 : 0;
  // Headwind adds yards, tailwind subtracts. Course elevation adds about 2 yards per 1,000 ft when provided.
  const elevationDelta = Number.isFinite(Number(elevationFt)) ? Math.round(Number(elevationFt) / 500) : 0;
  const playsLikeYards = Math.max(0, Math.round((Number(centerDist) || 0) + deltaYards + lieAdjust + elevationDelta));
  const matched = closestActiveClub(clubs, playsLikeYards);
  const clubName = matched?.club_type || matched?.name || fallbackClubName || '—';
  const clubSpec = clubSpecSubtitle(matched);
  const clubCarry = matched ? Number(matched.carry_yards) : Number(fallbackCarryYards);
  const deltaLabel = `${deltaYards > 0 ? '+' : ''}${deltaYards}`;
  const ttsLocale = resolveTtsLocale(lang);
  const shotNumber = shotList.length + 1;

  useEffect(() => {
    if (shotList.length === 0) {
      setLie('tee');
      return;
    }
    setLie((current) => (current === 'tee' ? 'fairway' : current));
  }, [shotList.length, holeNumber]);

  useEffect(() => {
    onSuggestedClub?.({ name: clubName, carry: Number.isFinite(Number(clubCarry)) ? Number(clubCarry) : null });
  }, [clubName, clubCarry, onSuggestedClub]);

  useEffect(() => {
    onAimTarget?.(pinChoice);
  }, [pinChoice, onAimTarget]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const speak = () => {
    speakCaddieCallout(
      {
        holeNumber,
        club: clubName,
        targetYards: centerDist,
        playsLikeYards,
        wind: { direction: kind === 'calm' ? 'calm' : kind.replace('-', ' '), speed: formatSpeed(windMph, speedUnit) },
        advice: suggestion,
      },
      distanceUnit,
      ttsLocale,
      personaId
    );
  };

  const selectPersona = (id) => {
    setPersonaId(saveCaddiePersonaId(id));
  };

  return (
    <div className="fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden" style={{ backgroundColor: '#0B0D0C' }}>
      <div className="absolute inset-0 h-full w-full">{children}</div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="pointer-events-auto mx-2 mt-1 rounded-3xl border-2 border-white/15 daylight-border bg-[#0B0D0C]/85 px-2 py-1 text-white shadow-lg backdrop-blur-md">
          <div className="truncate px-1 text-[11px] font-semibold leading-tight">{courseName || 'Active round'}</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canPrev}
              aria-label="Previous hole"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl disabled:opacity-40"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 text-center text-xs font-bold leading-tight whitespace-nowrap">
              Hole <span className="tabular-nums">{holeNumber}</span>
              <span className="text-white/70"> / Par </span>
              <span className="tabular-nums">{par}</span>
            </div>
            <button
              type="button"
              onClick={onNext}
              disabled={!canNext}
              aria-label="Next hole"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl disabled:opacity-40"
            >
              <ChevronRight size={18} />
            </button>
            <div className="px-1 text-[11px] font-semibold leading-tight whitespace-nowrap">
              Shot <span className="tabular-nums">{shotNumber}</span>
            </div>
            <button
              type="button"
              onClick={toggleDistanceUnit}
              aria-label={distanceUnit === 'm' ? 'Distance unit meters. Switch to yards' : 'Distance unit yards. Switch to meters'}
              className="min-h-[44px] rounded-2xl border border-white/20 px-2 text-[11px] font-semibold"
            >
              {distanceUnit === 'm' ? 'M' : 'YDS'}
            </button>
            <button
              type="button"
              onClick={onEndRound}
              className="ml-auto min-h-[44px] whitespace-nowrap rounded-2xl px-2.5 text-[11px] font-semibold text-[#0B0D0C]"
              style={{ backgroundColor: '#10B981' }}
            >
              End Round
            </button>
          </div>
        </div>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto rounded-3xl border-2 border-white/15 daylight-border bg-[#0B0D0C]/85 px-3 py-2 text-white shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Center Green</div>
              <div className="tabular-nums text-2xl font-bold leading-none text-[#10B981]">{formatDistance(centerDist, distanceUnit)}</div>
              <div className="mt-0.5 flex gap-1">
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums">F {formatDistance(frontDist, distanceUnit)}</span>
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums">B {formatDistance(backDist, distanceUnit)}</span>
              </div>
              {lastShot && (
                <div className="mt-0.5 truncate text-[10px] text-white/85">
                  Last Shot: <span className="tabular-nums">{formatDistance(lastShot.distanceFromPrev, distanceUnit)}</span> • {lastShot.clubUsed}
                </div>
              )}
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Suggested Club</div>
              <div className="truncate text-sm font-bold leading-tight">{clubName}</div>
              {clubSpec ? <div className="truncate text-[10px] font-normal text-white/65">{clubSpec}</div> : null}
            </div>
            <button
              type="button"
              onClick={() => onMarkShot?.(clubName)}
              className="min-h-[44px] shrink-0 rounded-2xl px-3 text-xs font-semibold text-[#0B0D0C]"
              style={{ backgroundColor: '#10B981' }}
            >
              Mark Shot
            </button>
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-label="Shot details"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl border border-white/20 text-sm"
            >
              {detailsOpen ? '▴' : '▾'}
            </button>
          </div>

          {detailsOpen && (
            <div className="mt-2 max-h-[28vh] space-y-2 overflow-y-auto">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Pin</div>
                <div className="mt-1 flex gap-1">
                  {['front', 'center', 'back'].map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => setPinChoice(choice)}
                      className="min-h-[44px] flex-1 rounded-2xl border px-2 text-[11px] font-semibold capitalize"
                      style={{
                        borderColor: pinChoice === choice ? '#10B981' : 'rgba(255,255,255,0.2)',
                        color: pinChoice === choice ? '#10B981' : '#fff',
                      }}
                    >
                      {choice} <span className="tabular-nums">{formatDistance(choice === 'front' ? frontDist : choice === 'back' ? backDist : centerDist, distanceUnit)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-[#10B981]/50 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Wind & Slope</div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="tabular-nums">{formatSpeed(windMph, speedUnit)}</span>
                  <WindArrow kind={kind} />
                  <span className="tabular-nums">Wind {deltaLabel}</span>
                  <span className="tabular-nums">Elev {elevationDelta > 0 ? `+${elevationDelta}` : elevationDelta}</span>
                  <span className="tabular-nums">Lie {lieAdjust > 0 ? `+${lieAdjust}` : '0'}</span>
                  <span className="tabular-nums">Plays {formatDistance(playsLikeYards, distanceUnit)}</span>
                </div>
                <div className="text-[11px] text-white/80">{suggestion || 'Aim at the middle of the green.'}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Lie</div>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {LIE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setLie(option.id)}
                      className="min-h-[44px] rounded-2xl border text-[10px] font-semibold"
                      style={{
                        borderColor: lie === option.id ? '#10B981' : 'rgba(255,255,255,0.2)',
                        color: lie === option.id ? '#10B981' : '#fff',
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Shot history</div>
                {shotList.length === 0 ? (
                  <div className="text-[11px] text-white/70">No shots logged on this hole.</div>
                ) : (
                  <ul className="space-y-0.5 text-[11px]">
                    {shotList.map((shot) => (
                      <li key={shot.shotNumber} className="tabular-nums">
                        {shot.shotNumber}. {formatDistance(shot.distanceFromPrev, distanceUnit)} • {shot.clubUsed} • {formatDistance(shot.remainingToCenter, distanceUnit)} left
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Caddie voice</div>
                <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Caddie voice">
                  {CADDIE_VOICES.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => selectPersona(voice.id)}
                      aria-pressed={personaId === voice.id}
                      className="min-h-[44px] rounded-full border px-3 text-[11px] font-semibold"
                      style={{
                        borderColor: personaId === voice.id ? '#10B981' : 'rgba(255,255,255,0.2)',
                        color: personaId === voice.id ? '#10B981' : '#fff',
                      }}
                    >
                      {voice.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => previewCaddieCallout(personaId, ttsLocale)}
                  className="mt-1 inline-flex min-h-[44px] items-center rounded-2xl border border-white/20 px-3 text-xs font-semibold"
                >
                  Preview Voice
                </button>
              </div>
              <button
                type="button"
                onClick={speak}
                aria-label="Play caddie callout"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3 text-xs font-semibold text-[#0B0D0C]"
                style={{ backgroundColor: '#10B981' }}
              >
                <Volume2 size={16} />
                Audio Caddie
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
