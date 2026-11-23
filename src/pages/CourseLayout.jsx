import { useState, useEffect } from 'react';
import {
  Wind,
  Droplets,
  Thermometer,
  Mountain,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Watch,
  Glasses,
  Navigation,
  Plus,
  X,
  Search,
  Flag,
  Crosshair,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  COURSE_PRESETS,
  fetchCourseWeather,
  fetchElevationFt,
  searchNearbyGolfCourses,
  degreesToCompass,
  calculateShotPhysics,
} from '../lib/weatherPhysics';

const CUSTOM_COURSES_KEY = 'the-turn-custom-courses';
const SCORES_KEY = 'the-turn-scores';
const PINS_KEY = 'the-turn-miss-pins';

const TEE_BOXES = [
  { id: 'tips', label: 'Tips', mult: 1.06, y: 294 },
  { id: 'blue', label: 'Blue', mult: 1.0, y: 284 },
  { id: 'white', label: 'White', mult: 0.93, y: 274 },
  { id: 'forward', label: 'Forward', mult: 0.84, y: 264 },
];

const PIN_TYPES = [
  { id: 'target', label: 'Target', color: '#22C55E' },
  { id: 'bailout', label: 'Bailout', color: '#EAB308' },
  { id: 'dead', label: 'Dead Zone', color: '#EF4444' },
];

