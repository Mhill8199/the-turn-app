import { createElement, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** 1 yard = 0.9144 meters exactly. */
export const YARDS_TO_METERS = 0.9144;
/** 1 mph = 1.609344 km/h exactly. */
export const MPH_TO_KMH = 1.609344;
/** 1 mph = 0.44704 m/s exactly. */
export const MPH_TO_MS = 0.44704;

export const DISTANCE_UNIT_STORAGE_KEY = 'the-turn-distance-unit';

const EM_DASH = '\u2014';

function toFiniteNumber(input) {
  if (input == null) return NaN;
  if (typeof input === 'string' && input.trim() === '') return NaN;
  const value = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(value) ? value : NaN;
}

function normalizeDistanceUnit(unit) {
  return unit === 'm' ? 'm' : 'yds';
}

function normalizeSpeedUnit(unit) {
  const key = String(unit ?? 'mph').trim().toLowerCase();
  if (key === 'km/h' || key === 'kmh') return 'km/h';
  if (key === 'm/s' || key === 'ms') return 'm/s';
  return 'mph';
}

export function formatDistance(yards, unit = 'yds') {
  const value = toFiniteNumber(yards);
  if (!Number.isFinite(value)) return EM_DASH;
  if (normalizeDistanceUnit(unit) === 'm') {
    return `${Math.round(value * YARDS_TO_METERS)} m`;
  }
  return `${Math.round(value)} yds`;
}

// mph and km/h use the nearest whole number; m/s uses one decimal under 10, otherwise a whole number.
export function formatSpeed(mph, unit = 'mph') {
  const value = toFiniteNumber(mph);
  if (!Number.isFinite(value)) return EM_DASH;
  const speedUnit = normalizeSpeedUnit(unit);
  if (speedUnit === 'km/h') {
    return `${Math.round(value * MPH_TO_KMH)} km/h`;
  }
  if (speedUnit === 'm/s') {
    const metersPerSecond = value * MPH_TO_MS;
    if (Math.abs(metersPerSecond) < 10) {
      return `${(Math.round(metersPerSecond * 10) / 10).toFixed(1)} m/s`;
    }
    return `${Math.round(metersPerSecond)} m/s`;
  }
  return `${Math.round(value)} mph`;
}

function readStoredDistanceUnit() {
  try {
    const stored = localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
    if (stored === 'm' || stored === 'yds') return stored;
  } catch {
    // localStorage can throw in private browsing.
  }
  return 'yds';
}

export const UnitContext = createContext(null);

export function UnitProvider({ children }) {
  const [distanceUnit, setDistanceUnitState] = useState(readStoredDistanceUnit);

  useEffect(() => {
    try {
      localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, distanceUnit);
    } catch {
      // Ignore quota and privacy-mode failures; in-memory state still updates.
    }
  }, [distanceUnit]);

  const setDistanceUnit = useCallback((next) => {
    setDistanceUnitState((prev) => normalizeDistanceUnit(typeof next === 'function' ? next(prev) : next));
  }, []);

  const toggleDistanceUnit = useCallback(() => {
    setDistanceUnitState((prev) => (prev === 'yds' ? 'm' : 'yds'));
  }, []);

  const speedUnit = distanceUnit === 'm' ? 'km/h' : 'mph';

  const value = useMemo(
    () => ({
      distanceUnit,
      setDistanceUnit,
      toggleDistanceUnit,
      speedUnit,
      formatDistance: (yards) => formatDistance(yards, distanceUnit),
      formatSpeed: (mph) => formatSpeed(mph, speedUnit),
      tabularNumsClass: 'tabular-nums',
    }),
    [distanceUnit, setDistanceUnit, toggleDistanceUnit, speedUnit]
  );

  return createElement(UnitContext.Provider, { value }, children);
}

export function useUnits() {
  const context = useContext(UnitContext);
  if (!context) {
    throw new Error('useUnits must be used within a UnitProvider');
  }
  return context;
}
