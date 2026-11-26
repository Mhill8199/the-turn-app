import { supabase } from '../lib/supabase';
import { haversineMeters } from './globalCourseCatalog';

/** Local queue. Remote sync uses user_trips and never blocks sign-in. */
export const TRIP_QUEUE_KEY = 'the-turn-trip-queue';
/** 1 mile. Proximity uses meters; 1 yard = 0.9144 m when a distance is shown. */
export const TRIP_PROXIMITY_METERS = 1609;
export const METERS_PER_YARD = 0.9144;

const TRIP_TILE_DB = 'the-turn-trip-tiles';
const TRIP_TILE_STORE = 'tiles';
const COURSE_CACHE_DB = 'the-turn-course-cache';
const COURSE_CACHE_STORE = 'courses';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const GOLF_TAGS = ['fairway', 'hole', 'green', 'bunker', 'water_hazard'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const blobUrls = new Map();

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function supabaseConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return typeof url === 'string' && url.startsWith('http') && typeof key === 'string' && key.length > 0;
}

export function normalizePartners(value) {
  if (Array.isArray(value)) {
    return value.map((name) => String(name || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function formatPartners(value) {
  return normalizePartners(value).join(', ');
}

export function formatTeeTime(value) {
  const raw = String(value || '').trim();
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${ampm[2]} ${ampm[3].toUpperCase()}`;
  }
  const clock = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!clock) return raw;
  let hour = Number(clock[1]);
  const minute = clock[2];
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${suffix}`;
}

export function formatTripDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || !day) return '';
  return `${month} ${day}`;
}

export function formatTripLine(trip) {
  if (!trip) return '';
  const parts = [trip.courseName, formatTripDate(trip.date), formatTeeTime(trip.teeTime)].filter(Boolean);
  const partners = formatPartners(trip.playingPartners);
  if (partners) parts.push(partners);
  return parts.join(' • ');
}

export function formatUpNext(trip) {
  if (!trip?.courseName) return '';
  const when = formatTeeTime(trip.teeTime);
  return when ? `Up Next: ${trip.courseName} • ${when}` : `Up Next: ${trip.courseName}`;
}

export function upcomingDateISO(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function tripDateTime(trip) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(trip?.date || ''));
  if (!match) return null;
  const clock = String(trip.teeTime || '00:00').trim();
  const parts = clock.match(/(\d{1,2}):(\d{2})/);
  let hour = parts ? Number(parts[1]) : 0;
  const minute = parts ? Number(parts[2]) : 0;
  if (/pm/i.test(clock) && hour < 12) hour += 12;
  if (/am/i.test(clock) && hour === 12) hour = 0;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0, 0);
}

export function createTrip(input = {}) {
  const id = input.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `trip-${Date.now()}`);
  return {
    id,
    courseId: input.courseId || '',
    courseName: String(input.courseName || '').trim(),
    lat: finite(input.lat),
    lon: finite(input.lon),
    teeBox: input.teeBox || 'blue',
    date: String(input.date || '').slice(0, 10),
    teeTime: String(input.teeTime || '').trim(),
    playingPartners: normalizePartners(input.playingPartners),
    notes: String(input.notes || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function loadTripQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem(TRIP_QUEUE_KEY) || '[]');
    return Array.isArray(saved) ? saved.map((trip) => createTrip(trip)).filter((trip) => trip.courseName) : [];
  } catch {
    return [];
  }
}

export function saveTripQueue(trips) {
  try {
    localStorage.setItem(TRIP_QUEUE_KEY, JSON.stringify(Array.isArray(trips) ? trips : []));
  } catch {
    // Quota or private mode: the in-memory queue still updates.
  }
}

export function mergeTrips(localTrips, remoteTrips) {
  const byId = new Map();
  for (const trip of remoteTrips || []) {
    if (trip?.id) byId.set(trip.id, trip);
  }
  for (const trip of localTrips || []) {
    if (trip?.id) byId.set(trip.id, trip);
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = tripDateTime(a)?.getTime() ?? 0;
    const bTime = tripDateTime(b)?.getTime() ?? 0;
    return aTime - bTime;
  });
}

/** Soonest trip today or later. A tee time earlier today still counts until the day ends. */
export function nextQueuedTrip(trips, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = (trips || [])
    .map((trip) => ({ trip, at: tripDateTime(trip) }))
    .filter((item) => item.at && item.at.getTime() >= start.getTime())
    .sort((a, b) => a.at - b.at);
  return upcoming[0]?.trip || null;
}

