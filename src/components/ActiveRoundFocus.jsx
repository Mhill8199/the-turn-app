import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Moon, Sun, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
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
  holeNumber = 1,
  par = 4,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onEndRound,
  centerYards,
  frontYards,
  backYards,
  pinYards,
  windSpeedMph = 0,
  windDirDeg = 0,
  holeBearingDeg = 0,
  clubs = [],
  fallbackClubName = '',
  fallbackCarryYards = null,
  suggestion = '',
  crewLabel = '',
  children,
}) {
  const { distanceUnit, toggleDistanceUnit, speedUnit } = useUnits();
  const { lang } = useLanguage();
  const themeApi = useTheme() || {};
  const [localNight, setLocalNight] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );
  const night = themeApi.theme ? themeApi.theme === 'dark' : localNight;
  const rawPin = Number.isFinite(Number(pinYards)) ? Number(pinYards) : Number(centerYards) || 0;
  const rawCenter = Number.isFinite(Number(centerYards)) ? Number(centerYards) : rawPin;
  const front = Number.isFinite(Number(frontYards)) ? Number(frontYards) : Math.max(40, rawCenter - 12);
  const back = Number.isFinite(Number(backYards)) ? Number(backYards) : rawCenter + 14;
  const { windMph, deltaYards, kind } = relativeWind(windSpeedMph, windDirDeg, holeBearingDeg);
  const playsLikeYards = Math.max(0, Math.round(rawPin + deltaYards));
  const matched = closestClub(clubs, playsLikeYards);
  const clubName = matched?.club_type || matched?.name || fallbackClubName || '—';
  const clubCarry = matched ? Number(matched.carry_yards) : Number(fallbackCarryYards);
  const deltaLabel = `${deltaYards > 0 ? '+' : ''}${deltaYards}`;
  const ttsLocale = resolveTtsLocale(lang);

  const toggleContrast = () => {
    if (typeof themeApi.toggleTheme === 'function') {
      themeApi.toggleTheme();
      return;
    }
    const root = document.documentElement;
    const nextNight = !root.classList.contains('dark');
    root.classList.toggle('dark', nextNight);
    setLocalNight(nextNight);
  };

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
    <div
      className="fixed inset-0 z-40 h-[100dvh] w-screen"
      style={{ backgroundColor: night ? '#0B0D0C' : '#F6F5F0', color: 'var(--text-primary)' }}
    >
      <div className="absolute inset-0 z-40">{children}</div>
      <div className="pointer-events-none relative z-50 mx-auto flex h-full min-h-0 w-full max-w-md flex-col">
        <header
          className="pointer-events-auto relative z-50 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: night ? '#0B0D0C' : '#FFFFFF' }}
        >
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous hole"
            className="min-h-[44px] min-w-[44px] rounded-2xl border text-lg font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            −
          </button>
          <div className="min-w-[3.25rem] text-center leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Hole</div>
            <div className="tabular-nums text-base font-bold">{holeNumber}</div>
          </div>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next hole"
            className="min-h-[44px] min-w-[44px] rounded-2xl border text-lg font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            +
          </button>
          <div className="px-1 text-center leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Par</div>
            <div className="tabular-nums text-base font-bold">{par}</div>
          </div>
          <button
            type="button"
            onClick={toggleDistanceUnit}
            aria-label={distanceUnit === 'm' ? 'Distance unit meters. Switch to yards' : 'Distance unit yards. Switch to meters'}
            className="min-h-[44px] rounded-2xl border px-2.5 text-xs font-semibold"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {distanceUnit === 'm' ? 'M' : 'Yds'}
          </button>
          <button
            type="button"
            onClick={toggleContrast}
            aria-label={night ? 'Night contrast. Switch to daylight' : 'Daylight contrast. Switch to night'}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-2xl border"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {night ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={onEndRound}
            className="ml-auto min-h-[44px] rounded-2xl border px-2.5 text-xs font-semibold text-white"
            style={{ backgroundColor: '#10B981', borderColor: '#10B981' }}
          >
            End Round
          </button>
        </header>

        <div className="min-h-0 flex-1" />

        <div className="pointer-events-auto relative z-50 shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="space-y-2 rounded-3xl border bg-[#0B0D0C] p-3 text-white">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Center of Green</div>
                <div className="tabular-nums text-3xl font-bold leading-none">{formatDistance(rawCenter, distanceUnit)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Club Suggestion</div>
                <div className="text-base font-bold leading-tight">{clubName}</div>
                <div className="text-xs text-[#10B981]">
                  Stock <span className="tabular-nums">{formatDistance(clubCarry, distanceUnit)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-2xl border border-[#10B981]/50 px-1 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Front</div>
                <div className="tabular-nums text-sm font-semibold">{formatDistance(front, distanceUnit)}</div>
              </div>
              <div className="rounded-2xl border border-[#10B981] px-1 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Center</div>
                <div className="tabular-nums text-sm font-semibold">{formatDistance(rawCenter, distanceUnit)}</div>
              </div>
              <div className="rounded-2xl border border-[#10B981]/50 px-1 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Back</div>
                <div className="tabular-nums text-sm font-semibold">{formatDistance(back, distanceUnit)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
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
            </div>

            {crewLabel ? (
              <div className="truncate text-[11px] font-semibold" style={{ color: '#D4AF37' }}>
                Foursome · {crewLabel}
              </div>
            ) : null}
            <div className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-[#10B981]/50 px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Shot Suggestion</div>
                <div className="truncate text-xs">{suggestion || 'Aim at the middle of the green.'}</div>
              </div>
              <button
                type="button"
                onClick={speak}
                aria-label="Play caddie callout"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl text-[#0B0D0C]"
                style={{ backgroundColor: '#10B981' }}
              >
                <Volume2 size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
