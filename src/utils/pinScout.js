import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Local Pin Scout stats. Survives a missing profiles column. */
export const PIN_SCOUT_STORAGE_KEY = 'the-turn-pin-scout';
export const PIN_SCOUT_EVENT = 'the-turn-pin-scout';
export const PIN_SCOUT_XP = 25;

const EMPTY = { pinsMarked: 0, scoutXp: 0, logged: [] };

export function pinScoutTier(pinsMarked) {
  const pins = Math.max(0, Number(pinsMarked) || 0);
  if (pins >= 18) return { id: 'tour-advance-scout', label: 'Tour Advance Scout', foil: 'gold', unlocked: true };
  if (pins >= 9) return { id: 'course-ranger', label: 'Course Ranger', foil: 'silver', unlocked: true };
  if (pins >= 1) return { id: 'pin-scout', label: 'Pin Scout', foil: 'champagne', unlocked: true };
  return { id: 'locked', label: 'Locked', foil: 'none', unlocked: false };
}

export function pinScoutKey({ courseId, holeNumber, playDate }) {
  return `${String(courseId ?? '')}|${Number(holeNumber) || 0}|${String(playDate || '').slice(0, 10)}`;
}

export function readPinScout() {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_SCOUT_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...EMPTY };
    const logged = Array.isArray(raw.logged) ? raw.logged.map((key) => String(key)) : [];
    return {
      pinsMarked: Math.max(0, Number(raw.pinsMarked) || 0),
      scoutXp: Math.max(0, Number(raw.scoutXp) || 0),
      logged,
    };
  } catch {
    return { ...EMPTY };
  }
}

function writePinScout(stats) {
  const next = {
    pinsMarked: Math.max(0, Number(stats.pinsMarked) || 0),
    scoutXp: Math.max(0, Number(stats.scoutXp) || 0),
    logged: Array.isArray(stats.logged) ? stats.logged.slice(-400) : [],
  };
  try {
    localStorage.setItem(PIN_SCOUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode can block storage. The in-memory award still reaches the toast.
  }
  return next;
}

function publish(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PIN_SCOUT_EVENT, { detail }));
}

async function syncProfile(stats) {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return;
    await supabase
      .from('profiles')
      .update({ pins_marked: stats.pinsMarked, scout_xp: stats.scoutXp })
      .eq('id', userId);
  } catch {
    // Missing column, RLS, or offline: localStorage remains the source of truth.
  }
}

/** Remember a hole/course/day that was updated, without granting XP. */
export function rememberDailyPin(input) {
  const key = pinScoutKey(input);
  const current = readPinScout();
  if (!key || current.logged.includes(key)) return { awarded: false, ...current, tier: pinScoutTier(current.pinsMarked) };
  const next = writePinScout({ ...current, logged: [...current.logged, key] });
  return { awarded: false, ...next, tier: pinScoutTier(next.pinsMarked) };
}

/** +25 XP the first time this course, hole, and play date is logged. */
export function awardDailyPin(input) {
  const key = pinScoutKey(input);
  const current = readPinScout();
  if (!key || current.logged.includes(key)) {
    return { awarded: false, ...current, tier: pinScoutTier(current.pinsMarked) };
  }
  const next = writePinScout({
    pinsMarked: current.pinsMarked + 1,
    scoutXp: current.scoutXp + PIN_SCOUT_XP,
    logged: [...current.logged, key],
  });
  const tier = pinScoutTier(next.pinsMarked);
  const detail = {
    awarded: true,
    pinsMarked: next.pinsMarked,
    scoutXp: next.scoutXp,
    tier,
    justUnlocked: next.pinsMarked === 1 || next.pinsMarked === 9 || next.pinsMarked === 18,
  };
  publish(detail);
  void syncProfile(next);
  return detail;
}

export function usePinScout() {
  const [stats, setStats] = useState(() => readPinScout());
  useEffect(() => {
    const sync = () => setStats(readPinScout());
    window.addEventListener(PIN_SCOUT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PIN_SCOUT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return stats;
}
