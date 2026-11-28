import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const API_BASE = 'https://api.golfintelligence.com';
const DEFAULT_TOKEN_MS = 50 * 60 * 1000;

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

type JsonRecord = Record<string, unknown>;
type LngLat = [number, number];
type ShapeKind = 'tee' | 'fairway' | 'bunker' | 'penalty' | 'green';

interface ScoreHole {
  holeId?: number;
  number: number;
  par?: number;
  yardage?: number;
  handicap?: number;
  teePoint?: LngLat;
  greenPoint?: LngLat;
}

interface ShapeBucket {
  tee: LngLat[][];
  fairway: LngLat[][];
  bunker: LngLat[][];
  penalty: LngLat[][];
  green: LngLat[][];
  teePoint?: LngLat;
  greenPoint?: LngLat;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  return null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function num(value: unknown): number | null {
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clearAccessToken() {
  cachedAccessToken = '';
  cachedAccessTokenExpiresAt = 0;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) return cachedAccessToken;

  const clientId = Deno.env.get('GOLF_INTEL_CLIENT_ID') || '';
  const activeToken = Deno.env.get('GOLF_INTEL_ACTIVE_TOKEN') || '';
  if (!clientId || !activeToken) {
    throw new Error('Golf Intelligence proxy is not configured');
  }

  const response = await fetch(`${API_BASE}/auth/authenticateToken`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      code: activeToken,
    }).toString(),
  });

  if (!response.ok) {
    clearAccessToken();
    throw new Error(`Golf Intelligence authentication failed (${response.status})`);
  }

  let payload: JsonRecord = {};
  try {
    payload = asRecord(await response.json()) || {};
  } catch {
    throw new Error('Golf Intelligence authentication did not return an access token');
  }

  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Golf Intelligence authentication did not return an access token');
  }

  const expiresIn = num(payload.expires_in);
  const lifetimeMs = expiresIn && expiresIn > 0 ? expiresIn * 1000 : DEFAULT_TOKEN_MS;
  const skew = expiresIn && expiresIn > 0 ? Math.min(60_000, lifetimeMs / 2) : 0;
  cachedAccessToken = accessToken;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(1000, lifetimeMs - skew);
  return cachedAccessToken;
}

