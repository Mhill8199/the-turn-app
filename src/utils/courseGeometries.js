/**
 * Parsed tee-to-green hole geometries.
 * Writes the-turn-course-geometries only. Reads the legacy course cache.
 * Does not delete the-turn-course-cache, the-turn-global-courses,
 * the-turn-courses-cache, or the-turn-trip-tiles.
 */

import { buildSkeletonHoles } from './globalCourseCatalog';

export const GEOMETRY_DB = 'the-turn-course-geometries';
export const GEOMETRY_STORE = 'holes';
export const GEOMETRY_LS_KEY = 'the-turn-course-geometries';

const LEGACY_DB = 'the-turn-course-cache';
const LEGACY_STORE = 'courses';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const YARDS_TO_METERS = 0.9144;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function courseHoleCount(course) {
  const count = finite(course?.holeCount);
  if (count === 9 || count === 18) return count;
  const listed = Array.isArray(course?.holes) ? course.holes.length : 0;
  if (listed === 9 || listed === 18) return listed;
  return 18;
}

export function geometryKey(course) {
  const lat = finite(course?.lat);
  const lon = finite(course?.lon ?? course?.lng);
  const id = String(course?.id || course?.name || 'course').trim().toLowerCase();
  if (lat == null || lon == null) return id;
  return `${id}|${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function legacyKey(course) {
  const lat = finite(course?.lat);
  const lon = finite(course?.lon ?? course?.lng);
  if (lat == null || lon == null) return '';
  const cellLat = (Math.round(lat * 100) / 100).toFixed(2);
  const cellLon = (Math.round(lon * 100) / 100).toFixed(2);
  const name = String(course?.name || 'course').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${name}|${cellLat},${cellLon}`;
}