export function closestQueuedTrip(trips, lat, lon, radiusMeters = TRIP_PROXIMITY_METERS) {
  let best = null;
  for (const trip of trips || []) {
    const meters = haversineMeters(lat, lon, trip?.lat, trip?.lon);
    if (meters == null || meters > radiusMeters) continue;
    if (!best || meters < best.meters) best = { trip, meters };
  }
  return best;
}

function tripToRow(trip, userId) {
  return {
    id: trip.id,
    user_id: userId,
    course_id: trip.courseId || null,
    course_name: trip.courseName,
    tee_box: trip.teeBox,
    play_date: trip.date || null,
    tee_time: trip.teeTime || null,
    playing_partners: trip.playingPartners,
    notes: trip.notes || '',
    lat: trip.lat,
    lon: trip.lon,
    payload: trip,
  };
}

function tripFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const trip = createTrip({
    id: row.id || payload.id,
    courseId: row.course_id || payload.courseId,
    courseName: row.course_name || payload.courseName,
    lat: row.lat ?? payload.lat,
    lon: row.lon ?? payload.lon,
    teeBox: row.tee_box || payload.teeBox,
    date: row.play_date || payload.date,
    teeTime: row.tee_time || payload.teeTime,
    playingPartners: row.playing_partners ?? payload.playingPartners,
    notes: row.notes ?? payload.notes,
    createdAt: row.created_at || payload.createdAt,
  });
  return trip.courseName ? trip : null;
}

async function pushTrips(trips, userId) {
  const rows = trips.map((trip) => tripToRow(trip, userId));
  if (!rows.length) {
    await supabase.from('user_trips').delete().eq('user_id', userId);
    return;
  }
  const attempts = [
    rows,
    rows.map((row) => ({
      ...row,
      playing_partners: Array.isArray(row.playing_partners) ? row.playing_partners.join(', ') : row.playing_partners,
    })),
    trips.map((trip) => ({ id: trip.id, user_id: userId, payload: trip })),
  ];
  for (const attempt of attempts) {
    const { error } = await supabase.from('user_trips').upsert(attempt, { onConflict: 'id' });
    if (!error) {
      const keep = trips.map((trip) => trip.id).join(',');
      await supabase.from('user_trips').delete().eq('user_id', userId).not('id', 'in', `(${keep})`);
      return;
    }
  }
}

/** Write localStorage first. A missing user_trips table or RLS rejection stays local. */
export async function syncTripQueue(trips, userId) {
  saveTripQueue(trips);
  if (!userId || !supabaseConfigured()) return;
  try {
    await pushTrips(trips, userId);
  } catch {
    // Signed-in state stays intact. The queue remains on this device.
  }
}

export async function pullRemoteTrips(userId) {
  if (!userId || !supabaseConfigured()) return null;
  try {
    const { data, error } = await supabase.from('user_trips').select('*').eq('user_id', userId);
    if (error || !Array.isArray(data)) return null;
    return data.map(tripFromRow).filter(Boolean);
  } catch {
    return null;
  }
}

