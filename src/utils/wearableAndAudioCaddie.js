/**
 * On-course caddie speech and wearable HUD copy.
 * speakCaddieCallout speaks one callout in the selected persona;
 * buildWearablePayload shapes the same facts for a watch Live Activity and glasses HUDs.
 */

/** 1 yard = 0.9144 meters. */
const YARDS_TO_METERS = 0.9144;

/** localStorage key for the selected caddie persona. */
export const CADDIE_VOICE_STORAGE_KEY = 'the-turn-caddie-voice';

/** How long to wait for speechSynthesis voices before speaking anyway. */
const VOICE_READY_TIMEOUT_MS = 1000;

/**
 * Five caddie personas. Rate and pitch are speechSynthesis utterance values.
 * Phrasing changes per id; scottish_links also prefers an en-GB voice for English.
 */
export const CADDIE_VOICES = [
  { id: 'tour_looper', label: 'Tour Looper', rate: 0.96, pitch: 0.95 },
  { id: 'scottish_links', label: 'Scottish Linksman', rate: 0.94, pitch: 0.92 },
  { id: 'swing_coach', label: 'Calm Swing Coach', rate: 0.92, pitch: 1.02 },
  { id: 'hype_partner', label: 'Hype Playing Partner', rate: 1.05, pitch: 1.06 },
  { id: 'tour_analytics', label: 'Tour Analytics', rate: 1.02, pitch: 0.98 },
];

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

const PREVIEW_CLUB = {
  en: 'Seven iron',
  es: 'Hierro siete',
  ja: 'セブンアイアン',
  ko: '세븐 아이언',
  zh: '七号铁',
  de: 'Eisen sieben',
  fr: 'Fer sept',
  pt: 'Ferro sete',
  sv: 'Järn sju',
  it: 'Ferro sette',
};

const PHRASES = {
  en: {
    lead: 'Right',
    calm: 'Okay',
    hype: 'Here we go',
    trust: 'trust it',
    hole: (n) => `Hole ${n}`,
    toPin: (d) => `${d} to the pin`,
    plays: (d) => `Plays like ${d}`,
    thisPlays: (d) => `This one plays like ${d}`,
    wind: 'Wind',
  },
  es: {
    lead: 'Bien',
    calm: 'Tranquilo',
    hype: 'Vamos',
    trust: 'confía',
    hole: (n) => `Hoyo ${n}`,
    toPin: (d) => `${d} a la bandera`,
    plays: (d) => `Juega como ${d}`,
    thisPlays: (d) => `Este golpe juega como ${d}`,
    wind: 'Viento',
  },
  ja: {
    lead: 'よし',
    calm: 'リラックス',
    hype: 'いこう',
    trust: 'いける',
    hole: (n) => `${n}番ホール`,
    toPin: (d) => `ピンまで${d}`,
    plays: (d) => `実距離は${d}`,
    thisPlays: (d) => `この一打の実距離は${d}`,
    wind: '風',
  },
  ko: {
    lead: '좋아',
    calm: '편하게',
    hype: '가자',
    trust: '자신 있게',
    hole: (n) => `${n}번 홀`,
    toPin: (d) => `핀까지 ${d}`,
    plays: (d) => `체감 ${d}`,
    thisPlays: (d) => `이 샷의 체감은 ${d}`,
    wind: '바람',
  },
  zh: {
    lead: '好',
    calm: '放轻松',
    hype: '来吧',
    trust: '果断打',
    hole: (n) => `第${n}洞`,
    toPin: (d) => `到旗杆${d}`,
    plays: (d) => `实际约${d}`,
    thisPlays: (d) => `这一杆实际约${d}`,
    wind: '风',
  },
  de: {
    lead: 'Also',
    calm: 'Ruhig',
    hype: 'Los',
    trust: 'voll drauf',
    hole: (n) => `Bahn ${n}`,
    toPin: (d) => `${d} zur Fahne`,
    plays: (d) => `Spielt wie ${d}`,
    thisPlays: (d) => `Dieser Schlag spielt wie ${d}`,
    wind: 'Wind',
  },
  fr: {
    lead: 'Bien',
    calm: 'Tranquille',
    hype: 'Allez',
    trust: 'envoie',
    hole: (n) => `Trou ${n}`,
    toPin: (d) => `${d} jusqu'au drapeau`,
    plays: (d) => `Joue comme ${d}`,
    thisPlays: (d) => `Celui-ci joue comme ${d}`,
    wind: 'Vent',
  },
  pt: {
    lead: 'Certo',
    calm: 'Calma',
    hype: 'Vamos',
    trust: 'manda ver',
    hole: (n) => `Buraco ${n}`,
    toPin: (d) => `${d} até o pin`,
    plays: (d) => `Joga como ${d}`,
    thisPlays: (d) => `Esta tacada joga como ${d}`,
    wind: 'Vento',
  },
  sv: {
    lead: 'Okej',
    calm: 'Lugnt',
    hype: 'Kör',
    trust: 'lita på den',
    hole: (n) => `Hål ${n}`,
    toPin: (d) => `${d} till flaggan`,
    plays: (d) => `Spelar som ${d}`,
    thisPlays: (d) => `Det här slaget spelar som ${d}`,
    wind: 'Vind',
  },
  it: {
    lead: 'Bene',
    calm: 'Calma',
    hype: 'Dai',
    trust: 'mandala',
    hole: (n) => `Buca ${n}`,
    toPin: (d) => `${d} alla bandiera`,
    plays: (d) => `Gioca come ${d}`,
    thisPlays: (d) => `Questo colpo gioca come ${d}`,
    wind: 'Vento',
  },
};