export default function CourseLayout({ clubs = [], isPro = false, onOpenPaywall, onOpenWearable }) {
  const [customCourses, setCustomCourses] = useState(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_COURSES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [scores, setScores] = useState(() => {
    try {
      const saved = localStorage.getItem(SCORES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [missPins, setMissPins] = useState(() => {
    try {
      const saved = localStorage.getItem(PINS_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const allCourses = [...customCourses, ...COURSE_PRESETS];
  const [courseId, setCourseId] = useState(() => {
    const savedHome = localStorage.getItem('the-turn-home-course');
    if (savedHome && allCourses.some((c) => c.id === savedHome)) return savedHome;
    return allCourses[0]?.id || COURSE_PRESETS[0].id;
  });
  const [holeIdx, setHoleIdx] = useState(0);
  const [teeId, setTeeId] = useState('blue');
  const [activePinType, setActivePinType] = useState('target');
  const [selectedClubId, setSelectedClubId] = useState(clubs[1]?.id || clubs[0]?.id || '1');
  const [courseSearch, setCourseSearch] = useState('');
  const [searchingCourses, setSearchingCourses] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [simOpen, setSimOpen] = useState(false);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorMode, setCreatorMode] = useState('hole');
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCity, setNewCourseCity] = useState('');
  const [newCourseElev, setNewCourseElev] = useState(1200);
  const [newCourseLat, setNewCourseLat] = useState(33.93);
  const [newCourseLon, setNewCourseLon] = useState(-117.16);

  const [holeNumber, setHoleNumber] = useState(1);
  const [holePar, setHolePar] = useState(4);
  const [holeYards, setHoleYards] = useState(395);
  const [holeBearing, setHoleBearing] = useState(135);
  const [bunkerStart, setBunkerStart] = useState(250);
  const [waterCarry, setWaterCarry] = useState('');
  const [greenSlope, setGreenSlope] = useState('Back-to-Front');
  const [holeNote, setHoleNote] = useState('');

  const [weather, setWeather] = useState({
    tempF: 68,
    dewPointF: 52,
    humidity: 56,
    windSpeedMph: 9,
    windGustMph: 14,
    windDirDeg: 145,
    isLive: false,
  });

  useEffect(() => {
    localStorage.setItem(CUSTOM_COURSES_KEY, JSON.stringify(customCourses));
  }, [customCourses]);

  useEffect(() => {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
  }, [scores]);

  useEffect(() => {
    localStorage.setItem(PINS_KEY, JSON.stringify(missPins));
  }, [missPins]);

  const activeCourse = allCourses.find((c) => c.id === courseId) || allCourses[0] || COURSE_PRESETS[0];
  const baseHole = activeCourse.holes[holeIdx] || activeCourse.holes[0];
  const activeTee = TEE_BOXES.find((t) => t.id === teeId) || TEE_BOXES[1];

  const activeHole = {
    ...baseHole,
    yards: Math.round(baseHole.yards * activeTee.mult),
    bunkerStart: baseHole.bunkerStart ? Math.round(baseHole.bunkerStart * activeTee.mult) : null,
    bunkerEnd: baseHole.bunkerEnd ? Math.round(baseHole.bunkerEnd * activeTee.mult) : null,
    waterCarry: baseHole.waterCarry ? Math.round(baseHole.waterCarry * activeTee.mult) : null,
  };

  useEffect(() => {
    setHoleNumber((activeCourse.holes?.length || 0) + 1);
  }, [activeCourse]);

  const reloadLiveWeather = () => {
    fetchCourseWeather(activeCourse.lat, activeCourse.lon)
      .then((live) => setWeather(live))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    fetchCourseWeather(activeCourse.lat, activeCourse.lon)
      .then((live) => {
        if (!cancelled) setWeather(live);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCourse.lat, activeCourse.lon]);

  const handleCourseDirectorySearch = async (e) => {
    e.preventDefault();
    if (!courseSearch.trim()) return;
    setSearchingCourses(true);
    setGpsStatus(`Searching courses near "${courseSearch.trim()}"...`);
    try {
      const found = await searchNearbyGolfCourses({ query: courseSearch.trim() });
      if (found.length > 0) {
        setCustomCourses((prev) => {
          const existingIds = new Set(prev.map((c) => c.id));
          const uniqueNew = found.filter((c) => !existingIds.has(c.id));
          return [...uniqueNew, ...prev];
        });
        setCourseId(found[0].id);
        setHoleIdx(0);
        setGpsStatus(`Found ${found.length} courses - loaded ${found[0].name} (${found[0].elevationFt} ft)`);
      } else {
        setGpsStatus(`No map courses found for "${courseSearch.trim()}" - tap + to add custom.`);
      }
    } catch {
      setGpsStatus('Course lookup timed out - try again or add custom.');
    } finally {
      setSearchingCourses(false);
    }
  };

  const handleUseGps = async () => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    setGpsStatus('Scanning GPS & nearby golf courses...');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const elevFt = await fetchElevationFt(lat, lon);

        try {
          const live = await fetchCourseWeather(lat, lon);
          setWeather(live);
        } catch {}

        try {
          const nearby = await searchNearbyGolfCourses({ lat, lon });
          if (nearby.length > 0) {
            setCustomCourses((prev) => {
              const existingIds = new Set(prev.map((c) => c.id));
              const uniqueNew = nearby.filter((c) => !existingIds.has(c.id));
              return [...uniqueNew, ...prev];
            });
            setCourseId(nearby[0].id);
            setHoleIdx(0);
            setGpsStatus(`GPS Locked - Found ${nearby.length} nearby courses (${nearby[0].name})`);
            setGpsLoading(false);
            return;
          }
        } catch {}

        const gpsCourseId = 'gps-live-spot';
        const gpsCourse = {
          id: gpsCourseId,
          name: `GPS Pin (${lat}, ${lon})`,
          city: 'Current Location',
          lat,
          lon,
          elevationFt: elevFt,
          holes: [
            { number: 1, par: 4, yards: 390, bearingDeg: 140, bunkerStart: 250, bunkerEnd: 272, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Live GPS pin spot - customize hole yardage & hazards anytime.' },
            { number: 2, par: 3, yards: 168, bearingDeg: 215, bunkerStart: 152, bunkerEnd: 160, waterCarry: null, greenSlope: 'Firm & Fast', note: 'Check live wind & dew point before committing.' },
          ],
        };

        setCustomCourses((prev) => [gpsCourse, ...prev.filter((c) => c.id !== gpsCourseId)]);
        setCourseId(gpsCourseId);
        setHoleIdx(0);
        setGpsStatus(`Locked GPS (${lat}, ${lon}) - Elev ${elevFt} ft`);
        setGpsLoading(false);
      },
      (err) => {
        setGpsStatus(`GPS denied/unavailable: ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveHole = (e) => {
    e.preventDefault();
    const yardsNum = Math.max(50, Number(holeYards) || 350);
    const bunkerNum = Number(bunkerStart) || null;
    const waterNum = Number(waterCarry) || null;

    const newHole = {
      number: Number(holeNumber) || (activeCourse.holes.length + 1),
      par: Number(holePar) || 4,
      yards: yardsNum,
      bearingDeg: ((Number(holeBearing) % 360) + 360) % 360,
      bunkerStart: bunkerNum,
      bunkerEnd: bunkerNum ? bunkerNum + 22 : null,
      waterCarry: waterNum,
      greenSlope,
      note: holeNote.trim() || 'Custom hole strategy - watch hazards and wind.',
    };

    const isPreset = COURSE_PRESETS.some((c) => c.id === activeCourse.id);
    if (isPreset) {
      const clonedCourse = {
        ...activeCourse,
        id: `custom-${activeCourse.id}-${Date.now()}`,
        name: `${activeCourse.name} (Custom)`,
        holes: [...activeCourse.holes, newHole],
      };
      setCustomCourses((prev) => [clonedCourse, ...prev]);
      setCourseId(clonedCourse.id);
      setHoleIdx(clonedCourse.holes.length - 1);
    } else {
      const updated = customCourses.map((c) =>
        c.id === activeCourse.id ? { ...c, holes: [...c.holes, newHole] } : c
      );
      setCustomCourses(updated);
      setHoleIdx(activeCourse.holes.length);
    }

    setHoleNote('');
    setCreatorOpen(false);
  };

  const handleCreateCourse = (e) => {
    e.preventDefault();
    if (!newCourseName.trim()) return;
    const yardsNum = Math.max(50, Number(holeYards) || 385);
    const bunkerNum = Number(bunkerStart) || null;
    const waterNum = Number(waterCarry) || null;

    const createdCourse = {
      id: `course-${Date.now()}`,
      name: newCourseName.trim(),
      city: newCourseCity.trim() || 'Custom Course',
      lat: Number(newCourseLat) || 33.93,
      lon: Number(newCourseLon) || -117.16,
      elevationFt: Number(newCourseElev) || 1000,
      holes: [
        {
          number: 1,
          par: Number(holePar) || 4,
          yards: yardsNum,
          bearingDeg: ((Number(holeBearing) % 360) + 360) % 360,
          bunkerStart: bunkerNum,
          bunkerEnd: bunkerNum ? bunkerNum + 22 : null,
          waterCarry: waterNum,
          greenSlope,
          note: holeNote.trim() || 'Opening hole - play smart off the tee.',
        },
      ],
    };

    setCustomCourses((prev) => [createdCourse, ...prev]);
    setCourseId(createdCourse.id);
    setHoleIdx(0);
    setNewCourseName('');
    setNewCourseCity('');
    setHoleNote('');
    setCreatorOpen(false);
  };

  const holePinKey = `${activeCourse.id}-h${activeHole.number}`;
  const currentHolePins = missPins[holePinKey] || [];

  const handleSvgTap = (e) => {
    if (!isPro) {
      onOpenPaywall('Custom Miss-Zone Target Pins');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 280);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 330);
    const pinSpec = PIN_TYPES.find((p) => p.id === activePinType) || PIN_TYPES[0];

    setMissPins((prev) => ({
      ...prev,
      [holePinKey]: [...(prev[holePinKey] || []).slice(-5), { id: Date.now(), x, y, type: pinSpec.id, color: pinSpec.color, label: pinSpec.label }],
    }));
  };

  const clearHolePins = () => {
    setMissPins((prev) => ({ ...prev, [holePinKey]: [] }));
  };

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

    const hitsBunker =
      activeHole.bunkerStart &&
      physics.effectiveCarry >= activeHole.bunkerStart - 5 &&
      physics.effectiveCarry <= (activeHole.bunkerEnd || activeHole.bunkerStart + 20) + 5;
    const missesWater = !activeHole.waterCarry || physics.effectiveCarry >= activeHole.waterCarry + 8;
    const remainingToPin = Math.max(0, activeHole.yards - physics.effectiveTotal);

    let score = 100;
    if (activeHole.par === 3) {
      score -= Math.abs(physics.effectiveCarry - activeHole.yards) * 2.5;
    } else {
      if (hitsBunker) score -= 50;
      if (!missesWater) score -= 70;
      if (physics.effectiveTotal > activeHole.yards - 15) score -= 40;
      const idealApproach = remainingToPin >= 80 && remainingToPin <= 125 ? 18 : 0;
      score += idealApproach + Math.min(260, physics.effectiveCarry) * 0.1;
    }

    return { ...club, ...physics, hitsBunker, missesWater, remainingToPin, score };
  });

  const bestClub = [...evaluatedClubs].sort((a, b) => b.score - a.score)[0];
  const activeClub = evaluatedClubs.find((c) => c.id === selectedClubId) || bestClub || evaluatedClubs[0];

  const pairedApproachClub =
    activeHole.par > 3 && activeClub && activeClub.remainingToPin > 25
      ? [...evaluatedClubs].sort(
          (a, b) => Math.abs(a.effectiveCarry - activeClub.remainingToPin) - Math.abs(b.effectiveCarry - activeClub.remainingToPin)
        )[0]
      : null;

  const crossYards = activeClub
    ? Math.round((Math.abs(activeClub.crosswindMph) * (activeClub.effectiveCarry / 160)) * 0.65)
    : 0;
  const aimAdvice =
    crossYards >= 2
      ? activeClub.crosswindMph > 0
        ? `Aim ${crossYards}y Right (R->L wind)`
        : `Aim ${crossYards}y Left (L->R wind)`
      : 'Aim Center (Neutral crosswind)';

  const dewSpread = weather.tempF - weather.dewPointF;
  const estStimp = dewSpread <= 4 ? '9.2 (Morning Dew)' : dewSpread <= 10 ? '10.5 (Medium-Fast)' : '11.8 (Dry & Slick)';
  const frontYards = Math.max(40, activeHole.yards - 12);
  const backYards = activeHole.yards + 14;

  const courseScores = scores[activeCourse.id] || {};
  const currentHoleScore = courseScores[activeHole.number] ?? activeHole.par;
  const setHoleScore = (val) => {
    const clamped = Math.max(1, Math.min(12, val));
    setScores((prev) => ({
      ...prev,
      [activeCourse.id]: {
        ...(prev[activeCourse.id] || {}),
        [activeHole.number]: clamped,
      },
    }));
  };

  const holesLogged = Object.keys(courseScores).length;
  const totalStrokes = Object.values(courseScores).reduce((acc, n) => acc + n, 0);
  const parForLogged = activeCourse.holes
    .filter((h) => courseScores[h.number] !== undefined)
    .reduce((acc, h) => acc + h.par, 0);
  const relPar = totalStrokes - parForLogged;

  const shapeShiftX = activeClub?.shot_shape === 'Fade' ? 14 : activeClub?.shot_shape === 'Draw' ? -14 : 0;

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <form onSubmit={handleCourseDirectorySearch} className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-2.5 opacity-55" />
            <input
              type="text"
              placeholder="Search city or course (e.g. Corona, CA)..."
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              className="w-full rounded-xl pl-8 pr-3 py-1.5 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>

          <button
            type="submit"
            disabled={searchingCourses}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border shrink-0"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {searchingCourses ? <Loader2 size={13} className="animate-spin" /> : 'Find'}
          </button>

          <button
            type="button"
            onClick={handleUseGps}
            disabled={gpsLoading}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1 shrink-0"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Navigation size={13} /> {gpsLoading ? '...' : 'GPS'}
          </button>

          <button
            type="button"
            onClick={() => setCreatorOpen(!creatorOpen)}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 shrink-0"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {creatorOpen ? <X size={13} /> : <Plus size={13} />}
          </button>
        </form>

        <div className="flex items-center justify-between gap-2">
          <select
            value={activeCourse.id}
            onChange={(e) => { setCourseId(e.target.value); setHoleIdx(0); }}
            className="font-bold text-sm rounded-xl px-3 py-2 border flex-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {allCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.elevationFt} ft)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSimOpen(!simOpen)}
            className="text-[11px] font-mono px-2.5 py-1.5 rounded-xl border flex items-center gap-1"
            style={{ borderColor: 'var(--border-subtle)', color: weather.isLive ? 'var(--accent-emerald)' : 'var(--accent-gold)' }}
          >
            <SlidersHorizontal size={11} /> {weather.isLive ? 'LIVE WX' : 'WHAT-IF'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Tee Box</span>
          <div className="flex gap-1.5">
            {TEE_BOXES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTeeId(t.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                  teeId === t.id ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={teeId !== t.id ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {gpsStatus && (
          <div className="text-[11px] font-mono" style={{ color: 'var(--accent-gold)' }}>
            {gpsStatus}
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {activeCourse.holes.map((h, idx) => (
            <button
              key={`${activeCourse.id}-${h.number}-${idx}`}
              onClick={() => setHoleIdx(idx)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border shrink-0 transition ${
                holeIdx === idx ? 'bg-emerald-700 text-white border-emerald-700' : ''
              }`}
              style={holeIdx !== idx ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
            >
              #{h.number} - P{h.par} ({Math.round(h.yards * activeTee.mult)}y)
            </button>
          ))}
        </div>
      </div>

      {simOpen && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-emerald)' }}>
              Weather & Dew Point What-If Simulator
            </span>
            <button
              type="button"
              onClick={reloadLiveWeather}
              className="text-[11px] underline font-semibold"
              style={{ color: 'var(--accent-gold)' }}
            >
              Reset to Live WX
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Temp ({weather.tempF}F)</label>
              <input
                type="range"
                min="40"
                max="105"
                value={weather.tempF}
                onChange={(e) => setWeather((w) => ({ ...w, tempF: Number(e.target.value), isLive: false }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Dew Pt ({weather.dewPointF}F)</label>
              <input
                type="range"
                min="30"
                max={weather.tempF}
                value={Math.min(weather.dewPointF, weather.tempF)}
                onChange={(e) => setWeather((w) => ({ ...w, dewPointF: Number(e.target.value), isLive: false }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Wind ({weather.windSpeedMph} mph)</label>
              <input
                type="range"
                min="0"
                max="30"
                value={weather.windSpeedMph}
                onChange={(e) => setWeather((w) => ({ ...w, windSpeedMph: Number(e.target.value), windGustMph: Number(e.target.value) + 5, isLive: false }))}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}

      {creatorOpen && (
        <form
          onSubmit={creatorMode === 'hole' ? handleSaveHole : handleCreateCourse}
          className="rounded-2xl p-4 border space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-gold)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
              Custom Course & Hole Builder
            </span>
            <div className="flex gap-1 rounded-lg p-0.5 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setCreatorMode('hole')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold ${creatorMode === 'hole' ? 'bg-emerald-700 text-white' : ''}`}
              >
                + Hole to {activeCourse.name.split(' ')[0]}
              </button>
              <button
                type="button"
                onClick={() => setCreatorMode('course')}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold ${creatorMode === 'course' ? 'bg-emerald-700 text-white' : ''}`}
              >
                + New Course
              </button>
            </div>
          </div>

          {creatorMode === 'course' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="Course Name"
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                className="rounded-xl px-3 py-2 text-xs border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <input
                type="text"
                placeholder="City / Region"
                value={newCourseCity}
                onChange={(e) => setNewCourseCity(e.target.value)}
                className="rounded-xl px-3 py-2 text-xs border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <div>
                <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Elevation (ft)</label>
                <input
                  type="number"
                  value={newCourseElev}
                  onChange={(e) => setNewCourseElev(e.target.value)}
                  className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Lat</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newCourseLat}
                    onChange={(e) => setNewCourseLat(e.target.value)}
                    className="w-full rounded-xl px-2 py-1.5 text-xs font-mono border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Lon</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newCourseLon}
                    onChange={(e) => setNewCourseLon(e.target.value)}
                    className="w-full rounded-xl px-2 py-1.5 text-xs font-mono border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Hole #</label>
              <input
                type="number"
                value={holeNumber}
                onChange={(e) => setHoleNumber(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Par</label>
              <select
                value={holePar}
                onChange={(e) => setHolePar(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value={3}>Par 3</option>
                <option value={4}>Par 4</option>
                <option value={5}>Par 5</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Yardage</label>
              <input
                type="number"
                required
                value={holeYards}
                onChange={(e) => setHoleYards(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Bearing (0-359 deg)</label>
              <input
                type="number"
                value={holeBearing}
                onChange={(e) => setHoleBearing(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Bunker Carry (y)</label>
              <input
                type="number"
                placeholder="e.g., 250"
                value={bunkerStart}
                onChange={(e) => setBunkerStart(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Water Carry (y)</label>
              <input
                type="number"
                placeholder="Optional"
                value={waterCarry}
                onChange={(e) => setWaterCarry(e.target.value)}
                className="w-full rounded-xl px-2.5 py-1.5 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={greenSlope}
              onChange={(e) => setGreenSlope(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <option value="Back-to-Front">Green: Back-to-Front</option>
              <option value="Firm & Fast">Green: Firm & Fast</option>
              <option value="Slopes Left">Green: Slopes Left</option>
              <option value="Two-Tier Back">Green: Two-Tier Back</option>
            </select>
            <input
              type="text"
              placeholder="Caddie strategy note..."
              value={holeNote}
              onChange={(e) => setHoleNote(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            {creatorMode === 'hole' ? 'Save Custom Hole' : 'Create Custom Course'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Thermometer size={14} className="mx-auto mb-1" style={{ color: 'var(--accent-emerald)' }} />
          <div className="font-mono font-bold text-sm">{weather.tempF}F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Temp</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Droplets size={14} className="mx-auto mb-1 text-sky-400" />
          <div className="font-mono font-bold text-sm">{weather.dewPointF}F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Dew Pt</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Wind size={14} className="mx-auto mb-1" style={{ color: 'var(--accent-gold)' }} />
          <div className="font-mono font-bold text-sm">{weather.windSpeedMph} mph</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{degreesToCompass(weather.windDirDeg)} (G{weather.windGustMph})</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Mountain size={14} className="mx-auto mb-1 opacity-75" />
          <div className="font-mono font-bold text-sm">{activeCourse.elevationFt} ft</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Elev</div>
        </div>
      </div>

      {bestClub && (
        <div
          onClick={() => setSelectedClubId(bestClub.id)}
          className="rounded-2xl p-3.5 border cursor-pointer flex items-center justify-between"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}
        >
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
              <Sparkles size={13} /> Highest-Percentage Play ({activeTee.label} Tees)
            </div>
            <div className="font-bold text-sm">
              Pull {bestClub.club_type} ({bestClub.effectiveCarry}y carry / {bestClub.effectiveTotal}y total)
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {aimAdvice} - {activeHole.par === 3 ? `Green: ${activeHole.greenSlope}` : `Leaves ${bestClub.remainingToPin}y in`}
            </div>
          </div>
          <CheckCircle2 size={20} style={{ color: 'var(--accent-emerald)' }} className="shrink-0" />
        </div>
      )}

      {/* Aerial Hole Shot Map: Tee Boxes, Hazards, Bunkers, Green & Dispersion */}
      {activeClub && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">
              Aerial Hole #{activeHole.number} - Par {activeHole.par} - {activeHole.yards} yds
            </span>
            <span className="font-mono" style={{ color: 'var(--accent-gold)' }}>
              {activeClub.headwindMph >= 0 ? `${activeClub.headwindMph} mph Into` : `${Math.abs(activeClub.headwindMph)} mph Helping`}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <Crosshair size={12} /> Tap aerial map to drop pin:
            </span>
            <div className="flex items-center gap-1.5">
              {PIN_TYPES.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => setActivePinType(pt.id)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    activePinType === pt.id ? 'border-white' : 'opacity-70'
                  }`}
                  style={{ backgroundColor: `${pt.color}25`, color: pt.color, borderColor: activePinType === pt.id ? pt.color : 'transparent' }}
                >
                  {pt.label}
                </button>
              ))}
              {currentHolePins.length > 0 && (
                <button type="button" onClick={clearHolePins} className="text-[10px] underline opacity-70 ml-1">
                  Clear
                </button>
              )}
            </div>
          </div>

          <svg
            viewBox="0 0 280 330"
            onClick={handleSvgTap}
            className="w-full h-72 rounded-xl cursor-crosshair select-none"
            style={{ backgroundColor: '#13261D' }}
          >
            {/* First-Cut Rough & Hole Corridor */}
            <path
              d="M 88 298 C 82 225, 86 135, 114 54 L 166 54 C 188 135, 184 225, 178 298 Z"
              fill="#1B4D36"
              stroke="#2C6E4F"
              strokeWidth="1.5"
            />

            {/* Mowed Fairway Landing Corridor */}
            <path
              d="M 114 265 C 108 205, 114 135, 132 66 L 154 66 C 166 135, 162 205, 156 265 Z"
              fill="#277A52"
              opacity="0.85"
            />

            {/* Yardage Reference Lines (100y / 200y markers) */}
            <line x1="78" y1="145" x2="202" y2="145" stroke="#A7F3D0" strokeOpacity="0.14" strokeDasharray="3 3" />
            <line x1="78" y1="215" x2="202" y2="215" stroke="#A7F3D0" strokeOpacity="0.14" strokeDasharray="3 3" />

            {/* Water Hazard (if present on hole) */}
            {activeHole.waterCarry && (() => {
              const waterY = Math.max(76, 282 - (activeHole.waterCarry / activeHole.yards) * 224);
              return (
                <g>
                  <path
                    d={`M 86 ${waterY - 6} Q 138 ${waterY - 12} 194 ${waterY - 4} L 192 ${waterY + 8} Q 138 ${waterY + 14} 88 ${waterY + 6} Z`}
                    fill="#0284C7"
                    fillOpacity="0.72"
                    stroke="#7DD3FC"
                    strokeWidth="1"
                  />
                  <text x="198" y={waterY + 3} fontSize="8" fontWeight="bold" fill="#7DD3FC">
                    H2O {activeHole.waterCarry}y
                  </text>
                </g>
              );
            })()}

            {/* Fairway & Greenside Sand Bunkers */}
            {activeHole.bunkerStart && (() => {
              const bY = Math.max(66, 282 - (activeHole.bunkerStart / activeHole.yards) * 224);
              return (
                <g>
                  <ellipse
                    cx="166"
                    cy={bY}
                    rx="14"
                    ry="10"
                    transform={`rotate(-14 166 ${bY})`}
                    fill="#E5D5B0"
                    stroke="#A17A32"
                    strokeWidth="1.5"
                  />
                  <text x="184" y={bY + 3} fontSize="8" fill="#FDE68A">
                    Sand {activeHole.bunkerStart}y
                  </text>
                </g>
              );
            })()}

            {/* Greenside Left & Right Bunkers */}
            <ellipse cx="106" cy="52" rx="11" ry="7" fill="#E5D5B0" stroke="#A17A32" strokeWidth="1.2" />
            <ellipse cx="174" cy="48" rx="12" ry="8" fill="#E5D5B0" stroke="#A17A32" strokeWidth="1.2" />

            {/* Putting Green Complex & Flagstick */}
            <ellipse cx="140" cy="44" rx="34" ry="20" fill="#34A86B" stroke="#6EE7B7" strokeWidth="1.2" />
            <line x1="142" y1="24" x2="142" y2="44" stroke="#FFFFFF" strokeWidth="1.6" />
            <polygon points="142,24 156,28 142,32" fill="#EF4444" />
            <text x="178" y="44" fontSize="9" fontWeight="bold" fill="#FFFFFF">
              {activeHole.yards}y Pin
            </text>

            {/* User-Dropped Miss-Zone Pins */}
            {currentHolePins.map((pin) => (
              <g key={pin.id}>
                <circle cx={pin.x} cy={pin.y} r="6.5" fill={pin.color} fillOpacity="0.9" stroke="#FFFFFF" strokeWidth="1.4" />
                <text x={pin.x + 8} y={pin.y + 3} fontSize="8" fontWeight="bold" fill={pin.color}>
                  {pin.label}
                </text>
              </g>
            ))}

            {/* Shot Arc, Dispersion Cone & Carry/Rollout Markers */}
            {(() => {
              const teeY = activeTee.y;
              const carryY = Math.max(38, teeY - (activeClub.effectiveCarry / activeHole.yards) * (teeY - 44));
              const totalY = Math.max(34, teeY - (activeClub.effectiveTotal / activeHole.yards) * (teeY - 44));
              const landX = 140 + shapeShiftX;
              const danger = activeClub.hitsBunker || !activeClub.missesWater;
              const strokeCol = danger ? '#F87171' : '#FBBF24';

              return (
                <>
                  <polygon
                    points={`140,${teeY} ${landX - 18},${carryY} ${landX + 18},${carryY}`}
                    fill={strokeCol}
                    fillOpacity="0.16"
                  />
                  <path
                    d={`M 140 ${teeY} Q ${140 - shapeShiftX * 0.6} ${(teeY + carryY) / 2} ${landX} ${carryY}`}
                    fill="none"
                    stroke={strokeCol}
                    strokeWidth="2.2"
                    strokeDasharray="4 3"
                  />
                  <line x1={landX} y1={carryY} x2={landX} y2={totalY} stroke={strokeCol} strokeWidth="2.2" />
                  {pairedApproachClub && (
                    <line x1={landX} y1={totalY} x2="142" y2="44" stroke="#6EE7B7" strokeWidth="1.6" strokeDasharray="3 3" />
                  )}
                  <circle cx={landX} cy={carryY} r="4.5" fill={strokeCol} stroke="#111827" strokeWidth="1" />
                  <circle cx={landX} cy={totalY} r="3.2" fill="#FFFFFF" stroke={strokeCol} strokeWidth="1.5" />
                  <text x={Math.min(162, landX + 9)} y={carryY + 3} fontSize="9" fontWeight="bold" fill={strokeCol}>
                    {activeClub.club_type}: {activeClub.effectiveCarry}y
                  </text>
                </>
              );
            })()}

            {/* Tee Box Complex (Tips, Blue, White, Forward) */}
            <rect x="116" y="260" width="48" height="38" rx="6" fill="#2E8B57" stroke="#A7F3D0" strokeWidth="1" opacity="0.9" />
            {TEE_BOXES.map((tb) => {
              const selected = tb.id === teeId;
              return (
                <g key={tb.id}>
                  <rect
                    x="124"
                    y={tb.y - 3}
                    width="32"
                    height="6"
                    rx="2"
                    fill={selected ? '#FBBF24' : '#D1FAE5'}
                    fillOpacity={selected ? 0.95 : 0.45}
                  />
                  <text
                    x="162"
                    y={tb.y + 1}
                    fontSize="7.5"
                    fontWeight={selected ? 'bold' : 'normal'}
                    fill={selected ? '#FBBF24' : '#D1FAE5'}
                  >
                    {tb.label}
                  </text>
                </g>
              );
            })}

            {/* Wind Compass & Vector Indicator (Top Left) */}
            <g transform="translate(36, 36)">
              <circle cx="0" cy="0" r="18" fill="#0B1611" fillOpacity="0.8" stroke="#6EE7B7" strokeWidth="1" />
              <g transform={`rotate(${weather.windDirDeg})`}>
                <line x1="0" y1="10" x2="0" y2="-10" stroke="#FBBF24" strokeWidth="2" />
                <polygon points="0,-12 -4,-5 4,-5" fill="#FBBF24" />
              </g>
              <text x="0" y="28" textAnchor="middle" fontSize="8" fill="#E5E7EB">
                Wind {degreesToCompass(weather.windDirDeg)}
              </text>
            </g>
          </svg>

          {pairedApproachClub && (
            <div className="p-2.5 rounded-xl border text-xs flex items-center justify-between" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <span>
                <strong>2-Shot Combo:</strong> {activeClub.club_type} ({activeClub.effectiveTotal}y) -&gt; <strong>{pairedApproachClub.club_type}</strong> ({activeClub.remainingToPin}y in)
              </span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--accent-emerald)' }}>
                {pairedApproachClub.effectiveCarry}y carry
              </span>
            </div>
          )}

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
                <div className="text-[10px] font-mono opacity-80">Stock {club.carry_yards}y -&gt; {club.effectiveCarry}y</div>
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

      <div className="rounded-2xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <Flag size={14} /> Green Complex & Dew-Point Stimp
          </span>
          <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--accent-gold)' }}>{estStimp}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Front</div>
            <div className="font-mono font-bold text-sm">{frontYards}y</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--accent-emerald)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--accent-emerald)' }}>Middle</div>
            <div className="font-mono font-bold text-sm">{activeHole.yards}y</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Back</div>
            <div className="font-mono font-bold text-sm">{backYards}y</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-4 border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-semibold">Hole {activeHole.number} Score (Par {activeHole.par})</div>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {holesLogged > 0
              ? `Round Pace: ${relPar === 0 ? 'E' : relPar > 0 ? `+${relPar}` : relPar} (${holesLogged} holes)`
              : 'Tap + / - to log hole strokes'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHoleScore(currentHoleScore - 1)}
            className="w-8 h-8 rounded-lg border font-bold text-sm"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            -
          </button>
          <span className="w-7 text-center font-mono font-bold text-base">{currentHoleScore}</span>
          <button
            type="button"
            onClick={() => setHoleScore(currentHoleScore + 1)}
            className="w-8 h-8 rounded-lg border font-bold text-sm"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenWearable}
        className="w-full rounded-2xl p-3.5 border flex items-center justify-between text-left"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 text-xs">
          <Watch size={15} style={{ color: 'var(--accent-gold)' }} />
          <Glasses size={15} style={{ color: 'var(--accent-gold)' }} />
          <span>Watch & Meta Glasses Feed: <strong>{bestClub?.club_type} ({bestClub?.effectiveCarry}y)</strong></span>
        </div>
        <span className="text-[11px] font-semibold underline" style={{ color: 'var(--accent-gold)' }}>Preview HUD</span>
      </button>
    </div>
  );
}