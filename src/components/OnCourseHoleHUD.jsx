import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import ActiveRoundFocus from './ActiveRoundFocus';
import SatelliteHoleMap from './SatelliteHoleMap';
import { useLanguage } from '../i18n/LanguageContext';
import { useUnits } from '../utils/distanceUnits';
import { buildWearablePayload, readCaddiePersonaId, resolveTtsLocale, speakCaddieCallout } from '../utils/wearableAndAudioCaddie';
import { activeBagClubs, closestActiveClub, clubSpecSubtitle } from '../utils/bagClubs';

export default function OnCourseHoleHUD({
  holeNumber: initialHole = 1,
  par = 4,
  playsLikeYards = 385,
  actualYards = 370,
  recommendedClub = '7-Iron',
  windNote = 'Neutral wind',
  clubs = [],
  lat,
  lon,
  courseName = 'Cart HUD',
}) {
  const { distanceUnit, formatDistance, tabularNumsClass } = useUnits();
  const { lang } = useLanguage();
  const unit = distanceUnit === 'm' ? 'm' : 'yds';
  const ttsLocale = resolveTtsLocale(lang);
  const [holeNumber, setHoleNumber] = useState(initialHole);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [pinTarget, setPinTarget] = useState(null);
  const [wearable, setWearable] = useState(null);

  const yardage = Number(playsLikeYards) || 385;
  const targetYards = Number.isFinite(Number(pinTarget?.yards)) ? Number(pinTarget.yards) : yardage;
  const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
  const playableClubs = activeBagClubs(clubs);
  const matchedClub = closestActiveClub(playableClubs, yardage);
  const suggestedName = matchedClub?.club_type || recommendedClub;
  const suggestedSpec = clubSpecSubtitle(matchedClub);

  useEffect(() => {
    setPinTarget(null);
  }, [holeNumber]);

  useEffect(() => {
    setWearable(buildWearablePayload({
      unit,
      targetYards: yardage,
      playsLikeYards: yardage,
      club: suggestedName,
      holeNumber,
      par,
      wind: windNote,
      advice: actualYards != null ? `Actual ${actualYards}` : '',
      ttsLocale,
    }));
  }, [unit, yardage, actualYards, suggestedName, holeNumber, par, windNote, ttsLocale]);

  const playCallout = () => {
    speakCaddieCallout(
      { holeNumber, club: suggestedName, targetYards: yardage, wind: windNote },
      unit,
      ttsLocale,
      readCaddiePersonaId()
    );
  };

  if (isRoundActive) {
    return (
      <ActiveRoundFocus
        holeNumber={holeNumber}
        par={par}
        canPrev={holeNumber > 1}
        canNext={holeNumber < 18}
        onPrev={() => setHoleNumber((n) => Math.max(1, n - 1))}
        onNext={() => setHoleNumber((n) => Math.min(18, n + 1))}
        onEndRound={() => {
          setPinTarget(null);
          setIsRoundActive(false);
        }}
        centerYards={targetYards}
        pinYards={targetYards}
        windSpeedMph={0}
        clubs={playableClubs}
        fallbackClubName={suggestedName}
        suggestion={windNote}
      >
        {hasCoords ? (
          <SatelliteHoleMap
            fill
            courseName={courseName}
            lat={Number(lat)}
            lon={Number(lon)}
            holeNumber={holeNumber}
            onPinChange={setPinTarget}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#102018] px-6 text-center">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#10B981]">Fairway</div>
              <div className="mt-2 text-sm text-white">
                Hole <span className="tabular-nums">{holeNumber}</span> · Par <span className="tabular-nums">{par}</span>
              </div>
              <div className="mt-1 text-xs text-emerald-200/80">
                <span className="tabular-nums">{formatDistance(yardage, distanceUnit)}</span> to the middle of the green
              </div>
            </div>
          </div>
        )}
      </ActiveRoundFocus>
    );
  }

  const glance = wearable?.glasses?.meta?.glance || '';
  const activity = wearable?.liveActivity;

  return (
    <div className="min-h-screen bg-black text-emerald-400 p-6 flex flex-col font-mono">
      <div className="flex items-center justify-between border-b border-emerald-900 pb-3">
        <span className="text-sm font-bold tracking-widest uppercase">THE TURN • CART HUD</span>
        <a href="/" className="text-xs px-3 min-h-[44px] inline-flex items-center rounded-lg border border-emerald-700 text-emerald-300">
          Exit HUD
        </a>
      </div>

      <div className="my-auto space-y-5 text-center py-8">
        <div className="text-xs uppercase tracking-widest text-emerald-500">
          Hole <span className="tabular-nums">{holeNumber}</span> • Par <span className="tabular-nums">{par}</span>
        </div>
        <div className={`text-5xl font-extrabold text-white ${tabularNumsClass}`}>{formatDistance(yardage)}</div>
        <div className={`text-xs text-emerald-300 ${tabularNumsClass}`}>Center of green • Actual {formatDistance(actualYards)}</div>
        <div className="p-5 rounded-3xl border-2 border-emerald-500 bg-emerald-950/30 space-y-2">
          <div className="text-xs uppercase tracking-widest text-amber-400">Recommended Club</div>
          <div className="text-4xl font-black text-white">{suggestedName}</div>
          {suggestedSpec ? <div className="text-xs text-emerald-200/70">{suggestedSpec}</div> : null}
          <div className="text-sm text-emerald-300 tabular-nums">{windNote}</div>
        </div>

        <button
          type="button"
          onClick={() => {
            setPinTarget(null);
            setIsRoundActive(true);
          }}
          className="w-full min-h-[44px] rounded-2xl bg-[#10B981] text-[#0B0D0C] font-semibold text-sm"
        >
          Start Round
        </button>
        <button
          type="button"
          onClick={playCallout}
          className="w-full min-h-[44px] rounded-2xl border-2 border-emerald-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2"
        >
          <Volume2 size={16} /> Play caddie callout
        </button>
        {(activity || glance) && (
          <div className="text-left text-xs text-emerald-200 space-y-1">
            {activity && (
              <div>
                {activity.title} · {activity.subtitle} · {activity.trailing}
              </div>
            )}
            {glance && <div>{glance}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
