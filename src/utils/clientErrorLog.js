import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'the-turn-client-errors';
const CAP = 50;

function supabaseConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function sanitize(value) {
  return String(value ?? '')
    .slice(0, 500)
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(password|token|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function appendLocal(entry) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const existing = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, entry].slice(-CAP)));
  } catch {
    /* private mode or quota — never throw from the logger */
  }
}

async function record(entry) {
  if (!supabaseConfigured()) {
    appendLocal(entry);
    return;
  }
  try {
    const { error } = await supabase.from('client_errors').insert({
      message: entry.message,
      source: entry.source,
      lineno: entry.lineno,
      userAgent: entry.userAgent,
      timestamp: entry.timestamp,
    });
    if (error) appendLocal(entry);
  } catch {
    appendLocal(entry);
  }
}

function capture(message, source, lineno) {
  record({
    message: sanitize(message),
    source: sanitize(source),
    lineno: Number.isFinite(lineno) ? lineno : null,
    userAgent: sanitize(navigator.userAgent),
    timestamp: new Date().toISOString(),
  });
}

export function installClientErrorLog() {
  if (typeof window === 'undefined' || window.__theTurnClientErrorLog) return;
  window.__theTurnClientErrorLog = true;

  window.addEventListener('error', (event) => {
    capture(event?.message, event?.filename, event?.lineno);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : reason;
    capture(message, 'unhandledrejection', null);
  });
}
