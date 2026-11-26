import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COURSE_PRESETS } from '../lib/weatherPhysics';
import { supabase } from '../lib/supabase';
import { formatDistance as formatYardsDistance, useUnits } from '../utils/distanceUnits';

/** ESRI World Imagery. Request this z/y/x order; never request z above 19. */
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_SIZE = 256;
const MIN_ZOOM = 14;
const MAX_ZOOM = 21;
const MAX_NATIVE_ZOOM = 19;
const DB_NAME = 'the-turn-course-cache';
const STORE_NAME = 'courses';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Dos Lagos Golf Club — first COURSE_PRESETS center, used when no lat/lon is passed. */
const DOCUMENTED_DEFAULT = { lat: 33.8139, lon: -117.5156 };

const GOLF_TAGS = ['hole', 'green', 'bunker', 'water_hazard'];

function clampLat(lat) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function clampZoom(zoom) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(Number(zoom) || 16)));
}

function validPoint(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function resolveCenter(center, hole, lat, lon) {
  return (
    validPoint(hole) ||
    validPoint(center) ||
    validPoint({ lat, lon }) ||
    validPoint(COURSE_PRESETS?.[0]) ||
    DOCUMENTED_DEFAULT
  );
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const merc = Math.log(Math.tan(latRad) + 1 / Math.cos(latRad));
  return ((1 - merc / Math.PI) / 2) * 2 ** zoom;
}

function worldPixelsToLatLon(px, py, zoom) {
  const n = 2 ** zoom;
  const lon = (px / TILE_SIZE / n) * 360 - 180;
  const yTile = py / TILE_SIZE;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * yTile) / n)));
  return { lat: (latRad * 180) / Math.PI, lon };
}

function makeView(center, zoom, width, height) {
  const viewZoom = clampZoom(zoom);
  const nativeZ = Math.min(viewZoom, MAX_NATIVE_ZOOM);
  const scale = 2 ** (viewZoom - nativeZ);
  const n = 2 ** nativeZ;
  const safe = validPoint(center) || DOCUMENTED_DEFAULT;
  const cx = lonToTileX(safe.lon, nativeZ) * TILE_SIZE;
  const cy = latToTileY(safe.lat, nativeZ) * TILE_SIZE;
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  const project = (lat, lon) => {
    const px = lonToTileX(lon, nativeZ) * TILE_SIZE;
    const py = latToTileY(lat, nativeZ) * TILE_SIZE;
    return {
      x: (px - cx) * scale + w / 2,
      y: (py - cy) * scale + h / 2,
    };
  };

  const unproject = (x, y) => worldPixelsToLatLon(cx + (x - w / 2) / scale, cy + (y - h / 2) / scale, nativeZ);

  const pan = (dx, dy) => worldPixelsToLatLon(cx - dx / scale, cy - dy / scale, nativeZ);

  const tiles = [];
  if (w > 1 && h > 1) {
    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);
    const tx0 = Math.floor((cx - halfW) / TILE_SIZE) - 2;
    const tx1 = Math.floor((cx + halfW) / TILE_SIZE) + 2;
    const ty0 = Math.floor((cy - halfH) / TILE_SIZE) - 2;
    const ty1 = Math.floor((cy + halfH) / TILE_SIZE) + 2;
    for (let tx = tx0; tx <= tx1; tx += 1) {
      for (let ty = ty0; ty <= ty1; ty += 1) {
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n;
        tiles.push({
          key: `${nativeZ}/${wrappedX}/${ty}`,
          url: TILE_URL.replace('{z}', String(nativeZ)).replace('{y}', String(ty)).replace('{x}', String(wrappedX)),
          x: (tx * TILE_SIZE - cx) * scale + w / 2,
          y: (ty * TILE_SIZE - cy) * scale + h / 2,
          size: TILE_SIZE * scale,
        });
        if (tiles.length >= 200) break;
      }
      if (tiles.length >= 200) break;
    }
  }

  return { project, unproject, pan, tiles, nativeZ, viewZoom, scale };
}

/** Cache key: course name plus lat/lon rounded to a 0.01° cell (~1.1 km). */
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
  return {
    south: cellLat - half,
    west: cellLon - half,
    north: cellLat + half,
    east: cellLon + half,
  };
}

function openCacheDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      const retry = indexedDB.open(DB_NAME, nextVersion);
      retry.onupgradeneeded = () => {
        if (!retry.result.objectStoreNames.contains(STORE_NAME)) {
          retry.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      retry.onsuccess = () => resolve(retry.result);
      retry.onerror = () => reject(retry.error || new Error('IndexedDB upgrade failed'));
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function readCourseCache(key) {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function supabaseConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return typeof url === 'string' && url.startsWith('http') && typeof key === 'string' && key.length > 0;
}

async function readRemoteGeometry(key) {
  if (!supabaseConfigured() || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('course_geometries')
      .select('features, geometry')
      .eq('cache_key', key)
      .maybeSingle();
    if (error || !data) return null;
    const features = Array.isArray(data.features) ? data.features : data.geometry;
    return Array.isArray(features) ? features : null;
  } catch {
    return null;
  }
}

async function upsertRemoteGeometry(record) {
  if (!supabaseConfigured() || !supabase) return;
  try {
    const row = {
      cache_key: record.key,
      course_name: record.courseName || '',
      cell_lat: record.cellLat,
      cell_lon: record.cellLon,
      features: record.features,
      geometry: record.features,
      fetched_at: new Date(record.fetchedAt || Date.now()).toISOString(),
    };
    const { error } = await supabase.from('course_geometries').upsert(row, { onConflict: 'cache_key' });
    if (error) {
      await supabase.from('course_geometries').upsert({ id: record.key, ...row }, { onConflict: 'id' });
    }
  } catch {
    // IndexedDB stays the source of truth when the table is missing or rejected.
  }
}

async function writeCourseCache(record) {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Some sessions create `courses` with an inline keyPath, others with out-of-line keys.
    const req = store.keyPath ? store.put(record) : store.put(record, record.key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

function numericRef(tags = {}) {
  const raw = tags.ref ?? tags['golf:ref'] ?? tags['golf:hole'] ?? '';
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function kindFromTags(tags = {}) {
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
      ref: numericRef(element.tags || {}),
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

async function fetchGolfFeatures(lat, lon, signal) {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: buildOverpassQuery(cellBBox(lat, lon)),
    signal,
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  const data = await response.json();
  return parseOverpass(data);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** 1 yard = 0.9144 m, so yards = meters / 0.9144. */
function metersToYards(meters) {
  return meters / 0.9144;
}

function projectPoint(origin, bearingDeg, yards) {
  const start = validPoint(origin);
  if (!start || !Number.isFinite(yards)) return start;
  const meters = yards * 0.9144;
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (start.lat * Math.PI) / 180;
  const lon1 = (start.lon * Math.PI) / 180;
  const ang = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
    Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
  );
  const lonDeg = ((lon2 * 180) / Math.PI + 540) % 360 - 180;
  return { lat: (lat2 * 180) / Math.PI, lon: lonDeg };
}

function bearingBetween(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Custom slippy fitBounds: center and zoom so every point sits inside the viewport. */
function fitBounds(points, width, height) {
  return fitView(points, width, height);
}

function arcPath(project, origin, bearing, yards, spreadDeg) {
  let path = '';
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    const delta = -spreadDeg + (2 * spreadDeg * i) / steps;
    const point = projectPoint(origin, bearing + delta, yards);
    if (!point) continue;
    const screen = project(point.lat, point.lon);
    path += `${i === 0 ? 'M' : 'L'}${screen.x.toFixed(1)} ${screen.y.toFixed(1)} `;
  }
  return path;
}

/** This map is a custom slippy view, not Leaflet. invalidateSize is used only if a Leaflet map was attached. */
function leafletMapFrom(node) {
  if (!node) return null;
  const attached = node._leaflet_map || node.leafletMap || null;
  if (attached && typeof attached.invalidateSize === 'function') return attached;
  return null;
}

/** Fit the tee-to-green corridor. A lone course center uses zoom 18. */
function fitView(points, width, height) {
  const list = (points || []).map((point) => validPoint(point)).filter(Boolean);
  const only = list[0] || DOCUMENTED_DEFAULT;
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  if (list.length < 2) return { center: only, zoom: 18 };

  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const point of list) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  const span = haversineMeters({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon });
  if (span < 40) return { center, zoom: 18 };

  const pad = 64;
  let chosen = MIN_ZOOM;
  for (let z = 19; z >= MIN_ZOOM; z -= 1) {
    const lonSpan = Math.abs(lonToTileX(maxLon, z) - lonToTileX(minLon, z)) * TILE_SIZE;
    const latSpan = Math.abs(latToTileY(minLat, z) - latToTileY(maxLat, z)) * TILE_SIZE;
    if (lonSpan <= safeW - pad && latSpan <= safeH - pad) {
      chosen = z;
      break;
    }
  }
  return { center, zoom: clampZoom(chosen) };
}

function collectCorridorPoints({ hole, center, features }) {
  const holePoint = validPoint(hole);
  const course = validPoint(center) || holePoint || DOCUMENTED_DEFAULT;
  const holeNumber = Number(hole?.number);
  const kinds = new Set(['hole', 'green']);
  let pool = [];
  if (Number.isFinite(holeNumber)) {
    pool = (features || []).filter((feature) => kinds.has(feature.kind) && Number(feature.ref) === holeNumber);
  }
  if (!pool.length && holePoint) {
    pool = (features || []).filter((feature) => {
      if (!kinds.has(feature.kind)) return false;
      const start = feature.rings?.[0]?.[0];
      return start && haversineMeters(holePoint, start) < 450;
    });
  }
  const points = [];
  const add = (point) => {
    const valid = validPoint(point);
    if (valid) points.push(valid);
  };
  for (const feature of pool) {
    for (const ring of feature.rings || []) {
      if (!ring?.length) continue;
      add(ring[0]);
      add(ring[Math.floor(ring.length / 2)]);
      add(ring[ring.length - 1]);
    }
  }
  add(holePoint);
  if (points.length >= 2) return points;
  return [course];
}

function featureStyle(kind, schematic) {
  if (kind === 'green') {
    return { fill: schematic ? 'rgba(22, 101, 52, 0.38)' : 'rgba(34, 197, 94, 0.42)', stroke: '#4ADE80', width: 1.6, close: true };
  }
  if (kind === 'bunker') {
    return { fill: 'rgba(232, 210, 154, 0.88)', stroke: '#A16207', width: 1.2, close: true };
  }
  if (kind === 'water') {
    return { fill: 'rgba(14, 165, 233, 0.55)', stroke: '#0284C7', width: 1.5, close: true };
  }
  return { fill: 'none', stroke: schematic ? '#9A3412' : '#FBBF24', width: 2.25, close: false };
}

function ringPath(ring, project, close) {
  let path = '';
  ring.forEach((point, index) => {
    const { x, y } = project(point.lat, point.lon);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  });
  if (close && ring.length >= 3) path += 'Z';
  return path;
}

function ToPinReadout({ meters }) {
  const yards = metersToYards(meters);
  const metersLabel = `${Math.round(meters)} m`;
  const yardsLabel = `${Math.round(yards)} yds`;
  let unit = 'yds';
  let primary = yardsLabel;
  try {
    const ctx = useUnits();
    unit = ctx?.distanceUnit === 'm' ? 'm' : 'yds';
    if (typeof ctx?.formatDistance === 'function') {
      const formatted = ctx.formatDistance(yards);
      if (typeof formatted === 'string' && /\d/.test(formatted)) primary = formatted;
    }
  } catch {
    unit = 'yds';
    try {
      const formatted = formatYardsDistance(yards, 'yds');
      if (typeof formatted === 'string' && /\d/.test(formatted)) primary = formatted;
    } catch {
      primary = yardsLabel;
    }
  }
  const secondary = unit === 'm' ? yardsLabel : metersLabel;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        To pin
      </div>
      <div className="tabular-nums text-lg font-semibold leading-tight">{primary}</div>
      <div className="tabular-nums text-[11px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
        {secondary}
      </div>
    </div>
  );
}

export default function SatelliteHoleMap({
  courseName = '',
  center,
  hole,
  origin,
  lat,
  lon,
  holeNumber,
  onPinChange,
  onShotsChange,
  onLivePosition,
  fill = false,
  clubUsed = '',
  carryYards = null,
  markRequest = null,
  aimTarget = 'center',
}) {
  const holeMeta = hole || (holeNumber != null ? { number: holeNumber } : null);
  const propLat = validPoint(holeMeta)?.lat ?? validPoint(center)?.lat ?? (Number.isFinite(Number(lat)) ? Number(lat) : null);
  const propLon = validPoint(holeMeta)?.lon ?? validPoint(center)?.lon ?? (Number.isFinite(Number(lon)) ? Number(lon) : null);

  const [viewCenter, setViewCenter] = useState(() => resolveCenter(center, holeMeta, lat, lon));
  const [zoom, setZoom] = useState(16);
  const [mode, setMode] = useState('satellite');
  const [pin, setPin] = useState(null);
  const [gpsOrigin, setGpsOrigin] = useState(null);
  const [gpsNote, setGpsNote] = useState('');
  const [features, setFeatures] = useState([]);
  const [featureStatus, setFeatureStatus] = useState('Loading course features…');
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [size, setSize] = useState({ width: 360, height: 320 });
  const [shots, setShots] = useState([]);
  const [liveGps, setLiveGps] = useState(null);

  const mapRef = useRef(null);
  const dragRef = useRef(null);
  const onPinChangeRef = useRef(onPinChange);
  const onShotsChangeRef = useRef(onShotsChange);
  const onLivePositionRef = useRef(onLivePosition);
  onPinChangeRef.current = onPinChange;
  onShotsChangeRef.current = onShotsChange;
  onLivePositionRef.current = onLivePosition;
  const viewCenterRef = useRef(viewCenter);
  const zoomRef = useRef(zoom);
  const sizeRef = useRef(size);
  const fitPointsRef = useRef([]);
  const fittedSizeRef = useRef({ width: 0, height: 0 });
  const shotsRef = useRef([]);
  const liveRef = useRef(null);
  const startRef = useRef(null);
  const teeRef = useRef(null);
  const greenRef = useRef(null);
  const clubRef = useRef(clubUsed);
  const recordShotRef = useRef(() => {});
  const markIdRef = useRef(null);
  viewCenterRef.current = viewCenter;
  zoomRef.current = zoom;
  sizeRef.current = size;
  shotsRef.current = shots;
  liveRef.current = liveGps;
  clubRef.current = clubUsed;

  const holeLat = validPoint(hole)?.lat ?? null;
  const holeLon = validPoint(hole)?.lon ?? null;
  const centerLat = validPoint(center)?.lat ?? (Number.isFinite(Number(lat)) ? Number(lat) : null);
  const centerLon = validPoint(center)?.lon ?? (Number.isFinite(Number(lon)) ? Number(lon) : null);
  const corridorPoints = useMemo(
    () => collectCorridorPoints({
      hole: holeLat != null && holeLon != null ? { ...holeMeta, lat: holeLat, lon: holeLon } : { number: holeMeta?.number },
      center: centerLat != null && centerLon != null ? { lat: centerLat, lon: centerLon } : null,
      features,
    }),
    [holeMeta, holeLat, holeLon, centerLat, centerLon, features]
  );
  const coursePoint = centerLat != null && centerLon != null ? { lat: centerLat, lon: centerLon } : DOCUMENTED_DEFAULT;
  const explicitGreen = validPoint({ lat: hole?.greenLat, lon: hole?.greenLon })
    || (holeLat != null && holeLon != null ? { lat: holeLat, lon: holeLon } : null);
  const holeYards = Number(hole?.yards);
  const holeBearing = Number(hole?.bearingDeg);
  const teePoint = validPoint(origin) || coursePoint;
  // Without a surveyed green, project the scorecard yardage from the tee/course coordinate along the hole bearing.
  const greenCenter = explicitGreen || (
    Number.isFinite(holeYards) && Number.isFinite(holeBearing)
      ? projectPoint(teePoint, holeBearing, holeYards)
      : coursePoint
  );
  greenRef.current = greenCenter;
  teeRef.current = validPoint(origin) || coursePoint;
  if (validPoint(origin)) startRef.current = validPoint(origin);

  const lastShot = shots[shots.length - 1];
  const framePoints = [
    ...corridorPoints,
    greenCenter,
    ...(lastShot && Number.isFinite(Number(lastShot.lat)) ? [{ lat: Number(lastShot.lat), lon: Number(lastShot.lng) }] : []),
  ];
  fitPointsRef.current = framePoints;
  const corridorKey = `${holeNumber ?? hole?.number ?? ''}|${framePoints.map((point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`).join('|')}`;

  useEffect(() => {
    if (!fill) {
      if (propLat != null && propLon != null) setViewCenter({ lat: propLat, lon: propLon });
      else setViewCenter(resolveCenter(null, null));
    }
    setPin(null);
    onPinChangeRef.current?.(null);
  }, [propLat, propLon, courseName, hole?.number, holeNumber, fill]);

  useEffect(() => {
    if (!fill) return undefined;
    shotsRef.current = [];
    setShots([]);
    onShotsChangeRef.current?.([]);
    setPin(null);
  }, [fill, courseName, hole?.number, holeNumber]);

  useEffect(() => {
    if (!fill || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = validPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!next) return;
        if (!startRef.current) startRef.current = next;
        liveRef.current = next;
        setLiveGps(next);
        onLivePositionRef.current?.({ lat: next.lat, lon: next.lon, lng: next.lon });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [fill]);

  recordShotRef.current = (point, clubOverride, notifyPin = true) => {
    const lie = validPoint(point);
    if (!lie) return;
    const prevShots = shotsRef.current;
    const previous = prevShots.length
      ? { lat: Number(prevShots[prevShots.length - 1].lat), lon: Number(prevShots[prevShots.length - 1].lng) }
      : teeRef.current || validPoint(origin) || lie;
    const green = greenRef.current || lie;
    const distanceFromPrev = Math.round(metersToYards(haversineMeters(previous, lie)));
    const remainingToCenter = Math.round(metersToYards(haversineMeters(lie, green)));
    const shot = {
      shotNumber: prevShots.length + 1,
      lat: lie.lat,
      lng: lie.lon,
      clubUsed: clubOverride || clubRef.current || '—',
      distanceFromPrev,
      remainingToCenter,
    };
    const next = [...prevShots, shot];
    shotsRef.current = next;
    setShots(next);
    onShotsChangeRef.current?.(next);
    if (notifyPin) {
      onPinChangeRef.current?.({
        lat: lie.lat,
        lon: lie.lon,
        yards: remainingToCenter,
        meters: remainingToCenter * 0.9144,
      });
    }
    const layout = sizeRef.current;
    const fit = fitBounds([lie, green, ...(startRef.current ? [startRef.current] : [])], layout.width, layout.height);
    fittedSizeRef.current = { width: layout.width, height: layout.height };
    setViewCenter(fit.center);
    setZoom(fit.zoom);
  };

  useEffect(() => {
    if (!fill || !markRequest?.id || markRequest.id === markIdRef.current) return;
    markIdRef.current = markRequest.id;
    const last = shotsRef.current[shotsRef.current.length - 1];
    const point = liveRef.current
      || (last ? { lat: last.lat, lon: last.lng } : null)
      || validPoint(origin)
      || viewCenterRef.current;
    recordShotRef.current(point, markRequest.club);
  }, [fill, markRequest, origin]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useLayoutEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;

    // Remeasure the slippy viewport. Leaflet maps, if one was attached, get invalidateSize().
    // The full-screen round refits the tee-to-green corridor; the setup card only remeasures.
    const resizeAndRecenter = (reason) => {
      const leafletMap = leafletMapFrom(el);
      if (leafletMap) leafletMap.invalidateSize(false);

      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;

      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      if (!fill) return;

      const prevSize = fittedSizeRef.current;
      const jumped =
        prevSize.width === 0 ||
        Math.abs(width - prevSize.width) >= 8 ||
        Math.abs(height - prevSize.height) >= 8;
      if (reason === 'resize' && !jumped) return;

      const fit = fitBounds(fitPointsRef.current, width, height);
      fittedSizeRef.current = { width, height };
      setViewCenter(fit.center);
      setZoom(fit.zoom);
    };

    resizeAndRecenter('mount');
    const raf = requestAnimationFrame(() => resizeAndRecenter('mount'));
    const onResize = () => resizeAndRecenter('resize');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(el);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [corridorKey, courseName, fill]);

  const cellLat = Math.round(viewCenter.lat * 100) / 100;
  const cellLon = Math.round(viewCenter.lon * 100) / 100;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const key = courseCacheKey(courseName, cellLat, cellLon);
    const queryLat = cellLat;
    const queryLon = cellLon;

    async function load() {
      let hadCache = false;
      try {
        const cached = await readCourseCache(key);
        if (cancelled) return;
        if (Array.isArray(cached?.features) && cached.features.length) {
          hadCache = true;
          setFeatures(cached.features);
          setFeatureStatus(navigator.onLine === false ? 'Offline — showing saved course features' : 'Saved course features');
        } else if (navigator.onLine === false) {
          setFeatures([]);
          setFeatureStatus('Offline — basemap only');
        } else {
          const remote = await readRemoteGeometry(key);
          if (cancelled) return;
          if (Array.isArray(remote) && remote.length) {
            hadCache = true;
            setFeatures(remote);
            setFeatureStatus('Saved course features');
            writeCourseCache({
              key,
              courseName: courseName || '',
              cellLat: queryLat,
              cellLon: queryLon,
              features: remote,
              fetchedAt: Date.now(),
            }).catch(() => {});
          } else {
            setFeatureStatus('Loading course features…');
          }
        }
      } catch {
        if (cancelled) return;
        if (navigator.onLine === false) setFeatureStatus('Offline — basemap only');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      try {
        const fresh = await fetchGolfFeatures(queryLat, queryLon, controller.signal);
        if (cancelled) return;
        setFeatures(fresh);
        setFeatureStatus(fresh.length ? `${fresh.length} course features` : 'No mapped golf features in this view');
        const record = {
          key,
          courseName: courseName || '',
          cellLat: queryLat,
          cellLon: queryLon,
          features: fresh,
          fetchedAt: Date.now(),
        };
        writeCourseCache(record).catch(() => {});
        upsertRemoteGeometry(record);
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') return;
        setFeatureStatus(hadCache ? 'Showing saved course features' : 'Course data unavailable');
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cellLat, cellLon, courseName, online]);

  const view = useMemo(
    () => makeView(viewCenter, zoom, size.width, size.height),
    [viewCenter, zoom, size.width, size.height]
  );

  const measuredFrom = validPoint(gpsOrigin) || validPoint(origin) || viewCenter;
  const originLabel = validPoint(gpsOrigin) ? 'From GPS' : validPoint(origin) ? 'From tee' : 'From map center';
  const pinMeters = pin ? haversineMeters(measuredFrom, pin) : null;
  const schematic = mode === 'schematic';

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    dragRef.current = {
      id: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer already ended.
    }
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.moved) return;
    const currentSize = sizeRef.current;
    setViewCenter((current) => makeView(current, zoomRef.current, currentSize.width, currentSize.height).pan(dx, dy));
  };

  const onPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) return;
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const layout = sizeRef.current;
    const x = ((event.clientX - rect.left) / rect.width) * layout.width;
    const y = ((event.clientY - rect.top) / rect.height) * layout.height;
    const nextPin = makeView(viewCenterRef.current, zoomRef.current, layout.width, layout.height).unproject(x, y);
    setPin(nextPin);
    const from = validPoint(gpsOrigin) || validPoint(origin) || viewCenterRef.current;
    const meters = haversineMeters(from, nextPin);
    onPinChangeRef.current?.({
      lat: nextPin.lat,
      lon: nextPin.lon,
      yards: metersToYards(meters),
      meters,
    });
    if (fill) recordShotRef.current(nextPin, undefined, false);
  };

  const useMyGps = () => {
    if (!navigator.geolocation) {
      setGpsNote('GPS unavailable — using map center');
      return;
    }
    setGpsNote('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = validPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!next) {
          setGpsNote('GPS unavailable — using map center');
          return;
        }
        setGpsOrigin(next);
        setGpsNote('GPS origin set');
      },
      () => setGpsNote('GPS unavailable — using map center'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  };

  const holeLabel = holeMeta?.number != null
    ? `Hole ${holeMeta.number}${holeMeta.par ? ` · Par ${holeMeta.par}` : ''}`
    : 'Hole map';

  const originScreen = view.project(measuredFrom.lat, measuredFrom.lon);
  const pinScreen = pin ? view.project(pin.lat, pin.lon) : null;
  const ballPoint = lastShot && Number.isFinite(Number(lastShot.lat))
    ? { lat: Number(lastShot.lat), lon: Number(lastShot.lng) }
    : liveGps;
  const aimBearingBase = Number.isFinite(holeBearing)
    ? holeBearing
    : (ballPoint && greenCenter ? bearingBetween(ballPoint, greenCenter) : 0);
  const targetPoint = aimTarget === 'front'
    ? projectPoint(greenCenter, aimBearingBase + 180, 12)
    : aimTarget === 'back'
      ? projectPoint(greenCenter, aimBearingBase, 14)
      : greenCenter;
  const ballScreen = ballPoint ? view.project(ballPoint.lat, ballPoint.lon) : null;
  const targetScreen = targetPoint ? view.project(targetPoint.lat, targetPoint.lon) : null;
  const liveScreen = liveGps ? view.project(liveGps.lat, liveGps.lon) : null;
  const shotScreens = shots.map((shot) => ({
    ...shot,
    ...view.project(Number(shot.lat), Number(shot.lng)),
  }));
  const carry = Number(carryYards);
  const aimBearing = ballPoint && targetPoint ? bearingBetween(ballPoint, targetPoint) : null;
  const shotPath = shotScreens.length
    ? shotScreens.map((shot, index) => `${index === 0 ? 'M' : 'L'}${shot.x.toFixed(1)} ${shot.y.toFixed(1)}`).join(' ')
    : '';

  const frameGps = () => {
    const points = [];
    if (liveRef.current) points.push(liveRef.current);
    if (greenRef.current) points.push(greenRef.current);
    const last = shotsRef.current[shotsRef.current.length - 1];
    if (last) points.push({ lat: Number(last.lat), lon: Number(last.lng) });
    if (!points.length) return;
    const fit = fitBounds(points, sizeRef.current.width, sizeRef.current.height);
    fittedSizeRef.current = { width: sizeRef.current.width, height: sizeRef.current.height };
    setViewCenter(fit.center);
    setZoom(fit.zoom);
  };

  const modeToggle = (
    <div
      className="flex overflow-hidden rounded-2xl border daylight-border shrink-0"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'rgba(11,13,12,0.72)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setMode('satellite')}
        aria-pressed={mode === 'satellite'}
        className="px-2.5 py-1.5 text-[11px] font-semibold"
        style={{
          backgroundColor: mode === 'satellite' ? 'var(--accent-emerald)' : 'transparent',
          color: mode === 'satellite' ? '#fff' : (fill ? '#F3F4F1' : 'var(--text-primary)'),
        }}
      >
        Satellite
      </button>
      <button
        type="button"
        onClick={() => setMode('schematic')}
        aria-pressed={mode === 'schematic'}
        className="px-2.5 py-1.5 text-[11px] font-semibold"
        style={{
          backgroundColor: mode === 'schematic' ? 'var(--accent-emerald)' : 'transparent',
          color: mode === 'schematic' ? '#fff' : (fill ? '#F3F4F1' : 'var(--text-primary)'),
        }}
      >
        Schematic
      </button>
    </div>
  );

  return (
    <section
      className={fill ? 'relative h-full w-full overflow-hidden' : 'w-full max-w-md overflow-hidden rounded-2xl border'}
      style={fill
        ? { backgroundColor: '#0B0D0C' }
        : { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      aria-label="Satellite hole map"
    >
      {!fill && (
        <div className="flex shrink-0 items-start justify-between gap-2 px-3 pb-2 pt-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{courseName || 'Satellite hole map'}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{holeLabel}</div>
          </div>
          {modeToggle}
        </div>
      )}

      <div
        ref={mapRef}
        className={fill
          ? 'absolute inset-0 h-full w-full overflow-hidden touch-none select-none cursor-crosshair'
          : 'relative h-[320px] w-full overflow-hidden touch-none select-none cursor-crosshair'}
        style={{
          backgroundColor: schematic ? 'var(--bg-elevated)' : '#102018',
          backgroundImage: schematic
            ? 'radial-gradient(ellipse at 50% 42%, rgba(35, 134, 93, 0.72), rgba(23, 91, 63, 0.22) 48%, transparent 72%)'
            : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {mode === 'satellite' && view.tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            width={Math.ceil(tile.size)}
            height={Math.ceil(tile.size)}
            className="absolute max-w-none pointer-events-none"
            style={{ left: `${tile.x}px`, top: `${tile.y}px`, width: `${tile.size}px`, height: `${tile.size}px` }}
            onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
          />
        ))}

        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`}>
          {features.map((feature) => {
            const style = featureStyle(feature.kind, schematic);
            return feature.rings.map((ring, index) => (
              <path
                key={`${feature.id}-${index}`}
                d={ringPath(ring, view.project, style.close)}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ));
          })}
          {features.map((feature) => {
            if (feature.kind !== 'hole') return null;
            const ring = feature.rings[0];
            if (!ring?.length) return null;
            const end = view.project(ring[ring.length - 1].lat, ring[ring.length - 1].lon);
            return <circle key={`${feature.id}-pin`} cx={end.x} cy={end.y} r="4.5" fill="#FBBF24" stroke="#111827" strokeWidth="1.2" />;
          })}
          {pinScreen && !fill && (
            <g>
              <line
                x1={originScreen.x}
                y1={originScreen.y}
                x2={pinScreen.x}
                y2={pinScreen.y}
                stroke={schematic ? '#9A3412' : '#F8FAFC'}
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <circle cx={originScreen.x} cy={originScreen.y} r="5" fill="#38BDF8" stroke="#fff" strokeWidth="1.5" />
              <circle cx={pinScreen.x} cy={pinScreen.y} r="6" fill="#EF4444" stroke="#fff" strokeWidth="1.6" />
            </g>
          )}
          {fill && ballPoint && aimBearing != null && Number.isFinite(carry) && carry > 0 && (
            <g fill="none" stroke="#10B981" strokeWidth="1.25" opacity="0.55">
              <path d={arcPath(view.project, ballPoint, aimBearing, carry, 18)} />
              <path d={arcPath(view.project, ballPoint, aimBearing, Math.max(10, carry * 0.82), 12)} strokeDasharray="3 3" opacity="0.8" />
            </g>
          )}
          {fill && shotPath && (
            <path d={shotPath} fill="none" stroke="#D4AF37" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {fill && shotScreens.map((shot) => (
            <g key={`shot-${shot.shotNumber}`}>
              <circle cx={shot.x} cy={shot.y} r="9" fill="#D4AF37" stroke="#0B0D0C" strokeWidth="1.4" />
              <text x={shot.x} y={shot.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0B0D0C">{shot.shotNumber}</text>
            </g>
          ))}
          {fill && ballScreen && targetScreen && (
            <line
              x1={ballScreen.x}
              y1={ballScreen.y}
              x2={targetScreen.x}
              y2={targetScreen.y}
              stroke="#10B981"
              strokeWidth="1.6"
              strokeDasharray="5 4"
            />
          )}
          {fill && liveScreen && (
            <g>
              <circle cx={liveScreen.x} cy={liveScreen.y} r="14" fill="#10B981" opacity="0.35">
                <animate attributeName="r" values="8;18;8" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.08;0.5" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={liveScreen.x} cy={liveScreen.y} r="6" fill="#10B981" stroke="#fff" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {fill && (
          <div
            className="absolute left-3 z-10 flex flex-col gap-1.5 top-[calc(env(safe-area-inset-top)+4.75rem)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {modeToggle}
            <button
              type="button"
              onClick={() => recordShotRef.current(liveRef.current || ballPoint || viewCenterRef.current)}
              className="min-h-[44px] rounded-2xl bg-[#0B0D0C]/85 px-2.5 text-[11px] font-semibold text-white backdrop-blur-md"
            >
              Log Shot
            </button>
            <button
              type="button"
              onClick={frameGps}
              aria-label="Re-center on GPS"
              className="min-h-[44px] rounded-2xl bg-[#0B0D0C]/85 px-2.5 text-[11px] font-semibold text-[#10B981] backdrop-blur-md"
            >
              GPS
            </button>
          </div>
        )}

        <div
          className={`absolute z-10 flex flex-col overflow-hidden rounded-xl border daylight-border ${fill ? 'right-3 top-[calc(env(safe-area-inset-top)+4.75rem)]' : 'top-2 right-2'}`}
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] text-lg font-semibold leading-none"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => clampZoom(z + 1))}
          >
            +
          </button>
          <div className="text-[10px] text-center font-mono tabular-nums border-y" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {zoom}
          </div>
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] text-lg font-semibold leading-none"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => clampZoom(z - 1))}
          >
            −
          </button>
        </div>

        {mode === 'satellite' && (
          <div className={`absolute z-10 text-[9px] px-1 rounded pointer-events-none ${fill ? 'left-3 bottom-[calc(env(safe-area-inset-bottom)+6.75rem)]' : 'bottom-1 left-1.5'}`} style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}>
            © Esri
          </div>
        )}
      </div>

      {!fill && <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          {pinMeters == null ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>To pin</div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Tap the map to drop a pin</div>
            </div>
          ) : (
            <ToPinReadout meters={pinMeters} />
          )}
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {pinMeters == null ? 'Distance uses GPS or the map center' : originLabel}
            {gpsNote ? ` · ${gpsNote}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={useMyGps}
          className="shrink-0 min-h-[44px] px-3 py-2 rounded-xl text-[11px] font-semibold border"
          style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          Use my GPS
        </button>
      </div>}

      {!fill && <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-3 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#4ADE80' }} />Green</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#E6D2A1' }} />Bunker</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#38BDF8' }} />Water</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: '#FBBF24' }} />Hole</span>
        <span className="truncate">{featureStatus}</span>
      </div>}
    </section>
  );
}