function courseCacheKey(courseName, lat, lon) {
  const cellLat = (Math.round(lat * 100) / 100).toFixed(2);
  const cellLon = (Math.round(lon * 100) / 100).toFixed(2);
  const name = String(courseName || 'course').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${name}|${cellLat},${cellLon}`;
}

function cellBBox(lat, lon) {
  const cellLat = Math.round(lat * 100) / 100;
  const cellLon = Math.round(lon * 100) / 100;
  const half = 0.02;
  return { south: cellLat - half, west: cellLon - half, north: cellLat + half, east: cellLon + half };
}

function openNamedDb(name, version, storeName) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = Number.isFinite(version) ? indexedDB.open(name, version) : indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function openGeometryDb() {
  try {
    return await openNamedDb(COURSE_CACHE_DB, 1, COURSE_CACHE_STORE);
  } catch {
    return openNamedDb(COURSE_CACHE_DB, undefined, COURSE_CACHE_STORE);
  }
}

function kindFromTags(tags = {}) {
  if (tags.golf === 'fairway') return 'fairway';
  if (tags.golf === 'green') return 'green';
  if (tags.golf === 'bunker') return 'bunker';
  if (tags.golf === 'hole') return 'hole';
  if (tags.golf === 'water_hazard' || tags.waterway || tags.natural === 'water') return 'water';
  return null;
}

function ringsFromElement(element) {
  const rings = [];
  const push = (geometry) => {
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    const ring = [];
    for (const point of geometry) {
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) ring.push({ lat, lon });
    }
    if (ring.length >= 2) rings.push(ring);
  };
  push(element.geometry);
  if (Array.isArray(element.members)) {
    for (const member of element.members) push(member.geometry);
  }
  return rings;
}

function parseOverpass(data) {
  const features = [];
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  for (const element of elements) {
    if (element?.type !== 'way' && element?.type !== 'relation') continue;
    const kind = kindFromTags(element.tags || {});
    if (!kind) continue;
    const rings = ringsFromElement(element);
    if (!rings.length) continue;
    features.push({
      id: `${element.type}:${element.id}:${kind}`,
      kind,
      ref: element.tags?.ref ?? null,
      rings,
    });
    if (features.length >= 400) break;
  }
  return features;
}

function buildOverpassQuery(bbox) {
  const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((n) => n.toFixed(5)).join(',');
  const clauses = [];
  for (const tag of GOLF_TAGS) {
    clauses.push(`way["golf"="${tag}"](${box});`);
    clauses.push(`relation["golf"="${tag}"](${box});`);
  }
  clauses.push(`way["waterway"]["golf"="water_hazard"](${box});`);
  clauses.push(`way["natural"="water"]["golf"="water_hazard"](${box});`);
  clauses.push(`relation["natural"="water"]["golf"="water_hazard"](${box});`);
  return `[out:json][timeout:20];(${clauses.join('')});out geom;`;
}

async function putRecord(db, storeName, record) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.keyPath ? store.put(record) : store.put(record, record.key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

async function cacheHolePolygons(courseName, lat, lon) {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: buildOverpassQuery(cellBBox(lat, lon)),
  });
  if (!response.ok) return;
  const features = parseOverpass(await response.json());
  if (!features.length) return;
  const db = await openGeometryDb();
  try {
    if (!db.objectStoreNames.contains(COURSE_CACHE_STORE)) return;
    const cellLat = Math.round(lat * 100) / 100;
    const cellLon = Math.round(lon * 100) / 100;
    await putRecord(db, COURSE_CACHE_STORE, {
      key: courseCacheKey(courseName, lat, lon),
      courseName: courseName || '',
      cellLat,
      cellLon,
      features,
      fetchedAt: Date.now(),
    });
  } finally {
    db.close();
  }
}

function tileXY(lat, lon, zoom) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (safeLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, n };
}

function usgsTileUrl(z, x, y) {
  return USGS_IMAGERY.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
}

function tilesAround(lat, lon, zoom, radius) {
  const center = tileXY(lat, lon, zoom);
  const tiles = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const x = ((center.x + dx) % center.n + center.n) % center.n;
      const y = center.y + dy;
      if (y < 0 || y >= center.n) continue;
      const url = usgsTileUrl(zoom, x, y);
      tiles.push({ key: url, url, z: zoom, x, y });
    }
  }
  return tiles;
}

async function cacheUsgsTiles(lat, lon) {
  const tiles = [...tilesAround(lat, lon, 16, 2), ...tilesAround(lat, lon, 15, 1)];
  const db = await openNamedDb(TRIP_TILE_DB, 1, TRIP_TILE_STORE);
  try {
    const queue = tiles.slice();
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const tile = queue.shift();
        try {
          const response = await fetch(tile.url);
          if (!response.ok) continue;
          const blob = await response.blob();
          await putRecord(db, TRIP_TILE_STORE, { ...tile, blob, savedAt: Date.now() });
        } catch {
          // One missed tile does not cancel the rest of the prefetch.
        }
      }
    });
    await Promise.all(workers);
  } finally {
    db.close();
  }
}

/**
 * Warm Overpass hole polygons into the existing course-geometry cache and USGS
 * imagery tiles into the-turn-trip-tiles. Failures never reject to the caller.
 * Does not clear the-turn-course-cache or any other course store.
 */
export async function prefetchTripCourse(trip) {
  try {
    const lat = finite(trip?.lat);
    const lon = finite(trip?.lon);
    if (lat == null || lon == null) return;
    await Promise.allSettled([
      cacheHolePolygons(trip.courseName, lat, lon),
      cacheUsgsTiles(lat, lon),
    ]);
  } catch {
    // Saving the trip must succeed even when Overpass or the tile host is down.
  }
}

async function readTileBlob(url) {
  const db = await openNamedDb(TRIP_TILE_DB, 1, TRIP_TILE_STORE);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(TRIP_TILE_STORE, 'readonly');
      const req = tx.objectStore(TRIP_TILE_STORE).get(url);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** MapLibre transformRequest helper. Returns a blob URL for a prefetched USGS tile, or null. */
export function rewriteCachedTileRequest(url) {
  if (typeof url !== 'string' || !url.includes('basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/')) {
    return Promise.resolve(null);
  }
  if (blobUrls.has(url)) return Promise.resolve({ url: blobUrls.get(url) });
  return readTileBlob(url)
    .then((blob) => {
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      blobUrls.set(url, objectUrl);
      return { url: objectUrl };
    })
    .catch(() => null);
}
