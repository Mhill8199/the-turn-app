/**
 * Worldwide golf-course catalog.
 * Tier 1 GPS Overpass, tier 2 Nominatim + name search, tier 3 offline starter/cache,
 * tier 4 custom pins created by the player. Results are always merged and deduped.
 * Satellite geometries stay in the-turn-course-cache and are not deleted here.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const GLOBAL_DB = 'the-turn-global-courses';
const GLOBAL_STORE = 'courses';
const GLOBAL_LS_KEY = 'the-turn-global-courses';
const LEGACY_LIST_DB = 'the-turn-courses-cache';
const LEGACY_DIRECTORY_DB = 'the-turn-course-cache';
const NEAR_RADIUS_M = 50000;
const DEDUPE_METERS = 600;

const PAR_18 = [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 5, 3, 4];
const PAR_9 = [4, 5, 4, 3, 4, 4, 3, 5, 4];

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCourseName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Escape a player query so it cannot break an Overpass regular expression. */
export function escapeOverpassRegex(value) {
  return String(value || '')
    .replace(/[\n\r]/g, ' ')
    .replace(/[\\.*+?^${}()|[\]"]/g, '\\$&');
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const latA = finiteOrNull(lat1);
  const lonA = finiteOrNull(lon1);
  const latB = finiteOrNull(lat2);
  const lonB = finiteOrNull(lon2);
  if (latA == null || lonA == null || latB == null || lonB == null) return null;
  const earth = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function yardsForPar(par) {
  if (par <= 3) return 165;
  if (par >= 5) return 520;
  return 395;
}

export function buildSkeletonHoles(count, coursePar) {
  const size = count === 9 ? 9 : count === 18 ? 18 : 1;
  const pattern = size === 9 ? PAR_9 : size === 18 ? PAR_18 : [4];
  const pars = pattern.slice();
  const target = finiteOrNull(coursePar);
  if (target != null && target >= size * 3 && target <= size * 5) {
    let guard = 0;
    const sum = () => pars.reduce((total, par) => total + par, 0);
    while (sum() > target && guard < 40) {
      const index = pars.findIndex((par) => par > 3);
      if (index < 0) break;
      pars[index] -= 1;
      guard += 1;
    }
    guard = 0;
    while (sum() < target && guard < 40) {
      const index = pars.findIndex((par) => par < 5);
      if (index < 0) break;
      pars[index] += 1;
      guard += 1;
    }
  }
  return pars.map((par, index) => ({
    number: index + 1,
    par,
    yards: yardsForPar(par),
    bearingDeg: (140 + index * 20) % 360,
    bunkerStart: par === 3 ? 150 : 250,
    bunkerEnd: par === 3 ? 158 : 272,
    waterCarry: null,
    greenSlope: 'Back-to-Front',
    note: 'Custom layout — edit yardage and hazards anytime.',
  }));
}

const playableCache = new Map();

export function ensurePlayableHoles(course) {
  if (!course) return course;
  if (Array.isArray(course.holes) && course.holes.length > 0) return course;
  const count = course.holeCount === 9 ? 9 : course.holeCount === 18 ? 18 : 1;
  const key = `${course.id || course.name}|${count}|${course.par || ''}`;
  const cached = playableCache.get(key);
  if (cached) return cached;
  const next = { ...course, holes: buildSkeletonHoles(count, course.par) };
  playableCache.set(key, next);
  return next;
}

function osmIdentity(course) {
  if (course?.osmId != null && String(course.osmId) !== '') return String(course.osmId);
  const id = String(course?.id || '');
  const typed = id.match(/^osm-([a-z]+)-(\d+)$/i);
  if (typed) return `${typed[1].toLowerCase()}:${typed[2]}`;
  const plain = id.match(/^osm-(\d+)$/);
  return plain ? plain[1] : '';
}

function sameOsmId(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const numeric = (value) => (String(value).match(/(\d+)$/) || [])[1] || '';
  const leftNum = numeric(left);
  const rightNum = numeric(right);
  if (!leftNum || leftNum !== rightNum) return false;
  const typed = (value) => /[a-z]/i.test(String(value).replace(/\d+/g, ''));
  if (typed(left) && typed(right)) return false;
  return true;
}

function courseNamesMatch(left, right) {
  const names = (course) => [course?.name, ...(Array.isArray(course?.aliases) ? course.aliases : [])]
    .map(normalizeCourseName)
    .filter(Boolean);
  const rightNames = new Set(names(right));
  return names(left).some((name) => rightNames.has(name));
}

function preferStableId(primary, incoming) {
  const stable = (id) => id && !String(id).startsWith('osm-') && !String(id).startsWith('nominatim-');
  if (stable(primary)) return primary;
  if (stable(incoming)) return incoming;
  return primary || incoming;
}

export function sanitizeCourse(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const lat = finiteOrNull(raw.lat ?? raw.latitude);
  const lon = finiteOrNull(raw.lon ?? raw.lng ?? raw.longitude);
  const holeCount = finiteOrNull(raw.holeCount ?? raw.holesCount);
  const osmId = raw.osmId != null && String(raw.osmId) !== '' ? String(raw.osmId) : undefined;
  const id = raw.id || (osmId ? `osm-${String(osmId).replace(':', '-')}` : `name-${normalizeCourseName(name)}`);
  return {
    ...raw,
    id,
    osmId,
    name,
    city: raw.city || '',
    state: raw.state || '',
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    elevationFt: finiteOrNull(raw.elevationFt) ?? undefined,
    holeCount: holeCount != null && holeCount > 0 ? holeCount : undefined,
    par: finiteOrNull(raw.par) ?? undefined,
    holes: Array.isArray(raw.holes) && raw.holes.length ? raw.holes : undefined,
    source: raw.source || undefined,
  };
}

function mergeCourseRecords(primary, incoming) {
  const primaryHoles = Array.isArray(primary.holes) ? primary.holes : [];
  const incomingHoles = Array.isArray(incoming.holes) ? incoming.holes : [];
  let holes = primaryHoles;
  if (!primaryHoles.length) holes = incomingHoles;
  else if (incomingHoles.length > primaryHoles.length && primary.source !== 'starter') holes = incomingHoles;

  const defined = {};
  Object.entries(incoming).forEach(([key, value]) => {
    if (value == null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    defined[key] = value;
  });

  return sanitizeCourse({
    ...primary,
    ...defined,
    id: preferStableId(primary.id, incoming.id),
    osmId: osmIdentity(primary) || osmIdentity(incoming) || undefined,
    name: primary.name || incoming.name,
    city: primary.city || incoming.city || '',
    state: primary.state || incoming.state || '',
    lat: finiteOrNull(primary.lat) ?? finiteOrNull(incoming.lat) ?? undefined,
    lon: finiteOrNull(primary.lon) ?? finiteOrNull(incoming.lon) ?? undefined,
    elevationFt: finiteOrNull(primary.elevationFt) ?? finiteOrNull(incoming.elevationFt) ?? undefined,
    holeCount: finiteOrNull(primary.holeCount) ?? finiteOrNull(incoming.holeCount) ?? undefined,
    par: finiteOrNull(primary.par) ?? finiteOrNull(incoming.par) ?? undefined,
    holes: holes.length ? holes : undefined,
    source: primary.source === 'starter' ? 'starter' : (primary.source || incoming.source),
  });
}

export function dedupeCourses(courses) {
  const result = [];
  const list = Array.isArray(courses) ? courses : [];
  list.forEach((raw) => {
    const course = sanitizeCourse(raw);
    if (!course) return;
    const osmId = osmIdentity(course);
    const lat = finiteOrNull(course.lat);
    const lon = finiteOrNull(course.lon);
    let match = -1;
    for (let index = 0; index < result.length; index += 1) {
      const existing = result[index];
      const existingOsm = osmIdentity(existing);
      if (osmId && existingOsm && sameOsmId(osmId, existingOsm)) {
        match = index;
        break;
      }
      if (osmId && existingOsm && !sameOsmId(osmId, existingOsm)) continue;
      if (!courseNamesMatch(course, existing)) continue;
      const existingLat = finiteOrNull(existing.lat);
      const existingLon = finiteOrNull(existing.lon);
      if (lat == null || lon == null || existingLat == null || existingLon == null) {
        match = index;
        break;
      }
      const meters = haversineMeters(lat, lon, existingLat, existingLon);
      if (meters == null || meters < DEDUPE_METERS) {
        match = index;
        break;
      }
    }
    if (match === -1) result.push(course);
    else result[match] = mergeCourseRecords(result[match], course);
  });
  return result;
}

export function sortByDistance(courses, lat, lon) {
  const originLat = finiteOrNull(lat);
  const originLon = finiteOrNull(lon);
  const list = Array.isArray(courses) ? [...courses] : [];
  if (originLat == null || originLon == null) return list;
  return list.sort((a, b) => {
    const left = haversineMeters(originLat, originLon, a?.lat, a?.lon);
    const right = haversineMeters(originLat, originLon, b?.lat, b?.lon);
    return (left == null ? Number.POSITIVE_INFINITY : left) - (right == null ? Number.POSITIVE_INFINITY : right);
  });
}

export function displayHoleCount(course) {
  const count = finiteOrNull(course?.holeCount);
  if (count != null && count > 0) return count;
  return null;
}

export function placeLabel(course) {
  const city = String(course?.city || '').trim();
  const state = String(course?.state || '').trim();
  if (!city) return state;
  if (!state || city.toLowerCase().includes(state.toLowerCase())) return city;
  return `${city}, ${state}`;
}

const DOS_LAGOS_HOLES = [
  { number: 1, par: 4, yards: 388, bearingDeg: 145, bunkerStart: 245, bunkerEnd: 268, waterCarry: null, greenSlope: 'Back-to-Front', note: 'Favor left-center; right bunker gathers anything leaking right.' },
  { number: 2, par: 5, yards: 518, bearingDeg: 210, bunkerStart: 275, bunkerEnd: 295, waterCarry: 185, greenSlope: 'Two-Tier Back', note: 'Lay up to 95-105 yds short of the creek unless tailwind is 10+ mph.' },
  { number: 3, par: 3, yards: 164, bearingDeg: 310, bunkerStart: 148, bunkerEnd: 156, waterCarry: null, greenSlope: 'Slopes Left', note: 'Plays half a club longer into the afternoon canyon breeze.' },
  { number: 4, par: 4, yards: 392, bearingDeg: 95, bunkerStart: 252, bunkerEnd: 278, waterCarry: null, greenSlope: 'Firm & Fast', note: '3-Wood or hybrid off the tee takes the 252y right bunker out of play.' },
  { number: 5, par: 4, yards: 424, bearingDeg: 180, bunkerStart: 260, bunkerEnd: 285, waterCarry: null, greenSlope: 'Elevated Front', note: 'Take one extra club to reach the upper shelf.' },
];

const OAK_VALLEY_HOLES = [
  { number: 1, par: 4, yards: 405, bearingDeg: 110, bunkerStart: 255, bunkerEnd: 275, waterCarry: null, greenSlope: 'Fast Front-to-Back', note: '2,600 ft elevation adds ~4% carry. Keep approach below the hole.' },
  { number: 2, par: 4, yards: 376, bearingDeg: 265, bunkerStart: 235, bunkerEnd: 255, waterCarry: null, greenSlope: 'Ridge Center', note: 'Downwind afternoon tee shot runs out fast.' },
  { number: 3, par: 3, yards: 182, bearingDeg: 20, bunkerStart: 165, bunkerEnd: 174, waterCarry: null, greenSlope: 'Deep Green', note: 'Check wind gusts over the ridge before pulling a club.' },
];

const GLEN_IVY_HOLES = [
  { number: 1, par: 4, yards: 368, bearingDeg: 160, bunkerStart: 240, bunkerEnd: 260, waterCarry: null, greenSlope: 'Gentle Tilt', note: 'Position drive at 235-245y for a flat wedge angle.' },
  { number: 2, par: 3, yards: 152, bearingDeg: 240, bunkerStart: 138, bunkerEnd: 146, waterCarry: null, greenSlope: 'Front Bunker', note: 'Do not miss short right.' },
];

const YUCAIPA_HOLES = [
  { number: 1, par: 4, yards: 382, bearingDeg: 195, bunkerStart: 235, bunkerEnd: 255, waterCarry: null, greenSlope: 'Back-to-Front', note: '2,480 ft elevation gives ~3.5% extra carry off the first tee.' },
  { number: 2, par: 3, yards: 158, bearingDeg: 120, bunkerStart: 142, bunkerEnd: 150, waterCarry: null, greenSlope: 'Slopes Left', note: 'Stay below the pin on the back-left shelf.' },
];

/** Tier 3 starter. Merged into search results — never a cap. */
export const STARTER_COURSES = [
  {
    id: 'dos-lagos',
    name: 'Dos Lagos Golf Club',
    city: 'Corona, CA',
    state: 'CA',
    lat: 33.8229,
    lng: -117.5214,
    lon: -117.5214,
    elevationFt: 740,
    holeCount: 18,
    par: 72,
    source: 'starter',
    holes: DOS_LAGOS_HOLES,
  },
  {
    id: 'yucaipa-valley',
    aliases: ['Yucaipa Valley Golf Club'],
    name: 'Yucaipa Valley Golf Course',
    city: 'Yucaipa, CA',
    state: 'CA',
    lat: 34.0175,
    lon: -117.0431,
    elevationFt: 2480,
    holeCount: 18,
    par: 72,
    source: 'starter',
    holes: YUCAIPA_HOLES,
  },
  {
    id: 'oak-valley',
    name: 'Oak Valley Golf Club',
    city: 'Beaumont, CA',
    state: 'CA',
    lat: 33.9384,
    lon: -117.0186,
    elevationFt: 2610,
    holeCount: 18,
    par: 72,
    source: 'starter',
    holes: OAK_VALLEY_HOLES,
  },
  {
    id: 'glen-ivy',
    name: 'Glen Ivy Golf Club',
    city: 'Corona, CA',
    state: 'CA',
    lat: 33.7512,
    lon: -117.4925,
    elevationFt: 1180,
    holeCount: 18,
    par: 72,
    source: 'starter',
    holes: GLEN_IVY_HOLES,
  },
  {
    id: 'morongo-tukwet',
    name: 'Morongo Golf Club at Tukwet Canyon',
    city: 'Beaumont, CA',
    state: 'CA',
    lat: 33.9615,
    lon: -116.977,
    elevationFt: 2590,
    holeCount: 18,
    par: 72,
    source: 'starter',
  },
  {
    id: 'pga-west-stadium',
    name: 'PGA WEST Stadium Course',
    city: 'La Quinta, CA',
    state: 'CA',
    lat: 33.6458,
    lon: -116.2672,
    elevationFt: 56,
    holeCount: 18,
    par: 72,
    source: 'starter',
  },
  {
    id: 'torrey-pines',
    name: 'Torrey Pines Golf Course',
    city: 'La Jolla, CA',
    state: 'CA',
    lat: 32.9043,
    lon: -117.2462,
    elevationFt: 370,
    holeCount: 18,
    par: 72,
    source: 'starter',
  },
];

function isAbort(error) {
  return error?.name === 'AbortError';
}

async function fetchJson(url, options = {}, signal) {
  const response = await fetch(url, {
    ...options,
    signal,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function fromNominatim(item) {
  if (!item || typeof item !== 'object') return null;
  const blob = `${item.display_name || ''} ${item.name || ''} ${item.type || ''} ${item.class || ''}`.toLowerCase();
  if (!blob.includes('golf')) return null;
  const address = item.address || {};
  const city = address.city || address.town || address.village || address.hamlet || address.suburb || address.municipality || '';
  const state = address.state || '';
  const name = item.name || String(item.display_name || '').split(',')[0].trim();
  const type = item.osm_type || 'way';
  const osmId = item.osm_id != null ? `${type}:${item.osm_id}` : undefined;
  return sanitizeCourse({
    id: osmId ? `osm-${type}-${item.osm_id}` : undefined,
    osmId,
    name,
    city,
    state,
    lat: item.lat,
    lon: item.lon,
    source: 'nominatim',
  });
}

function fromOverpassElement(element) {
  const tags = element?.tags || {};
  const name = tags.name || tags['name:en'];
  if (!name) return null;
  const type = element.type || 'way';
  const osmId = element.id != null ? `${type}:${element.id}` : undefined;
  return sanitizeCourse({
    id: osmId ? `osm-${type}-${element.id}` : undefined,
    osmId,
    name,
    city: tags['addr:city'] || tags['addr:town'] || tags['addr:suburb'] || '',
    state: tags['addr:state'] || '',
    lat: element.center?.lat ?? element.lat,
    lon: element.center?.lon ?? element.lon,
    holeCount: tags.holes,
    par: tags.par,
    source: 'overpass',
  });
}

function openGlobalDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(GLOBAL_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GLOBAL_STORE)) {
        db.createObjectStore(GLOBAL_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

function readLocalCourses() {
  try {
    const raw = localStorage.getItem(GLOBAL_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCourses(courses) {
  try {
    localStorage.setItem(GLOBAL_LS_KEY, JSON.stringify(courses));
  } catch {
    // Quota and private-mode failures leave IndexedDB as the offline copy.
  }
}

async function readGlobalIdb() {
  try {
    const db = await openGlobalDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(GLOBAL_STORE, 'readonly');
      const request = tx.objectStore(GLOBAL_STORE).getAll();
      request.onsuccess = () => {
        db.close();
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

async function databaseExists(name) {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    const list = await indexedDB.databases();
    return (list || []).some((entry) => entry?.name === name);
  } catch {
    return true;
  }
}

function extractDirectoryCourses(record) {
  if (!record || typeof record !== 'object') return [];
  if (Array.isArray(record.features) && record.courseName && !Array.isArray(record.courses)) return [];
  const found = [];
  if (Array.isArray(record.courses)) {
    record.courses.forEach((course) => {
      const clean = sanitizeCourse(course);
      if (clean) found.push(clean);
    });
  }
  if (record.course) {
    const clean = sanitizeCourse(record.course);
    if (clean) found.push(clean);
  }
  if (!record.courses && !record.course && record.name && !record.features) {
    const clean = sanitizeCourse(record);
    if (clean) found.push(clean);
  }
  return found;
}

async function readExistingDatabase(name) {
  const exists = await databaseExists(name);
  if (!exists || typeof indexedDB === 'undefined') return [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (rows) => {
      if (settled) return;
      settled = true;
      resolve(rows);
    };
    try {
      const request = indexedDB.open(name);
      request.onerror = () => finish([]);
      request.onupgradeneeded = () => {
        try { request.transaction?.abort(); } catch { /* leave an existing database untouched */ }
        finish([]);
      };
      request.onsuccess = () => {
        const db = request.result;
        const names = Array.from(db.objectStoreNames || []);
        if (!names.length) {
          db.close();
          finish([]);
          return;
        }
        const collected = [];
        let pending = names.length;
        const done = () => {
          pending -= 1;
          if (pending <= 0) {
            db.close();
            finish(collected);
          }
        };
        names.forEach((storeName) => {
          try {
            const tx = db.transaction(storeName, 'readonly');
            const getAll = tx.objectStore(storeName).getAll();
            getAll.onsuccess = () => {
              (getAll.result || []).forEach((record) => {
                extractDirectoryCourses(record).forEach((course) => collected.push(course));
              });
              done();
            };
            getAll.onerror = () => done();
          } catch {
            done();
          }
        });
      };
    } catch {
      finish([]);
    }
  });
}

let offlineCatalogPromise = null;

/** Starter list plus global cache, read once from the older course directories. */
export function loadOfflineCatalog() {
  if (!offlineCatalogPromise) {
    offlineCatalogPromise = (async () => {
      const [globalRows, legacyList, legacyDirectory] = await Promise.all([
        readGlobalIdb(),
        readExistingDatabase(LEGACY_LIST_DB),
        readExistingDatabase(LEGACY_DIRECTORY_DB),
      ]);
      return dedupeCourses([
        ...STARTER_COURSES,
        ...readLocalCourses(),
        ...globalRows,
        ...legacyList,
        ...legacyDirectory,
      ]);
    })().catch(() => dedupeCourses([...STARTER_COURSES, ...readLocalCourses()]));
  }
  return offlineCatalogPromise;
}

export async function rememberGlobalCourses(courses) {
  const incoming = dedupeCourses(courses);
  if (!incoming.length) return;
  const existing = dedupeCourses([...readLocalCourses(), ...(await readGlobalIdb())]);
  const merged = dedupeCourses([...existing, ...incoming]).slice(-400);
  writeLocalCourses(merged);
  try {
    const db = await openGlobalDb();
    await new Promise((resolve) => {
      const tx = db.transaction(GLOBAL_STORE, 'readwrite');
      const store = tx.objectStore(GLOBAL_STORE);
      merged.forEach((course) => {
        if (course?.id) store.put(course);
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // localStorage still holds the offline copy.
  }
  offlineCatalogPromise = null;
}

function filterByName(courses, query) {
  const norm = normalizeCourseName(query);
  if (!norm) return courses;
  return courses.filter((course) => {
    const hay = `${normalizeCourseName(course?.name)}${normalizeCourseName(course?.city)}`;
    return hay.includes(norm);
  });
}

async function cachedNameMatches(query) {
  return filterByName(await loadOfflineCatalog(), query);
}

/** Tier 2 — Nominatim and Overpass name search. */
export async function searchCoursesByName(query, { signal } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return cachedNameMatches(trimmed);
  }
  const escaped = escapeOverpassRegex(trimmed);
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=20&q=${encodeURIComponent(`${trimmed} golf course`)}`;
  const overpassQuery = `[out:json][timeout:15];(way["leisure"="golf_course"]["name"~"${escaped}",i];relation["leisure"="golf_course"]["name"~"${escaped}",i];node["leisure"="golf_course"]["name"~"${escaped}",i];);out center tags;`;

  const [nominatim, overpass] = await Promise.allSettled([
    fetchJson(nominatimUrl, { method: 'GET' }, signal),
    fetchJson(OVERPASS_URL, {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }, signal),
  ]);

  if (signal?.aborted) {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const found = [];
  if (nominatim.status === 'fulfilled' && Array.isArray(nominatim.value)) {
    nominatim.value.forEach((item) => {
      const course = fromNominatim(item);
      if (course) found.push(course);
    });
  }
  if (overpass.status === 'fulfilled') {
    (overpass.value?.elements || []).forEach((element) => {
      const course = fromOverpassElement(element);
      if (course) found.push(course);
    });
  }

  if (!found.length && nominatim.status === 'rejected' && overpass.status === 'rejected') {
    return cachedNameMatches(trimmed);
  }

  const deduped = dedupeCourses(found);
  await rememberGlobalCourses(deduped);
  return deduped;
}

function withinRadius(course, lat, lon, radius) {
  const meters = haversineMeters(lat, lon, course?.lat, course?.lon);
  return meters != null && meters <= radius;
}

/** Tier 1 — every golf course Overpass knows within 50 km. */
export async function fetchCoursesNear(lat, lon, { signal } = {}) {
  const latitude = finiteOrNull(lat);
  const longitude = finiteOrNull(lon);
  if (latitude == null || longitude == null) return [];

  const fromCache = async () => {
    const cached = sortByDistance(await loadOfflineCatalog(), latitude, longitude);
    const close = cached.filter((course) => withinRadius(course, latitude, longitude, NEAR_RADIUS_M));
    if (close.length) return close;
    return cached.filter((course) => haversineMeters(latitude, longitude, course?.lat, course?.lon) != null).slice(0, 20);
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return fromCache();

  const overpassQuery = `[out:json][timeout:15];(way["leisure"="golf_course"](around:${NEAR_RADIUS_M},${latitude},${longitude});relation["leisure"="golf_course"](around:${NEAR_RADIUS_M},${latitude},${longitude});node["leisure"="golf_course"](around:${NEAR_RADIUS_M},${latitude},${longitude}););out center tags;`;
  try {
    const data = await fetchJson(OVERPASS_URL, {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }, signal);
    const courses = sortByDistance(
      dedupeCourses((data?.elements || []).map(fromOverpassElement).filter(Boolean)),
      latitude,
      longitude,
    );
    await rememberGlobalCourses(courses);
    return courses;
  } catch (error) {
    if (isAbort(error)) throw error;
    return fromCache();
  }
}

export async function readCachedCourses() {
  return loadOfflineCatalog();
}

export async function searchNearbyGolfCourses({ lat, lon, query, signal } = {}) {
  if (query && String(query).trim()) return searchCoursesByName(query, { signal });
  if (lat != null && lon != null) return fetchCoursesNear(lat, lon, { signal });
  return loadOfflineCatalog();
}

export const GLOBAL_COURSES_DB = GLOBAL_DB;
export const GLOBAL_COURSES_STORAGE_KEY = GLOBAL_LS_KEY;