async function giFetch(path: string, init: RequestInit = {}, allowRetry = true): Promise<unknown> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401 && allowRetry) {
    clearAccessToken();
    return giFetch(path, init, false);
  }
  if (!response.ok) {
    throw new Error(`Golf Intelligence request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function storedGeometry(row: JsonRecord | null): JsonRecord | null {
  if (!row) return null;
  for (const candidate of [row.payload, row.geometry, row.features]) {
    const record = asRecord(candidate);
    if (record && Array.isArray(record.holes) && record.holes.length && (record.publicId || record.source === 'golf-intel')) {
      return record;
    }
  }
  return null;
}

async function readCachedGeometry(admin: SupabaseClient, publicId: string): Promise<JsonRecord | null> {
  for (const column of ['public_id', 'cache_key', 'id']) {
    try {
      const { data, error } = await admin.from('course_geometries').select('*').eq(column, publicId).maybeSingle();
      if (error || !data) continue;
      const hit = storedGeometry(asRecord(data));
      if (hit) return hit;
    } catch {
      // The table shape varies. Another key may still match this publicId.
    }
  }
  return null;
}

async function saveCachedGeometry(admin: SupabaseClient, publicId: string, normalized: JsonRecord) {
  const stamped = new Date().toISOString();
  const rows: JsonRecord[] = [
    {
      public_id: publicId,
      cache_key: publicId,
      course_name: normalized.name || '',
      geometry: normalized,
      features: normalized,
      payload: normalized,
      fetched_at: stamped,
    },
    {
      cache_key: publicId,
      course_name: normalized.name || '',
      geometry: normalized,
      features: normalized,
      fetched_at: stamped,
    },
  ];
  for (const row of rows) {
    try {
      const { error } = await admin.from('course_geometries').upsert(row, { onConflict: 'cache_key' });
      if (!error) return;
    } catch {
      // Try a narrower row before giving the JSON back without a server cache.
    }
  }
  try {
    await admin.from('course_geometries').insert(rows[1]);
  } catch {
    // The caller still receives the normalized course.
  }
}

function locationOf(row: JsonRecord) {
  const location = asRecord(row.location) || asRecord(row.address) || {};
  const coord = asRecord(row.gpsCoordinate) || asRecord(row.coordinate) || asRecord(location.gpsCoordinate) || asRecord(location.coordinate) || {};
  return {
    city: text(row.city, location.city, row.cityName),
    state: text(row.state, row.region, row.regionCode, location.state, location.region),
    country: text(row.country, row.countryCode, location.country),
    lat: num(row.latitude ?? row.lat ?? location.latitude ?? location.lat ?? coord.latitude ?? coord.lat),
    lon: num(row.longitude ?? row.lon ?? row.lng ?? location.longitude ?? location.lon ?? coord.longitude ?? coord.lon),
  };
}

function searchRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((row): row is JsonRecord => Boolean(row));
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ['results', 'courseGroups', 'courses', 'items', 'data', 'value']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).map(asRecord).filter((row): row is JsonRecord => Boolean(row));
    }
  }
  return [];
}

function clubsFromSearch(payload: unknown) {
  const clubs = [];
  for (const row of searchRows(payload)) {
    const facility = asRecord(row.facility);
    const publicId = text(row.publicId, row.publicID, row.PublicId);
    const name = text(row.name, row.clubName, row.courseName, row.fullName, row.facilityName, facility?.name);
    if (!publicId || !name) continue;
    clubs.push({ publicId, name, ...locationOf(row) });
  }
  return clubs;
}

function readPoint(value: unknown): LngLat | null {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] !== 'object') {
    const first = num(value[0]);
    const second = num(value[1]);
    if (first == null || second == null) return null;
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) return [first, second];
    if (Math.abs(second) > 90 && Math.abs(first) <= 90) return [second, first];
    return [first, second];
  }
  const record = asRecord(value);
  if (!record) return null;
  const lat = num(record.latitude ?? record.lat ?? record.Latitude);
  const lon = num(record.longitude ?? record.lon ?? record.lng ?? record.Longitude);
  if (lat == null || lon == null) return null;
  return [lon, lat];
}

function closeRing(points: LngLat[]): LngLat[] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]]);
  return points;
}

function ringFrom(value: unknown): LngLat[] {
  if (!Array.isArray(value)) return [];
  const ring: LngLat[] = [];
  for (const point of value) {
    const read = readPoint(point);
    if (read) ring.push(read);
  }
  return ring.length >= 3 ? closeRing(ring) : [];
}

function ringsFromItem(item: JsonRecord): LngLat[][] {
  const rings: LngLat[][] = [];
  const add = (value: unknown) => {
    const ring = ringFrom(value);
    if (ring.length >= 4) rings.push(ring);
  };
  if (Array.isArray(item.shapes)) {
    for (const shape of item.shapes) {
      if (Array.isArray(shape) && Array.isArray(shape[0]) && Array.isArray((shape[0] as unknown[])[0])) add(shape[0]);
      else add(shape);
    }
  }
  const geometry = asRecord(item.geometry);
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) add(geometry.coordinates[0]);
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    for (const polygon of geometry.coordinates as unknown[]) {
      if (Array.isArray(polygon)) add(polygon[0]);
    }
  }
  if (Array.isArray(item.coordinates)) {
    const coordinates = item.coordinates;
    if (coordinates.length && Array.isArray(coordinates[0]) && Array.isArray((coordinates[0] as unknown[])[0])) add(coordinates[0]);
    else add(coordinates);
  }
  if (Array.isArray(item.polygon)) add(item.polygon);
  return rings;
}

function kindFromGps(value: unknown): ShapeKind | null {
  const kind = String(value || '').toLowerCase();
  if (!kind) return null;
  if (kind.includes('bunker') || kind.includes('sand')) return 'bunker';
  if (kind.includes('water') || kind.includes('penalty') || kind.includes('hazard') || kind.includes('lateral')) return 'penalty';
  if (kind.includes('tee')) return 'tee';
  if (kind.includes('fairway')) return 'fairway';
  if (kind.includes('green')) return 'green';
  return null;
}

async function inflateData(value: unknown): Promise<unknown> {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  try {
    const binary = atob(trimmed.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function collectGpsItems(payload: JsonRecord): Promise<JsonRecord[]> {
  const found: JsonRecord[] = [];
  const push = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const record = asRecord(item);
      if (!record) continue;
      if (record.gpsType || record.type || record.shapes || record.geometry || record.coordinates || record.polygon) {
        found.push(record);
      }
    }
  };
  push(payload.gpsItems);
  push(payload.gps);
  push(payload.shapes);
  const inflated = await inflateData(payload.data);
  if (Array.isArray(inflated)) push(inflated);
  const inflatedRecord = asRecord(inflated);
  if (inflatedRecord) {
    push(inflatedRecord.gpsItems);
    push(inflatedRecord.items);
    push(inflatedRecord.shapes);
    push(inflatedRecord.features);
  }
  return found;
}

function emptyBucket(): ShapeBucket {
  return { tee: [], fairway: [], bunker: [], penalty: [], green: [] };
}

function squareRing(lon: number, lat: number, yards: number): LngLat[] {
  const dLat = (yards * 0.9144) / 111320;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return closeRing([
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ]);
}

function toGeometry(rings: LngLat[][]) {
  if (!rings.length) return null;
  if (rings.length === 1) return { type: 'Polygon' as const, coordinates: [rings[0]] };
  return { type: 'MultiPolygon' as const, coordinates: rings.map((ring) => [ring]) };
}

function handicapOf(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = num(value);
    if (number != null && number > 0 && number <= 18) return number;
  }
  return undefined;
}

function scoreHoles(payload: JsonRecord): ScoreHole[] {
  let bestHoles: unknown[] = [];
  let bestScore = -1;
  const courses = Array.isArray(payload.courses) ? payload.courses : [];
  for (const course of courses) {
    const record = asRecord(course);
    if (!record || !Array.isArray(record.tees)) continue;
    for (const tee of record.tees) {
      const teeRecord = asRecord(tee);
      if (!teeRecord || !Array.isArray(teeRecord.holes)) continue;
      const name = text(teeRecord.teeName, teeRecord.name, teeRecord.teeType);
      const bonus = /blue|white|member|middle/i.test(name) ? 0.5 : 0;
      if (teeRecord.holes.length + bonus > bestScore) {
        bestHoles = teeRecord.holes;
        bestScore = teeRecord.holes.length + bonus;
      }
    }
  }

  const byNumber = new Map<number, ScoreHole>();
  const take = (row: JsonRecord, preferScore: boolean) => {
    const number = num(row.holeNumber ?? row.number ?? row.hole);
    if (number == null || number < 1 || number > 18) return;
    const current = byNumber.get(number) || { number };
    const holeId = num(row.holeId ?? row.id);
    if (holeId != null) current.holeId = holeId;
    const par = num(row.par);
    const yardage = num(row.yardage ?? row.yards ?? row.length);
    const handicap = handicapOf(row.allocation, row.handicap, row.hcp, row.strokeIndex);
    if (preferScore || current.par == null) {
      if (par != null) current.par = par;
      if (yardage != null) current.yardage = yardage;
      if (handicap != null) current.handicap = handicap;
    }
    const teePoint = readPoint(row.teeGPSCoordinate ?? row.teeCoordinate ?? row.tee);
    const greenPoint = readPoint(row.greenGPSCoordinate ?? row.greenCoordinate ?? row.greenCenter ?? row.green);
    if (teePoint) current.teePoint = teePoint;
    if (greenPoint) current.greenPoint = greenPoint;
    byNumber.set(number, current);
  };

  for (const row of bestHoles) {
    const record = asRecord(row);
    if (record) take(record, true);
  }
  if (Array.isArray(payload.holes)) {
    for (const row of payload.holes) {
      const record = asRecord(row);
      if (record) take(record, bestHoles.length === 0);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function payloadHasScorecard(payload: JsonRecord) {
  return scoreHoles(payload).some((hole) => hole.par != null || hole.yardage != null);
}

function bucketKey(item: JsonRecord, idToNumber: Map<number, number>) {
  const holeNumber = num(item.holeNumber ?? item.number ?? item.hole);
  if (holeNumber != null && holeNumber >= 1 && holeNumber <= 18) return holeNumber;
  const holeId = num(item.holeId ?? item.holeID);
  if (holeId != null && idToNumber.has(holeId)) return idToNumber.get(holeId) as number;
  return null;
}

async function shapeBuckets(payload: JsonRecord, holes: ScoreHole[]) {
  const idToNumber = new Map<number, number>();
  holes.forEach((hole) => {
    if (hole.holeId != null) idToNumber.set(hole.holeId, hole.number);
  });
  const buckets = new Map<number, ShapeBucket>();
  const bucketFor = (number: number) => {
    const existing = buckets.get(number);
    if (existing) return existing;
    const created = emptyBucket();
    buckets.set(number, created);
    return created;
  };
  for (const item of await collectGpsItems(payload)) {
    const number = bucketKey(item, idToNumber);
    if (number == null) continue;
    const kind = kindFromGps(item.gpsType ?? item.type ?? item.shapeType ?? item.featureType);
    if (!kind) continue;
    const bucket = bucketFor(number);
    bucket[kind].push(...ringsFromItem(item));
    const point = readPoint(item.center ?? item.point ?? item.gpsCoordinate);
    if (point && kind === 'tee' && !bucket.teePoint) bucket.teePoint = point;
    if (point && kind === 'green' && !bucket.greenPoint) bucket.greenPoint = point;
  }
  return buckets;
}

function bucketsHaveShapes(buckets: Map<number, ShapeBucket>) {
  for (const bucket of buckets.values()) {
    if (bucket.tee.length || bucket.fairway.length || bucket.bunker.length || bucket.penalty.length || bucket.green.length) {
      return true;
    }
  }
  return false;
}

function geometryFor(rings: LngLat[][], point: LngLat | undefined, yards: number) {
  if (rings.length) return toGeometry(rings);
  if (!point) return null;
  return toGeometry([squareRing(point[0], point[1], yards)]);
}

async function normalizeCourse(publicId: string, payload: JsonRecord) {
  const holesIn = scoreHoles(payload);
  const buckets = await shapeBuckets(payload, holesIn);
  const scored = holesIn.length
    ? holesIn
    : [...buckets.keys()].sort((a, b) => a - b).map((number): ScoreHole => ({ number }));
  const place = locationOf(payload);
  const holes = scored.map((hole) => {
    const bucket = buckets.get(hole.number) || emptyBucket();
    const teePoint = bucket.teePoint || hole.teePoint;
    const greenPoint = bucket.greenPoint || hole.greenPoint;
    return {
      number: hole.number,
      holeId: hole.holeId,
      par: hole.par ?? null,
      yardage: hole.yardage ?? null,
      handicap: hole.handicap ?? null,
      tee: geometryFor(bucket.tee, teePoint, 8),
      fairway: toGeometry(bucket.fairway),
      bunkers: toGeometry(bucket.bunker),
      penalty_areas: toGeometry(bucket.penalty),
      green: geometryFor(bucket.green, greenPoint, 14),
    };
  });
  const firstTee = holes.find((hole) => hole.tee && 'coordinates' in hole.tee)?.tee;
  const teeCoord = firstTee && firstTee.type === 'Polygon' ? firstTee.coordinates?.[0]?.[0] : null;
  return {
    publicId,
    source: 'golf-intel',
    name: text(payload.name, payload.clubName, payload.courseName, asRecord(payload.facility)?.name),
    city: place.city,
    state: place.state,
    country: place.country,
    lat: place.lat ?? (teeCoord ? teeCoord[1] : null),
    lon: place.lon ?? (teeCoord ? teeCoord[0] : null),
    holes,
  };
}

function mergePayload(detail: JsonRecord, extra: unknown, key: string) {
  const record = asRecord(extra);
  if (!record) return detail;
  const next = { ...detail };
  if (Array.isArray(record[key]) && !Array.isArray(next[key])) next[key] = record[key];
  if (Array.isArray(record.gpsItems)) {
    const current = Array.isArray(next.gpsItems) ? next.gpsItems : [];
    next.gpsItems = [...current, ...record.gpsItems];
  }
  if (typeof record.data === 'string' && typeof next.data !== 'string') next.data = record.data;
  if (Array.isArray(record.courses) && !Array.isArray(next.courses)) next.courses = record.courses;
  if (Array.isArray(record.holes) && !Array.isArray(next.holes)) next.holes = record.holes;
  for (const field of ['name', 'clubName', 'courseName', 'latitude', 'longitude', 'city', 'state', 'country']) {
    if (next[field] == null && record[field] != null) next[field] = record[field];
  }
  return next;
}

async function handleSearch(body: JsonRecord) {
  const keywords = text(body.keywords, body.query, body.q);
  if (keywords.length < 2) return json(400, { error: 'Enter at least two letters to search courses' });
  const payload = await giFetch('/courses/searchCourseGroups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, rows: 15, offset: 0 }),
  });
  return json(200, { courses: clubsFromSearch(payload) });
}

async function handleHydrate(body: JsonRecord) {
  const publicId = text(body.publicId, body.PublicId);
  if (!publicId) return json(400, { error: 'publicId is required' });
  const admin = serviceClient();
  if (admin) {
    const cached = await readCachedGeometry(admin, publicId);
    if (cached) return json(200, { ...cached, publicId: cached.publicId || publicId, cached: true });
  }

  let detail = asRecord(await giFetch(`/courses/getCourseGroupDetail?PublicId=${encodeURIComponent(publicId)}`)) || {};
  if (!payloadHasScorecard(detail)) {
    try {
      const scorecard = await giFetch(`/courses/getCourseGroupScorecard?PublicId=${encodeURIComponent(publicId)}`);
      detail = mergePayload(detail, scorecard, 'courses');
    } catch {
      // Detail is still returned when the scorecard split is unavailable.
    }
  }
  const previewHoles = scoreHoles(detail);
  const previewBuckets = await shapeBuckets(detail, previewHoles);
  if (!bucketsHaveShapes(previewBuckets)) {
    try {
      const gps = await giFetch(`/courses/getCourseGroupGPS?PublicId=${encodeURIComponent(publicId)}`);
      detail = mergePayload(detail, gps, 'gpsItems');
    } catch {
      // Polygons stay empty when GPS is unavailable. The scorecard still returns.
    }
  }

  const normalized = await normalizeCourse(publicId, detail);
  if (admin) {
    try {
      await saveCachedGeometry(admin, publicId, normalized);
    } catch {
      // A failed insert must not hide the course from the player.
    }
  }
  return json(200, { ...normalized, cached: false });
}

function findImageUrl(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['imageUrl', 'imageURL', 'url', 'slopeImageUrl', 'href', 'image']) {
    const found = findImageUrl(record[key], depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findImageUrl(nested, depth + 1);
    if (found) return found;
  }
  return '';
}

function holeIdFromCache(cached: JsonRecord | null, holeNumber: number | null) {
  if (!cached || !Array.isArray(cached.holes)) return '';
  for (const hole of cached.holes) {
    const record = asRecord(hole);
    if (!record) continue;
    const number = num(record.number ?? record.holeNumber);
    if (holeNumber != null && number !== holeNumber) continue;
    const holeId = text(record.holeId);
    if (holeId) return holeId;
  }
  return '';
}

async function handleSlope(body: JsonRecord) {
  const publicId = text(body.publicId, body.PublicId);
  const holeNumber = num(body.holeNumber ?? body.hole ?? body.number);
  let holeId = text(body.holeId, body.HoleId);
  const imageSizeType = text(body.imageSizeType) || 'Portrait';
  if (!holeId && publicId) {
    const admin = serviceClient();
    if (admin) {
      try {
        holeId = holeIdFromCache(await readCachedGeometry(admin, publicId), holeNumber);
      } catch {
        holeId = '';
      }
    }
  }
  const params = new URLSearchParams();
  if (holeId) params.set('holeId', holeId);
  if (imageSizeType) params.set('imageSizeType', imageSizeType);
  if (publicId) params.set('PublicId', publicId);
  if (holeNumber != null) params.set('holeNumber', String(holeNumber));
  if (![...params.keys()].length) return json(200, { imageUrl: null });
  try {
    const payload = await giFetch(`/greens/getSlopeImage?${params.toString()}`);
    const imageUrl = findImageUrl(payload) || null;
    return json(200, { imageUrl, holeId: holeId || null, publicId: publicId || null, holeNumber, payload });
  } catch {
    return json(200, { imageUrl: null, holeId: holeId || null, publicId: publicId || null, holeNumber });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const apiKey = req.headers.get('apikey') || '';
    if (authorization || apiKey) {
      const url = Deno.env.get('SUPABASE_URL') || '';
      const anon = Deno.env.get('SUPABASE_ANON_KEY') || apiKey;
      if (url && anon) {
        try {
          createClient(url, anon, {
            global: { headers: authorization ? { Authorization: authorization } : {} },
            auth: { persistSession: false, autoRefreshToken: false },
          });
        } catch {
          // The caller's key is accepted when present. Golf Intelligence credentials stay on the server.
        }
      }
    }

    const body = asRecord(await req.json()) || {};
    const action = text(body.action).toLowerCase();
    if (action === 'search') return await handleSearch(body);
    if (action === 'hydrate') return await handleHydrate(body);
    if (action === 'slope') return await handleSlope(body);
    return json(400, { error: 'Unknown action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Golf Intelligence proxy failed';
    const safe = message
      .replace(/client_id=[^&\s]+/gi, 'client_id=redacted')
      .replace(/code=[^&\s]+/gi, 'code=redacted')
      .replace(/bearer\s+[a-z0-9._\-]+/gi, 'bearer redacted');
    const status = /not configured/i.test(safe) ? 500 : 502;
    return json(status, { error: safe || 'Golf Intelligence proxy failed' });
  }
});
