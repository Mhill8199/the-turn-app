import { Flag, Map, Minus, Mountain, Plus, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDistance, formatSpeed, useUnits, YARDS_TO_METERS } from '../utils/distanceUnits';
import { resolveTtsLocale, speakCaddieCallout } from '../utils/wearableAndAudioCaddie';
import { useLanguage } from '../i18n/LanguageContext';

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
  const deltaYards = Math.round(head);
  let kind = 'cross-right';
  if (Math.abs(head) < 0.5 && Math.abs(cross) < 0.5) kind = 'calm';
  else if (Math.abs(head) >= Math.abs(cross)) kind = head >= 0 ? 'head' : 'tail';
  else kind = cross >= 0 ? 'cross-right' : 'cross-left';
  return { windMph, deltaYards, kind };
}

function windArrow(kind) {
  if (kind === 'head') return '↓';
  if (kind === 'tail') return '↑';
  if (kind === 'cross-left') return '←';
  if (kind === 'cross-right') return '→';
  return '·';
}

function compactYards(yards, unit) {
  const value = Number(yards);
  if (!Number.isFinite(value)) return '';
  if (unit === 'm') return `${Math.round(value * YARDS_TO_METERS)}m`;
  return `${Math.round(value)}y`;
}

export default function ActiveRoundFocus({
  holeNumber = 1,
  holeCount = 18,
  onSelectHole,
  par = 4,
  holeYards,
  handicap,
  scoreLabel = 'E',
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
  shots = 0,
  putts = 0,
  onChangePutts,
  onMarkShot,
  onSetPin,
  elevationDeltaFt,
  pinTendency = '',
  onViewChange,
  onStrategyChange,
  children,
}) {
  const { distanceUnit, formatDistance: formatUnitDistance, speedUnit, toggleDistanceUnit } = useUnits();
  const { lang } = useLanguage();
  const [greenOpen, setGreenOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const count = holeCount === 9 ? 9 : 18;
  const holes = Array.from({ length: count }, (_, index) => index + 1);
  const rawPin = Number.isFinite(Number(pinYards)) ? Number(pinYards) : null;
  const rawCenter = Number.isFinite(Number(centerYards)) ? Number(centerYards) : (rawPin ?? 0);
  const front = Number.isFinite(Number(frontYards)) ? Number(frontYards) : null;
  const back = Number.isFinite(Number(backYards)) ? Number(backYards) : null;
  const primary = rawPin != null ? rawPin : rawCenter;
  const { windMph, deltaYards, kind } = relativeWind(windSpeedMph, windDirDeg, holeBearingDeg);
  const playsLikeYards = Math.max(0, Math.round(primary + deltaYards));
  const matched = closestClub(clubs, playsLikeYards);
  const clubName = matched?.club_type || matched?.name || fallbackClubName || '—';
  const clubCarry = matched ? Number(matched.carry_yards) : Number(fallbackCarryYards);
  const ttsLocale = resolveTtsLocale(lang);
  const hcp = Number(handicap);
  const hcpLabel = Number.isFinite(hcp) && hcp > 0 ? ` • ${hcp} HCP` : '';
  const yardLabel = compactYards(holeYards, distanceUnit);
  const subtitle = `PAR ${par}${yardLabel ? ` • ${yardLabel}` : ''}${hcpLabel}`;
  const elevation = Number(elevationDeltaFt);
  const hasElevation = Number.isFinite(elevation);
  const shotCount = Math.max(0, Number(shots) || 0);
  const puttCount = Math.max(0, Number(putts) || 0);

  useEffect(() => {
    setGreenOpen(false);
    setStrategyOpen(false);
    onViewChange?.('hole');
    onStrategyChange?.(false);
  }, [holeNumber]);

  const speak = () => {
    speakCaddieCallout(
      {
        holeNumber,
        club: clubName,
        targetYards: primary,
        playsLikeYards,
        wind: { direction: kind === 'calm' ? 'calm' : kind.replace('-', ' '), speed: formatSpeed(windMph, speedUnit) },
        advice: suggestion,
      },
      distanceUnit,
      ttsLocale
    );
  };

  const openGreen = () => {
    setStrategyOpen(false);
    setGreenOpen((open) => {
      const next = !open;
      onViewChange?.(next ? 'green' : 'hole');
      return next;
    });
  };

  const openStrategy = () => {
    setGreenOpen(false);
    onViewChange?.('hole');
    setStrategyOpen((open) => {
      const next = !open;
      if (next) speak();
      onStrategyChange?.(next);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-40 h-[100dvh] w-screen bg-[#0B0D0C] text-white">
      <div className="fixed inset-0 z-30 h-[100dvh] w-screen">{children}</div>

      <header className="pointer-events-auto absolute inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0B0D0C]/90 px-2 pb-1.5 pt-[max(0.35rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {holes.map((number) => {
              const active = number === holeNumber;
              return (
                <button
                  key={number}
                  type="button"
                  onClick={() => onSelectHole?.(number)}
                  aria-pressed={active}
                  className={`min-h-[44px] min-w-[44px] shrink-0 rounded-full text-sm font-semibold tabular-nums ${
                    active ? 'bg-white text-[#10B981]' : 'bg-white/10 text-white'
                  }`}
                >
                  {number}
                </button>
              );
            })}
          </div>
          <div
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white px-2 text-sm font-bold tabular-nums text-[#10B981]"
            aria-label={`Score ${scoreLabel}`}
          >
            {scoreLabel}
          </div>
          <button
            type="button"
            onClick={onEndRound}
            className="min-h-[44px] rounded-full px-3 text-xs font-semibold text-white"
          >
            End
          </button>
        </div>
        <div className="pt-1 text-center text-[11px] font-semibold tracking-wide text-white/90">
          {subtitle}
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-24 right-2 top-28 z-50 flex w-[4.75rem] flex-col gap-1.5 overflow-y-auto">
        <button
          type="button"
          onClick={onSetPin}
          className="pointer-events-auto flex min-h-[44px] items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#0B0D0C]/80 text-[10px] font-semibold text-[#10B981] backdrop-blur-md"
        >
          <Flag size={14} />
          SET PIN
        </button>
        <div className="pointer-events-none rounded-2xl border border-white/10 bg-[#0B0D0C]/80 px-1.5 py-1.5 text-center backdrop-blur-md">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[#10B981]">{rawPin != null ? 'Pin' : 'Center'}</div>
          <div className="tabular-nums text-xl font-bold leading-none">{formatUnitDistance(primary)}</div>
          <div className="mt-1 text-[9px] leading-tight text-white/70">
            <div>F <span className="tabular-nums">{front == null ? '—' : formatUnitDistance(front)}</span></div>
            <div>B <span className="tabular-nums">{back == null ? '—' : formatUnitDistance(back)}</span></div>
          </div>
        </div>
        <div className="pointer-events-none min-h-[44px] rounded-2xl border border-white/10 bg-[#0B0D0C]/80 px-1.5 py-1.5 text-center backdrop-blur-md">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Wind</div>
          <div className="text-sm font-semibold tabular-nums text-[#10B981]">
            {windArrow(kind)} {formatSpeed(windMph, speedUnit)}
          </div>
        </div>
        <div className="pointer-events-none min-h-[44px] rounded-2xl border border-white/10 bg-[#0B0D0C]/80 px-1.5 py-1.5 text-center backdrop-blur-md">
          <div className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/60">
            <Mountain size={10} />
            Slope
          </div>
          {hasElevation ? (
            <div className="text-xs font-semibold tabular-nums">
              {elevation > 0 ? `+${Math.round(elevation)}` : Math.round(elevation)} ft
            </div>
          ) : (
            <div className="text-[10px] text-white/40">Unavailable</div>
          )}
        </div>
        <button
          type="button"
          onClick={openGreen}
          aria-pressed={greenOpen}
          className="pointer-events-auto min-h-[44px] rounded-2xl border border-white/10 bg-[#0B0D0C]/80 px-1.5 py-1 text-[10px] font-semibold backdrop-blur-md"
        >
          <Map size={14} className="mx-auto text-[#10B981]" />
          GREEN MAP
        </button>
        <button
          type="button"
          onClick={openStrategy}
          aria-pressed={strategyOpen}
          className="pointer-events-auto min-h-[44px] rounded-2xl border border-[#D4AF37]/50 bg-[#0B0D0C]/80 px-1.5 py-1 text-[10px] font-semibold text-[#D4AF37] backdrop-blur-md"
        >
          STRATEGY
        </button>
      </div>

      {greenOpen ? (
        <div className="pointer-events-auto absolute left-2 top-28 z-50 w-44 rounded-2xl border border-white/10 bg-[#0B0D0C]/90 p-3 backdrop-blur-md">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Green</div>
          <p className="mt-1 text-xs text-white/80">
            {pinTendency ? pinTendency : 'Pin tendency unavailable'}
          </p>
          <button type="button" onClick={openGreen} className="mt-2 min-h-[44px] text-xs font-semibold text-white">
            Back to hole
          </button>
        </div>
      ) : null}

      {strategyOpen ? (
        <div className="pointer-events-auto absolute left-2 top-28 z-50 w-48 rounded-2xl border border-[#D4AF37]/40 bg-[#0B0D0C]/90 p-3 backdrop-blur-md">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">Caddie</div>
          <div className="text-base font-bold">{clubName}</div>
          <div className="tabular-nums text-sm text-[#10B981]">{formatUnitDistance(playsLikeYards)} plays like</div>
          {Number.isFinite(clubCarry) ? (
            <div className="text-[11px] text-white/60">
              Stock <span className="tabular-nums">{formatDistance(clubCarry, distanceUnit)}</span>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-white/80">{suggestion || 'Aim at the middle of the green.'}</p>
          {crewLabel ? <p className="mt-1 truncate text-[11px] text-[#D4AF37]">Foursome · {crewLabel}</p> : null}
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={speak}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-2xl bg-[#10B981] text-xs font-semibold text-[#0B0D0C]"
            >
              <Volume2 size={14} />
              Audio Caddie
            </button>
            <button
              type="button"
              onClick={toggleDistanceUnit}
              className="min-h-[44px] rounded-2xl border border-white/15 px-2 text-[11px] font-semibold"
            >
              {distanceUnit === 'm' ? 'M' : 'Yds'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-50 flex items-stretch gap-2 bg-[#0B0D0C]/85 px-2 pt-2 backdrop-blur-md pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-2xl border border-white/10">
          <div className="tabular-nums text-lg font-bold leading-none">{shotCount}</div>
          <div className="text-[10px] font-semibold tracking-wider text-white/60">SHOTS</div>
        </div>
        <div className="flex min-h-[44px] items-center gap-1 rounded-full border border-white/10 px-1">
          <button
            type="button"
            aria-label="Fewer putts"
            onClick={() => onChangePutts?.(-1)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full"
          >
            <Minus size={16} />
          </button>
          <div className="text-center">
            <div className="tabular-nums text-lg font-bold leading-none">{puttCount}</div>
            <div className="text-[10px] font-semibold tracking-wider text-white/60">PUTTS</div>
          </div>
          <button
            type="button"
            aria-label="More putts"
            onClick={() => onChangePutts?.(1)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full"
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={onMarkShot}
          className="min-h-[44px] flex-1 rounded-2xl bg-[#10B981] text-sm font-semibold text-[#0B0D0C]"
        >
          + SHOT
        </button>
      </div>
    </div>
  );
}
