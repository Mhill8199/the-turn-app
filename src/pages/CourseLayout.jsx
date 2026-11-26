import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Plus,
  X,
  Search,
  Flag,
  Crosshair,
  Loader2,
  SlidersHorizontal,
  Globe,
  LocateFixed,
} from 'lucide-react';
import {
  COURSE_PRESETS,
  fetchCourseWeather,
  fetchElevationFt,
  fetchCoursesNearPlayer,
  searchGlobalGolfCourses,
  cacheSelectedCourse,
  readCachedCourses,
  readCoursesCacheSync,
  dedupeCourses,
  courseDedupeKey,
  courseMatchesQuery,
  sortCoursesByDistance,
  haversineMeters,
  degreesToCompass,
  calculateShotPhysics,
} from '../lib/weatherPhysics';
import SatelliteHoleMap from '../components/SatelliteHoleMap';
import ActiveRoundFocus, { PinFinishSheet, PinScoutToast } from '../components/ActiveRoundFocus';
import { useUnits, YARDS_TO_METERS } from '../utils/distanceUnits';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useHolePinFeed } from '../utils/pinPlacements';
import { useLanguage } from '../i18n/LanguageContext';
import { buildWearablePayload, readCaddiePersonaId, resolveTtsLocale, speakCaddieCallout } from '../utils/wearableAndAudioCaddie';
import { activeBagClubs, clubSpecSubtitle } from '../utils/bagClubs';

const CUSTOM_COURSES_KEY = 'the-turn-custom-courses';
const RECENT_COURSES_KEY = 'the-turn-recent-courses';
const SCORES_KEY = 'the-turn-scores-v2';
const PINS_KEY = 'the-turn-miss-pins';

function courseAliasKeys(course) {
  const name = String(course?.name || '').toLowerCase().trim();
  const lat = Number(course?.lat);
  const lng = Number(course?.lng ?? course?.lon);
  const latPart = Number.isFinite(lat) ? lat.toFixed(3) : 'na';
  const lngPart = Number.isFinite(lng) ? lng.toFixed(3) : 'na';
  return [courseDedupeKey(course), `${name}_${latPart}_${lngPart}`];
}

function CoursePickerRow({ course, selected, distanceLabel, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(course)}
      className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl border daylight-border px-3 py-2 text-left"
      style={{
        backgroundColor: selected ? 'rgba(16,185,129,0.16)' : 'var(--bg-elevated)',
        borderColor: selected ? '#10B981' : 'var(--border-subtle)',
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{course.name}</span>
        {course.city ? (
          <span className="block truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{course.city}</span>
        ) : null}
      </span>
      {distanceLabel ? (
        <span
          className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums"
          style={{ backgroundColor: 'rgba(16,185,129,0.18)', color: 'var(--accent-emerald)' }}
        >
          {distanceLabel}
        </span>
      ) : null}
    </button>
  );
}

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

const SAT_ZOOM_LEVELS = [15, 16, 17];

function destinationPoint(origin, bearingDeg, yards) {
  const lat = Number(origin?.lat);
  const lon = Number(origin?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(Number(yards))) return null;
  const meters = Number(yards) * 0.9144;
  const R = 6371000;
  const br = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ang = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

function resolveGreenCenter(course, hole) {
  const greenLat = Number(hole?.greenLat);
  const greenLon = Number(hole?.greenLon);
  if (Number.isFinite(greenLat) && Number.isFinite(greenLon)) return { lat: greenLat, lon: greenLon };
  const holeLat = Number(hole?.lat);
  const holeLon = Number(hole?.lon);
  if (Number.isFinite(holeLat) && Number.isFinite(holeLon)) return { lat: holeLat, lon: holeLon };
  const projected = destinationPoint({ lat: course?.lat, lon: course?.lon }, hole?.bearingDeg, hole?.yards);
  if (projected) return projected;
  return { lat: Number(course?.lat), lon: Number(course?.lon) };
}

function calcGpsYards(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(meters * 1.09361);
}

function buildSatelliteTileGrid(lat, lon, zoom = 16) {
  const safeLat = Math.max(-85, Math.min(85, Number(lat) || 33.8139));
  const safeLon = Number(lon) || -117.5156;
  const n = Math.pow(2, zoom);
  const exactX = ((safeLon + 180) / 360) * n;
  const latRad = (safeLat * Math.PI) / 180;
  const exactY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const centerTileX = Math.floor(exactX);
  const centerTileY = Math.floor(exactY);
  const fracX = exactX - centerTileX;
  const fracY = exactY - centerTileY;

  const tileSize = 180;
  const offsetX = 140 - fracX * tileSize;
  const offsetY = 165 - fracY * tileSize;

  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tx = ((centerTileX + dx) % n + n) % n;
      const ty = centerTileY + dy;
      if (ty < 0 || ty >= n) continue;
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
        x: offsetX + dx * tileSize,
        y: offsetY + dy * tileSize,
        size: tileSize,
      });
    }
  }
  return tiles;
}

