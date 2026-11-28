/**
 * Golf Intelligence search, hydrate, and green slope.
 * Hydrated holes are stored with courseGeometries.js under the-turn-course-geometries.
 * Search hits stay in the course catalog. They are not written as geometries.
 * Nominatim and Overpass remain the offline fallback when the proxy cannot be reached.
 */

import { supabase } from '../lib/supabase';
import { searchCoursesByName } from './globalCourseCatalog';
import { readStoredGeometry, rememberHydratedGeometry } from './courseGeometries';

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function invokeProxy(body) {
  const { data, error } = await supabase.functions.invoke('golf-intel-proxy', { body });
  if (error) {
    const failure = new Error(error.message || 'Golf Intelligence proxy unavailable');
    failure.name = error.name || 'ProxyError';
    throw failure;
  }
  if (data && typeof data === 'object' && data.error && !data.courses && !data.holes && !data.imageUrl && data.imageUrl !== null) {
    throw new Error(String(data.error));
  }
  return data;
}

function catalogCourse(row) {
  const publicId = String(row?.publicId || '').trim();
  const name = String(row?.name || '').trim();
  if (!publicId || !name) return null;
  const lat = finite(row.lat);
  const lon = finite(row.lon);
  return {
    id: `gi-${publicId}`,
    publicId,
    name,
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    source: 'golf-intel',
  };
}

export async function searchGolfCourses(query, { signal } = {}) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return [];
  if (signal?.aborted) throw abortError();
  try {
    const data = await invokeProxy({ action: 'search', keywords: trimmed });
    if (signal?.aborted) throw abortError();
    const rows = Array.isArray(data?.courses) ? data.courses : [];
    return rows.map(catalogCourse).filter(Boolean);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    return searchCoursesByName(trimmed, { signal });
  }
}

export async function hydrateGolfCourse(course, { signal } = {}) {
  const publicId = String(course?.publicId || '').trim();
  if (!publicId) return null;
  const anchored = {
    ...course,
    id: course?.id || `gi-${publicId}`,
    publicId,
  };
  const cached = await readStoredGeometry(anchored);
  if (cached?.source === 'golf-intel' && cached.holes?.length) return cached;
  if (signal?.aborted) throw abortError();
  const data = await invokeProxy({ action: 'hydrate', publicId });
  if (signal?.aborted) throw abortError();
  if (!data || data.error || !Array.isArray(data.holes)) return null;
  return rememberHydratedGeometry(anchored, data);
}

export async function fetchGreenSlope(identifiers = {}) {
  const data = await invokeProxy({
    action: 'slope',
    publicId: identifiers.publicId || undefined,
    holeId: identifiers.holeId || undefined,
    holeNumber: identifiers.holeNumber ?? undefined,
    imageSizeType: identifiers.imageSizeType || 'Portrait',
  });
  return data || { imageUrl: null };
}
