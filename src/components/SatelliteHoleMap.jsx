import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COURSE_PRESETS } from '../lib/weatherPhysics';
import { supabase } from '../lib/supabase';
import { useUnits } from '../utils/distanceUnits';
import { rewriteCachedTileRequest } from '../utils/tripQueue';

/**
 * Basemap choice (never log the token):
 * - VITE_MAPBOX_TOKEN non-empty → Mapbox satellite-streets-v12 (mapbox://styles/mapbox/satellite-streets-v12).
 * - Token empty → USGS National Map imagery + OpenFreeMap liberty labels. No key.
 */
const MAPBOX_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const USGS_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const DB_NAME = 'the-turn-course-cache';
const STORE_NAME = 'courses';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DOCUMENTED_DEFAULT = { lat: 33.8229, lon: -117.5214 };
const DOS_LAGOS = { lat: 33.8229, lon: -117.5214 };
const HOLE_FIT_PADDING = { top: 115, bottom: 130, left: 24, right: 96 };
const GOLF_TAGS = ['fairway', 'hole', 'green', 'bunker', 'water_hazard'];

function mapboxToken() {
  return String(import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
}

function withToken(url, token) {
  if (!token || url.includes('access_token=')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${token}`;
}

/** Rewrite mapbox:// resources so MapLibre can request them. Do not log the result. */
function rewriteMapboxUrl(url, token) {
  if (!url || !token) return url;
  if (url.startsWith('mapbox://styles/')) {
    return withToken(`https://api.mapbox.com/styles/v1/${url.slice('mapbox://styles/'.length)}`, token);
  }
  if (url.startsWith('mapbox://sprites/')) {
    const rest = url.slice('mapbox://sprites/'.length);
    const match = rest.match(/^(.*?)(@2x)?(\.(?:json|png|webp))?$/);
    const path = match?.[1] || rest;
    const retina = match?.[2] || '';
    const ext = match?.[3] || '';
    const base = path.endsWith('/sprite') ? path : `${path}/sprite`;
    return withToken(`https://api.mapbox.com/styles/v1/${base}${retina}${ext}`, token);
  }
  if (url.startsWith('mapbox://fonts/')) {
    return withToken(`https://api.mapbox.com/fonts/v1/${url.slice('mapbox://fonts/'.length)}`, token);
  }
  if (url.startsWith('mapbox://')) {
    let rest = url.slice('mapbox://'.length);
    if (!/\.json(?:$|\?)/.test(rest)) rest += '.json';
    return withToken(`https://api.mapbox.com/v4/${rest}`, token);
  }
  if (url.includes('api.mapbox.com')) return withToken(url, token);
  return url;
}

function absUrl(value, base) {
  if (typeof value !== 'string' || !value) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('data:')) return value;
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function usgsRasterStyle() {
  return {
    version: 8,
    name: 'usgs-national-map',
    sources: {
      'usgs-imagery': {
        type: 'raster',
        tiles: [USGS_TILES],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'USGS National Map',
      },
    },
    layers: [
      { id: 'usgs-basemap-color', type: 'background', paint: { 'background-color': '#0B0D0C' } },
      { id: 'usgs-imagery', type: 'raster', source: 'usgs-imagery' },
    ],
  };
}

/** Raster underneath, liberty symbol/line labels on top. Fills and the liberty background are omitted so they cannot hide USGS imagery. */
async function loadUsgsLibertyStyle(signal) {
  const response = await fetch(LIBERTY_STYLE, { signal });
  if (!response.ok) throw new Error(`OpenFreeMap style ${response.status}`);
  const style = await response.json();
  const sources = {};
  for (const [id, source] of Object.entries(style.sources || {})) {
    const next = { ...source };
    if (typeof next.url === 'string') next.url = absUrl(next.url, LIBERTY_STYLE);
    if (Array.isArray(source.tiles)) next.tiles = source.tiles.map((tile) => absUrl(tile, LIBERTY_STYLE));
    if ((next.type === 'vector' || next.type === 'geojson') && !/openstreetmap/i.test(String(next.attribution || ''))) {
      next.attribution = next.attribution
        ? `${next.attribution} · © OpenStreetMap / OpenFreeMap`
        : '© OpenStreetMap / OpenFreeMap';
    }
    sources[id] = next;
  }
  sources['usgs-imagery'] = {
    type: 'raster',
    tiles: [USGS_TILES],
    tileSize: 256,
    maxzoom: 16,
    attribution: 'USGS National Map',
  };
  const labels = (Array.isArray(style.layers) ? style.layers : [])
    .filter((layer) => layer?.id && (layer.type === 'symbol' || layer.type === 'line'))
    .map((layer) => ({
      ...layer,
      layout: layer.layout ? { ...layer.layout } : undefined,
      paint: layer.paint ? { ...layer.paint } : undefined,
    }));
  return {
    version: 8,
    name: 'usgs-national-map-openfreemap-labels',
    glyphs: absUrl(style.glyphs, LIBERTY_STYLE),
    sprite: typeof style.sprite === 'string' ? absUrl(style.sprite, LIBERTY_STYLE) : style.sprite,
    sources,
    layers: [
      { id: 'usgs-basemap-color', type: 'background', paint: { 'background-color': '#0B0D0C' } },
      { id: 'usgs-imagery', type: 'raster', source: 'usgs-imagery' },
      ...labels,
    ],
  };
}

/** Add liberty labels after the USGS raster is already on screen. A failed fetch leaves the imagery up. */
async function attachLibertyLabels(map, signal) {
  try {
    const style = await loadUsgsLibertyStyle(signal);
    if (signal?.aborted || !map?.getStyle?.()) return;
    try {
      if (style.glyphs) map.setGlyphs(style.glyphs);
      if (typeof style.sprite === 'string') map.setSprite(style.sprite);
    } catch (error) {
      console.warn(error?.message || 'Label style skipped');
    }
    for (const [id, source] of Object.entries(style.sources || {})) {
      if (id === 'usgs-imagery' || map.getSource(id)) continue;
      try {
        map.addSource(id, source);
      } catch (error) {
        console.warn(error?.message || 'Label source skipped');
      }
    }
    for (const layer of style.layers || []) {
      if (!layer?.id || layer.id === 'usgs-imagery' || layer.id === 'usgs-basemap-color' || layer.id === 'usgs-topo') continue;
      if (map.getLayer(layer.id) || (layer.source && !map.getSource(layer.source))) continue;
      try {
        const before = map.getLayer('hole-fairways-fill') ? 'hole-fairways-fill' : undefined;
        map.addLayer(layer, before);
      } catch (error) {
        console.warn(error?.message || 'Label layer skipped');
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn(error?.message || 'Label overlay unavailable');
  }
}

function applyBasemapMode(map, schematic, restore) {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  for (const layer of layers) {
    if (!layer?.id || layer.id.startsWith('hole-')) continue;
    if (layer.type === 'raster') {
      const opacity = layer.id === 'usgs-topo' ? 0.35 : 1;
      map.setPaintProperty(layer.id, 'raster-opacity', schematic ? 0 : opacity);
    } else if (layer.type === 'background') {
      if (!restore.has(layer.id)) {
        restore.set(layer.id, map.getPaintProperty(layer.id, 'background-color') ?? '#0B0D0C');
      }
      map.setPaintProperty(layer.id, 'background-color', schematic ? '#102018' : restore.get(layer.id));
    }
  }
}

function safeResize(map) {
  if (!map) return;
  try {
    map.resize();
  } catch {
    // resize can race map.remove() during unmount.
  }
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

function pointKey(point) {
  if (!point) return '';
  return `${Number(point.lat).toFixed(5)},${Number(point.lon).toFixed(5)}`;
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

function openCacheDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
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
    if (error) await supabase.from('course_geometries').upsert({ id: record.key, ...row }, { onConflict: 'id' });
  } catch {
    // IndexedDB stays the source of truth when the table is missing or rejected.
  }
}

async function writeCourseCache(record) {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.keyPath ? store.put(record) : store.put(record, record.key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
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

function isDosLagosCourse(name) {
  return /dos\s*lagos/i.test(String(name || ''));
}

function overpassAround(lat, lon, dosLagos) {
  const la = dosLagos ? '33.8229' : Number(lat).toFixed(5);
  const lo = dosLagos ? '-117.5214' : Number(lon).toFixed(5);
  return `[out:json][timeout:25];(way["golf"~"hole|green|fairway|bunker|tee|water_hazard"](around:1200,${la},${lo}););out geom;`;
}

async function fetchGolfFeatures(lat, lon, dosLagos, signal) {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: overpassAround(lat, lon, dosLagos),
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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function metersToYards(meters) {
  return meters / 0.9144;
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
  const dist = yards * 0.9144;
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

function alongTrackMeters(origin, axisDeg, point) {
  const dist = haversineMeters(origin, point);
  const delta = ((bearingBetween(origin, point) - axisDeg + 540) % 360) - 180;
  return dist * Math.cos((delta * Math.PI) / 180);
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function ringCentroid(ring) {
  let lat = 0;
  let lon = 0;
  for (const point of ring) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

function longestRing(rings) {
  return rings.reduce((best, ring) => (ring.length > (best?.length || 0) ? ring : best), rings[0]);
}

function holeRef(feature) {
  const match = String(feature?.ref ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function closestLine(lines, near) {
  let best = lines[0];
  let bestD = Infinity;
  for (const feature of lines) {
    const ring = feature.rings[0];
    const mid = ring[Math.floor(ring.length / 2)];
    const distance = near ? haversineMeters(mid, near) : 0;
    if (distance < bestD) {
      best = feature;
      bestD = distance;
    }
  }
  return best;
}

function pickGreen(features, near) {
  const greens = features.filter((feature) => feature?.kind === 'green' && feature.rings?.some((ring) => ring.length >= 3));
  if (!greens.length) return null;
  if (!near) return greens[0];
  let best = greens[0];
  let bestD = Infinity;
  for (const feature of greens) {
    const distance = haversineMeters(ringCentroid(longestRing(feature.rings)), near);
    if (distance < bestD) {
      best = feature;
      bestD = distance;
    }
  }
  return best;
}

function orientTeeGreen(line, greenFeature) {
  const ring = line.rings[0];
  const start = ring[0];
  const end = ring[ring.length - 1];
  if (!greenFeature?.rings?.[0]?.length) return { tee: start, greenEnd: end };
  const centroid = ringCentroid(longestRing(greenFeature.rings));
  if (haversineMeters(start, centroid) + 5 < haversineMeters(end, centroid)) return { tee: end, greenEnd: start };
  return { tee: start, greenEnd: end };
}

function depthPoints(tee, center, rings) {
  const pts = (rings || []).flat().filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
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
    const along = alongTrackMeters(tee, axis, point);
    if (along < minS) {
      minS = along;
      front = point;
    }
    if (along > maxS) {
      maxS = along;
      back = point;
    }
  }
  return { front, center: ringCentroid(pts), back };
}

function resolvePlaying(features, holeNum, anchor, cardBearing, cardYards) {
  const lines = features.filter((feature) => feature?.kind === 'hole' && feature.rings?.[0]?.length >= 2);
  const wanted = Number(holeNum);
  const numbered = Number.isFinite(wanted) ? lines.filter((feature) => holeRef(feature) === wanted) : [];
  const hasCard = Number.isFinite(cardBearing) && Number.isFinite(cardYards) && cardYards > 0 && anchor;
  let line = null;
  if (numbered.length) line = closestLine(numbered, anchor);
  else if (!hasCard && lines.length) line = closestLine(lines, anchor);

  let tee = null;
  let greenEnd = null;
  if (line) {
    tee = line.rings[0][0];
    greenEnd = line.rings[0][line.rings[0].length - 1];
  } else if (hasCard) {
    tee = anchor;
    greenEnd = destination(anchor, cardBearing, cardYards);
  }
  const greenFeature = pickGreen(features, greenEnd || anchor);
  if (line && greenFeature) {
    const oriented = orientTeeGreen(line, greenFeature);
    tee = oriented.tee;
    greenEnd = oriented.greenEnd;
  }
  if (!tee) tee = anchor;
  const rings = greenFeature?.rings?.length ? [longestRing(greenFeature.rings)] : [];
  const green = rings[0]?.length >= 3 ? ringCentroid(rings[0]) : (greenEnd || tee);
  const depth = depthPoints(tee, green, rings);
  return { tee, green: depth.center, front: depth.front, back: depth.back, surveyed: Boolean(line) };
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] };
}

function polygonsFor(features, kind) {
  const out = [];
  for (const feature of features) {
    if (feature?.kind !== kind) continue;
    for (const ring of feature.rings || []) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const coords = ring.map((point) => [point.lon, point.lat]);
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
      if (coords.length < 4) continue;
      out.push({
        type: 'Feature',
        properties: { id: feature.id, kind },
        geometry: { type: 'Polygon', coordinates: [coords] },
      });
    }
  }
  return { type: 'FeatureCollection', features: out };
}

function linesFor(features, kind) {
  const out = [];
  for (const feature of features || []) {
    if (feature?.kind !== kind) continue;
    for (const ring of feature.rings || []) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      out.push({
        type: 'Feature',
        properties: { id: feature.id, kind, ref: feature.ref ?? null },
        geometry: { type: 'LineString', coordinates: ring.map((point) => [point.lon, point.lat]) },
      });
    }
  }
  return { type: 'FeatureCollection', features: out };
}

function approachFc(from, target, green) {
  if (!from || !target || !green) return emptyFc();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { leg: 'carry' },
        geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [target.lon, target.lat]] },
      },
      {
        type: 'Feature',
        properties: { leg: 'green' },
        geometry: { type: 'LineString', coordinates: [[target.lon, target.lat], [green.lon, green.lat]] },
      },
    ],
  };
}

function shotsFc(shots, origin) {
  const coords = [];
  if (origin?.lat != null && origin?.lon != null) coords.push([origin.lon, origin.lat]);
  for (const shot of shots || []) {
    if (shot?.lat == null || shot?.lon == null) continue;
    coords.push([shot.lon, shot.lat]);
  }
  if (coords.length < 2) return emptyFc();
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: 'trail' },
      geometry: { type: 'LineString', coordinates: coords },
    }],
  };
}

