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
  fetchCourseWeather,
  fetchElevationFt,
  cacheSelectedCourse,
  degreesToCompass,
  calculateShotPhysics,
} from '../lib/weatherPhysics';
import {
  STARTER_COURSES,
  dedupeCourses,
  sortByDistance,
  displayHoleCount,
  placeLabel,
  haversineMeters,
  ensurePlayableHoles,
  buildSkeletonHoles,
  loadOfflineCatalog,
  fetchCoursesNear,
  rememberGlobalCourses,
  normalizeCourseName,
} from '../utils/globalCourseCatalog';
import { loadPlayableGeometry, placeHolePoint, savePlacedGeometry } from '../utils/courseGeometries';
import { hydrateGolfCourse, searchGolfCourses } from '../utils/courseGeometryService';
import SatelliteHoleMap from '../components/SatelliteHoleMap';
import ActiveRoundFocus from '../components/ActiveRoundFocus';
import { useUnits } from '../utils/distanceUnits';
import { useLanguage } from '../i18n/LanguageContext';
import { buildWearablePayload, resolveTtsLocale, speakCaddieCallout } from '../utils/wearableAndAudioCaddie';
import { useAuth } from '../context/AuthContext';
import RoundWarmupModal from '../components/RoundWarmupModal';
import {
  TRIP_PROXIMITY_METERS,
  loadTripQueue,
  saveTripQueue,
  syncTripQueue,
  pullRemoteTrips,
  mergeTrips,
  nextQueuedTrip,
  closestQueuedTrip,
  formatTripLine,
  formatUpNext,
  formatPartners,
  formatTeeTime,
  createTrip,
  prefetchTripCourse,
  upcomingDateISO,
  METERS_PER_YARD,
} from '../utils/tripQueue';

const CUSTOM_COURSES_KEY = 'the-turn-custom-courses';
const SCORES_KEY = 'the-turn-scores-v2';
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

const SAT_ZOOM_LEVELS = [15, 16, 17];

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

function courseDistanceLabel(course, origin, formatDistance) {
  if (!origin) return '';
  const meters = haversineMeters(origin.lat, origin.lon, course?.lat, course?.lon);
  if (meters == null) return '';
  return formatDistance(meters / 0.9144);
}

function readPinnedCourse() {
  try {
    const raw = localStorage.getItem('the-turn-selected-course');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.id && parsed?.name) return parsed;
  } catch {
    // Ignore unreadable storage. The starter list still loads.
  }
  return null;
}

function scoreToParLabel(rel, logged) {
  if (!logged || !Number.isFinite(rel) || rel === 0) return 'E';
  return rel > 0 ? `+${rel}` : String(rel);
}

function rowsNotAlreadyShown(base, extra) {
  const shown = dedupeCourses(base);
  const shownIds = new Set(shown.map((course) => course.id));
  return dedupeCourses([...shown, ...extra]).filter((course) => !shownIds.has(course.id));
}

function CourseResultButton({ course, origin, formatDistance, onSelect }) {
  const place = placeLabel(course);
  const holes = displayHoleCount(course);
  const distance = courseDistanceLabel(course, origin, formatDistance);
  return (
    <button
      type="button"
      onClick={() => onSelect(course)}
      className="w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between gap-3 hover:bg-white/5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold truncate text-white">{course.name}</span>
        {place ? <span className="block text-[11px] truncate text-white/60">{place}</span> : null}
      </span>
      <span className="shrink-0 text-right">
        {distance ? <span className="block text-xs tabular-nums text-[#10B981]">{distance}</span> : null}
        {holes != null ? <span className="block text-[10px] tabular-nums text-white/50">{holes} holes</span> : null}
      </span>
    </button>
  );
}

