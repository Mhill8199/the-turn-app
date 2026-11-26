import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { awardDailyPin, rememberDailyPin } from './pinScout';

/** Crowd-sourced flags. Distinct from the-turn-course-cache and the-turn-courses-cache. */
const DB_NAME = 'the-turn-pin-placements';
const STORE_NAME = 'placements';

const ZONES = [
  'front-left',
  'front-center',
  'front-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'back-left',
  'back-center',
  'back-right',
];

const YARD = 0.9144;
const METERS_PER_DEG = 111320;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function localPlayDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isWeekendPlayDate(playDate) {
  const match = String(playDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay();
  return day === 0 || day === 6;
}

export function formatZoneLabel(zone) {
  const known = ZONES.includes(zone) ? zone : 'middle-center';
  return known.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
}

function normalizePoint(point) {
  const lat = finite(point?.lat);
  const lng = finite(point?.lng ?? point?.lon);
  if (lat == null || lng == null) return null;
  return { lat, lng, lon: lng };
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;
  const points = ring.map((point) => normalizePoint(point)).filter(Boolean);
  return points.length >= 3 ? points : null;
}

function localOffsetMeters(origin, point) {
  const lat0 = (origin.lat * Math.PI) / 180;
  const north = (point.lat - origin.lat) * METERS_PER_DEG;
  const east = (point.lng - origin.lng) * METERS_PER_DEG * Math.cos(lat0);
  return { east, north };
}

function fromLocalOffset(origin, east, north) {
  const lat0 = (origin.lat * Math.PI) / 180;
  const cos = Math.cos(lat0) || 1e-6;
  return normalizePoint({
    lat: origin.lat + north / METERS_PER_DEG,
    lng: origin.lng + east / (METERS_PER_DEG * cos),
  });
}

/** Along is positive past the green center (back). Cross is positive to the player's right, looking at the green. */
function alongCrossMeters(origin, point, bearingDeg) {
  const { east, north } = localOffsetMeters(origin, point);
  const bearing = ((Number(bearingDeg) || 0) * Math.PI) / 180;
  const along = north * Math.cos(bearing) + east * Math.sin(bearing);
  const cross = east * Math.cos(bearing) - north * Math.sin(bearing);
  return { along, cross };
}

function axisBand(value, min, max, low, mid, high) {
  const span = max - min;
  if (!Number.isFinite(span) || span < 4) return null;
  const t = (value - min) / span;
  if (t < 1 / 3) return low;
  if (t < 2 / 3) return mid;
  return high;
}

function pointInRing(point, ring) {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i].lat;
    const xi = ring[i].lng;
    const yj = ring[j].lat;
    const xj = ring[j].lng;
    const crosses = (yi > y) !== (yj > y);
    if (!crosses) continue;
    const xCross = ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (x < xCross) inside = !inside;
  }
  return inside;
}

function closestOnRing(point, ring, origin) {
  const target = localOffsetMeters(origin, point);
  let best = null;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const start = localOffsetMeters(origin, ring[i]);
    const end = localOffsetMeters(origin, ring[(i + 1) % ring.length]);
    const dx = end.east - start.east;
    const dy = end.north - start.north;
    const len2 = dx * dx + dy * dy || 1e-6;
    let t = ((target.east - start.east) * dx + (target.north - start.north) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const east = start.east + dx * t;
    const north = start.north + dy * t;
    const distance = (east - target.east) ** 2 + (north - target.north) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fromLocalOffset(origin, east, north);
    }
  }
  return best;
}

export function snapOntoGreen(point, greenCenter, greenRing) {
  const raw = normalizePoint(point);
  const center = normalizePoint(greenCenter);
  if (!raw) return center;
  const ring = normalizeRing(greenRing);
  if (ring) {
    if (pointInRing(raw, ring)) return raw;
    return closestOnRing(raw, ring, center || raw) || raw;
  }
  if (!center) return raw;
  const { east, north } = localOffsetMeters(center, raw);
  const distance = Math.hypot(east, north);
  const limit = 18 * YARD;
  if (distance <= limit || distance < 0.5) return raw;
  const scale = limit / distance;
  return fromLocalOffset(center, east * scale, north * scale);
}

