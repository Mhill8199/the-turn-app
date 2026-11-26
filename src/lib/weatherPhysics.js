import {
  rememberGlobalCourses,
  STARTER_COURSES,
  searchNearbyGolfCourses as searchCatalogCourses,
  readCachedCourses as readGlobalCachedCourses,
} from '../utils/globalCourseCatalog';

/** Offline starter courses. Live search merges with this list and is not capped by it. */
export const COURSE_PRESETS = STARTER_COURSES;

export { searchCatalogCourses as searchNearbyGolfCourses, readGlobalCachedCourses as readCachedCourses };

export async function fetchElevationFt(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    if (!res.ok) return 800;
    const data = await res.json();
    const meters = Array.isArray(data.elevation) ? data.elevation[0] : data.elevation;
    return typeof meters === 'number' ? Math.round(meters * 3.28084) : 800;
  } catch {
    return 800;
  }
}

const COURSE_CACHE_DB = 'the-turn-course-cache';
const COURSE_CACHE_STORE = 'courses';
const SAVED_COURSES_KEY = 'directory|saved-courses';

function openCourseDirectoryDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(COURSE_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COURSE_CACHE_STORE)) {
        db.createObjectStore(COURSE_CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function readDirectoryRecord(key) {
  try {
    const db = await openCourseDirectoryDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(COURSE_CACHE_STORE, 'readonly');
      const req = tx.objectStore(COURSE_CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeDirectoryRecord(record) {
  try {
    const db = await openCourseDirectoryDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(COURSE_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(COURSE_CACHE_STORE);
      const req = store.keyPath ? store.put(record) : store.put(record, record.key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || tx.error);
    });
  } catch {
    // Offline cache is best-effort; a failed write must not block search.
  }
}

async function rememberCourses(courses) {
  const list = (courses || []).filter((course) => course && course.id);
  if (!list.length) return;
  const existing = await readDirectoryRecord(SAVED_COURSES_KEY);
  const byId = new Map((existing?.courses || []).map((course) => [course.id, course]));
  for (const course of list) {
    byId.set(course.id, course);
    await writeDirectoryRecord({ key: `selected|${course.id}`, course, savedAt: Date.now() });
  }
  await writeDirectoryRecord({
    key: SAVED_COURSES_KEY,
    courses: [...byId.values()],
    savedAt: Date.now(),
  });
}

/** Persist the course the golfer opened so it still loads with the network off. */
export async function cacheSelectedCourse(course) {
  if (!course?.id) return;
  await rememberCourses([course]);
  await rememberGlobalCourses([course]);
}

export async function fetchCourseWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  const c = data.current;
  return {
    tempF: Math.round(c.temperature_2m),
    dewPointF: Math.round(c.dew_point_2m),
    humidity: Math.round(c.relative_humidity_2m),
    windSpeedMph: Math.round(c.wind_speed_10m),
    windGustMph: Math.round(c.wind_gusts_10m),
    windDirDeg: Math.round(c.wind_direction_10m),
    isLive: true,
  };
}

export function degreesToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export function calculateShotPhysics({ stockCarry, stockTotal, windSpeedMph, windDirDeg, holeBearingDeg, tempF, dewPointF, elevationFt }) {
  const relRad = ((windDirDeg - holeBearingDeg) * Math.PI) / 180;
  const headwindComponent = Math.cos(relRad) * windSpeedMph;
  const crosswindComponent = Math.sin(relRad) * windSpeedMph;

  const windFactor = headwindComponent >= 0
    ? 1 - headwindComponent * 0.01
    : 1 + Math.abs(headwindComponent) * 0.0055;

  const tempFactor = 1 + ((tempF - 70) / 20) * 0.015;
  const elevationFactor = 1 + (elevationFt / 1000) * 0.015;

  const effectiveCarry = Math.round(stockCarry * windFactor * tempFactor * elevationFactor);

  const dewSpread = tempF - dewPointF;
  const baseRollout = Math.max(0, (stockTotal || stockCarry) - stockCarry);
  const turfMultiplier = dewSpread <= 4 ? 0.55 : dewSpread <= 10 ? 0.85 : 1.15;
  const effectiveTotal = Math.round(effectiveCarry + baseRollout * turfMultiplier);

  const turfCondition = dewSpread <= 4
    ? 'Heavy Dew / Soft (Low Roll)'
    : dewSpread <= 10
    ? 'Balanced Turf'
    : 'Dry & Firm (Extra Roll)';

  return {
    effectiveCarry,
    effectiveTotal,
    headwindMph: Math.round(headwindComponent),
    crosswindMph: Math.round(crosswindComponent),
    turfCondition,
    dewSpread,
  };
}