export default function CourseLayout({ clubs = [], isPro = false, onOpenPaywall, onOpenWearable, onActiveHole }) {
  const { distanceUnit, formatDistance, formatSpeed } = useUnits();
  const { theme } = useTheme();
  const { lang } = useLanguage();
  const auth = useAuth();
  const [caddiePayload, setCaddiePayload] = useState(null);
  const caddieHoleArmed = useRef(false);
  const [customCourses, setCustomCourses] = useState(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_COURSES_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return dedupeCourses(Array.isArray(parsed) ? parsed : []);
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

  const [courseId, setCourseId] = useState(() => {
    const savedHome = localStorage.getItem('the-turn-home-course');
    const initialCourses = dedupeCourses([...customCourses, ...COURSE_PRESETS]);
    if (savedHome && initialCourses.some((c) => c.id === savedHome)) return savedHome;
    return initialCourses[0]?.id || COURSE_PRESETS[0].id;
  });
  const [holeIdx, setHoleIdx] = useState(0);
  const [teeId, setTeeId] = useState('blue');
  const [activePinType, setActivePinType] = useState('target');
  const [selectedClubId, setSelectedClubId] = useState(() => {
    const active = activeBagClubs(clubs);
    return active[1]?.id || active[0]?.id || '1';
  });
  const [courseSearch, setCourseSearch] = useState('');
  const [searchingCourses, setSearchingCourses] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [useSatTiles, setUseSatTiles] = useState(true);
  const [satZoom, setSatZoom] = useState(16);
  const [tileError, setTileError] = useState(false);

  // Live GPS Shot Distance Tracker state
  const [shotStartGps, setShotStartGps] = useState(null);
  const [lastMeasuredShot, setLastMeasuredShot] = useState(null);
  const [trackingShot, setTrackingShot] = useState(false);

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

  const [isRoundActive, setIsRoundActive] = useState(false);
  const [pinTarget, setPinTarget] = useState(null);
  const [roundShots, setRoundShots] = useState([]);
  const [liveRoundGps, setLiveRoundGps] = useState(null);
  const [markRequest, setMarkRequest] = useState(null);
  const [suggestedClub, setSuggestedClub] = useState({ name: '', carry: null });
  const [aimTarget, setAimTarget] = useState('center');
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [pinSheetMode, setPinSheetMode] = useState('finish');
  const [pinPlaceMode, setPinPlaceMode] = useState(false);
  const [flagDraft, setFlagDraft] = useState(null);
  const [greenRing, setGreenRing] = useState(null);
  const roundActiveRef = useRef(false);
  roundActiveRef.current = isRoundActive;

  const [weather, setWeather] = useState({
    tempF: 68,
    dewPointF: 52,
    humidity: 56,
    windSpeedMph: 9,
    windGustMph: 14,
    windDirDeg: 145,
    isLive: false,
  });
  const [cachedCourses, setCachedCourses] = useState(() => readCoursesCacheSync());
  const [nearbyCourses, setNearbyCourses] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [playerGps, setPlayerGps] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [offlineMode, setOfflineMode] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [recentCourses, setRecentCourses] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_COURSES_KEY) || '[]');
      return dedupeCourses(Array.isArray(saved) ? saved : []);
    } catch {
      return [];
    }
  });
  const nearAbortRef = useRef(null);
  const nearGen = useRef(0);

  const allCourses = useMemo(
    () => dedupeCourses([
      ...customCourses,
      ...recentCourses,
      ...COURSE_PRESETS,
      ...cachedCourses,
      ...nearbyCourses,
      ...searchResults,
    ]),
    [customCourses, recentCourses, cachedCourses, nearbyCourses, searchResults]
  );

  useEffect(() => {
    localStorage.setItem(CUSTOM_COURSES_KEY, JSON.stringify(customCourses));
  }, [customCourses]);

  useEffect(() => {
    let cancelled = false;
    readCachedCourses().then((courses) => {
      if (!cancelled && Array.isArray(courses)) setCachedCourses(dedupeCourses(courses));
    });
    const onOnline = () => setOfflineMode(false);
    const onOffline = () => setOfflineMode(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
  }, [scores]);

  useEffect(() => {
    localStorage.setItem(PINS_KEY, JSON.stringify(missPins));
  }, [missPins]);

  const activeCourse = allCourses.find((c) => c.id === courseId) || allCourses[0] || COURSE_PRESETS[0];

  useEffect(() => {
    cacheSelectedCourse(activeCourse);
  }, [activeCourse]);
  const baseHole = activeCourse.holes?.[holeIdx] || activeCourse.holes?.[0] || {
    number: 1,
    par: 4,
    yards: 390,
    bearingDeg: 140,
    bunkerStart: null,
    bunkerEnd: null,
    waterCarry: null,
    greenSlope: 'Back-to-Front',
    note: '',
  };
  const activeTee = TEE_BOXES.find((t) => t.id === teeId) || TEE_BOXES[1];

  useEffect(() => {
    setTileError(false);
  }, [activeCourse.lat, activeCourse.lon, useSatTiles, satZoom]);

  const activeHole = {
    ...baseHole,
    yards: Math.round(baseHole.yards * activeTee.mult),
    bunkerStart: baseHole.bunkerStart ? Math.round(baseHole.bunkerStart * activeTee.mult) : null,
    bunkerEnd: baseHole.bunkerEnd ? Math.round(baseHole.bunkerEnd * activeTee.mult) : null,
    waterCarry: baseHole.waterCarry ? Math.round(baseHole.waterCarry * activeTee.mult) : null,
  };

  useEffect(() => {
    onActiveHole?.(activeHole.number);
  }, [activeHole.number, onActiveHole]);

  useEffect(() => {
    setPinTarget(null);
  }, [activeCourse.id, activeHole.number, teeId]);

  useEffect(() => {
    setRoundShots([]);
    setLiveRoundGps(null);
    setMarkRequest(null);
    setAimTarget('center');
  }, [activeCourse.id, activeHole.number, isRoundActive]);

  const pinFeed = useHolePinFeed({
    courseId: activeCourse?.id,
    courseName: activeCourse?.name,
    holeNumber: activeHole?.number,
    userId: auth?.user?.id ?? null,
  });

  useEffect(() => {
    setPinPlaceMode(false);
    setFlagDraft(null);
    setPinSheetOpen(false);
    setGreenRing(null);
  }, [activeCourse.id, activeHole.number]);

  const openPinSheet = (open, mode) => {
    const nextOpen = open !== false;
    setPinSheetOpen(nextOpen);
    setPinSheetMode(mode === 'mark' ? 'mark' : 'finish');
    if (!nextOpen) setPinPlaceMode(false);
  };

  const commitTodayPin = async (point) => {
    const saved = await pinFeed.save({
      lat: point?.lat,
      lng: point?.lng ?? point?.lon,
      greenCenter: resolveGreenCenter(activeCourse, activeHole),
      holeBearingDeg: activeHole.bearingDeg,
      greenRing,
    });
    if (saved) setPinPlaceMode(false);
    return saved;
  };

  const beginFlagDrag = () => {
    const center = resolveGreenCenter(activeCourse, activeHole);
    const seed = flagDraft || pinFeed.livePin || center;
    setFlagDraft({ lat: Number(seed?.lat), lng: Number(seed?.lng ?? seed?.lon) });
    setPinPlaceMode(true);
    setPinSheetOpen(true);
    setPinSheetMode('mark');
  };

  const lockFlagDraft = () => {
    const center = resolveGreenCenter(activeCourse, activeHole);
    const point = flagDraft || pinFeed.livePin || center;
    return commitTodayPin(point);
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

  const rememberRecent = (course) => {
    setRecentCourses((prev) => {
      const next = dedupeCourses([course, ...prev]).slice(0, 12);
      try {
        localStorage.setItem(RECENT_COURSES_KEY, JSON.stringify(next));
      } catch {
        // Recent list is a convenience cache.
      }
      return next;
    });
  };

  const patchCourseElevation = (course, elevationFt) => {
    const key = courseDedupeKey(course);
    const apply = (list) => list.map((item) => (courseDedupeKey(item) === key ? { ...item, elevationFt } : item));
    setCustomCourses(apply);
    setNearbyCourses(apply);
    setSearchResults(apply);
    setCachedCourses(apply);
    setRecentCourses((prev) => {
      const next = apply(prev);
      try {
        localStorage.setItem(RECENT_COURSES_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota failures.
      }
      return next;
    });
  };

  const selectCourse = (course) => {
    if (!course?.id) return;
    const preset = COURSE_PRESETS.some((item) => item.id === course.id);
    if (!preset) {
      setCustomCourses((prev) => dedupeCourses([
        course,
        ...prev.filter((item) => courseDedupeKey(item) !== courseDedupeKey(course)),
      ]));
    }
    setCourseId(course.id);
    setHoleIdx(0);
    rememberRecent(course);
    cacheSelectedCourse(course);
    if (!Number.isFinite(Number(course.elevationFt)) && Number.isFinite(Number(course.lat)) && Number.isFinite(Number(course.lon))) {
      fetchElevationFt(course.lat, course.lon).then((elevationFt) => {
        patchCourseElevation(course, elevationFt);
        cacheSelectedCourse({ ...course, elevationFt });
      });
    }
  };

  const loadNearbyCourses = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not available in this browser.');
      setPickerOpen(true);
      return;
    }
    const gen = nearGen.current + 1;
    nearGen.current = gen;
    setGpsLoading(true);
    setPickerOpen(true);
    setGpsStatus('Finding courses near you...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (nearGen.current !== gen) return;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setPlayerGps({ lat, lon });
        nearAbortRef.current?.abort();
        const controller = new AbortController();
        nearAbortRef.current = controller;
        try {
          const nearby = await fetchCoursesNearPlayer(lat, lon, { signal: controller.signal });
          if (controller.signal.aborted || nearGen.current !== gen) return;
          setNearbyCourses(dedupeCourses(nearby));
          const cached = await readCachedCourses();
          if (!controller.signal.aborted && nearGen.current === gen) setCachedCourses(dedupeCourses(cached));
          setGpsStatus(
            nearby.length
              ? `${nearby.length} courses within 25 miles`
              : 'No mapped courses within 25 miles. Drop a pin to play this spot.'
          );
        } catch (error) {
          if (error?.name === 'AbortError' || nearGen.current !== gen) return;
          setGpsStatus('Nearby lookup failed. Saved courses still work offline.');
        } finally {
          if (nearGen.current === gen) setGpsLoading(false);
        }
      },
      (err) => {
        if (nearGen.current !== gen) return;
        setGpsStatus(`GPS denied or unavailable: ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    loadNearbyCourses();
    return () => nearAbortRef.current?.abort();
  }, [loadNearbyCourses]);

  useEffect(() => {
    const q = courseSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchingCourses(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingCourses(true);
      try {
        const found = await searchGlobalGolfCourses({
          query: q,
          signal: controller.signal,
          lat: playerGps?.lat,
          lon: playerGps?.lon,
        });
        if (controller.signal.aborted) return;
        setSearchResults(dedupeCourses(found));
        const cached = await readCachedCourses();
        if (!controller.signal.aborted) setCachedCourses(dedupeCourses(cached));
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        setGpsStatus('Course search failed. Saved courses still work offline.');
      } finally {
        if (!controller.signal.aborted) setSearchingCourses(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [courseSearch, playerGps?.lat, playerGps?.lon]);

  const handleDropPin = async () => {
    const lat = Number(playerGps?.lat ?? activeCourse?.lat);
    const lon = Number(playerGps?.lon ?? activeCourse?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setGpsStatus('Drop pin needs a GPS fix or a map center.');
      return;
    }
    const elevationFt = await fetchElevationFt(lat, lon);
    const pinned = {
      id: `pin-${Date.now()}`,
      name: 'Dropped Pin',
      city: 'Custom pin',
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      elevationFt,
      holes: [
        { number: 1, par: 4, yards: 390, bearingDeg: 140, bunkerStart: 250, bunkerEnd: 272, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Pinned course - customize hole yardage and hazards anytime.' },
      ],
    };
    setNewCourseLat(pinned.lat);
    setNewCourseLon(pinned.lon);
    setNewCourseName(pinned.name);
    setNewCourseCity(pinned.city);
    setNewCourseElev(elevationFt);
    setCreatorMode('course');
    selectCourse(pinned);
    setPickerOpen(false);
    setGpsStatus(`Pinned course at ${pinned.lat}, ${pinned.lon}. Start the round, or rename it with +.`);
  };

  const handleSaveHole = (e) => {
    e.preventDefault();
    const yardsNum = Math.max(50, Number(holeYards) || 350);
    const bunkerNum = Number(bunkerStart) || null;
    const waterNum = Number(waterCarry) || null;

    const newHole = {
      number: Number(holeNumber) || ((activeCourse.holes?.length || 0) + 1),
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
      setHoleIdx(activeCourse.holes?.length || 0);
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

  const suggestionClubs = activeBagClubs(clubs);
  const evaluatedClubs = suggestionClubs.map((club) => {
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
        ? `Aim ${formatDistance(crossYards)} Right (R->L wind)`
        : `Aim ${formatDistance(crossYards)} Left (L->R wind)`
      : 'Aim Center (Neutral crosswind)';

  const dewSpread = weather.tempF - weather.dewPointF;
  const estStimp = dewSpread <= 4 ? '9.2 (Morning Dew)' : dewSpread <= 10 ? '10.5 (Medium-Fast)' : '11.8 (Dry & Slick)';
  const frontYards = Math.max(40, activeHole.yards - 12);
  const backYards = activeHole.yards + 14;

  // Hole Stat & Score State (Total Strokes, Fairway Hit, GIR, Putts, Tracked Drive)
  const courseScores = scores[activeCourse.id] || {};
  const rawEntry = courseScores[activeHole.number];
  const defaultGir = activeHole.par <= 3 ? true : true;
  const currentStat =
    typeof rawEntry === 'number'
      ? { strokes: rawEntry, putts: 2, fir: activeHole.par > 3 ? 'hit' : 'na', gir: rawEntry - 2 <= activeHole.par - 2 }
      : rawEntry || {
          strokes: activeHole.par,
          putts: 2,
          fir: activeHole.par > 3 ? 'hit' : 'na',
          gir: defaultGir,
        };

  const updateHoleStat = (patch) => {
    const nextStrokes = Math.max(1, Math.min(12, patch.strokes ?? currentStat.strokes));
    const nextPutts = Math.max(0, Math.min(nextStrokes, patch.putts ?? currentStat.putts));
    const autoGir = nextStrokes - nextPutts <= activeHole.par - 2;
    const nextEntry = {
      strokes: nextStrokes,
      putts: nextPutts,
      fir: patch.fir ?? currentStat.fir,
      gir: patch.gir !== undefined ? patch.gir : autoGir,
      driveYards: patch.driveYards ?? currentStat.driveYards ?? null,
    };

    setScores((prev) => ({
      ...prev,
      [activeCourse.id]: {
        ...(prev[activeCourse.id] || {}),
        [activeHole.number]: nextEntry,
      },
    }));
  };

  // Live GPS Shot Distance & Fairway Tracker
  const handleMarkShotStart = () => {
    if (!navigator.geolocation) {
      setGpsStatus('GPS not supported on this device.');
      return;
    }
    setTrackingShot(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setShotStartGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          club: activeClub?.club_type || 'Driver',
          hole: activeHole.number,
        });
        setLastMeasuredShot(null);
        setTrackingShot(false);
      },
      (err) => {
        setGpsStatus(`Shot GPS error: ${err.message}`);
        setTrackingShot(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleMeasureShotEnd = () => {
    if (!shotStartGps || !navigator.geolocation) return;
    setTrackingShot(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const yards = calcGpsYards(shotStartGps.lat, shotStartGps.lon, pos.coords.latitude, pos.coords.longitude);
        const measured = { yards, club: shotStartGps.club, hole: shotStartGps.hole };
        setLastMeasuredShot(measured);
        updateHoleStat({ driveYards: yards });
        setShotStartGps(null);
        setTrackingShot(false);
      },
      (err) => {
        setGpsStatus(`Shot GPS error: ${err.message}`);
        setTrackingShot(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Round Aggregate Totals (Total Strokes, GIR%, FIR%, Putts)
  const loggedHoleNumbers = Object.keys(courseScores).map(Number);
  const holesLogged = loggedHoleNumbers.length;
  let totalStrokes = 0;
  let totalPutts = 0;
  let girHits = 0;
  let firHits = 0;
  let firEligible = 0;
  let parForLogged = 0;

  loggedHoleNumbers.forEach((hNum) => {
    const holeMeta = activeCourse.holes?.find((h) => h.number === hNum) || { par: 4 };
    const entry = courseScores[hNum];
    const st = typeof entry === 'number' ? entry : entry.strokes;
    const pt = typeof entry === 'number' ? 2 : entry.putts ?? 2;
    const isGir = typeof entry === 'number' ? st - pt <= holeMeta.par - 2 : Boolean(entry.gir);
    const firVal = typeof entry === 'number' ? 'hit' : entry.fir;

    totalStrokes += st;
    totalPutts += pt;
    parForLogged += holeMeta.par;
    if (isGir) girHits += 1;
    if (holeMeta.par > 3) {
      firEligible += 1;
      if (firVal === 'hit') firHits += 1;
    }
  });

  const relPar = totalStrokes - parForLogged;
  const girPct = holesLogged > 0 ? Math.round((girHits / holesLogged) * 100) : 0;
  const firPct = firEligible > 0 ? Math.round((firHits / firEligible) * 100) : 0;

  const shapeShiftX = activeClub?.shot_shape === 'Fade' ? 14 : activeClub?.shot_shape === 'Draw' ? -14 : 0;
  const satTiles = buildSatelliteTileGrid(activeCourse.lat, activeCourse.lon, satZoom);
  const showRealSat = useSatTiles && !tileError;
  const caddieUnit = distanceUnit === 'm' ? 'm' : 'yds';
  const ttsLocale = resolveTtsLocale(lang);
  const caddieClub = bestClub?.club_type || 'Club';
  const caddieYards = Number(bestClub?.effectiveCarry ?? activeHole.yards) || 0;

  useEffect(() => {
    setCaddiePayload(buildWearablePayload({
      unit: caddieUnit,
      targetYards: caddieYards,
      playsLikeYards: caddieYards,
      club: caddieClub,
      holeNumber: activeHole.number,
      par: activeHole.par,
      wind: aimAdvice,
      courseName: activeCourse.name,
      ttsLocale,
    }));
  }, [caddieUnit, caddieYards, caddieClub, activeHole.number, activeHole.par, aimAdvice, activeCourse.name, ttsLocale]);

  useEffect(() => {
    if (!caddieHoleArmed.current) {
      caddieHoleArmed.current = true;
      return;
    }
    const payload = buildWearablePayload({
      unit: caddieUnit,
      targetYards: caddieYards,
      playsLikeYards: caddieYards,
      club: caddieClub,
      holeNumber: activeHole.number,
      par: activeHole.par,
      wind: aimAdvice,
      courseName: activeCourse.name,
      ttsLocale,
    });
    setCaddiePayload(payload);
    if (roundActiveRef.current) return;
    speakCaddieCallout(
      { holeNumber: activeHole.number, club: caddieClub, targetYards: caddieYards, wind: aimAdvice },
      caddieUnit,
      ttsLocale,
      readCaddiePersonaId()
    );
  }, [activeHole.number]);

  const playCaddieCallout = () => {
    const payload = buildWearablePayload({
      unit: caddieUnit,
      targetYards: caddieYards,
      playsLikeYards: caddieYards,
      club: caddieClub,
      holeNumber: activeHole.number,
      par: activeHole.par,
      wind: aimAdvice,
      courseName: activeCourse.name,
      ttsLocale,
    });
    setCaddiePayload(payload);
    speakCaddieCallout(
      { holeNumber: activeHole.number, club: caddieClub, targetYards: caddieYards, wind: aimAdvice },
      caddieUnit,
      ttsLocale,
      readCaddiePersonaId()
    );
  };

  const distanceLabelFor = (course) => {
    if (!playerGps) return '';
    const meters = haversineMeters(playerGps.lat, playerGps.lon, course?.lat, course?.lon ?? course?.lng);
    if (!Number.isFinite(meters)) return '';
    return formatDistance(meters / YARDS_TO_METERS);
  };
  const queryText = courseSearch.trim();
  const pinnedKeys = new Set();
  const takeCourse = (course) => {
    const aliases = courseAliasKeys(course);
    if (aliases.some((key) => pinnedKeys.has(key))) return false;
    aliases.forEach((key) => pinnedKeys.add(key));
    return true;
  };
  const recentSaved = [];
  const savedSource = dedupeCourses([
    ...recentCourses,
    ...customCourses,
    ...COURSE_PRESETS,
    ...(offlineMode || nearbyCourses.length === 0 ? cachedCourses : []),
  ]);
  for (const course of savedSource) {
    if (!courseMatchesQuery(course, queryText) || !takeCourse(course)) continue;
    recentSaved.push(course);
  }
  const nearbyList = [];
  for (const course of sortCoursesByDistance(nearbyCourses, playerGps?.lat, playerGps?.lon)) {
    if (!courseMatchesQuery(course, queryText) || !takeCourse(course)) continue;
    nearbyList.push(course);
  }
  const globalList = [];
  for (const course of sortCoursesByDistance(searchResults, playerGps?.lat, playerGps?.lon)) {
    if (queryText.length < 2 || !courseMatchesQuery(course, queryText) || !takeCourse(course)) continue;
    globalList.push(course);
  }
  const pickerSurface = theme === 'dark' ? '#0B0D0C' : 'var(--bg-surface)';

  if (isRoundActive) {
    const greenCenter = resolveGreenCenter(activeCourse, activeHole);
    const targetYards = Number.isFinite(Number(pinTarget?.yards)) ? Number(pinTarget.yards) : activeHole.yards;
    return (
      <ActiveRoundFocus
        courseName={activeCourse.name}
        holeNumber={activeHole.number}
        par={activeHole.par}
        canPrev={holeIdx > 0}
        canNext={holeIdx < (activeCourse.holes?.length || 1) - 1}
        onPrev={() => setHoleIdx((idx) => Math.max(0, idx - 1))}
        onNext={() => setHoleIdx((idx) => Math.min((activeCourse.holes?.length || 1) - 1, idx + 1))}
        onEndRound={() => {
          setPinTarget(null);
          setRoundShots([]);
          setLiveRoundGps(null);
          setMarkRequest(null);
          setPinSheetOpen(false);
          setPinPlaceMode(false);
          setIsRoundActive(false);
        }}
        onMarkShot={(club) => setMarkRequest({ id: Date.now(), club })}
        onSuggestedClub={(next) => {
          setSuggestedClub((prev) => (prev?.name === next?.name && prev?.carry === next?.carry ? prev : next));
        }}
        onAimTarget={(next) => setAimTarget((prev) => (prev === next ? prev : next))}
        centerYards={activeHole.yards}
        pinYards={targetYards}
        greenCenter={greenCenter}
        windSpeedMph={weather?.windSpeedMph}
        windDirDeg={weather?.windDirDeg}
        holeBearingDeg={activeHole.bearingDeg}
        elevationFt={activeCourse.elevationFt}
        shots={roundShots}
        livePosition={liveRoundGps}
        clubs={suggestionClubs}
        suggestion={activeHole.note || aimAdvice}
        holeScore={currentStat}
        onHoleScore={updateHoleStat}
        livePin={pinFeed.livePin}
        pinTendency={pinFeed.tendency}
        onConfirmPin={pinFeed.confirm}
        pinSheetOpen={pinSheetOpen}
        pinSheetMode={pinSheetMode}
        onOpenPinSheet={openPinSheet}
        pinPlaceMode={pinPlaceMode}
        onCommitPin={commitTodayPin}
        onBeginFlagDrag={beginFlagDrag}
        onLockFlag={lockFlagDraft}
      >
        <SatelliteHoleMap
          fill
          clubs={suggestionClubs}
          livePin={pinFeed.livePin}
          historyPins={pinFeed.history}
          pinPlaceMode={pinPlaceMode}
          flagDraft={flagDraft}
          onFlagDraft={setFlagDraft}
          onGreenGeometry={setGreenRing}
          onRequestMarkPin={() => openPinSheet(true, 'mark')}
          onConfirmPin={pinFeed.confirm}
          courseName={activeCourse.name}
          center={{ lat: activeCourse.lat, lon: activeCourse.lon }}
          hole={{
            number: activeHole.number,
            par: activeHole.par,
            lat: activeHole.lat,
            lon: activeHole.lon,
            yards: activeHole.yards,
            bearingDeg: activeHole.bearingDeg,
            greenLat: activeHole.greenLat ?? greenCenter?.lat,
            greenLon: activeHole.greenLon ?? greenCenter?.lon,
          }}
          origin={shotStartGps ? { lat: shotStartGps.lat, lon: shotStartGps.lon } : undefined}
          onPinChange={setPinTarget}
          onShotsChange={setRoundShots}
          onLivePosition={setLiveRoundGps}
          clubUsed={suggestedClub?.name || ''}
          carryYards={suggestedClub?.carry}
          markRequest={markRequest}
          aimTarget={aimTarget}
        />
      </ActiveRoundFocus>
    );
  }

  return (
    <div className="space-y-4 pb-[max(6rem,env(safe-area-inset-bottom))]">
      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => {
            setPinTarget(null);
            setIsRoundActive(true);
          }}
          className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          Start Round
        </button>
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-55" />
            <input
              type="text"
              placeholder="Search any golf course"
              value={courseSearch}
              onChange={(e) => { setCourseSearch(e.target.value); setPickerOpen(true); }}
              onFocus={() => setPickerOpen(true)}
              className="min-h-[44px] w-full rounded-2xl border daylight-border py-2 pl-9 pr-3 text-sm"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
          <button
            type="button"
            onClick={loadNearbyCourses}
            disabled={gpsLoading}
            className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-2xl px-3 text-xs font-semibold text-white"
            style={{ backgroundColor: '#10B981' }}
          >
            {gpsLoading ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
            Near Me
          </button>
          <button
            type="button"
            onClick={() => setCreatorOpen(!creatorOpen)}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl border daylight-border px-2.5 text-xs font-semibold"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {creatorOpen ? <X size={13} /> : <Plus size={13} />}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="min-h-[44px] flex-1 rounded-2xl border daylight-border px-3 py-1.5 text-left"
            style={{ backgroundColor: pickerSurface, borderColor: 'var(--border-subtle)', color: theme === 'dark' ? '#F3F4F1' : 'var(--text-primary)' }}
          >
            <span className="block truncate text-sm font-bold">{activeCourse.name}</span>
            <span className="block truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {activeCourse.city || 'Selected course'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSimOpen(!simOpen)}
            className="min-h-[44px] text-[11px] font-mono px-2.5 py-1.5 rounded-xl border flex items-center gap-1"
            style={{ borderColor: 'var(--border-subtle)', color: weather.isLive ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}
          >
            <SlidersHorizontal size={11} /> {weather.isLive ? 'LIVE WX' : 'WHAT-IF'}
          </button>
        </div>

        {pickerOpen && (
          <div
            className="max-h-80 space-y-3 overflow-y-auto rounded-2xl border daylight-border p-2"
            style={{ backgroundColor: pickerSurface, borderColor: 'var(--border-subtle)' }}
          >
            <section className="space-y-1.5">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Recent & Saved Courses</p>
              {recentSaved.length === 0 ? (
                <p className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>No saved matches yet.</p>
              ) : recentSaved.map((course) => (
                <CoursePickerRow
                  key={`saved-${course.id}-${courseDedupeKey(course)}`}
                  course={course}
                  selected={course.id === activeCourse.id}
                  distanceLabel={distanceLabelFor(course)}
                  onSelect={selectCourse}
                />
              ))}
            </section>
            <section className="space-y-1.5">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Nearby Courses (GPS)</p>
              {gpsLoading && nearbyList.length === 0 ? (
                <p className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Locating courses within 25 miles...</p>
              ) : null}
              {!gpsLoading && nearbyList.length === 0 ? (
                <p className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>No mapped courses within 25 miles yet.</p>
              ) : null}
              {nearbyList.map((course) => (
                <CoursePickerRow
                  key={`near-${course.id}-${courseDedupeKey(course)}`}
                  course={course}
                  selected={course.id === activeCourse.id}
                  distanceLabel={distanceLabelFor(course)}
                  onSelect={selectCourse}
                />
              ))}
            </section>
            <section className="space-y-1.5">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Global Search Results</p>
              {searchingCourses ? (
                <p className="flex items-center gap-1 px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 size={12} className="animate-spin" /> Searching courses...
                </p>
              ) : null}
              {!searchingCourses && queryText.length < 2 ? (
                <p className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Type a course or city to search the world.</p>
              ) : null}
              {!searchingCourses && queryText.length >= 2 && globalList.length === 0 ? (
                <p className="px-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>No matches yet. Try another name or drop a pin.</p>
              ) : null}
              {globalList.map((course) => (
                <CoursePickerRow
                  key={`search-${course.id}-${courseDedupeKey(course)}`}
                  course={course}
                  selected={course.id === activeCourse.id}
                  distanceLabel={distanceLabelFor(course)}
                  onSelect={selectCourse}
                />
              ))}
            </section>
            <button
              type="button"
              onClick={handleDropPin}
              className="min-h-[44px] w-full rounded-2xl border daylight-border px-3 text-left text-sm font-semibold"
              style={{ borderColor: '#10B981', color: 'var(--accent-emerald)', backgroundColor: 'rgba(16,185,129,0.12)' }}
            >
              Can&apos;t find your course? Drop Pin on Map
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Tee Box</span>
          <div className="flex gap-1.5">
            {TEE_BOXES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTeeId(t.id)}
                className={`min-h-[44px] px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
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
          <div className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--accent-emerald)' }}>
            {gpsStatus}
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(activeCourse.holes || []).map((h, idx) => (
            <button
              key={`${activeCourse.id}-${h.number}-${idx}`}
              onClick={() => setHoleIdx(idx)}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border shrink-0 transition tabular-nums ${
                holeIdx === idx ? 'bg-emerald-700 text-white border-emerald-700' : ''
              }`}
              style={holeIdx !== idx ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
            >
              #{h.number} - P{h.par} ({formatDistance(Math.round(h.yards * activeTee.mult))})
            </button>
          ))}
        </div>
      </div>

      {simOpen && (
        <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-emerald)' }}>
              Weather & Dew Point What-If Simulator
            </span>
            <button
              type="button"
              onClick={reloadLiveWeather}
              className="text-[11px] underline font-semibold"
              style={{ color: 'var(--accent-emerald)' }}
            >
              Reset to Live WX
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <label className="text-[10px] block mb-0.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>Temp ({weather.tempF}F)</label>
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
              <label className="text-[10px] block mb-0.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>Dew Pt ({weather.dewPointF}F)</label>
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
              <label className="text-[10px] block mb-0.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>Wind ({formatSpeed(weather.windSpeedMph)})</label>
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
          className="rounded-3xl p-4 border space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Custom Course & Hole Builder
            </span>
            <div className="flex gap-1 rounded-lg p-0.5 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setCreatorMode('hole')}
                className={`min-h-[44px] px-2.5 py-1 rounded text-[11px] font-semibold ${creatorMode === 'hole' ? 'bg-emerald-700 text-white' : ''}`}
              >
                + Hole to {activeCourse.name.split(' ')[0]}
              </button>
              <button
                type="button"
                onClick={() => setCreatorMode('course')}
                className={`min-h-[44px] px-2.5 py-1 rounded text-[11px] font-semibold ${creatorMode === 'course' ? 'bg-emerald-700 text-white' : ''}`}
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
          <div className="font-mono font-bold text-sm tabular-nums">{weather.tempF}F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Temp</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Droplets size={14} className="mx-auto mb-1 text-sky-400" />
          <div className="font-mono font-bold text-sm tabular-nums">{weather.dewPointF}F</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Dew Pt</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Wind size={14} className="mx-auto mb-1" style={{ color: 'var(--accent-emerald-fill)' }} />
          <div className="font-mono font-bold text-sm tabular-nums">{formatSpeed(weather.windSpeedMph)}</div>
          <div className="text-[10px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>{degreesToCompass(weather.windDirDeg)} (G {formatSpeed(weather.windGustMph)})</div>
        </div>

        <div className="rounded-xl p-2.5 border text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Mountain size={14} className="mx-auto mb-1 opacity-75" />
          <div className="font-mono font-bold text-sm tabular-nums">{Number.isFinite(Number(activeCourse.elevationFt)) ? `${activeCourse.elevationFt} ft` : '—'}</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Elev</div>
        </div>
      </div>

      {bestClub && (
        <div
          onClick={() => setSelectedClubId(bestClub.id)}
          className="rounded-3xl p-3.5 border cursor-pointer flex items-center justify-between"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}
        >
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
              <Sparkles size={13} /> Highest-Percentage Play ({activeTee.label} Tees)
            </div>
            <div className="font-bold text-sm tabular-nums">
              Pull {bestClub.club_type} ({formatDistance(bestClub.effectiveCarry)} carry / {formatDistance(bestClub.effectiveTotal)} total)
            </div>
            {clubSpecSubtitle(bestClub) ? (
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{clubSpecSubtitle(bestClub)}</div>
            ) : null}
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {aimAdvice} - {activeHole.par === 3 ? `Green: ${activeHole.greenSlope}` : `Leaves ${formatDistance(bestClub.remainingToPin)} in`}
            </div>
          </div>
          <CheckCircle2 size={20} style={{ color: 'var(--accent-emerald)' }} className="shrink-0" />
        </div>
      )}

      {/* Toggleable Live Satellite Tile + Aerial Hole Shot Map */}
      {activeClub && (
        <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold truncate tabular-nums">
              Hole #{activeHole.number} - Par {activeHole.par} - {formatDistance(activeHole.yards)}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setUseSatTiles(!useSatTiles)}
                className="min-h-[44px] px-2.5 rounded-lg border font-mono text-[10px] font-semibold flex items-center gap-1"
                style={{
                  borderColor: showRealSat ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                  color: showRealSat ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-elevated)',
                }}
              >
                <Globe size={11} /> {showRealSat ? 'SAT' : 'VEC'}
              </button>
              {showRealSat && (
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-subtle)' }}>
                  {SAT_ZOOM_LEVELS.map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setSatZoom(z)}
                      className={`min-h-[44px] min-w-[44px] font-mono text-[10px] font-semibold ${
                        satZoom === z ? 'bg-emerald-700 text-white' : ''
                      }`}
                      style={satZoom !== z ? { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' } : {}}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              )}
              <span className="font-mono tabular-nums" style={{ color: 'var(--accent-emerald)' }}>
                {activeClub.headwindMph >= 0 ? `${formatSpeed(activeClub.headwindMph)} Into` : `${formatSpeed(Math.abs(activeClub.headwindMph))} Helping`}
              </span>
            </div>
          </div>

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
                  className={`min-h-[44px] px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
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

          {/* OSM satellite hole map — imagery, schematic, and tap-to-pin. Existing hole diagram stays below. */}
          <SatelliteHoleMap
            courseName={activeCourse.name}
            center={{ lat: activeCourse.lat, lon: activeCourse.lon }}
            hole={{
              number: activeHole.number,
              par: activeHole.par,
              lat: activeHole.lat,
              lon: activeHole.lon,
              yards: activeHole.yards,
              bearingDeg: activeHole.bearingDeg,
              greenLat: resolveGreenCenter(activeCourse, activeHole)?.lat,
              greenLon: resolveGreenCenter(activeCourse, activeHole)?.lon,
            }}
            origin={shotStartGps ? { lat: shotStartGps.lat, lon: shotStartGps.lon } : undefined}
            livePin={pinFeed.livePin}
            historyPins={pinFeed.history}
            pinPlaceMode={pinPlaceMode}
            flagDraft={flagDraft}
            onFlagDraft={setFlagDraft}
            onGreenGeometry={setGreenRing}
            onRequestMarkPin={() => openPinSheet(true, 'mark')}
            onConfirmPin={pinFeed.confirm}
          />

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={playCaddieCallout}
              className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--accent-emerald)' }}
            >
              Play caddie callout
            </button>
            {caddiePayload?.glasses?.meta?.glance && (
              <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                {caddiePayload.liveActivity?.title} · {caddiePayload.glasses.meta.glance}
              </p>
            )}
          </div>

          <svg
            viewBox="0 0 280 330"
            onClick={handleSvgTap}
            className="w-full h-80 rounded-2xl cursor-crosshair select-none border border-emerald-950 shadow-inner"
            style={{ backgroundColor: '#0A150F' }}
          >
            <defs>
              <clipPath id="satMapClip">
                <rect x="0" y="0" width="280" height="330" rx="14" />
              </clipPath>
              <radialGradient id="earthTerrain" cx="50%" cy="45%" r="65%">
                <stop offset="0%" stopColor="#162A1E" />
                <stop offset="65%" stopColor="#0E1C14" />
                <stop offset="100%" stopColor="#08110C" />
              </radialGradient>
              <linearGradient id="roughTurf" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#163C29" />
                <stop offset="50%" stopColor="#1D4D35" />
                <stop offset="100%" stopColor="#143625" />
              </linearGradient>
              <pattern id="mowStripes" width="28" height="22" patternUnits="userSpaceOnUse">
                <rect width="28" height="11" fill="#236E48" />
                <rect y="11" width="28" height="11" fill="#2B8055" />
              </pattern>
              <radialGradient id="greenCollar" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stopColor="#3BC279" />
                <stop offset="72%" stopColor="#2FA364" />
                <stop offset="100%" stopColor="#1E7546" />
              </radialGradient>
              <radialGradient id="bunkerSand" cx="42%" cy="38%" r="65%">
                <stop offset="0%" stopColor="#F5EAD0" />
                <stop offset="72%" stopColor="#DFC794" />
                <stop offset="100%" stopColor="#A6823C" />
              </radialGradient>
              <linearGradient id="waterLake" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0369A1" />
                <stop offset="50%" stopColor="#0284C7" />
                <stop offset="100%" stopColor="#075985" />
              </linearGradient>
              <filter id="turfShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#040A07" floodOpacity="0.65" />
              </filter>
            </defs>

            <rect width="280" height="330" fill="url(#earthTerrain)" />

            {showRealSat && (
              <g clipPath="url(#satMapClip)">
                {satTiles.map((t) => (
                  <image
                    key={t.key}
                    href={t.href}
                    x={t.x}
                    y={t.y}
                    width={t.size}
                    height={t.size}
                    preserveAspectRatio="xMidYMid slice"
                    onError={() => setTileError(true)}
                  />
                ))}
                <rect width="280" height="330" fill="#06120B" fillOpacity="0.34" />
              </g>
            )}

            <g opacity={showRealSat ? 0.42 : 1}>
              <path d="M 10 85 Q 140 60 270 95" fill="none" stroke="#34D399" strokeOpacity="0.08" strokeWidth="1" />
              <path d="M 10 175 Q 140 150 270 185" fill="none" stroke="#34D399" strokeOpacity="0.08" strokeWidth="1" />
              <path d="M 10 255 Q 140 235 270 265" fill="none" stroke="#34D399" strokeOpacity="0.08" strokeWidth="1" />

              {!showRealSat && [
                [44, 74, 15], [32, 112, 18], [48, 152, 14], [30, 198, 17], [46, 242, 15],
                [236, 68, 16], [248, 118, 19], [232, 164, 15], [246, 212, 17], [234, 256, 14],
              ].map(([cx, cy, r], idx) => (
                <g key={idx}>
                  <circle cx={cx + 2} cy={cy + 3} r={r} fill="#040A07" opacity="0.55" />
                  <circle cx={cx} cy={cy} r={r} fill="#112E1F" stroke="#1C4731" strokeWidth="1" />
                  <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.52} fill="#19422D" opacity="0.7" />
                </g>
              ))}

              <path
                d="M 86 300 C 78 225, 84 135, 112 52 L 168 52 C 190 135, 186 225, 180 300 Z"
                fill="url(#roughTurf)"
                stroke="#2A6B4A"
                strokeWidth="1.2"
                filter="url(#turfShadow)"
              />

              <path
                d="M 113 266 C 107 205, 113 135, 131 66 L 155 66 C 167 135, 163 205, 157 266 Z"
                fill="url(#mowStripes)"
                stroke="#4ADE80"
                strokeOpacity="0.35"
                strokeWidth="1"
              />
            </g>

            <path d="M 94 140 Q 140 152 186 140" fill="none" stroke="#E2E8F0" strokeOpacity="0.22" strokeDasharray="3 3" />
            <path d="M 86 212 Q 140 226 194 212" fill="none" stroke="#E2E8F0" strokeOpacity="0.22" strokeDasharray="3 3" />

            {activeHole.waterCarry && (() => {
              const waterY = Math.max(76, 282 - (activeHole.waterCarry / activeHole.yards) * 224);
              return (
                <g filter="url(#turfShadow)">
                  <path
                    d={`M 84 ${waterY - 7} Q 138 ${waterY - 14} 196 ${waterY - 5} L 194 ${waterY + 9} Q 138 ${waterY + 16} 86 ${waterY + 7} Z`}
                    fill="url(#waterLake)"
                    stroke="#7DD3FC"
                    strokeWidth="1.1"
                  />
                  <line x1="108" y1={waterY - 1} x2="132" y2={waterY - 2} stroke="#BAE6FD" strokeOpacity="0.55" strokeWidth="1" />
                  <line x1="148" y1={waterY + 3} x2="174" y2={waterY + 2} stroke="#BAE6FD" strokeOpacity="0.45" strokeWidth="1" />
                  <text x="200" y={waterY + 3} fontSize="8" fontWeight="bold" fill="#7DD3FC">
                    H2O {formatDistance(activeHole.waterCarry)}
                  </text>
                </g>
              );
            })()}

            {activeHole.bunkerStart && (() => {
              const bY = Math.max(66, 282 - (activeHole.bunkerStart / activeHole.yards) * 224);
              return (
                <g filter="url(#turfShadow)">
                  <ellipse
                    cx="166"
                    cy={bY}
                    rx="15"
                    ry="10.5"
                    transform={`rotate(-14 166 ${bY})`}
                    fill="url(#bunkerSand)"
                    stroke="#8C6A28"
                    strokeWidth="1.2"
                  />
                  <text x="185" y={bY + 3} fontSize="8" fontWeight="bold" fill="#FDE68A">
                    Sand {formatDistance(activeHole.bunkerStart)}
                  </text>
                </g>
              );
            })()}

            <g filter="url(#turfShadow)">
              <ellipse cx="105" cy="52" rx="11.5" ry="7.5" fill="url(#bunkerSand)" stroke="#8C6A28" strokeWidth="1.1" />
              <ellipse cx="175" cy="48" rx="12.5" ry="8" fill="url(#bunkerSand)" stroke="#8C6A28" strokeWidth="1.1" />
            </g>

            <g filter="url(#turfShadow)">
              <ellipse cx="140" cy="44" rx="37" ry="22" fill="#238653" fillOpacity={showRealSat ? 0.72 : 1} />
              <ellipse cx="140" cy="44" rx="33" ry="19" fill="url(#greenCollar)" fillOpacity={showRealSat ? 0.78 : 1} stroke="#A7F3D0" strokeWidth="1.1" />
              <circle cx="142" cy="44" r="2.2" fill="#0B1611" />
              <line x1="142" y1="22" x2="142" y2="44" stroke="#FFFFFF" strokeWidth="1.7" />
              <polygon points="142,22 158,26.5 142,31" fill="#EF4444" />
            </g>
            <rect x="178" y="34" width="48" height="14" rx="4" fill="#060D09" fillOpacity="0.82" stroke="#6EE7B7" strokeOpacity="0.4" strokeWidth="0.8" />
            <text x="202" y="43.5" textAnchor="middle" fontSize="8.5" fontWeight="bold" fill="#FFFFFF">
              {formatDistance(activeHole.yards)} PIN
            </text>

            {currentHolePins.map((pin) => (
              <g key={pin.id}>
                <circle cx={pin.x} cy={pin.y} r="6.5" fill={pin.color} fillOpacity="0.92" stroke="#FFFFFF" strokeWidth="1.5" />
                <text x={pin.x + 8} y={pin.y + 3} fontSize="8" fontWeight="bold" fill={pin.color}>
                  {pin.label}
                </text>
              </g>
            ))}

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
                    fillOpacity="0.22"
                  />
                  <path
                    d={`M 140 ${teeY} Q ${140 - shapeShiftX * 0.6} ${(teeY + carryY) / 2} ${landX} ${carryY}`}
                    fill="none"
                    stroke={strokeCol}
                    strokeWidth="2.4"
                    strokeDasharray="4 3"
                  />
                  <line x1={landX} y1={carryY} x2={landX} y2={totalY} stroke={strokeCol} strokeWidth="2.4" />
                  {pairedApproachClub && (
                    <line x1={landX} y1={totalY} x2="142" y2="44" stroke="#6EE7B7" strokeWidth="1.7" strokeDasharray="3 3" />
                  )}
                  <circle cx={landX} cy={carryY} r="4.8" fill={strokeCol} stroke="#FFFFFF" strokeWidth="1.2" />
                  <circle cx={landX} cy={totalY} r="3.4" fill="#FFFFFF" stroke={strokeCol} strokeWidth="1.5" />
                  <rect
                    x={Math.min(160, landX + 7)}
                    y={carryY - 7}
                    width="74"
                    height="14"
                    rx="4"
                    fill="#060D09"
                    fillOpacity="0.85"
                  />
                  <text x={Math.min(164, landX + 11)} y={carryY + 3} fontSize="8.5" fontWeight="bold" fill={strokeCol}>
                    {activeClub.club_type}: {formatDistance(activeClub.effectiveCarry)}
                  </text>
                </>
              );
            })()}

            <rect x="116" y="259" width="48" height="40" rx="6" fill="#1C5E3E" fillOpacity={showRealSat ? 0.78 : 1} stroke="#A7F3D0" strokeOpacity="0.65" strokeWidth="1" filter="url(#turfShadow)" />
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
                    fillOpacity={selected ? 0.98 : 0.5}
                  />
                  <text
                    x="162"
                    y={tb.y + 1.5}
                    fontSize="7.5"
                    fontWeight={selected ? 'bold' : 'normal'}
                    fill={selected ? '#FBBF24' : '#FFFFFF'}
                  >
                    {tb.label}
                  </text>
                </g>
              );
            })}

            <g transform="translate(34, 34)">
              <circle cx="0" cy="0" r="18" fill="#060D09" fillOpacity="0.86" stroke="#6EE7B7" strokeOpacity="0.65" strokeWidth="1" />
              <g transform={`rotate(${weather.windDirDeg})`}>
                <line x1="0" y1="10" x2="0" y2="-10" stroke="#10B981" strokeWidth="2.2" />
                <polygon points="0,-12 -4,-5 4,-5" fill="#10B981" />
              </g>
              <text className="tabular-nums" x="0" y="28" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#FFFFFF">
                {degreesToCompass(weather.windDirDeg)} {formatSpeed(weather.windSpeedMph)}
              </text>
            </g>

            <g transform="translate(184, 12)">
              <rect x="0" y="0" width="86" height="15" rx="4" fill="#060D09" fillOpacity="0.85" stroke="#34D399" strokeOpacity="0.4" strokeWidth="0.8" />
              <text x="43" y="10.5" textAnchor="middle" fontSize="7.5" fontFamily="monospace" fill="#6EE7B7">
                {showRealSat ? `SAT ${satZoom}x` : 'VEC'} • {Number.isFinite(Number(activeCourse.elevationFt)) ? `${activeCourse.elevationFt}ft` : '—'}
              </text>
            </g>
          </svg>

          {pairedApproachClub && (
            <div className="p-2.5 rounded-xl border text-xs flex items-center justify-between tabular-nums" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <span>
                <strong>2-Shot Combo:</strong> {activeClub.club_type} ({formatDistance(activeClub.effectiveTotal)}) -&gt; <strong>{pairedApproachClub.club_type}</strong> ({formatDistance(activeClub.remainingToPin)} in)
              </span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--accent-emerald)' }}>
                {formatDistance(pairedApproachClub.effectiveCarry)} carry
              </span>
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {evaluatedClubs.slice(0, 8).map((club) => (
              <button
                key={club.id}
                onClick={() => {
                  if (!isPro && club.id !== suggestionClubs[0]?.id && club.id !== bestClub?.id) {
                    onOpenPaywall('Full-Bag Interactive Shot Simulation');
                    return;
                  }
                  setSelectedClubId(club.id);
                }}
                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border shrink-0 transition ${
                  activeClub.id === club.id ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={activeClub.id !== club.id ? { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' } : {}}
              >
                <div>{club.club_type}</div>
                {clubSpecSubtitle(club) ? <div className="text-[10px] font-normal opacity-70">{clubSpecSubtitle(club)}</div> : null}
                <div className="text-[10px] font-mono opacity-80 tabular-nums">Stock {formatDistance(club.carry_yards)} -&gt; {formatDistance(club.effectiveCarry)}</div>
              </button>
            ))}
          </div>

          {(activeClub.hitsBunker || !activeClub.missesWater) && (
            <div className="text-xs text-red-400 font-medium flex items-center gap-1.5 tabular-nums">
              <AlertTriangle size={14} /> Hazard Alert: Adjusted carry ({formatDistance(activeClub.effectiveCarry)}) brings trouble into play.
            </div>
          )}

          <p className="text-xs pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            <strong>Caddie Note:</strong> {activeHole.note}
          </p>
        </div>
      )}

      {/* Live GPS Shot Yardage & Fairway Tracker */}
      <div className="rounded-3xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <LocateFixed size={14} /> Live GPS Shot Yardage Tracker
          </span>
          {(lastMeasuredShot || currentStat.driveYards) && (
            <span className="text-xs font-mono font-bold tabular-nums" style={{ color: 'var(--accent-emerald)' }}>
              {lastMeasuredShot ? `${lastMeasuredShot.club}: ${formatDistance(lastMeasuredShot.yards)}` : `Logged: ${formatDistance(currentStat.driveYards)}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMarkShotStart}
            disabled={trackingShot}
            className="flex-1 min-h-[44px] py-2 rounded-xl text-xs font-semibold border"
            style={{
              backgroundColor: shotStartGps ? 'rgba(16,185,129,0.16)' : 'var(--bg-elevated)',
              borderColor: shotStartGps ? 'var(--accent-emerald)' : 'var(--border-subtle)',
              color: shotStartGps ? 'var(--accent-emerald)' : 'inherit',
            }}
          >
            {shotStartGps ? `Tee Locked (${shotStartGps.club}) • Walk to Ball` : `1. Mark Tee GPS (${activeClub?.club_type || 'Driver'})`}
          </button>

          <button
            type="button"
            onClick={handleMeasureShotEnd}
            disabled={!shotStartGps || trackingShot}
            className="flex-1 min-h-[44px] py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            {trackingShot ? 'Reading GPS...' : '2. Measure at Ball'}
          </button>
        </div>
      </div>

      {/* Full Hole-by-Hole Scorecard: Total Strokes, Fairway Hit, GIR & Putts */}
      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-emerald)' }}>
              Hole #{activeHole.number} Scorecard (Par {activeHole.par})
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              GIR auto-detects when (Strokes - Putts) &le; {activeHole.par - 2}
            </div>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full tabular-nums" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent-emerald)' }}>
            {holesLogged > 0 ? `${totalStrokes} (${relPar === 0 ? 'E' : relPar > 0 ? `+${relPar}` : relPar})` : 'Ready'}
          </span>
        </div>

        {/* Strokes & Putts Counters */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-xl border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-semibold">Total Strokes</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateHoleStat({ strokes: currentStat.strokes - 1 })}
                className="min-h-[44px] min-w-[44px] rounded-lg border font-bold text-sm"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                -
              </button>
              <span className="w-5 text-center font-mono font-bold text-base tabular-nums">{currentStat.strokes}</span>
              <button
                type="button"
                onClick={() => updateHoleStat({ strokes: currentStat.strokes + 1 })}
                className="min-h-[44px] min-w-[44px] rounded-lg border font-bold text-sm"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                +
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded-xl border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-semibold">Putts</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateHoleStat({ putts: currentStat.putts - 1 })}
                className="min-h-[44px] min-w-[44px] rounded-lg border font-bold text-sm"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                -
              </button>
              <span className="w-5 text-center font-mono font-bold text-base tabular-nums">{currentStat.putts}</span>
              <button
                type="button"
                onClick={() => updateHoleStat({ putts: currentStat.putts + 1 })}
                className="min-h-[44px] min-w-[44px] rounded-lg border font-bold text-sm"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                +
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openPinSheet(true, 'mark')}
          className="min-h-[44px] w-full rounded-xl text-xs font-semibold text-[#0B0D0C]"
          style={{ backgroundColor: '#10B981' }}
        >
          Mark Pin
        </button>

        {/* Fairway Hit (FIR) & Green in Regulation (GIR) Toggles */}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          {activeHole.par > 3 ? (
            <div className="p-2.5 rounded-xl border space-y-1.5" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-secondary)' }}>Fairway (FIR)</div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: 'left', label: 'Miss L' },
                  { id: 'hit', label: 'Hit' },
                  { id: 'right', label: 'Miss R' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateHoleStat({ fir: opt.id })}
                    className={`min-h-[44px] py-1 rounded-lg font-semibold text-[11px] border ${
                      currentStat.fir === opt.id
                        ? opt.id === 'hit'
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-amber-600/30 text-amber-300 border-amber-500'
                        : ''
                    }`}
                    style={currentStat.fir !== opt.id ? { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' } : {}}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl border flex flex-col justify-center" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-secondary)' }}>Fairway (FIR)</div>
              <div className="text-xs font-mono mt-1 opacity-70">N/A (Par 3)</div>
            </div>
          )}

          <div className="p-2.5 rounded-xl border space-y-1.5" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-secondary)' }}>Green in Reg (GIR)</div>
            <div className="grid grid-cols-2 gap-1">
              {[
                { val: true, label: 'GIR Yes' },
                { val: false, label: 'Missed' },
              ].map((opt) => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => updateHoleStat({ gir: opt.val })}
                  className={`min-h-[44px] py-1 rounded-lg font-semibold text-[11px] border ${
                    Boolean(currentStat.gir) === opt.val
                      ? opt.val
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-red-500/25 text-red-300 border-red-400'
                      : ''
                  }`}
                  style={Boolean(currentStat.gir) !== opt.val ? { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' } : {}}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Round Totals Strip */}
        <div className="grid grid-cols-4 gap-1.5 pt-1 text-center text-xs" data-numeric>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Strokes</div>
            <div className="font-mono font-bold tabular-nums">{holesLogged > 0 ? totalStrokes : '-'}</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>FIR</div>
            <div className="font-mono font-bold">{firEligible > 0 ? `${firHitCountLabel(firHits, firEligible)} (${firPct}%)` : '-'}</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>GIR</div>
            <div className="font-mono font-bold">{holesLogged > 0 ? `${girHits}/${holesLogged} (${girPct}%)` : '-'}</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Putts</div>
            <div className="font-mono font-bold tabular-nums">{holesLogged > 0 ? totalPutts : '-'}</div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <Flag size={14} /> Green Complex & Dew-Point Stimp
          </span>
          <span className="text-[11px] font-mono font-semibold tabular-nums" style={{ color: 'var(--accent-emerald)' }}>{estStimp}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Front</div>
            <div className="font-mono font-bold text-sm tabular-nums">{formatDistance(frontYards)}</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--accent-emerald)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--accent-emerald)' }}>Middle</div>
            <div className="font-mono font-bold text-sm tabular-nums">{formatDistance(activeHole.yards)}</div>
          </div>
          <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Back</div>
            <div className="font-mono font-bold text-sm tabular-nums">{formatDistance(backYards)}</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenWearable}
        className="w-full rounded-3xl p-3.5 border flex items-center justify-between text-left"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 text-xs">
          <Watch size={15} style={{ color: 'var(--accent-emerald)' }} />
          <Glasses size={15} style={{ color: 'var(--accent-emerald)' }} />
          <span>Watch & Meta Glasses Feed: <strong className="tabular-nums">{bestClub?.club_type} ({formatDistance(bestClub?.effectiveCarry)})</strong></span>
        </div>
        <span className="text-[11px] font-semibold underline" style={{ color: 'var(--accent-emerald)' }}>Preview HUD</span>
      </button>
      <PinScoutToast />
      <PinFinishSheet
        floating
        open={pinSheetOpen}
        pinPlaceMode={pinPlaceMode}
        startWithMethods={pinSheetMode === 'mark'}
        holeScore={currentStat}
        onHoleScore={updateHoleStat}
        canAdvance={false}
        onAdvance={() => openPinSheet(false)}
        onClose={() => openPinSheet(false)}
        onCommitPin={commitTodayPin}
        onBeginFlagDrag={beginFlagDrag}
        onLockFlag={lockFlagDraft}
      />
    </div>
  );
}

function firHitCountLabel(hits, eligible) {
  return `${hits}/${eligible}`;
}