export function classifyGreenZone(pin, greenCenter, holeBearingDeg, greenRing) {
  const point = normalizePoint(pin);
  const center = normalizePoint(greenCenter);
  if (!point || !center) return 'middle-center';
  const spot = alongCrossMeters(center, point, holeBearingDeg);
  let alongMin = null;
  let alongMax = null;
  let crossMin = null;
  let crossMax = null;
  const ring = normalizeRing(greenRing);
  if (ring) {
    const samples = ring.map((vertex) => alongCrossMeters(center, vertex, holeBearingDeg));
    alongMin = Math.min(...samples.map((sample) => sample.along));
    alongMax = Math.max(...samples.map((sample) => sample.along));
    crossMin = Math.min(...samples.map((sample) => sample.cross));
    crossMax = Math.max(...samples.map((sample) => sample.cross));
  }
  if (!(alongMax - alongMin >= 4)) {
    alongMin = -12 * YARD;
    alongMax = 14 * YARD;
  }
  if (!(crossMax - crossMin >= 4)) {
    crossMin = -12 * YARD;
    crossMax = 12 * YARD;
  }
  const depth = axisBand(spot.along, alongMin, alongMax, 'front', 'middle', 'back') || 'middle';
  const side = axisBand(spot.cross, crossMin, crossMax, 'left', 'center', 'right') || 'center';
  return `${depth}-${side}`;
}

/**
 * Weekend vs weekday buckets. A percentage needs 4 placements and a single leading zone.
 * Fewer than 3 placements omits the insight. 3 placements name the zone and omit the percentage.
 */