function dispersionFc(from, target) {
  if (!from || !target) return emptyFc();
  const bearing = bearingBetween(from, target);
  const yards = metersToYards(haversineMeters(from, target));
  const half = Math.max(8, yards * 0.08);
  const left = destination(target, (bearing + 270) % 360, half);
  const right = destination(target, (bearing + 90) % 360, half);
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { kind: 'dispersion' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[from.lon, from.lat], [left.lon, left.lat], [right.lon, right.lat], [from.lon, from.lat]]],
      },
    }],
  };
}

function setSourceData(map, id, data) {
  const source = map?.getSource?.(id);
  if (source && typeof source.setData === 'function') source.setData(data);
}

/**
 * Stable GeoJSON ids. A Year-2 Golf Intelligence or Golfbert feed only replaces
 * the FeatureCollections passed into these sources — not the layer stack or HUD.
 *
 * Sources: hole-fairways, hole-greens, hole-bunkers, hole-water, hole-centerlines, hole-approach, hole-shots, hole-dispersion
 * Layers:  hole-fairways-fill, hole-fairways-line,
 *          hole-greens-fill, hole-greens-line,
 *          hole-bunkers-fill, hole-bunkers-line,
 *          hole-water-fill, hole-water-line,
 *          hole-centerlines,
 *          hole-approach-carry, hole-approach-green,
 *          hole-shots-line,
 *          hole-dispersion-fill, hole-dispersion-line
 * hole-fairways is created even when Overpass returns no fairway polygons.
 */
