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
import { formatZoneLabel, readStandingPosition } from '../utils/pinPlacements';
import { PIN_SCOUT_EVENT } from '../utils/pinScout';
import { useAuth } from '../context/AuthContext';

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

function alongYards(origin, point, bearingDeg) {
  const dist = yardsBetween(origin, point);
  if (!Number.isFinite(dist)) return null;
  const lat1 = (Number(origin.lat) * Math.PI) / 180;
  const lat2 = (Number(point.lat) * Math.PI) / 180;
  const dLon = ((Number(point.lon) - Number(origin.lon)) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  let delta = bearing - (Number(bearingDeg) || 0);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return dist * Math.cos((delta * Math.PI) / 180);
}

export function PinFinishSheet({
  open = false,
  floating = false,
  pinPlaceMode = false,
  startWithMethods = false,
  holeScore = null,
  onHoleScore,
  canAdvance = false,
  onAdvance,
  onClose,
  onCommitPin,
  onBeginFlagDrag,
  onLockFlag,
}) {
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setMethodsOpen(false);
      setNotice('');
      setBusy(false);
      return;
    }
    if (startWithMethods) setMethodsOpen(true);
  }, [open, startWithMethods]);

  if (!open) return null;

  const useGps = async () => {
    setBusy(true);
    setNotice('Reading GPS…');
    try {
      const point = await readStandingPosition();
      const saved = await onCommitPin?.(point);
      setNotice(saved?.green_zone ? `Locked ${formatZoneLabel(saved.green_zone)}` : 'Saved on this device');
    } catch (error) {
      setNotice(error?.message || 'GPS unavailable. Drag the flag on the green.');
    } finally {
      setBusy(false);
    }
  };

  const lockFlag = async () => {
    setBusy(true);
    try {
      const saved = await onLockFlag?.();
      setNotice(saved?.green_zone ? `Locked ${formatZoneLabel(saved.green_zone)}` : 'Saved on this device');
    } catch {
      setNotice('Saved on this device');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={floating ? 'fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]' : 'pointer-events-auto mb-2'}>
      <div className="rounded-3xl border border-white/15 bg-[#0B0D0C]/85 px-3 py-2 text-white shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Hole complete</div>
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-2xl px-2 text-[11px] font-semibold text-white/80">Close</button>
        </div>
        {holeScore && typeof onHoleScore === 'function' && (
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[11px]">Putts</span>
            <button type="button" aria-label="Fewer putts" onClick={() => onHoleScore({ putts: Number(holeScore.putts) - 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">−</button>
            <span className="w-6 text-center text-sm font-bold tabular-nums">{holeScore.putts}</span>
            <button type="button" aria-label="More putts" onClick={() => onHoleScore({ putts: Number(holeScore.putts) + 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">+</button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMethodsOpen(true)}
          className="mt-1 min-h-[44px] w-full rounded-2xl text-xs font-semibold text-[#0B0D0C]"
          style={{ backgroundColor: '#10B981' }}
        >
          Mark Pin
        </button>
        {methodsOpen && (
          <div className="mt-1 space-y-1">
            <button
              type="button"
              onClick={useGps}
              disabled={busy}
              className="min-h-[44px] w-full rounded-2xl border border-[#10B981]/50 px-2 text-[11px] font-semibold text-[#10B981] disabled:opacity-50"
            >
              Use My Current GPS Standing at Hole
            </button>
            <button
              type="button"
              onClick={onBeginFlagDrag}
              className="min-h-[44px] w-full rounded-2xl border border-white/20 px-2 text-[11px] font-semibold"
            >
              Drag Flag on the Green
            </button>
            {pinPlaceMode && (
              <button
                type="button"
                onClick={lockFlag}
                disabled={busy}
                className="min-h-[44px] w-full rounded-2xl px-2 text-xs font-semibold text-[#0B0D0C] disabled:opacity-50"
                style={{ backgroundColor: '#10B981' }}
              >
                Lock Flag
              </button>
            )}
            {notice ? <div className="text-[11px] text-[#10B981]">{notice}</div> : null}
          </div>
        )}
        <button
          type="button"
          onClick={onAdvance}
          className="mt-1 min-h-[44px] w-full rounded-2xl border border-white/20 text-xs font-semibold"
        >
          {canAdvance ? 'Next Hole' : 'Done'}
        </button>
      </div>
    </div>
  );
}

export function PinScoutToast() {
  const auth = useAuth();
  const patchProfile = auth?.patchProfile;
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let timer = 0;
    const onAward = (event) => {
      const detail = event.detail;
      if (!detail?.awarded) return;
      patchProfile?.({ pins_marked: detail.pinsMarked, scout_xp: detail.scoutXp });
      setToast(detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 4600);
    };
    window.addEventListener(PIN_SCOUT_EVENT, onAward);
    return () => {
      window.removeEventListener(PIN_SCOUT_EVENT, onAward);
      window.clearTimeout(timer);
    };
  }, [patchProfile]);

  if (!toast) return null;
  const unlock = toast.justUnlocked && toast.tier?.label ? `${toast.tier.label} unlocked. ` : '';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3 top-[calc(env(safe-area-inset-top)+4.5rem)]"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto flex min-h-[44px] w-full max-w-sm items-center gap-2 rounded-2xl px-3 py-2 shadow-lg"
        style={{ backgroundColor: '#D4AF37', color: '#0B0D0C' }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-tight">+25 XP • Pin Scout (+1 Daily Pin Logged)</div>
          <div className="text-[11px] font-medium leading-snug">
            {unlock}1 pin Pin Scout · 9 pins Course Ranger · 18 pins Tour Advance Scout
          </div>
        </div>
        <button
          type="button"
          onClick={() => setToast(null)}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          aria-label="Dismiss Pin Scout toast"
        >
          ×
        </button>
      </div>
    </div>
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
  holeScore = null,
  onHoleScore,
  livePin = null,
  pinTendency = '',
  onConfirmPin,
  pinSheetOpen = false,
  pinSheetMode = 'finish',
  onOpenPinSheet,
  pinPlaceMode = false,
  onCommitPin,
  onBeginFlagDrag,
  onLockFlag,
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
  const pinLat = Number(livePin?.lat);
  const pinLng = Number(livePin?.lng ?? livePin?.lon);
  const hasLivePin = Number.isFinite(pinLat) && Number.isFinite(pinLng);
  const pinPoint = hasLivePin ? { lat: pinLat, lon: pinLng } : null;
  let exactPinDist = pinPoint && liePoint ? yardsBetween(liePoint, pinPoint) : null;
  if (exactPinDist == null && pinPoint && centerPoint) {
    const along = alongYards(centerPoint, pinPoint, holeBearingDeg);
    if (Number.isFinite(along)) exactPinDist = Math.max(0, centerDist + along);
  }
  if (exactPinDist == null && hasLivePin) exactPinDist = centerDist;
  const playsBase = hasLivePin && Number.isFinite(exactPinDist) ? exactPinDist : centerDist;
  const { windMph, deltaYards, kind } = relativeWind(windSpeedMph, windDirDeg, holeBearingDeg);
  // rough +5 yards, bunker +10, tee uses full carry. Fairway uses stock carry.
  const lieAdjust = lie === 'rough' ? 5 : lie === 'bunker' ? 10 : 0;
  // Headwind adds yards, tailwind subtracts. Course elevation adds about 2 yards per 1,000 ft when provided.
  const elevationDelta = Number.isFinite(Number(elevationFt)) ? Math.round(Number(elevationFt) / 500) : 0;
  const playsLikeYards = Math.max(0, Math.round((Number(playsBase) || 0) + deltaYards + lieAdjust + elevationDelta));
  const matched = closestActiveClub(clubs, playsLikeYards);
  const clubName = matched?.club_type || matched?.name || fallbackClubName || '—';
  const clubSpec = clubSpecSubtitle(matched);
  const clubCarry = matched ? Number(matched.carry_yards) : Number(fallbackCarryYards);
  const deltaLabel = `${deltaYards > 0 ? '+' : ''}${deltaYards}`;
  const ttsLocale = resolveTtsLocale(lang);

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
        targetYards: hasLivePin && Number.isFinite(exactPinDist) ? exactPinDist : centerDist,
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

  const holeYards = Number.isFinite(Number(centerYards)) ? Number(centerYards) : scoreCenter;
  const yardagePills = [
    ...(hasLivePin ? [{ id: 'pin', label: 'Exact Pin', yards: exactPinDist, accent: true }] : []),
    { id: 'back', label: 'Back', yards: backDist, accent: false },
    { id: 'center', label: 'Center', yards: centerDist, accent: !hasLivePin },
    { id: 'front', label: 'Front', yards: frontDist, accent: false },
  ];

  return (
    <div className="fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden" style={{ backgroundColor: '#0B0D0C' }}>
      <PinScoutToast />
      <div className="absolute inset-0 h-full w-full">{children}</div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)]" aria-label={courseName || 'Active round'}>
        <div className="pointer-events-auto mx-2 mt-1 flex items-center gap-1 rounded-3xl border-2 border-white/15 daylight-border bg-[#0B0D0C]/85 px-1 py-1 text-white shadow-lg backdrop-blur-md">
          <div className="flex min-h-[44px] min-w-0 flex-1 items-center">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canPrev}
              aria-label="Previous hole"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl disabled:opacity-40"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 flex-1 truncate text-center text-[11px] font-bold leading-tight">
              <span className="sr-only">{courseName || 'Active round'}. </span>
              Hole <span className="tabular-nums">{holeNumber}</span>
              <span className="text-white/70"> • Par </span>
              <span className="tabular-nums">{par}</span>
              <span className="text-white/70"> • </span>
              <span className="tabular-nums">{formatDistance(holeYards, distanceUnit)}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (onOpenPinSheet) onOpenPinSheet(true);
                else onNext?.();
              }}
              disabled={!canNext}
              aria-label="Next hole"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl disabled:opacity-40"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full bg-white/10 px-2" aria-label="Live wind">
            <WindArrow kind={kind} />
            <span className="tabular-nums text-[11px] font-semibold">{formatSpeed(windMph, speedUnit)}</span>
          </div>
          <button
            type="button"
            onClick={toggleDistanceUnit}
            aria-label={distanceUnit === 'm' ? 'Distance unit meters. Switch to yards' : 'Distance unit yards. Switch to meters'}
            className="min-h-[44px] shrink-0 rounded-2xl border border-white/20 px-2 text-[11px] font-semibold"
          >
            {distanceUnit === 'm' ? 'M' : 'YDS'}
          </button>
          <button
            type="button"
            onClick={onEndRound}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded-2xl px-2.5 text-[11px] font-semibold text-[#0B0D0C]"
            style={{ backgroundColor: '#10B981' }}
          >
            End Round
          </button>
        </div>
      </header>

      <div className="pointer-events-none absolute left-2 z-50 flex flex-col gap-1.5 top-[calc(env(safe-area-inset-top)+4.35rem)]">
        {yardagePills.map((pill) => (
          <div
            key={pill.id}
            className={`min-h-[44px] rounded-full border-2 px-3 py-1 backdrop-blur-md tabular-nums ${pill.accent ? 'border-[#10B981] text-[#10B981]' : 'border-white/15 text-white'} bg-[#0B0D0C]/85 daylight-border`}
          >
            <div className="text-[9px] font-semibold uppercase tracking-wider">{pill.label}</div>
            <div className="text-sm font-bold leading-none">{formatDistance(pill.yards, distanceUnit)}</div>
          </div>
        ))}
        {hasLivePin && (
          <div className="pointer-events-auto flex flex-col gap-1">
            <div className="rounded-full border border-[#10B981]/50 bg-[#0B0D0C]/85 px-2.5 py-1 text-[9px] font-semibold tracking-wide text-[#10B981] backdrop-blur-md">
              LIVE PIN • Verified Today
            </div>
            <button
              type="button"
              onClick={() => onConfirmPin?.()}
              className="min-h-[44px] rounded-full border border-[#10B981]/50 bg-[#0B0D0C]/85 px-3 text-[11px] font-semibold text-[#10B981] backdrop-blur-md"
            >
              Confirm Pin <span className="tabular-nums">· {Number(livePin?.confirmations) || 0}</span>
            </button>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 px-2 pb-[env(safe-area-inset-bottom)]">
        <PinFinishSheet
          open={pinSheetOpen}
          pinPlaceMode={pinPlaceMode}
          startWithMethods={pinSheetMode === 'mark'}
          holeScore={holeScore}
          onHoleScore={onHoleScore}
          canAdvance={canNext}
          onAdvance={() => {
            if (canNext) onNext?.();
            else onOpenPinSheet?.(false);
          }}
          onClose={() => onOpenPinSheet?.(false)}
          onCommitPin={onCommitPin}
          onBeginFlagDrag={onBeginFlagDrag}
          onLockFlag={onLockFlag}
        />
        <div className="pointer-events-auto mb-2 rounded-3xl border-2 border-white/15 daylight-border bg-[#0B0D0C]/85 px-2.5 py-2 text-white shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">Plays Like</div>
              <div className="tabular-nums text-2xl font-bold leading-none text-[#10B981]">{formatDistance(playsLikeYards, distanceUnit)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">Recommended Club</div>
              <div className="truncate text-sm font-bold leading-tight">{clubName}</div>
              {clubSpec ? <div className="truncate text-[10px] font-medium text-white/60">{clubSpec}</div> : null}
            </div>
            <button
              type="button"
              onClick={speak}
              aria-label="Caddie Callout"
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-2xl border border-white/20 px-2 text-[11px] font-semibold"
            >
              <Volume2 size={15} />
              Callout
            </button>
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
              aria-label="Pin, lie, score, and shots"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl border border-white/20 text-sm"
            >
              {detailsOpen ? '▴' : '▾'}
            </button>
          </div>

          {detailsOpen && (
            <div className="mt-2 max-h-[26vh] space-y-2 overflow-y-auto">
              {pinTendency ? (
                <div className="rounded-2xl border border-[#10B981]/40 bg-[#0B0D0C]/85 px-3 py-2 text-[11px] font-semibold text-[#10B981] backdrop-blur-md">
                  {pinTendency}
                </div>
              ) : null}
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
              {holeScore && typeof onHoleScore === 'function' && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">Score</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[11px]">Strokes</span>
                    <button type="button" aria-label="Fewer strokes" onClick={() => onHoleScore({ strokes: Number(holeScore.strokes) - 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">−</button>
                    <span className="w-6 text-center text-sm font-bold tabular-nums">{holeScore.strokes}</span>
                    <button type="button" aria-label="More strokes" onClick={() => onHoleScore({ strokes: Number(holeScore.strokes) + 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">+</button>
                    <span className="ml-1 text-[11px]">Putts</span>
                    <button type="button" aria-label="Fewer putts" onClick={() => onHoleScore({ putts: Number(holeScore.putts) - 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">−</button>
                    <span className="w-6 text-center text-sm font-bold tabular-nums">{holeScore.putts}</span>
                    <button type="button" aria-label="More putts" onClick={() => onHoleScore({ putts: Number(holeScore.putts) + 1 })} className="min-h-[44px] min-w-[44px] rounded-2xl border border-white/20 text-sm font-bold">+</button>
                    <button
                      type="button"
                      onClick={() => onOpenPinSheet?.(true, 'mark')}
                      className="min-h-[44px] rounded-2xl px-3 text-[11px] font-semibold text-[#0B0D0C]"
                      style={{ backgroundColor: '#10B981' }}
                    >
                      Mark Pin
                    </button>
                  </div>
                  {par > 3 && (
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {[
                        { id: 'left', label: 'Miss L' },
                        { id: 'hit', label: 'Fairway' },
                        { id: 'right', label: 'Miss R' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onHoleScore({ fir: opt.id })}
                          className="min-h-[44px] rounded-2xl border text-[11px] font-semibold"
                          style={{
                            borderColor: holeScore.fir === opt.id ? '#10B981' : 'rgba(255,255,255,0.2)',
                            color: holeScore.fir === opt.id ? '#10B981' : '#fff',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">Shot list</div>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