export function greenskeeperTendency(records, playDate) {
  const weekend = isWeekendPlayDate(playDate || localPlayDate());
  const bucket = (Array.isArray(records) ? records : []).filter((row) => {
    return row?.green_zone && ZONES.includes(row.green_zone) && isWeekendPlayDate(row.play_date) === weekend;
  });
  if (bucket.length < 3) return null;
  const counts = {};
  for (const row of bucket) counts[row.green_zone] = (counts[row.green_zone] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null;
  const [zone, count] = ranked[0];
  const when = weekend ? 'Weekends' : 'Weekdays';
  const label = formatZoneLabel(zone);
  if (bucket.length >= 4) {
    const pct = Math.round((count / bucket.length) * 100);
    return `Greenskeeper Tendency: ${pct}% ${label} on ${when}`;
  }
  return `Greenskeeper Tendency: ${label} on ${when}`;
}

export function readStandingPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation?.getCurrentPosition) {
      reject(new Error('GPS unavailable. Drag the flag on the green.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = normalizePoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        if (!point) {
          reject(new Error('GPS unavailable. Drag the flag on the green.'));
          return;
        }
        resolve(point);
      },
      () => reject(new Error('GPS unavailable. Drag the flag on the green.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function holeKey(courseId, holeNumber) {
  return `${String(courseId ?? '')}|${Number(holeNumber) || 0}`;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function openPinDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('byHole', 'holeKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAllLocal() {
  try {
    const db = await openPinDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const rows = await requestToPromise(tx.objectStore(STORE_NAME).getAll());
      return Array.isArray(rows) ? rows : [];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

async function putLocal(record) {
  if (!record?.id) return false;
  try {
    const db = await openPinDb();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      await transactionDone(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    // Offline cache is best-effort. The in-memory pin still drives the round.
    return false;
  }
}

async function hasDailyPin(record) {
  const rows = await readAllLocal();
  const userId = record?.reported_by || null;
  return rows.some((row) => {
    if (!row || row.id === record.id) return false;
    if (String(row.course_id ?? '') !== String(record.course_id ?? '')) return false;
    if (Number(row.hole_number) !== Number(record.hole_number)) return false;
    if (String(row.play_date || '') !== String(record.play_date || '')) return false;
    const ownLocal = String(row.id || '').startsWith('local-');
    if (userId) return row.reported_by === userId || (ownLocal && !row.reported_by);
    return ownLocal;
  });
}

function notePinScout(record, { prior, savedLocal, savedRemote }) {
  const identity = {
    courseId: record.course_id,
    holeNumber: record.hole_number,
    playDate: record.play_date,
  };
  try {
    if (prior) {
      rememberDailyPin(identity);
      return;
    }
    if (savedLocal || savedRemote) awardDailyPin(identity);
  } catch {
    // XP is optional. A failed stat write must not reject the pin.
  }
}

function recency(row) {
  const stamp = Date.parse(row?.created_at || '');
  return Number.isFinite(stamp) ? stamp : 0;
}

function sameSpot(a, b) {
  if (!a || !b || a.play_date !== b.play_date) return false;
  const north = (a.lat - b.lat) * METERS_PER_DEG;
  const east = (a.lng - b.lng) * METERS_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(north, east) < 4;
}

function normalizeRemote(row) {
  const point = normalizePoint(row);
  if (!point) return null;
  const confirmations = finite(row?.confirmations);
  const playDate = String(row?.play_date || '').slice(0, 10);
  const remoteId = row?.id ?? null;
  return {
    id: remoteId != null ? `remote-${remoteId}` : `remote-${point.lat.toFixed(5)}-${point.lng.toFixed(5)}-${playDate}`,
    remote_id: remoteId,
    course_id: row?.course_id != null ? String(row.course_id) : '',
    course_name: row?.course_name || '',
    hole_number: Number(row?.hole_number) || 0,
    play_date: playDate,
    lat: point.lat,
    lng: point.lng,
    green_zone: ZONES.includes(row?.green_zone) ? row.green_zone : '',
    reported_by: row?.reported_by || null,
    confirmations: confirmations == null ? 0 : confirmations,
    created_at: row?.created_at || row?.inserted_at || '',
    holeKey: holeKey(row?.course_id, row?.hole_number),
  };
}

function mergeRows(localRows, remoteRows) {
  const merged = localRows.map((row) => ({ ...row }));
  for (const remote of remoteRows) {
    const index = merged.findIndex((row) => (
      (remote.remote_id != null && row.remote_id === remote.remote_id) || sameSpot(row, remote)
    ));
    if (index === -1) {
      merged.push(remote);
      continue;
    }
    const current = merged[index];
    merged[index] = {
      ...current,
      ...remote,
      id: current.id || remote.id,
      remote_id: remote.remote_id ?? current.remote_id ?? null,
      confirmations: Math.max(Number(current.confirmations) || 0, Number(remote.confirmations) || 0),
      created_at: recency(remote) >= recency(current) ? (remote.created_at || current.created_at) : current.created_at,
      green_zone: remote.green_zone || current.green_zone,
      holeKey: current.holeKey || remote.holeKey,
    };
  }
  return merged;
}

function pickToday(rows, playDate) {
  const todays = rows.filter((row) => row.play_date === playDate && finite(row.lat) != null && finite(row.lng) != null);
  todays.sort((a, b) => recency(b) - recency(a) || (Number(b.confirmations) || 0) - (Number(a.confirmations) || 0));
  return todays[0] || null;
}

async function fetchRemotePins(courseId, holeNumber) {
  try {
    const { data, error } = await supabase
      .from('pin_placements')
      .select('*')
      .eq('course_id', String(courseId))
      .eq('hole_number', Number(holeNumber))
      .limit(500);
    if (error || !Array.isArray(data)) return [];
    return data.map((row) => normalizeRemote(row)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function loadHolePins({ courseId, holeNumber, playDate = localPlayDate() }) {
  const key = holeKey(courseId, holeNumber);
  const local = (await readAllLocal()).filter((row) => row?.holeKey === key || (
    String(row?.course_id) === String(courseId) && Number(row?.hole_number) === Number(holeNumber)
  ));
  const remote = courseId == null ? [] : await fetchRemotePins(courseId, holeNumber);
  const history = mergeRows(local, remote).filter((row) => (
    String(row.course_id) === String(courseId) && Number(row.hole_number) === Number(holeNumber)
  ));
  await Promise.all(history.map((row) => putLocal({ ...row, holeKey: row.holeKey || key })));
  return { today: pickToday(history, playDate), history };
}

export async function savePinPlacement({
  courseId,
  courseName = '',
  holeNumber,
  playDate = localPlayDate(),
  lat,
  lng,
  greenCenter,
  holeBearingDeg = 0,
  greenRing = null,
  userId = null,
}) {
  const snapped = snapOntoGreen({ lat, lng }, greenCenter, greenRing);
  if (!snapped) return null;
  const greenZone = classifyGreenZone(snapped, greenCenter, holeBearingDeg, greenRing);
  const record = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    remote_id: null,
    course_id: courseId == null ? '' : String(courseId),
    course_name: courseName || '',
    hole_number: Number(holeNumber) || 0,
    play_date: playDate,
    lat: snapped.lat,
    lng: snapped.lng,
    green_zone: greenZone,
    reported_by: userId || null,
    confirmations: 0,
    created_at: new Date().toISOString(),
    holeKey: holeKey(courseId, holeNumber),
  };
  const prior = await hasDailyPin(record);
  const localOk = await putLocal(record);
  let saved = record;
  let remoteOk = false;
  try {
    const payload = {
      course_id: record.course_id,
      course_name: record.course_name,
      hole_number: record.hole_number,
      play_date: record.play_date,
      lat: record.lat,
      lng: record.lng,
      green_zone: record.green_zone,
      reported_by: record.reported_by,
    };
    const { data, error } = await supabase.from('pin_placements').insert(payload).select('*').maybeSingle();
    if (!error && data) {
      remoteOk = true;
      const remote = normalizeRemote(data);
      if (remote) {
        const merged = {
          ...record,
          remote_id: remote.remote_id,
          confirmations: Math.max(record.confirmations, remote.confirmations || 0),
          created_at: remote.created_at || record.created_at,
        };
        await putLocal(merged);
        saved = merged;
      }
    }
  } catch {
    // Missing table, RLS, or offline: the IndexedDB record already stands.
  }
  notePinScout(saved, { prior, savedLocal: localOk, savedRemote: remoteOk });
  return saved;
}

export async function confirmPinPlacement(record) {
  if (!record?.id) return record;
  const next = {
    ...record,
    confirmations: Number(record.confirmations) || 0,
    holeKey: record.holeKey || holeKey(record.course_id, record.hole_number),
  };
  await putLocal(next);
  if (next.remote_id == null) return next;
  try {
    const { error } = await supabase
      .from('pin_placements')
      .update({ confirmations: next.confirmations })
      .eq('id', next.remote_id);
    if (error) return next;
  } catch {
    return next;
  }
  return next;
}

export function useHolePinFeed({ courseId, courseName, holeNumber, userId }) {
  const [livePin, setLivePin] = useState(null);
  const [history, setHistory] = useState([]);
  const playDate = localPlayDate();
  const requestRef = useRef(0);
  const liveRef = useRef(null);
  liveRef.current = livePin;

  const reload = useCallback(async () => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    const result = await loadHolePins({ courseId, holeNumber, playDate });
    if (token !== requestRef.current) return;
    setHistory(result.history);
    setLivePin(result.today);
    liveRef.current = result.today;
  }, [courseId, holeNumber, playDate]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const save = useCallback(async (input) => {
    const saved = await savePinPlacement({
      courseId,
      courseName,
      holeNumber,
      playDate,
      userId,
      lat: input?.lat,
      lng: input?.lng ?? input?.lon,
      greenCenter: input?.greenCenter,
      holeBearingDeg: input?.holeBearingDeg,
      greenRing: input?.greenRing,
    });
    if (!saved) return null;
    setLivePin(saved);
    liveRef.current = saved;
    setHistory((current) => {
      const rest = current.filter((row) => row.id !== saved.id && !sameSpot(row, saved));
      return [saved, ...rest];
    });
    return saved;
  }, [courseId, courseName, holeNumber, playDate, userId]);

  const confirm = useCallback(async () => {
    const current = liveRef.current;
    if (!current) return null;
    const next = { ...current, confirmations: (Number(current.confirmations) || 0) + 1 };
    liveRef.current = next;
    setLivePin(next);
    setHistory((rows) => rows.map((row) => (row.id === next.id || sameSpot(row, next) ? { ...row, confirmations: next.confirmations } : row)));
    try {
      await confirmPinPlacement(next);
    } catch {
      // The local count stays on screen.
    }
    return next;
  }, []);

  const tendency = useMemo(() => greenskeeperTendency(history, playDate), [history, playDate]);

  return { livePin, history, tendency, playDate, save, confirm, reload };
}