function ensureOverlayLayers(map) {
  if (!map?.getStyle?.() || map.getSource('hole-fairways')) return;
  const areas = [
    ['hole-fairways', '#10B981', 0.08, '#10B981', 1.5],
    ['hole-water', '#38BDF8', 0.42, '#EF4444', 1.6],
    ['hole-bunkers', '#D4AF37', 0.34, '#D4AF37', 1.6],
    ['hole-greens', '#10B981', 0.14, '#10B981', 2],
  ];
  for (const [id] of areas) {
    map.addSource(id, { type: 'geojson', data: emptyFc() });
  }
  map.addSource('hole-centerlines', { type: 'geojson', data: emptyFc() });
  map.addSource('hole-approach', { type: 'geojson', data: emptyFc() });
  map.addSource('hole-shots', { type: 'geojson', data: emptyFc() });
  for (const [id, fill, fillOpacity, line, lineWidth] of areas) {
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': fill, 'fill-opacity': fillOpacity } });
    map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': line, 'line-width': lineWidth },
    });
  }
  map.addLayer({
    id: 'hole-centerlines',
    type: 'line',
    source: 'hole-centerlines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#F8FAFC', 'line-width': 2.25 },
  });
  map.addLayer({
    id: 'hole-approach-carry',
    type: 'line',
    source: 'hole-approach',
    filter: ['==', ['get', 'leg'], 'carry'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#10B981', 'line-width': 3 },
  });
  map.addLayer({
    id: 'hole-approach-green',
    type: 'line',
    source: 'hole-approach',
    filter: ['==', ['get', 'leg'], 'green'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#D4AF37', 'line-width': 2.5, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'hole-shots-line',
    type: 'line',
    source: 'hole-shots',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#D4AF37', 'line-width': 2.5 },
  });
}

function ensureDispersionLayer(map) {
  if (!map?.getStyle?.() || map.getSource('hole-dispersion')) return;
  map.addSource('hole-dispersion', { type: 'geojson', data: emptyFc() });
  map.addLayer({
    id: 'hole-dispersion-fill',
    type: 'fill',
    source: 'hole-dispersion',
    paint: { 'fill-color': '#10B981', 'fill-opacity': 0.14 },
  });
  map.addLayer({
    id: 'hole-dispersion-line',
    type: 'line',
    source: 'hole-dispersion',
    paint: { 'line-color': '#10B981', 'line-width': 1.25, 'line-dasharray': [1.4, 1.2] },
  });
}

function syncTourPaint(map) {
  const paint = [
    ['hole-fairways-fill', 'fill-color', '#10B981'],
    ['hole-fairways-fill', 'fill-opacity', 0.08],
    ['hole-fairways-line', 'line-color', '#10B981'],
    ['hole-water-fill', 'fill-color', '#38BDF8'],
    ['hole-water-fill', 'fill-opacity', 0.42],
    ['hole-water-line', 'line-color', '#EF4444'],
    ['hole-bunkers-fill', 'fill-color', '#D4AF37'],
    ['hole-bunkers-fill', 'fill-opacity', 0.34],
    ['hole-bunkers-line', 'line-color', '#D4AF37'],
    ['hole-greens-fill', 'fill-color', '#10B981'],
    ['hole-greens-fill', 'fill-opacity', 0.14],
    ['hole-greens-line', 'line-color', '#10B981'],
  ];
  for (const [layer, prop, value] of paint) {
    if (!map.getLayer(layer)) continue;
    try { map.setPaintProperty(layer, prop, value); } catch { /* layer may still be mounting */ }
  }
}

let gpsPulseStyle = false;
function ensureGpsPulse() {
  if (gpsPulseStyle || typeof document === 'undefined') return;
  gpsPulseStyle = true;
  const style = document.createElement('style');
  style.id = 'turn-gps-pulse';
  style.textContent = '@keyframes turn-gps-pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.75)}70%{box-shadow:0 0 0 12px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}';
  document.head.appendChild(style);
}

function closestClubName(clubs, yards) {
  const list = Array.isArray(clubs) ? clubs : [];
  let best = null;
  let bestDiff = Infinity;
  for (const club of list) {
    const carry = Number(club?.carry_yards);
    if (!Number.isFinite(carry)) continue;
    const diff = Math.abs(carry - yards);
    if (diff < bestDiff) {
      best = club;
      bestDiff = diff;
    }
  }
  return best?.club_type || best?.name || '';
}

function legLabel(yards, clubs, format) {
  if (!Number.isFinite(yards) || typeof format !== 'function') return '';
  const name = closestClubName(clubs, yards);
  const dist = format(yards);
  return name ? `${name} · ${dist}` : dist;
}

function showDistance(yards, format) {
  return Number.isFinite(yards) ? format(yards) : '—';
}

function markerEl(css) {
  const el = document.createElement('div');
  el.style.cssText = css;
  return el;
}

export default function SatelliteHoleMap({
  courseName = '',
  center,
  hole,
  origin,
  lat,
  lon,
  holeNumber,
  clubs,
  onPinChange,
  onShotsChange,
  onLivePosition,
  onReticleChange,
  onYardage,
  onRegister,
  onHolePoint,
  geometry,
  viewMode = 'hole',
  showDispersion = false,
  initialShots,
  bearingDeg: bearingProp,
  isRoundActive = false,
  fill = false,
}) {
  const { formatDistance, distanceUnit } = useUnits();
  const fullscreen = Boolean(fill || isRoundActive);
  const holeNum = hole?.number ?? holeNumber ?? null;
  const propLat = validPoint(hole)?.lat ?? validPoint(center)?.lat ?? (Number.isFinite(Number(lat)) ? Number(lat) : null);
  const propLon = validPoint(hole)?.lon ?? validPoint(center)?.lon ?? (Number.isFinite(Number(lon)) ? Number(lon) : null);
  const cardYards = Number(hole?.yards);
  const cardBearing = Number.isFinite(Number(hole?.bearingDeg)) ? Number(hole.bearingDeg) : Number(bearingProp);

  const anchor = useMemo(() => {
    if (propLat != null && propLon != null) return { lat: propLat, lon: propLon };
    return resolveCenter(center, null, lat, lon);
  }, [propLat, propLon, center?.lat, center?.lon, lat, lon]);

  const [features, setFeatures] = useState([]);
  const [featureStatus, setFeatureStatus] = useState('Loading course features…');
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [mode, setMode] = useState('satellite');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [zoomLabel, setZoomLabel] = useState('16');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [gpsOrigin, setGpsOrigin] = useState(null);
  const [gpsNote, setGpsNote] = useState('');
  const [pin, setPin] = useState(null);
  const [livePin, setLivePin] = useState(null);
  const [target, setTarget] = useState(null);
  const [shots, setShots] = useState([]);
  const [gpsDot, setGpsDot] = useState(null);
  const [placeMode, setPlaceMode] = useState(null);
  const [hazardReadout, setHazardReadout] = useState(null);

  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const framedRef = useRef('');
  const aimRef = useRef('');
  const bgRestoreRef = useRef(new Map());
  const modeRef = useRef(mode);
  const clubMarkerRef = useRef(null);
  const commitPinRef = useRef(() => {});
  const onPinChangeRef = useRef(onPinChange);
  const onShotsChangeRef = useRef(onShotsChange);
  const onReticleChangeRef = useRef(onReticleChange);
  const onLivePositionRef = useRef(onLivePosition);
  const onYardageRef = useRef(onYardage);
  const onRegisterRef = useRef(onRegister);
  const onHolePointRef = useRef(onHolePoint);
  const placeModeRef = useRef(null);
  const holeNumRef = useRef(holeNum);
  const holeFeaturesRef = useRef([]);
  const lieRef = useRef(null);
  const greenRef = useRef(null);
  const targetRef = useRef(null);
  const shotsRef = useRef(shots);
  const clubsRef = useRef(clubs);
  const formatRef = useRef(formatDistance);
  modeRef.current = mode;
  onPinChangeRef.current = onPinChange;
  onShotsChangeRef.current = onShotsChange;
  onReticleChangeRef.current = onReticleChange;
  onLivePositionRef.current = onLivePosition;
  onYardageRef.current = onYardage;
  onRegisterRef.current = onRegister;
  onHolePointRef.current = onHolePoint;
  placeModeRef.current = placeMode;
  holeNumRef.current = holeNum;
  shotsRef.current = shots;
  clubsRef.current = clubs;
  formatRef.current = formatDistance;

  const layoutHole = Array.isArray(geometry?.holes)
    ? geometry.holes.find((item) => Number(item.number) === Number(holeNum))
    : null;
  const holeFeatures = useMemo(() => {
    const list = Array.isArray(features) ? features : [];
    if (!list.some((feature) => feature?.holeNumber != null)) return list;
    const number = Number(holeNum);
    return list.filter((feature) => Number(feature.holeNumber) === number);
  }, [features, holeNum]);
  holeFeaturesRef.current = holeFeatures;
  const playing = useMemo(() => {
    if (layoutHole?.tee && layoutHole?.green) {
      return {
        tee: layoutHole.tee,
        green: layoutHole.green,
        front: layoutHole.front,
        back: layoutHole.back,
        surveyed: !layoutHole.generated,
      };
    }
    return resolvePlaying(holeFeatures, holeNum, anchor, cardBearing, cardYards);
  }, [layoutHole, holeFeatures, holeNum, anchor, cardBearing, cardYards]);
  const lie = useMemo(() => {
    const last = shots.length ? shots[shots.length - 1] : null;
    return validPoint(last) || validPoint(gpsDot) || validPoint(gpsOrigin) || validPoint(origin) || playing.tee || anchor;
  }, [shots, gpsDot, gpsOrigin, origin?.lat, origin?.lon, playing.tee, anchor]);
  lieRef.current = lie;
  greenRef.current = playing.green;
  targetRef.current = target;

  const holeKey = `${courseName}|${holeNum ?? ''}|${anchor.lat.toFixed(4)},${anchor.lon.toFixed(4)}`;
  const teeKey = pointKey(playing.tee);
  const greenKey = pointKey(playing.green);
  const lieKey = pointKey(lie);
  const aimKey = `${lieKey}>${greenKey}`;
  const targetKey = pointKey(target);
  const pinKey = pointKey(pin);
  const shotsKey = shots.map((shot) => `${shot.n}:${Number(shot.lat).toFixed(5)},${Number(shot.lon).toFixed(5)}`).join('|');
  const clubsKey = Array.isArray(clubs) ? clubs.map((club) => `${club?.club_type || club?.name}:${club?.carry_yards}`).join('|') : '';

  const pinPoint = livePin || pin;
  const backYards = lie && playing.back ? metersToYards(haversineMeters(lie, playing.back)) : NaN;
  const centerYards = lie && playing.green ? metersToYards(haversineMeters(lie, playing.green)) : NaN;
  const frontYards = lie && playing.front ? metersToYards(haversineMeters(lie, playing.front)) : NaN;
  const pinYards = lie && pinPoint ? metersToYards(haversineMeters(lie, pinPoint)) : NaN;
  const targetYards = lie && target ? metersToYards(haversineMeters(lie, target)) : NaN;
  const clubName = closestClubName(clubs, targetYards);

  commitPinRef.current = (point) => {
    if (!point) return;
    setPin(point);
    setLivePin(point);
    const from = lieRef.current;
    const meters = from ? haversineMeters(from, point) : null;
    const yards = meters == null ? null : metersToYards(meters);
    onPinChangeRef.current?.({ lat: point.lat, lon: point.lon, yards, meters });
  };

  const shotSeedRef = useRef(initialShots);
  shotSeedRef.current = initialShots;
  useEffect(() => {
    setPin(null);
    setLivePin(null);
    setTarget(null);
    setHazardReadout(null);
    setPlaceMode(null);
    setShots(Array.isArray(shotSeedRef.current) ? shotSeedRef.current : []);
    onPinChangeRef.current?.(null);
  }, [holeKey]);

  useEffect(() => {
    if (target || !lie || !playing.green) return;
    setTarget(interpolate(lie, playing.green, 0.42));
  }, [target, lie, playing.green, holeKey]);

  useEffect(() => {
    if (!pin || !lie) return;
    const meters = haversineMeters(lie, pin);
    onPinChangeRef.current?.({ lat: pin.lat, lon: pin.lon, yards: metersToYards(meters), meters });
  }, [lieKey, pinKey, pin, lie]);

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

  const cellLat = Math.round(anchor.lat * 100) / 100;
  const cellLon = Math.round(anchor.lon * 100) / 100;

  useEffect(() => {
    if (geometry === undefined) return undefined;
    const next = Array.isArray(geometry?.features) ? geometry.features : [];
    setFeatures(next);
    if (!geometry) setFeatureStatus('Loading course features…');
    else setFeatureStatus(geometry.generated ? 'Playable hole corridors' : `${next.length} course features`);
    return undefined;
  }, [geometry]);

  useEffect(() => {
    if (geometry !== undefined) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const key = courseCacheKey(courseName, cellLat, cellLon);

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
              cellLat,
              cellLon,
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
        const dosLagos = isDosLagosCourse(courseName);
        const queryLat = dosLagos ? DOS_LAGOS.lat : anchor.lat;
        const queryLon = dosLagos ? DOS_LAGOS.lon : anchor.lon;
        const fresh = await fetchGolfFeatures(queryLat, queryLon, dosLagos, controller.signal);
        if (cancelled) return;
        if (fresh.length) {
          setFeatures(fresh);
          setFeatureStatus(`${fresh.length} course features`);
          const record = {
            key,
            courseName: courseName || '',
            cellLat,
            cellLon,
            features: fresh,
            fetchedAt: Date.now(),
          };
          writeCourseCache(record).catch(() => {});
          upsertRemoteGeometry(record);
        } else if (hadCache) {
          setFeatureStatus('Showing saved course features');
        } else {
          setFeatures([]);
          setFeatureStatus('No mapped golf features in this view');
        }
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
  }, [cellLat, cellLon, courseName, online, geometry]);

  useLayoutEffect(() => {
    const el = mapElRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width > 0 && height > 0) {
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }
      safeResize(mapRef.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    safeResize(mapRef.current);
  }, [holeKey, size.width, size.height, fullscreen, mapReady]);

  useEffect(() => {
    const container = mapElRef.current;
    if (!container) return undefined;
    let map;
    let cancelled = false;
    const token = mapboxToken();
    const usingMapbox = token.length > 0;
    const startup = new AbortController();

    const start = anchorRef.current || DOCUMENTED_DEFAULT;
    map = new maplibregl.Map({
        container: mapElRef.current,
        style: usingMapbox ? MAPBOX_STYLE : usgsRasterStyle(),
        center: [start.lon, start.lat],
        zoom: 16,
        bearing: 0,
        pitch: 0,
        maxPitch: 0,
        bearingSnap: 0,
        minZoom: 12,
        maxZoom: 19,
        fadeDuration: 0,
        attributionControl: { compact: false, customAttribution: usingMapbox ? '© Mapbox © OpenStreetMap' : 'USGS National Map · © OpenStreetMap / OpenFreeMap' },
        transformRequest: (url) => rewriteCachedTileRequest(url).then((cached) => {
          if (cached) return cached;
          if (usingMapbox) return { url: rewriteMapboxUrl(url, token) };
          return { url };
        }),
      });
      mapRef.current = map;
      map.resize();
      map.dragRotate?.disable?.();
      map.touchZoomRotate?.disableRotation?.();
      map.keyboard?.disableRotation?.();
      map.on('load', () => {
        if (cancelled) return;
        ensureOverlayLayers(map);
        ensureDispersionLayer(map);
        syncTourPaint(map);
        applyBasemapMode(map, modeRef.current === 'schematic', bgRestoreRef.current);
        safeResize(map);
        requestAnimationFrame(() => {
          safeResize(map);
          requestAnimationFrame(() => safeResize(map));
        });
        setMapError('');
        setMapReady(true);
        setZoomLabel(String(Math.round(map.getZoom())));
        if (!usingMapbox) attachLibertyLabels(map, startup.signal);
      });
      map.on('zoom', () => {
        if (!cancelled) setZoomLabel(String(Math.round(map.getZoom())));
      });
      map.on('click', (event) => {
        if (cancelled) return;
        const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
        if (placeModeRef.current) {
          onHolePointRef.current?.(holeNumRef.current, placeModeRef.current, point);
          placeModeRef.current = null;
          setPlaceMode(null);
          return;
        }
        let hits = [];
        try {
          const layers = ['hole-bunkers-fill', 'hole-water-fill'].filter((id) => map.getLayer(id));
          if (layers.length) hits = map.queryRenderedFeatures(event.point, { layers }) || [];
        } catch {
          hits = [];
        }
        if (hits.length) {
          const featureId = hits[0]?.properties?.id;
          const feature = (holeFeaturesRef.current || []).find((item) => item.id === featureId);
          const ring = feature?.rings?.[0];
          const from = lieRef.current;
          const kind = String(hits[0]?.layer?.id || '').includes('bunker') ? 'bunker' : 'water';
          if (ring && from) {
            let carry = Infinity;
            let clear = 0;
            for (const spot of ring) {
              const yards = metersToYards(haversineMeters(from, spot));
              if (yards < carry) carry = yards;
              if (yards > clear) clear = yards;
            }
            setHazardReadout({
              kind,
              carry: Number.isFinite(carry) ? carry : null,
              clear: Number.isFinite(clear) ? clear : null,
            });
            return;
          }
        }
        commitPinRef.current(point);
      });
      map.on('error', (event) => {
        if (cancelled) return;
        const raw = String(event?.error?.message || 'map tile warning');
        const safe = raw.replace(/access_token=[^&\s]+/gi, 'access_token=redacted');
        console.warn(safe);
        if (/WebGL|Failed to initialize/i.test(raw)) setMapError(safe);
      });

    return () => {
      cancelled = true;
      startup.abort();
      setMapReady(false);
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const root = mapElRef.current;
    if (!root) return;
    root.querySelectorAll('.maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right').forEach((el) => {
      el.style.bottom = fullscreen ? '5.5rem' : '0px';
    });
    root.querySelectorAll('.maplibregl-ctrl-attrib').forEach((el) => {
      el.style.fontSize = '10px';
      el.style.maxWidth = '70vw';
      el.style.whiteSpace = 'normal';
    });
  }, [fullscreen, mapReady, size.height]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    ensureOverlayLayers(map);
    ensureDispersionLayer(map);
    syncTourPaint(map);
    setSourceData(map, 'hole-fairways', polygonsFor(holeFeatures, 'fairway'));
    setSourceData(map, 'hole-greens', polygonsFor(holeFeatures, 'green'));
    setSourceData(map, 'hole-bunkers', polygonsFor(holeFeatures, 'bunker'));
    setSourceData(map, 'hole-water', polygonsFor(holeFeatures, 'water'));
    setSourceData(map, 'hole-centerlines', linesFor(holeFeatures, 'hole'));
    applyBasemapMode(map, mode === 'schematic', bgRestoreRef.current);
  }, [mapReady, holeFeatures, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    ensureOverlayLayers(map);
    ensureDispersionLayer(map);
    setSourceData(map, 'hole-approach', approachFc(lie, target, playing.green));
    setSourceData(map, 'hole-shots', shotsFc(shots, playing.tee));
    setSourceData(map, 'hole-dispersion', showDispersion ? dispersionFc(lie, target) : emptyFc());
  }, [mapReady, lie, target, playing.green, playing.tee, shots, lieKey, targetKey, greenKey, shotsKey, showDispersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !playing.tee || !playing.green) return;
    if (size.width < 40 || size.height < 40) return;
    const bearing = bearingBetween(playing.tee, playing.green);
    const featureIds = holeFeatures.map((feature) => feature.id).join('.');
    const frameId = `${holeKey}|${viewMode}|${teeKey}|${greenKey}|${featureIds}|${fullscreen ? 'fill' : 'card'}`;
    if (framedRef.current === frameId) return;
    framedRef.current = frameId;
    const points = [];
    const push = (point) => {
      if (Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) points.push(point);
    };
    if (viewMode === 'green') {
      push(playing.front);
      push(playing.green);
      push(playing.back);
      holeFeatures.filter((feature) => feature.kind === 'green').forEach((feature) => {
        feature.rings?.forEach((ring) => ring.forEach(push));
      });
    } else {
      push(playing.tee);
      push(playing.green);
      push(playing.front);
      push(playing.back);
      holeFeatures.forEach((feature) => {
        if (!['fairway', 'green', 'bunker', 'water', 'hole'].includes(feature.kind)) return;
        feature.rings?.forEach((ring) => ring.forEach(push));
      });
    }
    if (!points.length) return;
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const point of points) {
      west = Math.min(west, point.lon);
      east = Math.max(east, point.lon);
      south = Math.min(south, point.lat);
      north = Math.max(north, point.lat);
    }
    if (east - west < 0.00035) {
      west -= 0.00025;
      east += 0.00025;
    }
    if (north - south < 0.00035) {
      south -= 0.00025;
      north += 0.00025;
    }
    const holeBounds = new maplibregl.LngLatBounds([west, south], [east, north]);
    const padding = fullscreen ? HOLE_FIT_PADDING : { top: 36, bottom: 36, left: 16, right: 16 };
    safeResize(map);
    try {
      map.fitBounds(holeBounds, { bearing, padding, duration: 600 });
    } catch (error) {
      console.warn(error?.message || 'fitBounds skipped');
    }
  }, [mapReady, holeKey, viewMode, teeKey, greenKey, holeFeatures, fullscreen, size.width, size.height, playing.tee, playing.green, playing.front, playing.back]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return undefined;
    const markers = [];
    const add = (marker) => {
      markers.push(marker);
      return marker;
    };

    if (playing.tee) {
      add(new maplibregl.Marker({
        element: markerEl('width:16px;height:16px;border-radius:9999px;background:#10B981;border:2px solid #fff;box-shadow:0 0 0 3px rgba(16,185,129,0.35);pointer-events:none'),
        anchor: 'center',
      }).setLngLat([playing.tee.lon, playing.tee.lat]).addTo(map));
    }
    [
      ['F', playing.front],
      ['C', playing.green],
      ['B', playing.back],
    ].forEach(([label, point]) => {
      if (!point) return;
      const el = markerEl('min-width:18px;height:18px;padding:0 3px;border-radius:9999px;background:#0B0D0C;color:#10B981;border:1px solid #10B981;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;pointer-events:none');
      el.textContent = label;
      add(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([point.lon, point.lat]).addTo(map));
    });
    holeFeatures.filter((feature) => feature.kind === 'water').slice(0, 4).forEach((feature) => {
      const ring = feature.rings?.[0];
      if (!ring?.length || !lie) return;
      let lat = 0;
      let lon = 0;
      let carry = Infinity;
      for (const spot of ring) {
        lat += spot.lat;
        lon += spot.lon;
        const yards = metersToYards(haversineMeters(lie, spot));
        if (yards < carry) carry = yards;
      }
      const badge = markerEl('pointer-events:none;background:rgba(11,13,12,0.82);color:#38BDF8;border:1px solid #EF4444;border-radius:9999px;padding:1px 6px;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap');
      badge.textContent = Number.isFinite(carry) ? formatDistance(carry) : '—';
      add(new maplibregl.Marker({ element: badge, anchor: 'center' })
        .setLngLat([lon / ring.length, lat / ring.length])
        .addTo(map));
    });
    if (target && lie && playing.green) {
      const label = markerEl('pointer-events:none;background:rgba(11,13,12,0.82);color:#10B981;border:1px solid rgba(255,255,255,0.18);border-radius:9999px;padding:2px 8px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap');
      label.textContent = legLabel(metersToYards(haversineMeters(lie, target)), clubs, formatDistance);
      const mid = interpolate(lie, target, 0.5);
      const clubMarker = add(new maplibregl.Marker({ element: label, anchor: 'bottom', offset: [0, -10] })
        .setLngLat([mid.lon, mid.lat])
        .addTo(map));
      clubMarkerRef.current = clubMarker;
      const handle = add(new maplibregl.Marker({
        element: markerEl('width:28px;height:28px;border-radius:9999px;border:2px solid #10B981;background:rgba(16,185,129,0.35);box-shadow:0 0 0 6px rgba(16,185,129,0.18);cursor:grab'),
        anchor: 'center',
        draggable: true,
      }).setLngLat([target.lon, target.lat]).addTo(map));
      handle.on('drag', () => {
        const ll = handle.getLngLat();
        const point = { lat: ll.lat, lon: ll.lng };
        const from = lieRef.current;
        setSourceData(map, 'hole-approach', approachFc(from, point, greenRef.current));
        if (!from) return;
        const middle = interpolate(from, point, 0.5);
        clubMarker.setLngLat([middle.lon, middle.lat]);
        const yards = metersToYards(haversineMeters(from, point));
        label.textContent = legLabel(yards, clubsRef.current, formatRef.current);
      });
      handle.on('dragend', () => {
        const ll = handle.getLngLat();
        const point = { lat: ll.lat, lon: ll.lng };
        setTarget(point);
        const from = lieRef.current;
        if (!from) return;
        const meters = haversineMeters(from, point);
        const yards = metersToYards(meters);
        onReticleChangeRef.current?.({
          lat: point.lat,
          lon: point.lon,
          meters,
          yards,
          club: closestClubName(clubsRef.current, yards),
        });
      });
    }
    if (pin) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:grab';
      const flag = markerEl('width:18px;height:18px;background:#D4AF37;border:2px solid #0B0D0C;border-radius:2px 10px 10px 10px');
      const text = markerEl('margin-top:2px;background:#0B0D0C;color:#fff;border-radius:9999px;padding:1px 6px;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap');
      if (lie) text.textContent = formatDistance(metersToYards(haversineMeters(lie, pin)));
      wrap.append(flag, text);
      const flagMarker = add(new maplibregl.Marker({ element: wrap, anchor: 'bottom', draggable: true })
        .setLngLat([pin.lon, pin.lat])
        .addTo(map));
      flagMarker.on('drag', () => {
        const ll = flagMarker.getLngLat();
        const point = { lat: ll.lat, lon: ll.lng };
        const from = lieRef.current;
        setLivePin(point);
        if (!from) return;
        const meters = haversineMeters(from, point);
        const yards = metersToYards(meters);
        text.textContent = formatRef.current(yards);
        onPinChangeRef.current?.({ lat: point.lat, lon: point.lon, yards, meters });
      });
      flagMarker.on('dragend', () => {
        const ll = flagMarker.getLngLat();
        commitPinRef.current({ lat: ll.lat, lon: ll.lng });
      });
    }
    for (const shot of shots) {
      const el = markerEl('min-width:22px;height:22px;padding:0 4px;border-radius:9999px;background:#D4AF37;color:#0B0D0C;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;border:1px solid #0B0D0C');
      el.textContent = String(shot.n);
      add(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([shot.lon, shot.lat]).addTo(map));
    }

    return () => {
      clubMarkerRef.current = null;
      markers.forEach((marker) => marker.remove());
    };
  }, [mapReady, targetKey, pinKey, shotsKey, lieKey, greenKey, distanceUnit, clubsKey, clubs, formatDistance, lie, pin, playing.tee, playing.green, playing.front, playing.back, shots, target, holeFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !gpsDot) return undefined;
    ensureGpsPulse();
    const marker = new maplibregl.Marker({
      element: markerEl('width:12px;height:12px;border-radius:9999px;background:#38BDF8;border:2px solid #10B981;animation:turn-gps-pulse 1.6s infinite;pointer-events:none'),
      anchor: 'center',
    }).setLngLat([gpsDot.lon, gpsDot.lat]).addTo(map);
    return () => marker.remove();
  }, [mapReady, gpsDot]);

  useEffect(() => {
    if (!fullscreen || !navigator.geolocation) return undefined;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const next = validPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!next) return;
        setGpsDot(next);
        onLivePositionRef.current?.(next);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [fullscreen]);

  useEffect(() => {
    onYardageRef.current?.({
      frontYards: Number.isFinite(frontYards) ? frontYards : null,
      centerYards: Number.isFinite(centerYards) ? centerYards : null,
      backYards: Number.isFinite(backYards) ? backYards : null,
      pinYards: Number.isFinite(pinYards) ? pinYards : null,
      bearingDeg: playing.tee && playing.green ? bearingBetween(playing.tee, playing.green) : null,
    });
  }, [frontYards, centerYards, backYards, pinYards, teeKey, greenKey, playing.tee, playing.green]);

  const markShotRef = useRef(null);
  const markPinRef = useRef(null);
  useEffect(() => {
    onRegisterRef.current?.({
      markShot: () => markShotRef.current?.(),
      setPin: () => markPinRef.current?.(),
    });
  }, [holeKey, mapReady]);

  const wantsLive = typeof onLivePosition === 'function';
  useEffect(() => {
    if (!wantsLive || !navigator.geolocation) return undefined;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const next = validPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (next) onLivePositionRef.current?.(next);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [wantsLive]);

  const useMyGps = () => {
    if (!navigator.geolocation) {
      setGpsNote('GPS unavailable — using the tee');
      return;
    }
    setGpsNote('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = validPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        if (!next) {
          setGpsNote('GPS unavailable — using the tee');
          return;
        }
        setGpsOrigin(next);
        setGpsNote('GPS lie set');
        onLivePositionRef.current?.(next);
      },
      () => setGpsNote('GPS unavailable — using the tee'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  };

  const markShot = () => {
    const point = targetRef.current;
    const previous = shotsRef.current[shotsRef.current.length - 1] || lieRef.current;
    if (!point || !previous) return;
    const meters = haversineMeters(previous, point);
    const next = [...shotsRef.current, {
      n: shotsRef.current.length + 1,
      lat: point.lat,
      lon: point.lon,
      yards: metersToYards(meters),
      meters,
    }];
    setShots(next);
    onShotsChangeRef.current?.(next);
    const green = greenRef.current;
    if (green) setTarget(interpolate(point, green, 0.42));
  };
  markShotRef.current = markShot;

  const markPin = () => {
    commitPinRef.current(greenRef.current || lieRef.current);
  };
  markPinRef.current = markPin;

  const zoomBy = (delta) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 200 });
  };

  const holeLabel = holeNum != null
    ? `Hole ${holeNum}${hole?.par ? ` · Par ${hole.par}` : ''}`
    : 'Hole map';
  const originLabel = validPoint(gpsDot) ? 'From GPS' : validPoint(gpsOrigin) ? 'From GPS' : validPoint(origin) ? 'From lie' : 'From tee';
  const controlBottom = '2.25rem';

  return (
    <section
      className={fullscreen
        ? 'fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-[#0B0D0C]'
        : 'relative w-full max-w-md overflow-hidden rounded-2xl border'}
      style={fullscreen ? undefined : { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      aria-label="Satellite hole map"
    >
      {!fullscreen && (
        <div className="flex shrink-0 items-start justify-between gap-2 px-3 pb-2 pt-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{courseName || 'Satellite hole map'}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{holeLabel}</div>
          </div>
        </div>
      )}

      <div className={fullscreen ? 'relative h-full w-full' : 'relative h-[320px] w-full'}>
        <div
          ref={mapElRef}
          className="h-full w-full"
          style={{ backgroundColor: '#0B0D0C' }}
        />

      <div className="pointer-events-none absolute inset-0 z-20">
        {!fullscreen && (
        <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 gap-1.5">
          {[
            ['Back', backYards, false],
            ['Center', centerYards, true],
            ['Front', frontYards, false],
          ].map(([label, yards, emerald]) => (
            <div
              key={label}
              className={`min-h-[44px] min-w-[4.5rem] rounded-full border px-3 py-1 text-center backdrop-blur-md ${
                emerald
                  ? 'border-[#10B981] bg-[#10B981] text-[#0B0D0C]'
                  : 'border-white/25 bg-[#0B0D0C]/55 text-white'
              }`}
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${emerald ? 'text-[#0B0D0C]/80' : 'text-white/70'}`}>{label}</div>
              <div className="tabular-nums text-sm font-bold leading-tight">{showDistance(yards, formatDistance)}</div>
            </div>
          ))}
        </div>
        )}

        <div className={`absolute flex flex-col gap-1.5 ${fullscreen ? 'left-2 top-28' : 'right-2 top-2'}`}>
          <div className="pointer-events-auto flex overflow-hidden rounded-full border border-white/20 bg-[#0B0D0C]/75 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setMode('satellite')}
              aria-pressed={mode === 'satellite'}
              className="min-h-[44px] px-3 text-[11px] font-semibold text-white"
              style={{ backgroundColor: mode === 'satellite' ? '#10B981' : 'transparent', color: mode === 'satellite' ? '#0B0D0C' : '#fff' }}
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setMode('schematic')}
              aria-pressed={mode === 'schematic'}
              className="min-h-[44px] px-3 text-[11px] font-semibold"
              style={{ backgroundColor: mode === 'schematic' ? '#10B981' : 'transparent', color: mode === 'schematic' ? '#0B0D0C' : '#fff' }}
            >
              Schematic
            </button>
          </div>
          <div className="pointer-events-auto ml-auto flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0B0D0C]/80 text-white backdrop-blur-md">
            <button type="button" className="min-h-[44px] min-w-[44px] text-lg font-semibold leading-none" aria-label="Zoom in" onClick={() => zoomBy(1)}>+</button>
            <div className="border-y border-white/15 text-center text-[10px] tabular-nums">{zoomLabel}</div>
            <button type="button" className="min-h-[44px] min-w-[44px] text-lg font-semibold leading-none" aria-label="Zoom out" onClick={() => zoomBy(-1)}>−</button>
          </div>
        </div>

        {fullscreen && geometry?.generated ? (
          <div className="pointer-events-auto absolute bottom-28 left-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setPlaceMode((mode) => (mode === 'tee' ? null : 'tee'))}
              className="min-h-[44px] rounded-2xl px-3 text-xs font-semibold backdrop-blur-md"
              style={{ backgroundColor: placeMode === 'tee' ? '#10B981' : 'rgba(11,13,12,0.85)', color: placeMode === 'tee' ? '#0B0D0C' : '#fff' }}
            >
              Set tee
            </button>
            <button
              type="button"
              onClick={() => setPlaceMode((mode) => (mode === 'green' ? null : 'green'))}
              className="min-h-[44px] rounded-2xl px-3 text-xs font-semibold backdrop-blur-md"
              style={{ backgroundColor: placeMode === 'green' ? '#D4AF37' : 'rgba(11,13,12,0.85)', color: placeMode === 'green' ? '#0B0D0C' : '#fff' }}
            >
              Set green
            </button>
          </div>
        ) : null}
        {hazardReadout ? (
          <div className="pointer-events-none absolute bottom-24 left-2 rounded-2xl border border-white/15 bg-[#0B0D0C]/85 px-3 py-2 text-white backdrop-blur-md">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">
              {hazardReadout.kind === 'bunker' ? 'Bunker' : 'Carry'}
            </div>
            <div className="tabular-nums text-sm font-semibold">
              {hazardReadout.kind === 'bunker'
                ? `${showDistance(hazardReadout.carry, formatDistance)} carry · ${showDistance(hazardReadout.clear, formatDistance)} clear`
                : showDistance(hazardReadout.carry, formatDistance)}
            </div>
          </div>
        ) : null}
        {!fullscreen && (
        <div className="absolute left-2 flex max-w-[70%] flex-wrap gap-1.5" style={{ bottom: controlBottom }}>
          <button
            type="button"
            onClick={markShot}
            disabled={!target}
            className="pointer-events-auto min-h-[44px] rounded-full bg-[#0B0D0C]/85 px-3 text-xs font-semibold text-[#D4AF37] backdrop-blur-md disabled:opacity-40"
          >
            Mark Shot
          </button>
          <button
            type="button"
            onClick={markPin}
            className="pointer-events-auto min-h-[44px] rounded-full bg-[#0B0D0C]/85 px-3 text-xs font-semibold text-white backdrop-blur-md"
          >
            Mark Today&apos;s Pin
          </button>
          {fullscreen && (
            <button
              type="button"
              onClick={useMyGps}
              className="pointer-events-auto min-h-[44px] rounded-full bg-[#0B0D0C]/85 px-3 text-xs font-semibold text-white backdrop-blur-md"
            >
              Use my GPS
            </button>
          )}
          <div className="pointer-events-none min-h-[44px] rounded-full bg-[#0B0D0C]/75 px-3 py-1 text-white backdrop-blur-md">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#D4AF37]">Pin</div>
            <div className="tabular-nums text-sm font-bold leading-tight">{showDistance(pinYards, formatDistance)}</div>
          </div>
        </div>
        )}

        {!mapReady && !mapError && (
          <div className="absolute left-3 top-1/2 text-xs font-semibold text-white/80">Loading satellite…</div>
        )}
        {mapError && (
          <div className="absolute left-3 right-3 top-1/2 rounded-xl bg-[#0B0D0C]/90 px-3 py-2 text-xs text-white">{mapError}</div>
        )}
        <p className="sr-only">{featureStatus}. {clubName ? `${clubName} to target.` : ''}</p>
      </div>
      </div>

      {!fullscreen && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>To pin</div>
            <div className="tabular-nums text-lg font-semibold leading-tight">
              {Number.isFinite(pinYards) ? formatDistance(pinYards) : 'Tap the map to drop a pin'}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {originLabel}{gpsNote ? ` · ${gpsNote}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={useMyGps}
            className="min-h-[44px] shrink-0 rounded-xl border px-3 py-2 text-[11px] font-semibold"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            Use my GPS
          </button>
        </div>
      )}

      {!fullscreen && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-3 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#10B981]" />Fairway</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#10B981]" />Green</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: '#D4AF37' }} />Bunker</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-sky-400" />Water</span>
          <span className="truncate">{featureStatus}</span>
        </div>
      )}
    </section>
  );
}
