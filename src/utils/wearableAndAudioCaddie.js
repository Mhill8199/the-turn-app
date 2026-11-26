/**
 * On-course caddie speech and wearable HUD copy.
 * speakCaddieCallout speaks one short callout; buildWearablePayload
 * shapes the same line for a watch Live Activity and glasses HUDs.
 */

/** 1 yard = 0.9144 meters. */
const YARDS_TO_METERS = 0.9144;

/** App language codes to speechSynthesis locales. */
export const TTS_LOCALE_BY_LANG = {
  en: 'en-US',
  es: 'es-ES',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  de: 'de-DE',
  fr: 'fr-FR',
  pt: 'pt-BR',
  sv: 'sv-SE',
  it: 'it-IT',
};

/**
 * @param {string | null | undefined} langOrLocale App language code or a full locale.
 * @returns {string}
 */
export function resolveTtsLocale(langOrLocale) {
  if (langOrLocale == null) return 'en-US';
  const raw = String(langOrLocale).trim();
  if (!raw) return 'en-US';
  if (raw.includes('-')) return raw;
  return TTS_LOCALE_BY_LANG[raw.toLowerCase()] || 'en-US';
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isMetricUnit(unit) {
  const key = String(unit ?? '').trim().toLowerCase();
  return key === 'm' || key === 'meter' || key === 'meters' || key === 'metre' || key === 'metres';
}

function wearableUnit(unit) {
  return isMetricUnit(unit) ? 'm' : 'yds';
}

function roundDistance(yardsValue) {
  const yards = finiteNumber(yardsValue);
  if (yards == null) return null;
  return {
    yards: Math.round(yards),
    meters: Math.round(yards * YARDS_TO_METERS),
  };
}

function spokenDistance(yardsValue, unit) {
  const rounded = roundDistance(yardsValue);
  if (!rounded) return '';
  if (isMetricUnit(unit)) return `${rounded.meters} meters`;
  return `${rounded.yards} yards`;
}

function publicText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b(bearer|token|secret|password)\b\s*[:=]?\s*\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clause(value) {
  return publicText(value).replace(/[.。]+$/u, '').trim();
}

function windClause(wind) {
  if (wind == null || wind === false) return '';
  if (typeof wind === 'number') return Number.isFinite(wind) ? `Wind ${wind}` : '';
  if (typeof wind === 'string') return clause(wind);
  if (typeof wind !== 'object' || Array.isArray(wind)) return '';
  const speed = wind.speed ?? wind.mph ?? wind.speedMph;
  const direction = wind.direction ?? wind.dir;
  const note = typeof wind.note === 'string' ? wind.note : typeof wind.description === 'string' ? wind.description : '';
  const bits = [direction, speed, note].map((part) => clause(part)).filter(Boolean);
  if (!bits.length) return '';
  const text = bits.join(' ');
  return /^wind\b/i.test(text) ? text : `Wind ${text}`;
}

function pinYards(payload) {
  const target = finiteNumber(payload.targetYards);
  if (target != null) return target;
  return finiteNumber(payload.carry);
}

/**
 * One short caddie sentence. A string payload is spoken as given.
 * @param {string | object | null | undefined} payload
 * @param {string} [unit]
 */
function buildCaddieSentence(payload, unit = 'yds') {
  if (typeof payload === 'string') return publicText(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';

  const parts = [];
  if (payload.holeNumber != null && publicText(payload.holeNumber) !== '') {
    parts.push(`Hole ${publicText(payload.holeNumber)}`);
  }
  const club = clause(payload.club);
  if (club) parts.push(club);

  const distance = spokenDistance(pinYards(payload), unit);
  if (distance) parts.push(`${distance} to the pin`);

  const playsLikeNumber = finiteNumber(payload.playsLike) ?? finiteNumber(payload.playsLikeYards);
  if (playsLikeNumber != null) {
    const playsLike = spokenDistance(playsLikeNumber, unit);
    if (playsLike) parts.push(`Plays like ${playsLike}`);
  } else if (typeof payload.playsLike === 'string') {
    const playsLike = clause(payload.playsLike);
    if (playsLike) parts.push(playsLike.toLowerCase().startsWith('plays like') ? playsLike : `Plays like ${playsLike}`);
  }

  const wind = windClause(payload.wind);
  if (wind) parts.push(wind);

  const advice = clause(payload.advice);
  if (advice) parts.push(advice);

  const sentence = parts.join('. ');
  if (!sentence) return '';
  return sentence.length > 180 ? `${sentence.slice(0, 179).trimEnd()}…` : `${sentence}.`;
}

function speechApis() {
  const root = typeof window !== 'undefined' ? window : undefined;
  const synth = root && 'speechSynthesis' in root ? root.speechSynthesis : undefined;
  const Utterance =
    root && 'SpeechSynthesisUtterance' in root
      ? root.SpeechSynthesisUtterance
      : typeof SpeechSynthesisUtterance !== 'undefined'
        ? SpeechSynthesisUtterance
        : undefined;
  if (!synth || typeof Utterance !== 'function') return null;
  return { synth, Utterance };
}

function pickVoice(synth, locale) {
  if (!synth || typeof synth.getVoices !== 'function') return null;
  let voices = [];
  try {
    voices = synth.getVoices() || [];
  } catch {
    return null;
  }
  const needle = String(locale).toLowerCase();
  return voices.find((voice) => typeof voice?.lang === 'string' && voice.lang.toLowerCase().startsWith(needle)) || null;
}

/**
 * Speak a caddie callout, replacing any utterance already in progress.
 * @param {string | object} payload
 * @param {'yds' | 'm' | 'meters' | string} [unit]
 * @param {string} [ttsLocale]
 * @returns {{ spoken: true, text: string, lang: string } | { spoken: false, reason: string }}
 */
export function speakCaddieCallout(payload, unit = 'yds', ttsLocale = 'en-US') {
  const apis = speechApis();
  if (!apis) return { spoken: false, reason: 'unsupported' };

  const text = buildCaddieSentence(payload, unit);
  const lang = resolveTtsLocale(ttsLocale);

  try {
    if (typeof apis.synth.cancel === 'function') apis.synth.cancel();
    if (!text) return { spoken: false, reason: 'empty' };

    const utterance = new apis.Utterance(text);
    utterance.lang = lang;
    const voice = pickVoice(apis.synth, lang);
    if (voice) utterance.voice = voice;
    apis.synth.speak(utterance);
    return { spoken: true, text, lang };
  } catch {
    return { spoken: false, reason: 'unsupported' };
  }
}

function hudDistanceLabel(yardsValue, unit) {
  const rounded = roundDistance(yardsValue);
  if (!rounded) return '';
  return unit === 'm' ? `${rounded.meters} m` : `${rounded.yards} yds`;
}

function joinHud(parts) {
  return parts.map((part) => publicText(part)).filter(Boolean).join(' · ');
}

/**
 * Shared snapshot for a smartwatch Live Activity and smart-glasses HUDs.
 * Distances on `state.targetYards` and `state.playsLikeYards` are yards.
 * @param {object} [state]
 */
export function buildWearablePayload(state = {}) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const unit = wearableUnit(source.unit);
  const rounded = roundDistance(source.targetYards);
  const yards = rounded ? rounded.yards : null;
  const meters = rounded ? rounded.meters : null;
  const active = unit === 'm' ? meters : yards;
  const label = active == null ? '' : String(active);
  const trailing = hudDistanceLabel(source.targetYards, unit);
  const holeTitle = source.holeNumber != null && publicText(source.holeNumber) !== ''
    ? `HOLE ${publicText(source.holeNumber)}`
    : '';
  const club = clause(source.club);
  const parText = source.par != null && publicText(source.par) !== '' ? `Par ${publicText(source.par)}` : '';
  const playsLabel = hudDistanceLabel(source.playsLikeYards, unit);
  const playsText = playsLabel ? `Plays ${playsLabel}` : '';
  const wind = windClause(source.wind);
  const advice = clause(source.advice);
  const courseName = clause(source.courseName);
  const context = [parText, playsText, wind, advice, courseName].filter(Boolean);

  const spokenText = buildCaddieSentence(
    {
      holeNumber: source.holeNumber,
      club: source.club,
      targetYards: source.targetYards,
      playsLike: source.playsLikeYards,
      wind: source.wind,
      advice: source.advice,
    },
    unit
  );

  return {
    version: 1,
    unit,
    distance: { yards, meters, label },
    liveActivity: {
      title: holeTitle || 'ON COURSE',
      subtitle: club || parText,
      trailing,
    },
    glasses: {
      rokid: {
        glance: [holeTitle || club || 'ON COURSE', trailing].filter(Boolean).join('  '),
        detail: joinHud([club && holeTitle ? club : '', ...context]),
      },
      meta: {
        glance: [club || holeTitle || 'ON COURSE', trailing].filter(Boolean).join('  '),
        detail: joinHud([holeTitle && club ? holeTitle : '', ...context]),
      },
    },
    spokenText,
    ttsLocale: resolveTtsLocale(source.ttsLocale || source.lang),
  };
}
