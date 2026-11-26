export const COURSE_PRESETS = [
  {
    id: 'dos-lagos',
    name: 'Dos Lagos Golf Club',
    city: 'Corona, CA',
    lat: 33.8139,
    lon: -117.5156,
    elevationFt: 740,
    holes: [
      { number: 1, par: 4, yards: 388, bearingDeg: 145, bunkerStart: 245, bunkerEnd: 268, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Favor left-center; right bunker gathers anything leaking right.' },
      { number: 2, par: 5, yards: 518, bearingDeg: 210, bunkerStart: 275, bunkerEnd: 295, waterCarry: 185, greenSlope: 'Two-Tier Back', note: 'Lay up to 95-105 yds short of the creek unless tailwind is 10+ mph.' },
      { number: 3, par: 3, yards: 164, bearingDeg: 310, bunkerStart: 148, bunkerEnd: 156, waterCarry: null, greenSlope: 'Slopes Left', note: 'Plays half a club longer into the afternoon canyon breeze.' },
      { number: 4, par: 4, yards: 392, bearingDeg: 95, bunkerStart: 252, bunkerEnd: 278, waterCarry: null, greenSlope: 'Firm & Fast', note: '3-Wood or hybrid off the tee takes the 252y right bunker out of play.' },
      { number: 5, par: 4, yards: 424, bearingDeg: 180, bunkerStart: 260, bunkerEnd: 285, waterCarry: null, greenSlope: 'Elevated Front', note: 'Take one extra club to reach the upper shelf.' },
    ],
  },
  {
    id: 'oak-valley',
    name: 'Oak Valley Golf Club',
    city: 'Beaumont, CA',
    lat: 33.9384,
    lon: -117.0186,
    elevationFt: 2610,
    holes: [
      { number: 1, par: 4, yards: 405, bearingDeg: 110, bunkerStart: 255, bunkerEnd: 275, waterCarry: null, greenSlope: 'Fast Front-to-Back', note: '2,600 ft elevation adds ~4% carry. Keep approach below the hole.' },
      { number: 2, par: 4, yards: 376, bearingDeg: 265, bunkerStart: 235, bunkerEnd: 255, waterCarry: null, greenSlope: 'Ridge Center', note: 'Downwind afternoon tee shot runs out fast.' },
      { number: 3, par: 3, yards: 182, bearingDeg: 20, bunkerStart: 165, bunkerEnd: 174, waterCarry: null, greenSlope: 'Deep Green', note: 'Check wind gusts over the ridge before pulling a club.' },
    ],
  },
  {
    id: 'glen-ivy',
    name: 'Glen Ivy Golf Club',
    city: 'Corona, CA',
    lat: 33.7512,
    lon: -117.4925,
    elevationFt: 1180,
    holes: [
      { number: 1, par: 4, yards: 368, bearingDeg: 160, bunkerStart: 240, bunkerEnd: 260, waterCarry: null, greenSlope: 'Gentle Tilt', note: 'Position drive at 235-245y for a flat wedge angle.' },
      { number: 2, par: 3, yards: 152, bearingDeg: 240, bunkerStart: 138, bunkerEnd: 146, waterCarry: null, greenSlope: 'Front Bunker', note: 'Do not miss short right.' },
    ],
  },
  {
    id: 'yucaipa-valley',
    name: 'Yucaipa Valley Golf Club',
    city: 'Yucaipa, CA',
    lat: 34.0175,
    lon: -117.0431,
    elevationFt: 2480,
    holes: [
      { number: 1, par: 4, yards: 382, bearingDeg: 195, bunkerStart: 235, bunkerEnd: 255, waterCarry: null, greenSlope: 'Back-to-Front', note: '2,480 ft elevation gives ~3.5% extra carry off the first tee.' },
      { number: 2, par: 3, yards: 158, bearingDeg: 120, bunkerStart: 142, bunkerEnd: 150, waterCarry: null, greenSlope: 'Slopes Left', note: 'Stay below the pin on the back-left shelf.' },
    ],
  },
];

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

/** Course catalog. Satellite geometries stay in the-turn-course-cache and are not touched here. */
const COURSE_CATALOG_DB = 'the-turn-courses-cache';
const COURSE_CATALOG_STORE = 'catalog';
const COURSE_CATALOG_KEY = 'the-turn-courses-cache';
const CATALOG_LIMIT = 80;
const NEARBY_RADIUS_M = 40000;
const OSM_HEADERS = { Accept: 'application/json' };

function defaultPlayableHoles() {
  return [
    { number: 1, par: 4, yards: 392, bearingDeg: 145, bunkerStart: 245, bunkerEnd: 268, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Live weather, dew point & wind active - customize hole specs with +.' },
    { number: 2, par: 3, yards: 165, bearingDeg: 220, bunkerStart: 148, bunkerEnd: 156, waterCarry: null, greenSlope: 'Firm & Fast', note: 'Check wind vector and dew point rollout before pulling a club.' },
  ];
}

/** osmId when present, otherwise name + rounded coordinates. Missing lat/lng never throw. */
export function courseDedupeKey(course) {
  if (!course || typeof course !== 'object') return 'invalid';
  const osmId = course.osmId;
  if (osmId != null && String(osmId).trim() !== '') return String(osmId).trim();
  const name = String(course.name || '').toLowerCase().trim();
  const lat = Number(course.lat);
  const lng = Number(course.lng ?? course.lon);
  const latPart = Number.isFinite(lat) ? lat.toFixed(3) : 'na';
  const lngPart = Number.isFinite(lng) ? lng.toFixed(3) : 'na';
  return `${name}_${latPart}_${lngPart}`;
}

export function dedupeCourses(courses) {
  const seen = new Set();
  const unique = [];
  for (const course of courses || []) {
    if (!course || typeof course !== 'object') continue;
    const key = courseDedupeKey(course);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(course);
  }
  return unique;
}

export function courseMatchesQuery(course, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return `${course?.name || ''} ${course?.city || ''}`.toLowerCase().includes(q);
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const aLat = Number(lat1);
  const aLon = Number(lon1);
  const bLat = Number(lat2);
  const bLon = Number(lon2);
  if (![aLat, aLon, bLat, bLon].every(Number.isFinite)) return NaN;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function sortCoursesByDistance(courses, lat, lon) {
  const originLat = Number(lat);
  const originLon = Number(lon);
  return [...(courses || [])]
    .map((course, index) => ({
      course,
      index,
      meters: haversineMeters(originLat, originLon, course?.lat, course?.lng ?? course?.lon),
    }))
    .sort((a, b) => {
      const aOk = Number.isFinite(a.meters);
      const bOk = Number.isFinite(b.meters);
      if (aOk && bOk && a.meters !== b.meters) return a.meters - b.meters;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return a.index - b.index;
    })
    .map((row) => row.course);
}

function readLocalCatalog() {
  try {
    const raw = localStorage.getItem(COURSE_CATALOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.courses;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function readCoursesCacheSync() {
  return dedupeCourses(readLocalCatalog());
}

function openCourseCatalogDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(COURSE_CATALOG_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COURSE_CATALOG_STORE)) {
        db.createObjectStore(COURSE_CATALOG_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function readIdbCatalog() {
  try {
    const db = await openCourseCatalogDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(COURSE_CATALOG_STORE, 'readonly');
      const req = tx.objectStore(COURSE_CATALOG_STORE).get(COURSE_CATALOG_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return Array.isArray(record?.courses) ? record.courses : [];
  } catch {
    return [];
  }
}

async function persistCatalog(courses) {
  const list = dedupeCourses(courses).slice(0, CATALOG_LIMIT);
  const record = { key: COURSE_CATALOG_KEY, courses: list, savedAt: Date.now() };
  try {
    localStorage.setItem(COURSE_CATALOG_KEY, JSON.stringify({ courses: list, savedAt: record.savedAt }));
  } catch {
    // Quota or private mode: IndexedDB still holds the catalog.
  }
  try {
    const db = await openCourseCatalogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(COURSE_CATALOG_STORE, 'readwrite');
      const store = tx.objectStore(COURSE_CATALOG_STORE);
      const req = store.keyPath ? store.put(record) : store.put(record, record.key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || tx.error);
    });
    db.close();
  } catch {
    // Offline cache is best-effort; a failed write must not block search.
  }
  return list;
}

async function mergeIntoCatalog(courses) {
  const incoming = (courses || []).filter((course) => course && course.id);
  if (!incoming.length) return readCachedCourses();
  const existing = await readCachedCourses();
  return persistCatalog(dedupeCourses([...incoming, ...existing]));
}

/** Persist the course the golfer opened so it still loads with the network off. */
export async function cacheSelectedCourse(course) {
  if (!course?.id) return;
  await mergeIntoCatalog([course]);
}

/** Courses previously saved in the-turn-courses-cache catalog. */
export async function readCachedCourses() {
  const [localCourses, idbCourses] = await Promise.all([
    Promise.resolve(readLocalCatalog()),
    readIdbCatalog(),
  ]);
  return dedupeCourses([...localCourses, ...idbCourses]).slice(0, CATALOG_LIMIT);
}

function cityStateFromTags(tags = {}) {
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:suburb'] || tags['addr:hamlet'] || '';
  const state = tags['addr:state'] || tags['is_in:state'] || '';
  return [city, state].filter(Boolean).join(', ');
}

function cityStateFromDisplay(displayName) {
  const parts = String(displayName || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return parts[1] || '';
  const body = parts.slice(1, -1).filter((part) => !/^\d/.test(part));
  const state = body[body.length - 1] || '';
  let city = body[body.length - 2] || '';
  if (/county/i.test(city) && body.length >= 3) city = body[body.length - 3];
  if (city && state && city !== state) return `${city}, ${state}`;
  return city || state;
}

function courseFromOverpassElement(el) {
  const tags = el?.tags || {};
  const name = String(tags.name || tags['name:en'] || '').trim();
  const lat = Number(el?.center?.lat ?? el?.lat);
  const lon = Number(el?.center?.lon ?? el?.lon);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const osmType = el.type || 'way';
  const osmId = el.id != null ? `${osmType}/${el.id}` : '';
  return {
    id: osmId ? `osm-${osmType}-${el.id}` : `osm-${name}-${lat.toFixed(4)}`,
    osmId: osmId || undefined,
    name,
    city: cityStateFromTags(tags),
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    elevationFt: null,
    holes: defaultPlayableHoles(),
  };
}

function courseFromNominatim(item) {
  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const display = String(item.display_name || '');
  const skipClass = item.class === 'boundary' || item.class === 'highway' || item.class === 'place';
  if (skipClass && !/golf|links|country club/i.test(display)) return null;
  const name = display.split(',')[0]?.trim() || 'Golf course';
  const osmType = item.osm_type || 'node';
  const osmId = item.osm_id != null ? `${osmType}/${item.osm_id}` : '';
  return {
    id: osmId ? `osm-${osmType}-${item.osm_id}` : `nominatim-${item.place_id || name}`,
    osmId: osmId || undefined,
    name,
    city: cityStateFromDisplay(display),
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    elevationFt: null,
    holes: defaultPlayableHoles(),
  };
}

function nominatimSearchUrl(query) {
  return `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(String(query).trim())}+golf+course&format=json&limit=15`;
}

async function queryOverpassCourses(lat, lon, { signal, modest = false } = {}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return [];
  const query = modest
    ? `[out:json][timeout:12];(way["leisure"="golf_course"](around:12000,${la},${lo});relation["leisure"="golf_course"](around:12000,${la},${lo});node["leisure"="golf_course"](around:12000,${la},${lo}););out center tags 25;`
    : `[out:json][timeout:12];(way["leisure"="golf_course"](around:40000,${la},${lo});relation["leisure"="golf_course"](around:40000,${la},${lo});node["leisure"="golf_course"](around:40000,${la},${lo}););out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: OSM_HEADERS,
    body: query,
    signal,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  const courses = [];
  for (const el of data.elements || []) {
    const course = courseFromOverpassElement(el);
    if (course) courses.push(course);
  }
  return dedupeCourses(courses);
}

function cachedWithinRadius(courses, lat, lon) {
  return sortCoursesByDistance(dedupeCourses(courses), lat, lon).filter((course) => {
    const meters = haversineMeters(lat, lon, course?.lat, course?.lng ?? course?.lon);
    return Number.isFinite(meters) && meters <= NEARBY_RADIUS_M;
  });
}

/** Real golf courses within 40 km, sorted nearest-first. */
export async function fetchCoursesNearPlayer(lat, lon, { signal } = {}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return [];
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) return cachedWithinRadius(await readCachedCourses(), la, lo);
  try {
    const courses = await queryOverpassCourses(la, lo, { signal, modest: false });
    const sorted = cachedWithinRadius(courses, la, lo).slice(0, CATALOG_LIMIT);
    await mergeIntoCatalog(sorted);
    return sorted;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return cachedWithinRadius(await readCachedCourses(), la, lo);
  }
}

/** Worldwide course search: Nominatim plus a modest Overpass lookup around the top hit. */
export async function searchGlobalGolfCourses({ query, signal, lat, lon } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const fromCache = async () => {
    const cached = (await readCachedCourses()).filter((course) => courseMatchesQuery(course, q));
    return sortCoursesByDistance(dedupeCourses(cached), lat, lon);
  };
  if (offline) return fromCache();
  try {
    const geoRes = await fetch(nominatimSearchUrl(q), { headers: OSM_HEADERS, signal });
    if (!geoRes.ok) throw new Error(`Nominatim ${geoRes.status}`);
    const geoData = await geoRes.json();
    const nominatimCourses = [];
    let center = null;
    for (const item of Array.isArray(geoData) ? geoData : []) {
      const itemLat = Number(item?.lat);
      const itemLon = Number(item?.lon);
      if (!center && Number.isFinite(itemLat) && Number.isFinite(itemLon)) center = { lat: itemLat, lon: itemLon };
      const course = courseFromNominatim(item);
      if (course) nominatimCourses.push(course);
    }
    let overpassCourses = [];
    if (center) overpassCourses = await queryOverpassCourses(center.lat, center.lon, { signal, modest: true });
    const courses = sortCoursesByDistance(dedupeCourses([...nominatimCourses, ...overpassCourses]), lat, lon);
    await mergeIntoCatalog(courses);
    return courses;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return fromCache();
  }
}

export async function searchNearbyGolfCourses({ lat, lon, query, signal } = {}) {
  if (query && String(query).trim()) {
    return searchGlobalGolfCourses({ query, signal, lat, lon });
  }
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
    return fetchCoursesNearPlayer(Number(lat), Number(lon), { signal });
  }
  return readCachedCourses();
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