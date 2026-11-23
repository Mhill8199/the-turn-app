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
} from 'lucide-react';
import { COURSE_PRESETS, fetchCourseWeather, degreesToCompass, calculateShotPhysics } from '../lib/weatherPhysics';

const CUSTOM_COURSES_KEY = 'the-turn-custom-courses';
const SCORES_KEY = 'the-turn-scores';
const PINS_KEY = 'the-turn-miss-pins';

const TEE_BOXES = [
  { id: 'tips', label: 'Tips', mult: 1.06 },
  { id: 'blue', label: 'Blue', mult: 1.0 },
  { id: 'white', label: 'White', mult: 0.93 },
  { id: 'forward', label: 'Forward', mult: 0.84 },
];

const PIN_TYPES = [
  { id: 'target', label: 'Target', color: '#22C55E' },
  { id: 'bailout', label: 'Bailout', color: '#EAB308' },
  { id: 'dead', label: 'Dead Zone', color: '#EF4444' },
];

async function fetchElevationFt(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    if (!res.ok) return 500;
    const data = await res.json();
    const meters = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    return typeof meters === 'number' ? Math.round(meters * 3.28084) : 500;
  } catch {
    return 500;
  }
}

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
  const [courseId, setCourseId] = useState(() => allCourses[0]?.id || COURSE_PRESETS[0].id);
  const [holeIdx, setHoleIdx] = useState(0);
  const [teeId, setTeeId] = useState('blue');
  const [activePinType, setActivePinType] = useState('target');
  const [selectedClubId, setSelectedClubId] = useState(clubs[1]?.id || clubs[0]?.id || '1');
  const [courseSearch, setCourseSearch] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  // Custom Course / Hole Creator state
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

  // Scale hole yardage and hazard distances for selected Tee Box
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

  useEffect(() => {
    let cancelled = false;
    fetchCourseWeather(activeCourse.lat, activeCourse.lon)
      .then((live) => {
        if (!cancelled) setWeather(live);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCourse.lat, activeCourse.lon]);

  const handleUseGps = async () => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    setGpsStatus('Locating coordinates & live telemetry...');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const elevFt = await fetchElevationFt(lat, lon);

        try {
          const live = await fetchCourseWeather(lat, lon);
          setWeather(live);
        } catch {}

        const gpsCourseId = 'gps-live-spot';
        const existingGps = customCourses.find((c) => c.id === gpsCourseId);
        const defaultHoles = existingGps?.holes?.length
          ? existingGps.holes
          : [
              { number: 1, par: 4, yards: 390, bearingDeg: 140, bunkerStart: 250, bunkerEnd: 272, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Live GPS pin spot — customize hole yardage & hazards anytime.' },
              { number: 2, par: 3, yards: 168, bearingDeg: 215, bunkerStart: 152, bunkerEnd: 160, waterCarry: null, greenSlope: 'Firm & Fast', note: 'Check live wind & dew point before committing.' },
            ];

        const gpsCourse = {
          id: gpsCourseId,
          name: `GPS Pin (${lat}, ${lon})`,
          city: 'Current Location',
          lat,
          lon,
          elevationFt: elevFt,
          holes: defaultHoles,
        };

        setCustomCourses((prev) => [gpsCourse, ...prev.filter((c) => c.id !== gpsCourseId)]);
        setCourseId(gpsCourseId);
        setHoleIdx(0);
        setGpsStatus(`Locked GPS (${lat}, ${lon}) • Elev ${elevFt} ft`);
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
      note: holeNote.trim() || 'Custom hole strategy — watch hazards and wind.',
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
          note: holeNote.trim() || 'Opening hole — play smart off the tee.',
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
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 260);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 310);
    const pinSpec = PIN_TYPES.find((p) => p.id === activePinType) || PIN_TYPES[0];

    setMissPins((prev) => ({
      ...prev,
      [holePinKey]: [...(prev[holePinKey] || []).slice(-5), { id: Date.now(), x, y, type: pinSpec.id, color: pinSpec.color, label: pinSpec.label }],
    }));
  };

  const clearHolePins = () => {
    setMissPins((prev) => ({ ...prev, [holePinKey]: [] }));
  };

  const filteredCourses = courseSearch.trim()
    ? allCourses.filter(
        (c) =>
          c.name.toLowerCase().includes(courseSearch.toLowerCase()) ||
          (c.city && c.city.toLowerCase().includes(courseSearch.toLowerCase()))
      )
    : allCourses;

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

  // Shot-shape lateral offset on SVG (Fade shifts right, Draw shifts left)
  const shapeShiftX = activeClub?.shot_shape === 'Fade' ? 14 : activeClub?.shot_shape === 'Draw' ? -14 : 0;

  return (
    <div className="space-y-4 pb-24">
      {/* Course Selector, GPS Lookup, Tee Box & Custom Builder Bar */}
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-2.5 opacity-55" />
            <input
              type="text"
              placeholder="Filter courses or cities..."
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              className="w-full rounded-xl pl-8 pr-3 py-1.5 text-xs border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>

          <button
            type="button"
            onClick={handleUseGps}
            disabled={gpsLoading}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-1 shrink-0"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Navigation size={13} /> {gpsLoading ? 'GPS...' : 'GPS'}
          </button>

          <button
            type="button"
            onClick={() => setCreatorOpen(!creatorOpen)}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 shrink-0"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {creatorOpen ? <X size={13} /> : <Plus size={13} />} {creatorOpen ? 'Close' : 'Custom'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <select
            value={activeCourse.id}
            onChange={(e) => { setCourseId(e.target.value); setHoleIdx(0); }}
            className="font-bold text-sm rounded-xl px-3 py-2 border flex-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {filteredCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.elevationFt} ft)
              </option>
            ))}
          </select>
          <span className="text-[11px] font-mono px-2.5 py-1.5 rounded-xl border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-emerald)' }}>
            {weather.isLive ? 'LIVE WX' : 'SIM WX'}
          </span>
        </div>

        {/* Tee Box Selector */}
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

        {/* Hole Number Pills */}
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
              #{h.number} • P{h.par} ({Math.round(h.yards * activeTee.mult)}y)
            </button>
          ))}
        </div>
      </div>

      {/* Custom Course & Hole Creator */}
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
              <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Bearing (0–359°)</label>
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

      {/* Live Atmospheric Telemetry Strip */}
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
              <Sparkles size={13} /> Highest-Percentage Play ({activeTee.label} Tees)
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

      {/* Overhead Course Visualizer with Miss-Zone Pins & Dispersion Curve */}
      {activeClub && (
        <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold">
              Hole {activeHole.number} • {activeHole.yards} yds • Shape: {activeClub.shot_shape || 'Straight'}
            </span>
            <span className="font-mono" style={{ color: 'var(--accent-gold)' }}>
              {activeClub.headwindMph >= 0 ? `${activeClub.headwindMph} mph Into` : `${Math.abs(activeClub.headwindMph)} mph Helping`}
            </span>
          </div>

          {/* Miss-Zone Pin Toolbar */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              <Crosshair size={12} /> Tap map to drop pin:
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
            viewBox="0 0 260 310"
            onClick={handleSvgTap}
            className="w-full h-64 rounded-xl cursor-crosshair"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <path d="M92,285 Q82,165 112,42 L156,42 Q178,165 148,285 Z" fill="#1E6B4B" opacity="0.35" />
            <ellipse cx="134" cy="40" rx="28" ry="18" fill="#23865D" />
            <circle cx="136" cy="37" r="3" fill="#FFFFFF" />
            <text x="166" y="42" fontSize="9" fill="currentColor" opacity="0.8">{activeHole.yards}y Pin</text>

            {activeHole.waterCarry && (() => {
              const waterY = Math.max(65, 285 - (activeHole.waterCarry / activeHole.yards) * 243);
              return (
                <>
                  <rect x="75" y={waterY - 6} width="115" height="12" rx="4" fill="#38BDF8" opacity="0.65" />
                  <text x="194" y={waterY + 3} fontSize="8" fill="#38BDF8">Water {activeHole.waterCarry}y</text>
                </>
              );
            })()}

            {activeHole.bunkerStart && (() => {
              const bY = Math.max(60, 285 - (activeHole.bunkerStart / activeHole.yards) * 243);
              return (
                <>
                  <ellipse cx="156" cy={bY} rx="13" ry="16" fill="#D6CFC2" stroke="#9E7B34" strokeWidth="1.5" />
                  <text x="173" y={bY + 3} fontSize="8" fill="currentColor" opacity="0.75">Bunker {activeHole.bunkerStart}y</text>
                </>
              );
            })()}

            {/* Custom Miss-Zone Pins */}
            {currentHolePins.map((pin) => (
              <g key={pin.id}>
                <circle cx={pin.x} cy={pin.y} r="6" fill={pin.color} opacity="0.85" stroke="#FFFFFF" strokeWidth="1.2" />
                <text x={pin.x + 8} y={pin.y + 3} fontSize="8" fontWeight="bold" fill={pin.color}>
                  {pin.label}
                </text>
              </g>
            ))}

            {/* Shot-Shape Curved Flight + Dispersion Cone */}
            {(() => {
              const carryY = Math.max(36, 285 - (activeClub.effectiveCarry / activeHole.yards) * 243);
              const totalY = Math.max(32, 285 - (activeClub.effectiveTotal / activeHole.yards) * 243);
              const landX = 130 + shapeShiftX;
              const danger = activeClub.hitsBunker || !activeClub.missesWater;
              const strokeCol = danger ? '#EF4444' : '#C8A96A';

              return (
                <>
                  {/* Dispersion cone from tee to landing zone */}
                  <polygon
                    points={`123,283 ${landX - 18},${carryY} ${landX + 18},${carryY}`}
                    fill={strokeCol}
                    opacity="0.14"
                  />
                  {/* Curved ball flight path */}
                  <path
                    d={`M 123 283 Q ${123 - shapeShiftX * 0.6} ${(283 + carryY) / 2} ${landX} ${carryY}`}
                    fill="none"
                    stroke={strokeCol}
                    strokeWidth="2"
                    strokeDasharray="4 3"
                  />
                  <line x1={landX} y1={carryY} x2={landX} y2={totalY} stroke={strokeCol} strokeWidth="2" />
                  {pairedApproachClub && (
                    <line x1={landX} y1={totalY} x2="136" y2="39" stroke="#23865D" strokeWidth="1.5" strokeDasharray="3 3" />
                  )}
                  <circle cx={landX} cy={carryY} r="4.5" fill={strokeCol} />
                  <circle cx={landX} cy={totalY} r="3" fill="#FFFFFF" stroke={strokeCol} strokeWidth="1.5" />
                  <text x={Math.min(148, landX + 8)} y={carryY + 3} fontSize="9" fontWeight="bold" fill={strokeCol}>
                    {activeClub.club_type}: {activeClub.effectiveCarry}y
                  </text>
                </>
              );
            })()}

            <rect x="110" y="283" width="26" height="10" rx="3" fill="#97A39C" />
          </svg>

          {pairedApproachClub && (
            <div className="p-2.5 rounded-xl border text-xs flex items-center justify-between" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <span>
                <strong>2-Shot Combo:</strong> {activeClub.club_type} ({activeClub.effectiveTotal}y) → <strong>{pairedApproachClub.club_type}</strong> ({activeClub.remainingToPin}y in)
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

      {/* Green Complex & Dew-Point Stimp Estimator */}
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

      {/* Live Hole Scorecard & Ghost Pacer */}
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

      {/* Wearable Sync Status Button */}
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