export function holeOverpassQuery(lat, lon) {
  const la = Number(lat).toFixed(5);
  const lo = Number(lon).toFixed(5);
  return `[out:json][timeout:20];(way["golf"~"hole|green|fairway|bunker|tee|water_hazard"](around:1600,${la},${lo});relation["golf"~"hole|green|fairway|bunker|tee|water_hazard"](around:1600,${la},${lo}););out geom;`;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function metersToYards(meters) {
  return meters / YARDS_TO_METERS;
}

function bearingBetween(a, b) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function destination(point, bearingDeg, yards) {
  const R = 6371000;
  const dist = yards * YARDS_TO_METERS;
  const br = (bearingDeg * Math.PI) / 180;
  const φ1 = (point.lat * Math.PI) / 180;
  const λ1 = (point.lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(dist / R) + Math.cos(φ1) * Math.sin(dist / R) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(
    Math.sin(br) * Math.sin(dist / R) * Math.cos(φ1),
    Math.cos(dist / R) - Math.sin(φ1) * Math.sin(φ2)
  );
  return { lat: (φ2 * 180) / Math.PI, lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function ringCentroid(ring) {
  let lat = 0;
  let lon = 0;
  const pts = ring || [];
  if (!pts.length) return null;
  for (const point of pts) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

function simplifyRing(ring, max = 48) {
  if (!Array.isArray(ring) || ring.length <= max) return ring || [];
  const step = Math.ceil(ring.length / max);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail.lat !== last.lat || tail.lon !== last.lon) out.push(last);
  return out;
}

function pointInRing(point, ring) {
  if (!point || !Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat;
    const xi = ring[i].lon;
    const yj = ring[j].lat;
    const xj = ring[j].lon;
    const intersect = ((yi > point.lat) !== (yj > point.lat))
      && (point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pullInside(point, centroid, ring) {
  if (!ring?.length || !centroid || pointInRing(point, ring)) return point;
  let high = 1;
  let low = 0;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    const candidate = interpolate(point, centroid, mid);
    if (pointInRing(candidate, ring)) high = mid;
    else low = mid;
  }
  return interpolate(point, centroid, Math.min(1, high + 0.02));
}

function circleRing(center, radiusYards, steps = 16) {
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(center, (i / steps) * 360, radiusYards));
  }
  return ring;
}

function corridorRing(tee, green, halfWidthYards) {
  const bearing = bearingBetween(tee, green);
  const left = (bearing + 270) % 360;
  const right = (bearing + 90) % 360;
  const nose = Math.max(8, halfWidthYards * 0.65);
  return [
    destination(tee, left, halfWidthYards),
    destination(green, left, nose),
    destination(green, right, nose),
    destination(tee, right, halfWidthYards),
    destination(tee, left, halfWidthYards),
  ];
}

function ringFromBBox(bbox) {
  const south = finite(bbox?.south);
  const north = finite(bbox?.north);
  const west = finite(bbox?.west);
  const east = finite(bbox?.east);
  if (south == null || north == null || west == null || east == null) return null;
  if (north - south < 0.0002 || east - west < 0.0002) return null;
  return [
    { lat: south, lon: west },
    { lat: south, lon: east },
    { lat: north, lon: east },
    { lat: north, lon: west },
    { lat: south, lon: west },
  ];
}

function boundaryOf(course) {
  if (Array.isArray(course?.boundary) && course.boundary.length >= 4) return course.boundary;
  return ringFromBBox(course?.boundingBox);
}

function parForYards(yards) {
  if (yards && yards < 250) return 3;
  if (yards && yards > 470) return 5;
  return 4;
}

function cardFor(course, number) {
  return (course?.holes || []).find((hole) => Number(hole?.number) === number) || null;
}

function knownHandicap(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number != null && number > 0 && number <= 18) return number;
  }
  return undefined;
}

function depthPoints(tee, center, rings) {
  const pts = (rings || []).flat().filter((point) => finite(point?.lat) != null && finite(point?.lon) != null);
  if (!tee || !center || pts.length < 3) {
    const axis = tee && center ? bearingBetween(tee, center) : 0;
    return {
      front: center ? destination(center, (axis + 180) % 360, 12) : tee,
      center: center || tee,
      back: center ? destination(center, axis, 14) : tee,
    };
  }
  const axis = bearingBetween(tee, center);
  let minS = Infinity;
  let maxS = -Infinity;
  let front = center;
  let back = center;
  for (const point of pts) {
    const dist = haversineMeters(tee, point);
    const delta = ((bearingBetween(tee, point) - axis + 540) % 360) - 180;
    const along = dist * Math.cos((delta * Math.PI) / 180);
    if (along < minS) {
      minS = along;
      front = point;
    }
    if (along > maxS) {
      maxS = along;
      back = point;
    }
  }
  return { front, center: ringCentroid(pts) || center, back };
}

function kindFromTags(tags = {}) {
  if (tags.golf === 'fairway') return 'fairway';
  if (tags.golf === 'green') return 'green';
  if (tags.golf === 'bunker') return 'bunker';
  if (tags.golf === 'hole') return 'hole';
  if (tags.golf === 'tee') return 'tee';
  if (tags.golf === 'water_hazard' || tags.waterway || tags.natural === 'water') return 'water';
  return null;
}

function ringsFromElement(element) {
  const rings = [];
  const push = (geometry) => {
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    const ring = [];
    for (const point of geometry) {
      const lat = finite(point?.lat);
      const lon = finite(point?.lon);
      if (lat == null || lon == null) continue;
      ring.push({ lat, lon });
    }
    if (ring.length >= 2) rings.push(simplifyRing(ring));
  };
  push(element.geometry);
  if (Array.isArray(element.members)) {
    for (const member of element.members) push(member.geometry);
  }
  return rings;
}

function holeNumberFromRef(ref) {
  const match = String(ref ?? '').match(/\d+/);
  if (!match) return null;
  const number = Number(match[0]);
  return number >= 1 && number <= 18 ? number : null;
}

export function parseHoleElements(data) {
  const features = [];
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  for (const element of elements) {
    if (element?.type !== 'way' && element?.type !== 'relation') continue;
    const tags = element.tags || {};
    const kind = kindFromTags(tags);
    if (!kind) continue;
    const rings = ringsFromElement(element);
    if (!rings.length) continue;
    features.push({
      id: `${element.type}:${element.id}:${kind}`,
      kind,
      ref: tags.ref ?? null,
      holeNumber: holeNumberFromRef(tags.ref),
      par: finite(tags.par),
      handicap: knownHandicap(tags.handicap, tags.hcp, tags['golf:handicap']),
      penalty: tags.golf === 'penalty_area' || String(tags.penalty || '') === 'yes',
      rings,
    });
    if (features.length >= 800) break;
  }
  return features;
}

function featurePoint(feature) {
  const ring = feature?.rings?.[0];
  if (!ring?.length) return null;
  if (ring.length === 2) return ring[Math.floor(ring.length / 2)];
  return ringCentroid(ring);
}

function nearestRings(features, kind, near, maxMeters) {
  if (!near) return [];
  const rings = [];
  for (const feature of features) {
    if (feature?.kind !== kind) continue;
    const point = featurePoint(feature);
    if (!point || haversineMeters(point, near) > maxMeters) continue;
    for (const ring of feature.rings || []) {
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

function assembleFromOsm(features, course) {
  const lines = features.filter((feature) => feature?.kind === 'hole' && feature.rings?.[0]?.length >= 2);
  if (!lines.length) return [];
  const byNumber = new Map();
  const unnumbered = [];
  for (const line of lines) {
    const number = line.holeNumber || holeNumberFromRef(line.ref);
    if (!number) {
      unnumbered.push(line);
      continue;
    }
    const prev = byNumber.get(number);
    if (!prev || line.rings[0].length > prev.rings[0].length) byNumber.set(number, line);
  }
  const center = { lat: finite(course?.lat), lon: finite(course?.lon ?? course?.lng) };
  unnumbered.sort((a, b) => {
    const pa = featurePoint(a);
    const pb = featurePoint(b);
    if (!pa || !pb || center.lat == null) return 0;
    return bearingBetween(center, pa) - bearingBetween(center, pb);
  });
  let cursor = 1;
  for (const line of unnumbered) {
    while (byNumber.has(cursor) && cursor <= 18) cursor += 1;
    if (cursor > 18) break;
    byNumber.set(cursor, line);
    cursor += 1;
  }

  const holes = [];
  for (const [number, line] of byNumber) {
    const ring = line.rings[0];
    let tee = ring[0];
    let greenEnd = ring[ring.length - 1];
    const teeHit = features.find((feature) => feature.kind === 'tee' && (feature.holeNumber === number));
    if (teeHit) {
      const point = featurePoint(teeHit);
      if (point) tee = point;
    }
    const greenRings = nearestRings(features, 'green', greenEnd, 140);
    const greenPoint = greenRings.length ? ringCentroid(greenRings[0]) : null;
    if (greenPoint && haversineMeters(tee, greenPoint) + 5 < haversineMeters(greenEnd, greenPoint)) {
      const swap = tee;
      tee = greenEnd;
      greenEnd = swap;
    }
    const green = greenPoint || greenEnd;
    const shapedGreen = greenRings.length ? greenRings : [circleRing(green, 14)];
    const depth = depthPoints(tee, green, shapedGreen);
    const yards = Math.round(metersToYards(haversineMeters(tee, green)));
    const card = cardFor(course, number);
    const playableYards = yards >= 50 ? yards : (finite(card?.yards) || 380);
    holes.push({
      number,
      par: line.par || finite(card?.par) || parForYards(playableYards),
      yards: playableYards,
      handicap: knownHandicap(line.handicap, card?.handicap, card?.hcp, card?.strokeIndex),
      bearingDeg: bearingBetween(tee, green),
      tee,
      green,
      front: depth.front,
      back: depth.back,
      center: depth.center || green,
      fairway: nearestRings(features, 'fairway', interpolate(tee, green, 0.5), 120),
      greenRings: shapedGreen,
      bunkers: nearestRings(features, 'bunker', interpolate(tee, green, 0.65), 110),
      water: nearestRings(features, 'water', interpolate(tee, green, 0.55), 130),
      penalty: features.filter((feature) => feature.penalty && feature.kind === 'water').flatMap((feature) => feature.rings || []),
      generated: false,
      elevationDeltaFt: finite(card?.elevationDeltaFt) ?? undefined,
    });
  }
  return holes.sort((a, b) => a.number - b.number);
}

function rebuildShape(hole, tee, green) {
  const bearing = bearingBetween(tee, green);
  const yards = Math.max(50, Math.round(metersToYards(haversineMeters(tee, green))));
  const greenRings = [circleRing(green, 14)];
  const depth = depthPoints(tee, green, greenRings);
  return {
    ...hole,
    tee,
    green,
    front: depth.front,
    back: depth.back,
    center: green,
    bearingDeg: bearing,
    yards,
    par: hole.par || parForYards(yards),
    fairway: [corridorRing(tee, green, 20)],
    greenRings,
    generated: true,
  };
}

export function generateCorridors(course, count = courseHoleCount(course)) {
  const size = count === 9 ? 9 : 18;
  const boundary = boundaryOf(course);
  const center = boundary ? ringCentroid(boundary) : {
    lat: finite(course?.lat),
    lon: finite(course?.lon ?? course?.lng),
  };
  if (center?.lat == null || center?.lon == null) return [];
  const skeleton = buildSkeletonHoles(size, course?.par);
  const span = boundary
    ? Math.min(
      metersToYards(haversineMeters(boundary[0], { lat: boundary[0].lat, lon: boundary[1].lon })),
      metersToYards(haversineMeters(boundary[0], boundary[2] || boundary[0]))
    )
    : 0;
  const reach = span > 80 ? Math.min(560, Math.max(140, span * 0.42)) : 0;

  return skeleton.map((base, index) => {
    const card = cardFor(course, base.number) || base;
    const fan = (index % 9) * 40 + (index >= 9 ? 18 : 0);
    const bearing = finite(card.bearingDeg) != null ? Number(card.bearingDeg) : fan;
    const yards = finite(card.yards) || finite(base.yards) || 380;
    const outbound = index < size / 2;
    const angle = outbound ? bearing : (bearing + 180) % 360;
    const teeRadius = reach ? Math.min(90, reach * 0.28) : 70;
    const greenRadius = reach ? Math.min(yards, reach) : yards;
    let tee = destination(center, (angle + 180) % 360, outbound ? teeRadius : greenRadius);
    let green = destination(tee, angle, Math.min(yards, reach || yards));
    if (!outbound && !reach) {
      tee = destination(center, bearing, yards * 0.92);
      green = destination(center, bearing, 80);
    }
    if (boundary) {
      tee = pullInside(tee, center, boundary);
      green = pullInside(green, center, boundary);
    }
    if (haversineMeters(tee, green) < 40) {
      green = destination(tee, angle, Math.max(90, Math.min(yards, 160)));
      if (boundary) green = pullInside(green, center, boundary);
    }
    const shaped = rebuildShape({
      number: base.number,
      par: finite(card.par) || base.par,
      handicap: knownHandicap(card.handicap, card.hcp, card.strokeIndex),
      bunkers: [],
      water: [],
      penalty: [],
      elevationDeltaFt: finite(card.elevationDeltaFt) ?? undefined,
    }, tee, green);
    const playBearing = shaped.bearingDeg;
    const bunkers = [];
    const bunkerStart = finite(card.bunkerStart);
    if (bunkerStart && bunkerStart < shaped.yards - 20) {
      const spot = destination(tee, playBearing, bunkerStart);
      const side = destination(spot, (playBearing + 90) % 360, 16);
      bunkers.push(circleRing(boundary ? pullInside(side, center, boundary) : side, 8, 10));
    }
    const water = [];
    const waterCarry = finite(card.waterCarry);
    if (waterCarry && waterCarry < shaped.yards - 10) {
      const spot = destination(tee, playBearing, waterCarry);
      water.push(corridorRing(
        destination(spot, (playBearing + 180) % 360, 8),
        destination(spot, playBearing, 8),
        24
      ));
    }
    return { ...shaped, yards: finite(card.yards) || shaped.yards, bunkers, water };
  });
}

function deriveFeatures(holes) {
  const features = [];
  const push = (hole, kind, rings, penalty = false) => {
    (rings || []).forEach((ring, index) => {
      if (!Array.isArray(ring) || ring.length < 2) return;
      features.push({
        id: `hole-${hole.number}-${kind}-${index}`,
        kind,
        ref: String(hole.number),
        holeNumber: hole.number,
        penalty,
        generated: Boolean(hole.generated),
        rings: [ring],
      });
    });
  };
  for (const hole of holes) {
    if (hole?.tee && hole?.green) {
      features.push({
        id: `hole-${hole.number}-centerline`,
        kind: 'hole',
        ref: String(hole.number),
        holeNumber: hole.number,
        par: hole.par,
        handicap: hole.handicap,
        generated: Boolean(hole.generated),
        rings: [[hole.tee, hole.green]],
      });
    }
    const fairway = hole.fairway?.length ? hole.fairway : (hole.tee && hole.green ? [corridorRing(hole.tee, hole.green, 20)] : []);
    push(hole, 'fairway', fairway);
    push(hole, 'green', hole.greenRings);
    push(hole, 'bunker', hole.bunkers);
    push(hole, 'water', hole.water, false);
    push(hole, 'water', hole.penalty, true);
  }
  return features;
}

function withFeatures(record) {
  return { ...record, features: deriveFeatures(record.holes || []) };
}

export function placeHolePoint(record, holeNumber, which, point) {
  if (!record || !point) return record;
  const number = Number(holeNumber);
  const placements = { ...(record.placements || {}), [number]: { ...(record.placements?.[number] || {}), [which]: point } };
  const holes = (record.holes || []).map((hole) => {
    if (Number(hole.number) !== number) return hole;
    const tee = which === 'tee' ? point : hole.tee;
    const green = which === 'green' ? point : hole.green;
    if (!tee || !green) return { ...hole, [which]: point };
    return rebuildShape(hole, tee, green);
  });
  return withFeatures({ ...record, holes, placements, generated: true });
}

function applyPlacements(record) {
  let next = record;
  const placements = record?.placements || {};
  Object.entries(placements).forEach(([number, pin]) => {
    if (pin?.tee) next = placeHolePoint(next, number, 'tee', pin.tee);
    if (pin?.green) next = placeHolePoint(next, number, 'green', pin.green);
  });
  return next;
}

function fillMissing(holes, course) {
  const count = courseHoleCount(course);
  const have = new Set(holes.map((hole) => hole.number));
  if ([...Array(count)].every((_, index) => have.has(index + 1))) return holes;
  const generated = generateCorridors(course, count).filter((hole) => !have.has(hole.number));
  return [...holes, ...generated].sort((a, b) => a.number - b.number);
}

function openDb(name, version, storeName, create) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (!create) {
        try { request.transaction?.abort(); } catch { /* leave existing stores alone */ }
        return;
      }
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function readStore(db, storeName, key) {
  if (!db?.objectStoreNames?.contains(storeName)) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalMap() {
  try {
    const raw = localStorage.getItem(GEOMETRY_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalMap(map) {
  try {
    const entries = Object.entries(map || {});
    entries.sort((a, b) => (a[1]?.fetchedAt || 0) - (b[1]?.fetchedAt || 0));
    const trimmed = Object.fromEntries(entries.slice(-8));
    localStorage.setItem(GEOMETRY_LS_KEY, JSON.stringify(trimmed));
  } catch {
    // IndexedDB keeps the full copy when localStorage is full.
  }
}

async function readGeometry(key) {
  const local = readLocalMap()[key];
  if (local?.holes?.length) return local;
  try {
    const db = await openDb(GEOMETRY_DB, 1, GEOMETRY_STORE, true);
    try {
      return await readStore(db, GEOMETRY_STORE, key);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function readLegacyFeatures(course) {
  const key = legacyKey(course);
  if (!key || typeof indexedDB === 'undefined') return [];
  try {
    const db = await openDb(LEGACY_DB, null, LEGACY_STORE, false);
    if (!db) return [];
    try {
      const row = await readStore(db, LEGACY_STORE, key);
      return Array.isArray(row?.features) ? row.features : [];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

async function writeGeometry(record) {
  const compact = {
    key: record.key,
    courseId: record.courseId || '',
    courseName: record.courseName || '',
    lat: record.lat,
    lon: record.lon,
    generated: Boolean(record.generated),
    holes: record.holes || [],
    placements: record.placements || {},
    fetchedAt: record.fetchedAt || Date.now(),
  };
  const map = readLocalMap();
  map[compact.key] = compact;
  writeLocalMap(map);
  try {
    const db = await openDb(GEOMETRY_DB, 1, GEOMETRY_STORE, true);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(GEOMETRY_STORE, 'readwrite');
      const req = tx.objectStore(GEOMETRY_STORE).put({ ...compact, features: record.features || [] });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // localStorage already holds the parsed holes.
  }
}

async function fetchHoleFeatures(lat, lon, signal) {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: holeOverpassQuery(lat, lon),
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);
  return parseHoleElements(await response.json());
}

export async function loadPlayableGeometry(course, { signal } = {}) {
  const lat = finite(course?.lat);
  const lon = finite(course?.lon ?? course?.lng);
  if (lat == null || lon == null) return null;
  const key = geometryKey(course);
  const cached = await readGeometry(key);
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

  let fresh = [];
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    try {
      fresh = await fetchHoleFeatures(lat, lon, signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      fresh = [];
    }
  }

  const holeWays = fresh.filter((feature) => feature.kind === 'hole');
  let holes = [];
  let generated = false;
  if (holeWays.length) {
    holes = fillMissing(assembleFromOsm(fresh, course), course);
    generated = holes.some((hole) => hole.generated);
  } else if (cached?.holes?.length) {
    holes = cached.holes;
    generated = cached.generated !== false;
  } else {
    const legacy = await readLegacyFeatures(course);
    const legacyHoles = legacy.some((feature) => feature?.kind === 'hole')
      ? assembleFromOsm(legacy, course)
      : [];
    if (legacyHoles.length) {
      holes = fillMissing(legacyHoles, course);
      generated = holes.some((hole) => hole.generated);
    } else {
      holes = generateCorridors(course);
      generated = true;
    }
  }

  let record = withFeatures({
    key,
    courseId: course.id,
    courseName: course.name || '',
    lat,
    lon,
    generated: generated || !holeWays.length,
    holes,
    placements: cached?.placements || {},
    fetchedAt: Date.now(),
  });
  if (Object.keys(record.placements).length) record = applyPlacements(record);
  await writeGeometry(record);
  return record;
}

export async function savePlacedGeometry(record) {
  if (!record?.key) return record;
  const next = withFeatures({ ...record, fetchedAt: Date.now() });
  await writeGeometry(next);
  return next;
}