const QUALITY_MARKERS = [
  'natural',
  'neural',
  'enhanced',
  'premium',
  'siri',
  'ava',
  'samantha',
  'daniel',
  'aria',
  'guy',
  'google uk english',
  'microsoft',
];

const ROBOTIC_MARKERS = ['compact', 'espeak', 'android default'];
const FEMALE_MARKERS = ['ava', 'samantha', 'aria', 'female', 'zira'];
const GLUED_UNIT_LANGS = new Set(['ja', 'zh', 'ko']);

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

let speakToken = 0;

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

/**
 * Saved persona id, or tour_looper when nothing valid is stored.
 * @returns {string}
 */
export function readCaddiePersonaId() {
  try {
    if (typeof localStorage === 'undefined') return 'tour_looper';
    const saved = localStorage.getItem(CADDIE_VOICE_STORAGE_KEY);
    if (CADDIE_VOICES.some((voice) => voice.id === saved)) return saved;
  } catch {
    /* private mode or blocked storage */
  }
  return 'tour_looper';
}

/**
 * Persist a persona id. Unknown ids fall back to tour_looper.
 * @param {string} personaId
 * @returns {string}
 */
export function saveCaddiePersonaId(personaId) {
  const match = CADDIE_VOICES.find((voice) => voice.id === personaId);
  const id = match ? match.id : 'tour_looper';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CADDIE_VOICE_STORAGE_KEY, id);
  } catch {
    /* private mode or blocked storage */
  }
  return id;
}

function resolvePersona(personaId) {
  const explicit = CADDIE_VOICES.find((voice) => voice.id === personaId);
  if (explicit) return explicit;
  if (personaId == null || personaId === '') {
    return CADDIE_VOICES.find((voice) => voice.id === readCaddiePersonaId()) || CADDIE_VOICES[0];
  }
  return CADDIE_VOICES[0];
}

function languageCode(langOrLocale) {
  const locale = resolveTtsLocale(langOrLocale).toLowerCase();
  const code = locale.split('-')[0];
  return PHRASES[code] ? code : 'en';
}

