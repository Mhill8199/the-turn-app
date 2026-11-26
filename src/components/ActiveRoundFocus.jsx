import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Minus, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDistance, formatSpeed, useUnits } from '../utils/distanceUnits';
import { resolveTtsLocale, speakCaddieCallout } from '../utils/wearableAndAudioCaddie';

function closestClub(clubs, playsLikeYards) {
  const list = Array.isArray(clubs) ? clubs : [];
  let best = null;
  let bestDiff = Infinity;
  for (const club of list) {
    const carry = Number(club?.carry_yards);
    if (!Number.isFinite(carry)) continue;
    const diff = Math.abs(carry - playsLikeYards);
    if (diff < bestDiff) {
      best = club;
      bestDiff = diff;
    }
  }
  return best;
}

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

export default function ActiveRoundFocus({
  courseName = '',
  holeNumber = 1,
  par = 4,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onEndRound,
  centerYards,
  pinYards,
  windSpeedMph = 0,
  windDirDeg = 0,
  holeBearingDeg = 0,
  clubs = [],
  fallbackClubName = '',
  fallbackCarryYards = null,
  suggestion = '',
  children,
}) {
  const { distanceUnit, toggleDistanceUnit, speedUnit } = useUnits();
  const { lang } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rawPin = Number.isFinite(Number(pinYards)) ? Number(pinYards) : Number(centerYards) || 0;
  const rawCenter = Number.isFinite(Number(centerYards)) ? Number(centerYards) : rawPin;
  const { windMph, deltaYards, kind } = relativeWind(windSpeedMph, windDirDeg, holeBearingDeg);
  const playsLikeYards = Math.max(0, Math.round(rawPin + deltaYards));
  const matched = closestClub(clubs, playsLikeYards);
  const clubName = matched?.club_type || matched?.name || fallbackClubName || '—';
  const clubCarry = matched ? Number(matched.carry_yards) : Number(fallbackCarryYards);
  const deltaLabel = `${deltaYards > 0 ? '+' : ''}${deltaYards}`;
  const ttsLocale = resolveTtsLocale(lang);

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
        targetYards: rawPin,
        playsLikeYards,
        wind: { direction: kind === 'calm' ? 'calm' : kind.replace('-', ' '), speed: formatSpeed(windMph, speedUnit) },
        advice: suggestion,
      },
      distanceUnit,
      ttsLocale
    );
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
            <div className="min-w-[4.5rem] text-center text-xs font-bold leading-tight">
              Hole <span className="tabular-nums">{holeNumber}</span>
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
            <div className="px-1 text-center text-[11px] leading-tight">
              <div className="font-semibold uppercase tracking-wider text-white/70">Par</div>
              <div className="tabular-nums text-sm font-bold">{par}</div>
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Center of Green</div>
              <div className="tabular-nums text-2xl font-bold leading-none text-[#10B981]">{formatDistance(rawCenter, distanceUnit)}</div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Club Suggestion</div>
              <div className="truncate text-sm font-bold leading-tight">{clubName}</div>
              <div className="text-[10px] text-[#10B981]">
                Stock <span className="tabular-nums">{formatDistance(clubCarry, distanceUnit)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={speak}
              aria-label="Play caddie callout"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl text-[#0B0D0C]"
              style={{ backgroundColor: '#10B981' }}
            >
              <Volume2 size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="mt-1 min-h-[32px] w-full text-left text-[10px] font-semibold uppercase tracking-wider text-[#10B981]"
          >
            Pin • Windage • Shot Suggestion {detailsOpen ? '▴' : '▾'}
          </button>

          {detailsOpen && (
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <div className="flex min-h-[44px] flex-col justify-center rounded-2xl border border-[#10B981]/50 px-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Pin</div>
                <div className="tabular-nums text-sm font-semibold">{formatDistance(rawPin, distanceUnit)}</div>
              </div>
              <div className="flex min-h-[44px] flex-col justify-center rounded-2xl border border-[#10B981]/50 px-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Windage</div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="tabular-nums">{formatSpeed(windMph, speedUnit)}</span>
                  <WindArrow kind={kind} />
                  <span className="tabular-nums">Plays {deltaLabel}</span>
                </div>
              </div>
              <div className="col-span-2 flex min-h-[44px] items-center rounded-2xl border border-[#10B981]/50 px-2 py-1">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Shot Suggestion</div>
                  <div className="text-xs">{suggestion || 'Aim at the middle of the green.'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