export default function CourseLayout({ clubs = [], isPro = false, onOpenPaywall, onOpenWearable, onActiveHole, onOpenSocial, launchRequest, onLaunchConsumed }) {
  const { distanceUnit, formatDistance, formatSpeed } = useUnits();
  const { lang } = useLanguage();
  const { user } = useAuth();
  const [caddiePayload, setCaddiePayload] = useState(null);
  const caddieHoleArmed = useRef(false);
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

  const [pinnedCourse, setPinnedCourse] = useState(() => readPinnedCourse());
  const [courseId, setCourseId] = useState(() => {
    const pinned = readPinnedCourse();
    if (pinned?.id) return pinned.id;
    try {
      return localStorage.getItem('the-turn-home-course') || STARTER_COURSES[0].id;
    } catch {
      return STARTER_COURSES[0].id;
    }
  });
  const [holeIdx, setHoleIdx] = useState(0);
  const [teeId, setTeeId] = useState('blue');
  const [activePinType, setActivePinType] = useState('target');
  const [selectedClubId, setSelectedClubId] = useState(clubs[1]?.id || clubs[0]?.id || '1');
  const [courseSearch, setCourseSearch] = useState('');
  const [searchingCourses, setSearchingCourses] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nearbyCourses, setNearbyCourses] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [libraryCourses, setLibraryCourses] = useState(STARTER_COURSES);
  const [gpsOrigin, setGpsOrigin] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const searchAbortRef = useRef(null);
  const pickerRef = useRef(null);
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
  const [newCourseElev, setNewCourseElev] = useState('');
  const [newCourseLat, setNewCourseLat] = useState('');
  const [newCourseLon, setNewCourseLon] = useState('');
  const [newCourseHoles, setNewCourseHoles] = useState(18);
  const [newCoursePar, setNewCoursePar] = useState(72);

  const [holeNumber, setHoleNumber] = useState(1);
  const [holePar, setHolePar] = useState(4);
  const [holeYards, setHoleYards] = useState(395);
  const [holeBearing, setHoleBearing] = useState(135);
  const [bunkerStart, setBunkerStart] = useState(250);
  const [waterCarry, setWaterCarry] = useState('');
  const [greenSlope, setGreenSlope] = useState('Back-to-Front');
  const [holeNote, setHoleNote] = useState('');

  const [isRoundActive, setIsRoundActive] = useState(false);
  const [courseGeometry, setCourseGeometry] = useState(null);
  const [liveYards, setLiveYards] = useState(null);
  const [shotLog, setShotLog] = useState({});
  const [holeView, setHoleView] = useState('hole');
  const [strategyOpen, setStrategyOpen] = useState(false);
  const roundActionsRef = useRef(null);
  const consumedLaunchRef = useRef('');
  const [pinTarget, setPinTarget] = useState(null);
  const [trips, setTrips] = useState(() => loadTripQueue());
  const [tripDrawerOpen, setTripDrawerOpen] = useState(false);
  const [warmupOpen, setWarmupOpen] = useState(false);
  const [roundPartners, setRoundPartners] = useState('');
  const [proximity, setProximity] = useState(null);
  const [hiddenProximityIds, setHiddenProximityIds] = useState([]);
  const [tripDraft, setTripDraft] = useState({
    courseId: '',
    teeBox: 'blue',
    date: '',
    teeTime: '08:30',
    playingPartners: '',
    notes: '',
  });
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

  useEffect(() => {
    localStorage.setItem(CUSTOM_COURSES_KEY, JSON.stringify(customCourses));
  }, [customCourses]);

  const requestNearMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    setPickerOpen(true);
    setGpsStatus('Scanning GPS and nearby golf courses...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setGpsOrigin({ lat, lon });
        setNewCourseLat(Number(lat.toFixed(5)));
        setNewCourseLon(Number(lon.toFixed(5)));
        try {
          const live = await fetchCourseWeather(lat, lon);
          setWeather(live);
        } catch {
          // Keep the last weather sample if the forecast is unreachable.
        }
        try {
          const nearby = await fetchCoursesNear(lat, lon);
          setNearbyCourses(Array.isArray(nearby) ? nearby : []);
          setGpsStatus(
            nearby?.length
              ? `GPS locked. ${nearby.length} courses within about 30 miles.`
              : 'GPS locked. No indexed courses within 30 miles — add a custom course.'
          );
        } catch (err) {
          if (err?.name !== 'AbortError') {
            setGpsStatus('Nearby course lookup failed. Saved courses are still available.');
          }
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsStatus(`GPS unavailable: ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }, []);

  const openCustomCourse = useCallback(() => {
    setCreatorMode('course');
    setCreatorOpen(true);
    setPickerOpen(false);
    if (courseSearch.trim()) setNewCourseName(courseSearch.trim());
  }, [courseSearch]);

  useEffect(() => {
    let cancelled = false;
    loadOfflineCatalog().then((courses) => {
      if (!cancelled && Array.isArray(courses) && courses.length) setLibraryCourses(courses);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    requestNearMe();
  }, [requestNearMe]);

  useEffect(() => {
    const query = courseSearch.trim();
    if (query.length < 2) {
      searchAbortRef.current?.abort();
      setSearchResults([]);
      setSearchingCourses(false);
      return undefined;
    }
    setPickerOpen(true);
    const timer = setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearchingCourses(true);
      setGpsStatus(`Searching courses for "${query}"...`);
      const norm = normalizeCourseName(query);
      const offlinePool = dedupeCourses([...customCourses, ...libraryCourses, ...STARTER_COURSES]);
      const offline = norm
        ? offlinePool.filter((course) => `${normalizeCourseName(course?.name)}${normalizeCourseName(course?.city)}`.includes(norm))
        : [];
      searchGolfCourses(query, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) return;
          const list = dedupeCourses([...(Array.isArray(found) ? found : []), ...offline]);
          setSearchResults(list);
          if (found?.length) rememberGlobalCourses(found).catch(() => {});
          setGpsStatus(list.length ? `${list.length} courses match "${query}".` : `No indexed course for "${query}". Add a custom course.`);
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          setGpsStatus('Course lookup timed out. Saved courses still work offline.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingCourses(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      searchAbortRef.current?.abort();
    };
  }, [courseSearch, customCourses, libraryCourses]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onPointerDown = (event) => {
      if (!pickerRef.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

  useEffect(() => {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
  }, [scores]);

  useEffect(() => {
    localStorage.setItem(PINS_KEY, JSON.stringify(missPins));
  }, [missPins]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    pullRemoteTrips(user.id).then((remote) => {
      if (cancelled || !remote) return;
      setTrips((local) => {
        const merged = mergeTrips(local, remote);
        saveTripQueue(merged);
        return merged;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!trips.length || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setProximity(closestQueuedTrip(trips, pos.coords.latitude, pos.coords.longitude, TRIP_PROXIMITY_METERS));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [trips]);

  const recentRows = useMemo(
    () => dedupeCourses([...customCourses, ...libraryCourses]).filter(
      (course) => course?.source !== 'starter' && !STARTER_COURSES.some((starter) => starter.id === course.id)
    ),
    [customCourses, libraryCourses]
  );
  const nearRows = useMemo(
    () => sortByDistance(rowsNotAlreadyShown(recentRows, nearbyCourses), gpsOrigin?.lat, gpsOrigin?.lon),
    [recentRows, nearbyCourses, gpsOrigin]
  );
  const searchRows = useMemo(
    () => sortByDistance(rowsNotAlreadyShown([...recentRows, ...nearRows], searchResults), gpsOrigin?.lat, gpsOrigin?.lon),
    [recentRows, nearRows, searchResults, gpsOrigin]
  );
  const allCourses = useMemo(
    () => dedupeCourses([...recentRows, ...nearRows, ...searchRows]),
    [recentRows, nearRows, searchRows]
  );
  const activeCourse = useMemo(() => {
    const listed = allCourses.find((course) => course.id === courseId);
    if (pinnedCourse?.id && pinnedCourse.id === courseId) {
      return ensurePlayableHoles({
        ...(listed || {}),
        ...pinnedCourse,
        id: pinnedCourse.id,
        name: pinnedCourse.name || listed?.name,
        lat: pinnedCourse.lat ?? listed?.lat,
        lon: pinnedCourse.lon ?? listed?.lon,
        holes: pinnedCourse.holes?.length ? pinnedCourse.holes : listed?.holes,
      });
    }
    if (listed) return ensurePlayableHoles(listed);
    if (pinnedCourse?.id) return ensurePlayableHoles(pinnedCourse);
    const starter = STARTER_COURSES.find((course) => course.id === courseId);
    if (starter) return ensurePlayableHoles(starter);
    if (courseId) {
      return ensurePlayableHoles({ id: courseId, name: 'Saved course', source: 'saved' });
    }
    return ensurePlayableHoles(STARTER_COURSES[0]);
  }, [allCourses, courseId, pinnedCourse]);

  useEffect(() => {
    if (!activeCourse?.id) return;
    if (pinnedCourse?.id && activeCourse.id !== pinnedCourse.id) return;
    cacheSelectedCourse(activeCourse);
  }, [activeCourse, pinnedCourse]);

  useEffect(() => {
    const lat = Number(activeCourse?.lat);
    const lon = Number(activeCourse?.lon);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lon);
    if (!activeCourse?.publicId && !hasPoint) {
      setCourseGeometry(null);
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const apply = (geo) => {
      if (!cancelled) setCourseGeometry(geo);
    };
    const loadOsm = () => {
      if (!hasPoint) {
        apply(null);
        return Promise.resolve();
      }
      return loadPlayableGeometry(activeCourse, { signal: controller.signal }).then(apply);
    };
    const rememberPlace = (geo) => {
      const lat = Number(geo?.lat);
      const lon = Number(geo?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setPinnedCourse((prev) => {
        if (!prev || (prev.publicId !== geo.publicId && prev.id !== activeCourse.id)) return prev;
        if (Number(prev.lat) === lat && Number(prev.lon) === lon && prev.publicId === geo.publicId) return prev;
        const next = {
          ...prev,
          lat,
          lon,
          publicId: geo.publicId || prev.publicId,
          name: geo.courseName || prev.name,
        };
        try {
          localStorage.setItem('the-turn-selected-course', JSON.stringify(next));
          localStorage.setItem('the-turn-home-course', next.id);
        } catch {
          // The in-memory pin still keeps this club for the session.
        }
        return next;
      });
    };
    const load = activeCourse?.publicId
      ? hydrateGolfCourse(activeCourse, { signal: controller.signal })
        .then((geo) => {
          if (geo?.holes?.length) {
            apply(geo);
            rememberPlace(geo);
            return null;
          }
          return loadOsm();
        })
        .catch((error) => {
          if (error?.name === 'AbortError' || cancelled) return null;
          return loadOsm();
        })
      : loadOsm();
    Promise.resolve(load).catch((error) => {
      if (error?.name === 'AbortError' || cancelled) return;
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeCourse.id, activeCourse.publicId, activeCourse.lat, activeCourse.lon, activeCourse.holeCount, activeCourse.name]);

  const layoutHoles = useMemo(() => {
    const count = activeCourse.holeCount === 9 ? 9 : 18;
    const skeleton = buildSkeletonHoles(count, activeCourse.par);
    const cards = new Map((activeCourse.holes || []).map((hole) => [hole.number, hole]));
    const mapped = new Map((courseGeometry?.holes || []).map((hole) => [hole.number, hole]));
    const starter = activeCourse.source === 'starter';
    return skeleton.map((base) => {
      const card = cards.get(base.number);
      const geo = mapped.get(base.number);
      const handicap = card?.handicap ?? card?.hcp ?? card?.strokeIndex ?? geo?.handicap;
      const useGeoScore = !starter && geo && !geo.generated;
      return {
        ...base,
        ...(card || {}),
        number: base.number,
        par: useGeoScore && geo.par ? geo.par : (card?.par || geo?.par || base.par),
        yards: useGeoScore && geo.yards ? geo.yards : (card?.yards || geo?.yards || base.yards),
        bearingDeg: card?.bearingDeg || geo?.bearingDeg || base.bearingDeg,
        handicap: Number.isFinite(Number(handicap)) && Number(handicap) > 0 ? Number(handicap) : undefined,
        elevationDeltaFt: Number.isFinite(Number(geo?.elevationDeltaFt))
          ? Number(geo.elevationDeltaFt)
          : (Number.isFinite(Number(card?.elevationDeltaFt)) ? Number(card.elevationDeltaFt) : undefined),
        lat: geo?.tee?.lat,
        lon: geo?.tee?.lon,
      };
    });
  }, [activeCourse, courseGeometry]);

  const baseHole = layoutHoles[holeIdx] || layoutHoles[0] || {
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
    setHoleNumber((activeCourse.holes?.length || 0) + 1);
  }, [activeCourse]);

  const reloadLiveWeather = () => {
    const lat = Number(activeCourse.lat);
    const lon = Number(activeCourse.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    fetchCourseWeather(lat, lon)
      .then((live) => setWeather(live))
      .catch(() => {});
  };

  useEffect(() => {
    const lat = Number(activeCourse.lat);
    const lon = Number(activeCourse.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    let cancelled = false;
    fetchCourseWeather(lat, lon)
      .then((live) => {
        if (!cancelled) setWeather(live);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCourse.lat, activeCourse.lon]);

  const selectCourse = useCallback((course) => {
    if (!course?.id && !course?.name) return;
    const playable = ensurePlayableHoles({
      ...course,
      id: course.id || `course-${normalizeCourseName(course.name)}`,
    });
    setPinnedCourse(playable);
    setCourseId(playable.id);
    const savedCourse = {
      id: playable.id,
      osmId: playable.osmId,
      name: playable.name,
      city: playable.city || '',
      state: playable.state || '',
      lat: playable.lat,
      lon: playable.lon,
      publicId: playable.publicId,
      holeCount: playable.holeCount,
      par: playable.par,
      elevationFt: playable.elevationFt,
      source: playable.source,
      holes: playable.holes,
    };
    try {
      localStorage.setItem('the-turn-home-course', playable.id);
    } catch {
      // The in-memory pin still keeps this selection for the session.
    }
    try {
      localStorage.setItem('the-turn-selected-course', JSON.stringify(savedCourse));
    } catch {
      // Home id is enough to reopen this course when the full record is still in memory.
    }
    const isStarter = STARTER_COURSES.some((starter) => starter.id === playable.id);
    if (!isStarter) {
      setCustomCourses((prev) => [playable, ...prev.filter((item) => item.id !== playable.id)]);
    }
    setHoleIdx(0);
    setPickerOpen(false);
    rememberGlobalCourses([playable]).catch(() => {});
    const lat = Number(playable.lat);
    const lon = Number(playable.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && !Number.isFinite(Number(playable.elevationFt))) {
      fetchElevationFt(lat, lon).then((elevationFt) => {
        if (!Number.isFinite(elevationFt)) return;
        setCustomCourses((prev) => prev.map((item) => (item.id === playable.id ? { ...item, elevationFt } : item)));
        setLibraryCourses((prev) => prev.map((item) => (item.id === playable.id ? { ...item, elevationFt } : item)));
      }).catch(() => {});
    }
  }, []);

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

    const owned = customCourses.some((course) => course.id === activeCourse.id);
    if (!owned) {
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

    const holeCount = Number(newCourseHoles) === 9 ? 9 : 18;
    const coursePar = Number(newCoursePar) || (holeCount === 9 ? 36 : 72);
    const lat = Number(newCourseLat);
    const lon = Number(newCourseLon);
    const elevation = Number(newCourseElev);
    const holes = buildSkeletonHoles(holeCount, coursePar).map((hole, index) => (
      index === 0
        ? {
          ...hole,
          yards: yardsNum,
          bearingDeg: ((Number(holeBearing) % 360) + 360) % 360,
          bunkerStart: bunkerNum,
          bunkerEnd: bunkerNum ? bunkerNum + 22 : null,
          waterCarry: waterNum,
          greenSlope,
          note: holeNote.trim() || hole.note,
        }
        : hole
    ));

    const createdCourse = {
      id: `course-${Date.now()}`,
      name: newCourseName.trim(),
      city: newCourseCity.trim() || 'Custom Course',
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      elevationFt: Number.isFinite(elevation) ? elevation : undefined,
      holeCount,
      par: coursePar,
      source: 'custom',
      holes,
    };

    setCustomCourses((prev) => [createdCourse, ...prev]);
    setCourseId(createdCourse.id);
    setHoleIdx(0);
    rememberGlobalCourses([createdCourse]).catch(() => {});
    setNewCourseName('');
    setNewCourseCity('');
    setHoleNote('');
    setCreatorOpen(false);
    setGpsStatus(`${createdCourse.name} is ready. Tap Start Round.`);
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
      elevationFt: Number.isFinite(Number(activeCourse.elevationFt)) ? Number(activeCourse.elevationFt) : 0,
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
    const holeMeta = activeCourse.holes.find((h) => h.number === hNum) || { par: 4 };
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
      ttsLocale
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
      ttsLocale
    );
  };

  const commitTrips = (next) => {
    setTrips(next);
    syncTripQueue(next, user?.id).catch(() => {});
  };

  const startQueuedRound = (trip) => {
    if (!trip) return;
    const known = allCourses.find((course) => course.id === trip.courseId)
      || allCourses.find((course) => course.name === trip.courseName);
    const course = known || {
      id: trip.courseId || `trip-${trip.id}`,
      name: trip.courseName,
      lat: trip.lat,
      lon: trip.lon,
      holes: [],
    };
    selectCourse(course);
    if (TEE_BOXES.some((box) => box.id === trip.teeBox)) setTeeId(trip.teeBox);
    setRoundPartners(formatPartners(trip.playingPartners));
    setHoleIdx(0);
    setPinTarget(null);
    setTripDrawerOpen(false);
    setIsRoundActive(true);
  };

  const openTripDrawer = () => {
    setTripDraft((draft) => ({
      ...draft,
      courseId: draft.courseId || activeCourse?.id || '',
      teeBox: teeId,
      date: draft.date || upcomingDateISO(1),
    }));
    setTripDrawerOpen(true);
  };

  const queueTrip = (event) => {
    event.preventDefault();
    const course = allCourses.find((item) => item.id === tripDraft.courseId) || activeCourse;
    if (!course?.name || !tripDraft.date || !tripDraft.teeTime) return;
    const trip = createTrip({
      courseId: course.id,
      courseName: course.name,
      lat: course.lat,
      lon: course.lon,
      teeBox: tripDraft.teeBox || teeId,
      date: tripDraft.date,
      teeTime: tripDraft.teeTime,
      playingPartners: tripDraft.playingPartners,
      notes: tripDraft.notes,
    });
    commitTrips([...trips, trip]);
    prefetchTripCourse(trip).catch(() => {});
    setTripDraft((draft) => ({ ...draft, notes: '' }));
  };

  const removeQueuedTrip = (id) => {
    commitTrips(trips.filter((trip) => trip.id !== id));
  };

  useEffect(() => {
    const token = launchRequest?.token;
    if (!token || consumedLaunchRef.current === token) return;
    consumedLaunchRef.current = token;
    const name = String(launchRequest.courseName || '').trim();
    if (name) {
      const known = [...allCourses, ...libraryCourses, ...STARTER_COURSES].find(
        (course) => String(course?.name || '').toLowerCase() === name.toLowerCase()
      );
      if (known) {
        selectCourse(known);
      } else {
        selectCourse({
          id: launchRequest.courseId || `lobby-${launchRequest.lobbyId || token}`,
          name,
          lat: launchRequest.lat,
          lon: launchRequest.lon,
          holes: Array.isArray(launchRequest.holes) ? launchRequest.holes : [],
        });
      }
    }
    const partnerLine = formatPartners(launchRequest.partners);
    const teeLine = formatTeeTime(launchRequest.teeTime);
    setRoundPartners([partnerLine, teeLine].filter(Boolean).join(' · '));
    setPinTarget(null);
    setTripDrawerOpen(false);
    setIsRoundActive(true);
    onLaunchConsumed?.();
  }, [launchRequest, allCourses, libraryCourses, selectCourse, onLaunchConsumed]);

  if (isRoundActive) {
    const shotKey = `${activeCourse.id}:${activeHole.number}`;
    const loggedPutts = rawEntry && typeof rawEntry === 'object' && Number.isFinite(Number(rawEntry.putts))
      ? Number(rawEntry.putts)
      : 0;
    const swingCount = (shotLog[shotKey] || []).length;
    const livePin = Number.isFinite(Number(liveYards?.pinYards)) ? Number(liveYards.pinYards) : null;
    return (
      <ActiveRoundFocus
        holeNumber={activeHole.number}
        holeCount={layoutHoles.length === 9 ? 9 : 18}
        onSelectHole={(number) => {
          const idx = layoutHoles.findIndex((hole) => hole.number === number);
          if (idx >= 0) setHoleIdx(idx);
        }}
        par={activeHole.par}
        holeYards={activeHole.yards}
        handicap={activeHole.handicap}
        scoreLabel={scoreToParLabel(relPar, holesLogged)}
        onEndRound={() => {
          setPinTarget(null);
          setHoleView('hole');
          setStrategyOpen(false);
          setIsRoundActive(false);
        }}
        centerYards={Number.isFinite(Number(liveYards?.centerYards)) ? Number(liveYards.centerYards) : activeHole.yards}
        frontYards={Number.isFinite(Number(liveYards?.frontYards)) ? Number(liveYards.frontYards) : frontYards}
        backYards={Number.isFinite(Number(liveYards?.backYards)) ? Number(liveYards.backYards) : backYards}
        pinYards={livePin}
        windSpeedMph={weather?.windSpeedMph}
        windDirDeg={weather?.windDirDeg}
        holeBearingDeg={Number.isFinite(Number(liveYards?.bearingDeg)) ? Number(liveYards.bearingDeg) : activeHole.bearingDeg}
        clubs={clubs}
        suggestion={activeHole.note || aimAdvice}
        crewLabel={roundPartners}
        shots={swingCount}
        putts={loggedPutts}
        onChangePutts={(delta) => {
          const putts = Math.max(0, loggedPutts + delta);
          updateHoleStat({ putts, strokes: Math.max(putts, swingCount + putts) });
        }}
        onMarkShot={() => roundActionsRef.current?.markShot?.()}
        onSetPin={() => roundActionsRef.current?.setPin?.()}
        elevationDeltaFt={activeHole.elevationDeltaFt}
        onViewChange={setHoleView}
        onStrategyChange={setStrategyOpen}
      >
        <SatelliteHoleMap
          fill
          isRoundActive
          courseId={activeCourse.id}
          geometry={courseGeometry}
          viewMode={holeView}
          showDispersion={strategyOpen}
          initialShots={shotLog[shotKey]}
          bearingDeg={activeHole.bearingDeg}
          courseName={activeCourse.name}
          center={{ lat: activeCourse.lat, lon: activeCourse.lon }}
          hole={{
            number: activeHole.number,
            par: activeHole.par,
            bearingDeg: activeHole.bearingDeg,
            yards: activeHole.yards,
            lat: activeHole.lat,
            lon: activeHole.lon,
            handicap: activeHole.handicap,
          }}
          clubs={clubs}
          origin={shotStartGps ? { lat: shotStartGps.lat, lon: shotStartGps.lon } : undefined}
          onPinChange={setPinTarget}
          onYardage={setLiveYards}
          onRegister={(api) => { roundActionsRef.current = api; }}
          onShotsChange={(shots) => {
            setShotLog((prev) => ({ ...prev, [shotKey]: shots }));
            if (!shots?.length) return;
            updateHoleStat({ strokes: shots.length + loggedPutts, putts: loggedPutts });
          }}
          onHolePoint={(number, which, point) => {
            setCourseGeometry((prev) => {
              if (!prev) return prev;
              const next = placeHolePoint(prev, number, which, point);
              savePlacedGeometry(next).catch(() => {});
              return next;
            });
          }}
        />
      </ActiveRoundFocus>
    );
  }

  const upNext = nextQueuedTrip(trips);
  const showProximity = Boolean(proximity?.trip) && !hiddenProximityIds.includes(proximity.trip.id);

  return (
    <div className="space-y-4 pb-[max(6rem,env(safe-area-inset-bottom))]">
      {showProximity ? (
        <div className="rounded-3xl border p-4 space-y-3" style={{ backgroundColor: '#0B0D0C', borderColor: '#D4AF37', color: '#F8F7F4' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>Queued course nearby</div>
          <p className="text-sm">
            {proximity.trip.courseName} is <span className="tabular-nums">{formatDistance(proximity.meters / METERS_PER_YARD)}</span> away. Start this round?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startQueuedRound(proximity.trip)}
              className="min-h-[44px] flex-1 rounded-2xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#10B981' }}
            >
              Start Round Now
            </button>
            <button
              type="button"
              onClick={() => setHiddenProximityIds((ids) => [...ids, proximity.trip.id])}
              className="min-h-[44px] rounded-2xl border px-4 text-sm font-semibold"
              style={{ borderColor: '#D4AF37', color: '#D4AF37' }}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}
      {upNext ? (
        <div className="rounded-3xl border p-4 space-y-3" style={{ backgroundColor: '#0B0D0C', borderColor: '#D4AF37', color: '#F8F7F4' }}>
          <div className="text-base font-semibold">{formatUpNext(upNext)}</div>
          <button
            type="button"
            onClick={() => startQueuedRound(upNext)}
            className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#10B981' }}
          >
            Start Round Now
          </button>
        </div>
      ) : null}
      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setRoundPartners('');
              setPinTarget(null);
              if (activeCourse?.id === 'dos-lagos' || /dos\s*lagos/i.test(activeCourse?.name || '')) {
                setHoleIdx(0);
              }
              setIsRoundActive(true);
            }}
            className="min-h-[44px] flex-1 rounded-2xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            Start Round
          </button>
          <button
            type="button"
            onClick={() => setWarmupOpen(true)}
            className="min-h-[44px] rounded-full px-4 text-sm font-semibold"
            style={{ color: '#D4AF37', border: '1px solid #D4AF37', backgroundColor: '#0B0D0C' }}
          >
            Round Warm-Up
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openTripDrawer}
            className="min-h-[44px] rounded-3xl border px-3 text-sm font-semibold"
            style={{ color: '#D4AF37', borderColor: '#D4AF37', backgroundColor: 'transparent' }}
          >
            Plan Trip / Queue Round
          </button>
          <button
            type="button"
            onClick={() => onOpenSocial?.()}
            className="min-h-[44px] rounded-3xl border px-3 text-left text-sm font-semibold"
            style={{ color: '#F8F7F4', borderColor: '#D4AF37', backgroundColor: '#0B0D0C' }}
          >
            Find Playing Partners / Match Foursome
          </button>
        </div>
        <div ref={pickerRef} className="relative space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#10B981]" />
              <input
                type="text"
                placeholder="Search any public, private, resort, or municipal course"
                value={courseSearch}
                onChange={(e) => {
                  setCourseSearch(e.target.value);
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                className="w-full min-h-[44px] rounded-2xl pl-9 pr-3 text-sm border border-[#10B981]/60 bg-[#0B0D0C] text-white placeholder:text-white/40"
              />
            </div>
            <button
              type="button"
              onClick={requestNearMe}
              disabled={gpsLoading}
              className="min-h-[44px] px-3 rounded-2xl text-xs font-semibold text-[#0B0D0C] flex items-center gap-1 shrink-0 bg-[#10B981]"
            >
              {gpsLoading ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
              Near Me
            </button>
            <button
              type="button"
              onClick={() => setSimOpen(!simOpen)}
              className="min-h-[44px] text-[11px] font-mono px-2.5 rounded-2xl border flex items-center gap-1 shrink-0"
              style={{ borderColor: 'var(--border-subtle)', color: weather.isLive ? 'var(--accent-emerald)' : 'var(--text-secondary)' }}
            >
              <SlidersHorizontal size={11} /> {weather.isLive ? 'LIVE WX' : 'WHAT-IF'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="w-full min-h-[44px] rounded-2xl px-3 py-2 text-left border border-[#10B981] bg-[#0B0D0C]/90 backdrop-blur-md"
          >
            <span className="block text-sm font-bold text-white truncate">{activeCourse.name}</span>
            <span className="block text-[11px] text-white/60 truncate tabular-nums">
              {[placeLabel(activeCourse), courseDistanceLabel(activeCourse, gpsOrigin, formatDistance)].filter(Boolean).join(' · ') || 'Choose a course'}
            </span>
          </button>

          {pickerOpen && (
            <div className="rounded-2xl border border-[#10B981]/70 bg-[#0B0D0C]/95 backdrop-blur-md shadow-xl overflow-hidden">
              <button
                type="button"
                onClick={openCustomCourse}
                className="w-full min-h-[44px] px-3 text-left text-sm font-semibold text-[#10B981] flex items-center gap-2 border-b border-white/10"
              >
                <Plus size={14} /> Add Custom Course
              </button>
              <div className="max-h-80 overflow-y-auto">
                {[
                  ['Search Results', searchRows],
                  ['Recent & Saved', recentRows],
                  ['Near Your Location', nearRows],
                  ['Offline starters', STARTER_COURSES],
                ].map(([label, rows]) => (
                  <div key={label}>
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#10B981]">{label}</div>
                    {rows.length === 0 ? (
                      <div className="px-3 pb-2 text-[11px] text-white/45">
                        {label === 'Near Your Location'
                          ? (gpsLoading ? 'Looking up courses around you...' : 'Tap Near Me to load every course within about 30 miles.')
                          : label === 'Search Results'
                            ? (searchingCourses ? 'Searching public, private, resort, and municipal courses...' : 'Type at least two letters to search worldwide.')
                            : label === 'Offline starters'
                              ? 'Dos Lagos, Yucaipa, Oak Valley, and Glen Ivy stay available offline.'
                              : 'Courses you pick stay on this device.'}
                      </div>
                    ) : rows.map((course, idx) => (
                      <CourseResultButton
                        key={`${label}-${course.osmId || course.id || 'course'}-${idx}`}
                        course={course}
                        origin={gpsOrigin}
                        formatDistance={formatDistance}
                        onSelect={selectCourse}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
          {layoutHoles.map((h, idx) => (
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
                onClick={() => setCreatorOpen(false)}
                className="min-h-[44px] min-w-[44px] rounded text-[11px] font-semibold flex items-center justify-center"
                aria-label="Close course builder"
              >
                <X size={14} />
              </button>
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
            <div className="space-y-2">
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Holes</label>
                  <select
                    value={newCourseHoles}
                    onChange={(e) => {
                      const count = Number(e.target.value) === 9 ? 9 : 18;
                      setNewCourseHoles(count);
                      setNewCoursePar(count === 9 ? 36 : 72);
                    }}
                    className="w-full min-h-[44px] rounded-xl px-2.5 text-xs font-mono border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <option value={18}>18 holes</option>
                    <option value={9}>9 holes</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] block mb-0.5" style={{ color: 'var(--text-secondary)' }}>Course par</label>
                  <input
                    type="number"
                    min="27"
                    max="90"
                    value={newCoursePar}
                    onChange={(e) => setNewCoursePar(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl px-2.5 text-xs font-mono border"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={requestNearMe}
                  className="min-h-[44px] flex-1 rounded-xl text-xs font-semibold text-[#0B0D0C] bg-[#10B981]"
                >
                  Use GPS pin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const lat = Number(gpsOrigin?.lat ?? activeCourse.lat);
                    const lon = Number(gpsOrigin?.lon ?? activeCourse.lon);
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                      setGpsStatus('Tap the satellite map to drop a course pin.');
                      return;
                    }
                    setNewCourseLat(Number(lat.toFixed(5)));
                    setNewCourseLon(Number(lon.toFixed(5)));
                    setGpsStatus('Map center copied. Tap the satellite map to move the pin.');
                  }}
                  className="min-h-[44px] flex-1 rounded-xl text-xs font-semibold border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  Use map center
                </button>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Tap the satellite map to drop the course pin, then start playing.
              </p>
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
            courseId={activeCourse.id}
            geometry={courseGeometry}
            courseName={activeCourse.name}
            center={{ lat: activeCourse.lat, lon: activeCourse.lon }}
            hole={{
              number: activeHole.number,
              par: activeHole.par,
              yards: activeHole.yards,
              bearingDeg: activeHole.bearingDeg,
              lat: activeHole.lat,
              lon: activeHole.lon,
            }}
            clubs={clubs}
            origin={shotStartGps ? { lat: shotStartGps.lat, lon: shotStartGps.lon } : undefined}
            onPinChange={creatorOpen && creatorMode === 'course' ? (pin) => {
              const lat = Number(pin?.lat);
              const lon = Number(pin?.lon);
              if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
              setNewCourseLat(Number(lat.toFixed(5)));
              setNewCourseLon(Number(lon.toFixed(5)));
              setGpsStatus('Course pin dropped on the map.');
            } : undefined}
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
                {showRealSat ? `SAT ${satZoom}x` : 'VEC'} • {Number.isFinite(Number(activeCourse.elevationFt)) ? `${activeCourse.elevationFt}ft` : 'elev —'}
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
                  if (!isPro && club.id !== clubs[0]?.id && club.id !== bestClub?.id) {
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
      <TripQueueDrawer
        open={tripDrawerOpen}
        onClose={() => setTripDrawerOpen(false)}
        courses={allCourses}
        draft={tripDraft}
        setDraft={setTripDraft}
        trips={trips}
        onQueue={queueTrip}
        onRemove={removeQueuedTrip}
      />
      <RoundWarmupModal open={warmupOpen} onClose={() => setWarmupOpen(false)} clubs={clubs} />
    </div>
  );
}

function firHitCountLabel(hits, eligible) {
  return `${hits}/${eligible}`;
}

function TripQueueDrawer({ open, onClose, courses, draft, setDraft, trips, onQueue, onRemove }) {
  if (!open) return null;
  const fieldStyle = { backgroundColor: '#141816', borderColor: 'rgba(255,255,255,0.14)', color: '#F8F7F4' };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(11, 13, 12, 0.72)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plan Trip / Queue Round"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border p-4"
        style={{
          backgroundColor: '#0B0D0C',
          borderColor: 'rgba(212, 175, 55, 0.55)',
          color: '#F8F7F4',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>Golf trip</div>
            <h2 className="text-lg font-semibold">Plan Trip / Queue Round</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trip planner"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border"
            style={{ borderColor: 'rgba(255,255,255,0.16)' }}
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={onQueue} className="space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
            Course
            <select
              value={draft.courseId}
              onChange={(event) => setDraft((prev) => ({ ...prev, courseId: event.target.value }))}
              className="mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm"
              style={fieldStyle}
            >
              {(courses || []).map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
            Tee box
            <select
              value={draft.teeBox}
              onChange={(event) => setDraft((prev) => ({ ...prev, teeBox: event.target.value }))}
              className="mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm"
              style={fieldStyle}
            >
              {TEE_BOXES.map((tee) => (
                <option key={tee.id} value={tee.id}>{tee.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
              Date
              <input
                type="date"
                required
                value={draft.date}
                onChange={(event) => setDraft((prev) => ({ ...prev, date: event.target.value }))}
                className="mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm tabular-nums"
                style={fieldStyle}
              />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
              Tee time
              <input
                type="time"
                required
                value={draft.teeTime}
                onChange={(event) => setDraft((prev) => ({ ...prev, teeTime: event.target.value }))}
                className="mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm tabular-nums"
                style={fieldStyle}
              />
            </label>
          </div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
            Playing partners
            <input
              type="text"
              value={draft.playingPartners}
              onChange={(event) => setDraft((prev) => ({ ...prev, playingPartners: event.target.value }))}
              placeholder="Jason, Rylie, Ryan"
              className="mt-1 w-full min-h-[44px] rounded-xl border px-3 text-sm"
              style={fieldStyle}
            />
          </label>
          <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>
            Notes
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              style={fieldStyle}
            />
          </label>
          <button
            type="submit"
            className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#10B981' }}
          >
            Queue Round
          </button>
          <p className="text-[11px]" style={{ color: '#D1D5DB' }}>
            Hole shapes and satellite tiles save in the background. A failed download still keeps the trip.
          </p>
        </form>
        <div className="mt-4 space-y-2">
          {(trips || []).length === 0 ? (
            <p className="text-sm" style={{ color: '#D1D5DB' }}>No rounds queued.</p>
          ) : trips.map((trip) => (
            <div key={trip.id} className="flex items-center gap-2 rounded-3xl border px-3 py-2" style={{ borderColor: 'rgba(212, 175, 55, 0.45)' }}>
              <div className="min-w-0 flex-1 text-sm">{formatTripLine(trip)}</div>
              <button
                type="button"
                onClick={() => onRemove(trip.id)}
                className="min-h-[44px] shrink-0 rounded-xl px-3 text-xs font-semibold"
                style={{ color: '#D4AF37' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}