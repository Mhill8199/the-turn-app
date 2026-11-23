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
      { number: 2, par: 5, yards: 518, bearingDeg: 210, bunkerStart: 275, bunkerEnd: 295, waterCarry: 185, greenSlope: 'Two-Tier Back', note: 'Lay up to 95–105 yds short of the creek unless tailwind is 10+ mph.' },
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
      { number: 1, par: 4, yards: 368, bearingDeg: 160, bunkerStart: 240, bunkerEnd: 260, waterCarry: null, greenSlope: 'Gentle Tilt', note: 'Position drive at 235–245y for a flat wedge angle.' },
      { number: 2, par: 3, yards: 152, bearingDeg: 240, bunkerStart: 138, bunkerEnd: 146, waterCarry: null, greenSlope: 'Front Bunker', note: 'Do not miss short right.' },
    ],
  },
];

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

/**
 * Computes effective carry & rollout given stock yardages, wind vector relative to hole bearing,
 * temperature air-density delta, dew-point turf moisture, and course elevation.
 */
export function calculateShotPhysics({ stockCarry, stockTotal, windSpeedMph, windDirDeg, holeBearingDeg, tempF, dewPointF, elevationFt }) {
  // Angle difference between wind source direction and hole direction
  // If windDirDeg == holeBearingDeg, wind blows straight into player's face (headwind)
  const relRad = ((windDirDeg - holeBearingDeg) * Math.PI) / 180;
  const headwindComponent = Math.cos(relRad) * windSpeedMph; // + = headwind, - = tailwind
  const crosswindComponent = Math.sin(relRad) * windSpeedMph; // + = right-to-left, - = left-to-right

  // Wind factor: headwinds hurt ~1% per mph; tailwinds help ~0.55% per mph
  const windFactor = headwindComponent >= 0
    ? 1 - headwindComponent * 0.01
    : 1 + Math.abs(headwindComponent) * 0.0055;

  // Temperature factor: ~1.5% per 20°F away from 70°F
  const tempFactor = 1 + ((tempF - 70) / 20) * 0.015;

  // Elevation factor: ~1.5% gain per 1,000 ft above sea level
  const elevationFactor = 1 + (elevationFt / 1000) * 0.015;

  const effectiveCarry = Math.round(stockCarry * windFactor * tempFactor * elevationFactor);

  // Dew point spread determines turf firmness & morning dew rollout
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