function utteranceLocale(persona, ttsLocale) {
  const locale = resolveTtsLocale(ttsLocale);
  if (persona.id === 'scottish_links' && languageCode(locale) === 'en') return 'en-GB';
  return locale;
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

function spellUnderHundred(n) {
  if (n === 0) return 'zero';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

/** Golf yardage speech: 151 → "one fifty one". */
function englishGolfNumber(value) {
  const n = Math.round(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return '';
  if (n < 100) return spellUnderHundred(n);
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const hundredWord = `${ONES[hundreds]} hundred`;
    if (rest === 0) return hundredWord;
    if (rest < 10) return `${ONES[hundreds]} oh ${spellUnderHundred(rest)}`;
    return `${ONES[hundreds]} ${spellUnderHundred(rest)}`;
  }
  return String(n);
}

function unitWord(lang, metric, amount) {
  if (lang === 'en') {
    if (!metric) return '';
    return amount === 1 ? 'meter' : 'meters';
  }
  const words = {
    es: metric ? 'metros' : 'yardas',
    ja: metric ? 'メートル' : 'ヤード',
    ko: metric ? '미터' : '야드',
    zh: metric ? '米' : '码',
    de: metric ? 'Meter' : 'Yards',
    fr: metric ? 'mètres' : 'yards',
    pt: metric ? 'metros' : 'jardas',
    sv: metric ? 'meter' : 'yard',
    it: metric ? 'metri' : 'iarde',
  };
  return words[lang] || (metric ? 'meters' : '');
}

function formatSpokenDistance(yardsValue, unit, lang) {
  const rounded = roundDistance(yardsValue);
  if (!rounded) return '';
  const metric = isMetricUnit(unit);
  const amount = metric ? rounded.meters : rounded.yards;
  const number = lang === 'en' ? englishGolfNumber(amount) : String(amount);
  const unitLabel = unitWord(lang, metric, amount);
  if (!unitLabel) return number;
  if (GLUED_UNIT_LANGS.has(lang)) return `${number}${unitLabel}`;
  return `${number} ${unitLabel}`;
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

function spokenWind(wind, lang) {
  const raw = windClause(wind);
  if (!raw) return '';
  const phrases = PHRASES[lang] || PHRASES.en;
  if (lang === 'en' || !/^wind\b/i.test(raw)) return raw;
  return `${phrases.wind} ${raw.replace(/^wind\s+/i, '')}`.trim();
}

function pinYards(payload) {
  const target = finiteNumber(payload.targetYards);
  if (target != null) return target;
  return finiteNumber(payload.carry);
}

function joinSpoken(parts) {
  const cleaned = [];
  for (const part of parts) {
    const text = clause(part);
    if (text) cleaned.push(text);
  }
  if (!cleaned.length) return '';
  let text = cleaned.join('. ').replace(/\s{2,}/g, ' ').trim();
  if (!/[.!?…。]$/u.test(text)) text += '.';
  if (text.length > 180) return `${text.slice(0, 179).trimEnd()}…`;
  return text;
}

function composePersonaLine(personaId, phrases, facts) {
  const pin = facts.distance ? phrases.toPin(facts.distance) : '';
  const plays = facts.playsDistance ? phrases.plays(facts.playsDistance) : (facts.playsClause || '');
  const thisPlays = facts.playsDistance ? phrases.thisPlays(facts.playsDistance) : (facts.playsClause || '');
  const hole = facts.hole ? phrases.hole(facts.hole) : '';

  if (personaId === 'tour_analytics') {
    return joinSpoken([
      [facts.club, facts.distance].filter(Boolean).join('... '),
      plays,
    ]);
  }

  if (personaId === 'scottish_links') {
    const mid = [facts.club, pin].filter(Boolean).join('... ');
    let head = phrases.lead;
    if (hole && mid) head = `${phrases.lead}, ${hole}... ${mid}`;
    else if (hole) head = `${phrases.lead}, ${hole}`;
    else if (mid) head = `${phrases.lead}, ... ${mid}`;
    return joinSpoken([head, plays, facts.wind, facts.advice]);
  }

  if (personaId === 'swing_coach') {
    const mid = [facts.club, pin].filter(Boolean).join(', ');
    let head = phrases.calm;
    if (hole && mid) head = `${phrases.calm}, ${hole}... ${mid}`;
    else if (mid) head = `${phrases.calm}... ${mid}`;
    else if (hole) head = `${phrases.calm}, ${hole}`;
    return joinSpoken([head, thisPlays, facts.wind, facts.advice]);
  }

  if (personaId === 'hype_partner') {
    const mid = [facts.club, pin].filter(Boolean).join('... ');
    let head = phrases.hype;
    if (hole && mid) head = `${phrases.hype}, ${hole}... ${mid}`;
    else if (mid) head = `${phrases.hype}... ${mid}`;
    else if (hole) head = `${phrases.hype}, ${hole}`;
    const hypePlays = facts.playsDistance && phrases.trust
      ? `${phrases.plays(facts.playsDistance)}, ${phrases.trust}`
      : plays;
    return joinSpoken([head, hypePlays, facts.wind, facts.advice]);
  }

  const mid = [facts.club, pin].filter(Boolean).join('... ');
  const head = hole ? (mid ? `${hole}... ${mid}` : hole) : mid;
  return joinSpoken([head, plays, facts.wind, facts.advice]);
}

/**
 * Natural spoken line for a callout. A string payload is spoken as given.
 * @param {string | object | null | undefined} payload
 * @param {string} [unit]
 * @param {string} [ttsLocale]
 * @param {string} [personaId]
 * @returns {string}
 */
export function buildCaddieCalloutLine(payload, unit = 'yds', ttsLocale = 'en-US', personaId) {
  if (typeof payload === 'string') {
    const text = publicText(payload);
    return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';

  const persona = resolvePersona(personaId);
  const lang = languageCode(ttsLocale);
  const phrases = PHRASES[lang];
  const hole = payload.holeNumber != null && publicText(payload.holeNumber) !== ''
    ? publicText(payload.holeNumber)
    : '';
  const club = clause(payload.club);
  const distance = formatSpokenDistance(pinYards(payload), unit, lang);

  let playsDistance = '';
  let playsClause = '';
  const playsNumber = finiteNumber(payload.playsLike) ?? finiteNumber(payload.playsLikeYards);
  if (playsNumber != null) {
    playsDistance = formatSpokenDistance(playsNumber, unit, lang);
  } else if (typeof payload.playsLike === 'string') {
    playsClause = clause(payload.playsLike);
  }

  return composePersonaLine(persona.id, phrases, {
    hole,
    club,
    distance,
    playsDistance,
    playsClause,
    wind: persona.id === 'tour_analytics' ? '' : spokenWind(payload.wind, lang),
    advice: persona.id === 'tour_analytics' ? '' : clause(payload.advice),
  });
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

function readVoices(synth) {
  if (!synth || typeof synth.getVoices !== 'function') return [];
  try {
    const list = synth.getVoices();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Resolve speechSynthesis.getVoices(), waiting once for voiceschanged when the
 * first read is empty. Times out so a callout still speaks.
 * @param {SpeechSynthesis} synth
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
function whenVoicesReady(synth) {
  const ready = readVoices(synth);
  if (ready.length) return Promise.resolve(ready);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', onVoices);
      }
      resolve(readVoices(synth));
    };
    const onVoices = () => {
      if (readVoices(synth).length) finish();
    };
    const timer = setTimeout(finish, VOICE_READY_TIMEOUT_MS);
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', onVoices);
    } else if (synth) {
      const previous = synth.onvoiceschanged;
      synth.onvoiceschanged = function onVoicesChanged(event) {
        if (typeof previous === 'function' && previous !== onVoicesChanged) previous.call(this, event);
        onVoices();
        if (settled) synth.onvoiceschanged = previous && previous !== onVoicesChanged ? previous : null;
      };
    }
    readVoices(synth);
  });
}

function normLang(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function voiceHaystack(voice) {
  return `${voice?.name || ''} ${voice?.voiceURI || ''}`.toLowerCase();
}

function scoreVoice(voice, locale, persona) {
  const name = voiceHaystack(voice);
  const lang = normLang(voice?.lang);
  const wanted = normLang(locale);
  const prefix = wanted.split('-')[0];
  const exact = Boolean(wanted) && lang === wanted;
  const prefixMatch = Boolean(prefix) && (lang === prefix || lang.startsWith(`${prefix}-`));
  let score = 0;
  if (exact) score += 220;
  else if (prefixMatch) score += 90;

  for (const marker of QUALITY_MARKERS) {
    if (name.includes(marker)) score += 28;
  }

  if (persona?.id === 'scottish_links' && wanted.startsWith('en')) {
    if (lang.startsWith('en-gb')) score += 70;
    if (name.includes('daniel') || name.includes('google uk english')) score += 36;
  }

  if (persona?.id === 'swing_coach') {
    for (const marker of FEMALE_MARKERS) {
      if (name.includes(marker)) score += 90;
    }
  }

  const robotic = ROBOTIC_MARKERS.some((marker) => name.includes(marker));
  if (robotic) score -= 120;
  return { voice, score, prefix: exact || prefixMatch, robotic };
}

/**
 * Prefer a natural voice for the locale. Skip Compact / eSpeak / Android default
 * when any better voice exists. Then any locale-prefix voice, then any voice.
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} locale
 * @param {{ id: string }} persona
 */
export function selectCaddieVoice(voices, locale, persona) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const scored = voices.map((voice) => scoreVoice(voice, locale, persona));
  const byScore = (a, b) => b.score - a.score;
  const matching = scored.filter((row) => row.prefix).sort(byScore);
  const matchingNatural = matching.filter((row) => !row.robotic);
  if (matchingNatural.length) return matchingNatural[0].voice;
  if (matching.length) return matching[0].voice;
  const anyNatural = scored.filter((row) => !row.robotic).sort(byScore);
  if (anyNatural.length) return anyNatural[0].voice;
  return scored.sort(byScore)[0]?.voice || null;
}

/**
 * Speak a caddie callout, replacing any utterance already in progress.
 * Persona defaults to the saved `the-turn-caddie-voice` id.
 * @param {string | object} payload
 * @param {'yds' | 'm' | 'meters' | string} [unit]
 * @param {string} [ttsLocale]
 * @param {string} [personaId]
 * @returns {Promise<{ spoken: true, text: string, lang: string, personaId: string } | { spoken: false, reason: string }>}
 */
export function speakCaddieCallout(payload, unit = 'yds', ttsLocale = 'en-US', personaId) {
  const apis = speechApis();
  if (!apis) return Promise.resolve({ spoken: false, reason: 'unsupported' });

  const persona = resolvePersona(personaId);
  const text = buildCaddieCalloutLine(payload, unit, ttsLocale, persona.id);
  const lang = utteranceLocale(persona, ttsLocale);
  if (!text) return Promise.resolve({ spoken: false, reason: 'empty' });

  const token = ++speakToken;
  try {
    if (typeof apis.synth.cancel === 'function') apis.synth.cancel();
  } catch {
    return Promise.resolve({ spoken: false, reason: 'unsupported' });
  }

  return whenVoicesReady(apis.synth).then((voices) => new Promise((resolve) => {
    if (token !== speakToken) {
      resolve({ spoken: false, reason: 'cancelled' });
      return;
    }
    let utterance;
    try {
      utterance = new apis.Utterance(text);
      utterance.lang = lang;
      utterance.rate = persona.rate;
      utterance.pitch = persona.pitch;
      const voice = selectCaddieVoice(voices, lang, persona);
      if (voice) utterance.voice = voice;
    } catch {
      resolve({ spoken: false, reason: 'unsupported' });
      return;
    }
    // Let cancel() finish before speak(); some engines drop an utterance started in the same turn.
    setTimeout(() => {
      if (token !== speakToken) {
        resolve({ spoken: false, reason: 'cancelled' });
        return;
      }
      try {
        apis.synth.speak(utterance);
        resolve({ spoken: true, text, lang, personaId: persona.id });
      } catch {
        resolve({ spoken: false, reason: 'unsupported' });
      }
    }, 0);
  }));
}

/**
 * Speak the fixed sample line in the selected persona and locale.
 * "Seven iron... one fifty one to the pin. Plays like one fifty six."
 * @param {string} [personaId]
 * @param {string} [ttsLocale]
 */
export function previewCaddieCallout(personaId, ttsLocale = 'en-US') {
  const lang = languageCode(ttsLocale);
  return speakCaddieCallout(
    {
      club: PREVIEW_CLUB[lang] || PREVIEW_CLUB.en,
      targetYards: 151,
      playsLike: 156,
    },
    'yds',
    ttsLocale,
    personaId
  );
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

  const spokenText = buildCaddieCalloutLine(
    {
      holeNumber: source.holeNumber,
      club: source.club,
      targetYards: source.targetYards,
      playsLike: source.playsLikeYards,
      wind: source.wind,
      advice: source.advice,
    },
    unit,
    source.ttsLocale || source.lang,
    source.personaId
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
