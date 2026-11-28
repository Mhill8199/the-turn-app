import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, MapPin, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { haversineMeters } from '../utils/globalCourseCatalog';
import { formatTeeTime, formatTripDate } from '../utils/tripQueue';

const STORAGE_KEY = 'the-turn-round-lobbies';
const MILES = 1609.344;
const PACE_OPTIONS = ['Ready golf', 'Casual', 'Competitive'];

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      lobbies: Array.isArray(parsed?.lobbies) ? parsed.lobbies : [],
      members: Array.isArray(parsed?.members) ? parsed.members : [],
    };
  } catch {
    return { lobbies: [], members: [] };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lobbies: store.lobbies || [],
      members: store.members || [],
    }));
  } catch {
    // A full disk still leaves the in-memory lobby and its seat code on screen.
  }
}

function makeSeatCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  let body = '';
  for (let index = 0; index < bytes.length; index += 1) {
    body += alphabet[bytes[index] % alphabet.length];
  }
  return `TURN-${body}`;
}

function displayNameOf(user) {
  const meta = user?.user_metadata || {};
  const named = meta.display_name || meta.full_name || meta.name;
  if (named) return String(named);
  if (user?.email) return String(user.email).split('@')[0];
  return 'You';
}

function normalizeSeatCode(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z0-9]{6}$/.test(compact)) return `TURN-${compact}`;
  return compact;
}

function sameId(left, right) {
  return String(left || '') === String(right || '');
}

function lobbyMemberKey(member) {
  return `${member.lobby_id || member.round_lobby_id || ''}:${member.user_id || member.member_id || member.display_name || member.id || ''}`;
}

function mergeStores(localStore, remoteStore) {
  const local = localStore || { lobbies: [], members: [] };
  if (!remoteStore) return local;
  const lobbies = new Map();
  for (const lobby of remoteStore.lobbies || []) {
    if (lobby?.id) lobbies.set(String(lobby.id), lobby);
  }
  for (const lobby of local.lobbies || []) {
    if (!lobby?.id) continue;
    const key = String(lobby.id);
    const remote = lobbies.get(key);
    lobbies.set(key, remote ? { ...remote, seat_code: remote.seat_code || lobby.seat_code, source: remote.source || 'remote' } : lobby);
  }
  const members = new Map();
  for (const member of [...(remoteStore.members || []), ...(local.members || [])]) {
    if (!member) continue;
    members.set(lobbyMemberKey(member), member);
  }
  return { lobbies: [...lobbies.values()], members: [...members.values()] };
}

function rosterFor(lobbyId, members) {
  return (members || []).filter((member) => sameId(member.lobby_id || member.round_lobby_id, lobbyId));
}

function normalizeLobby(row, members) {
  if (!row) return null;
  const roster = rosterFor(row.id, members);
  const spotsTotal = Math.max(1, Number(row.spots_total ?? row.max_players ?? row.seats ?? 4) || 4);
  const counted = roster.length || Number(row.spots_filled ?? row.filled_seats ?? row.member_count ?? 0) || 0;
  return {
    id: row.id,
    course_name: row.course_name || row.course || '',
    tee_time: row.tee_time || row.tee_time_label || row.starts_at || '',
    spots_total: spotsTotal,
    spots_filled: Math.min(spotsTotal, counted),
    pace_preference: row.pace_preference || row.pace || '',
    notes: row.notes || '',
    seat_code: row.seat_code || '',
    host_id: row.host_id || row.owner_id || null,
    lat: row.lat ?? row.latitude ?? null,
    lon: row.lon ?? row.lng ?? row.longitude ?? null,
    members: roster,
    source: row.source || 'remote',
  };
}

function isUpcoming(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const parsed = Date.parse(raw.length === 16 ? `${raw}:00` : raw);
  if (Number.isNaN(parsed)) return true;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return parsed >= start.getTime();
}

function formatWhen(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dateLabel = formatTripDate(raw.slice(0, 10));
  const timeSource = raw.includes('T') ? raw.slice(11, 16) : raw;
  const timeLabel = formatTeeTime(timeSource);
  return [dateLabel, timeLabel].filter(Boolean).join(' · ') || raw;
}

function firstField(row, keys) {
  for (const key of keys) {
    if (row && row[key] != null && row[key] !== '') return row[key];
  }
  return undefined;
}

function activityName(row) {
  const named = firstField(row, ['display_name', 'golfer_name', 'user_name', 'player_name', 'name']);
  return named ? String(named) : '';
}

function activityCourse(row) {
  const course = firstField(row, ['course_name', 'course', 'venue']);
  return course ? String(course) : '';
}

async function readRemoteLobbies() {
  const { data, error } = await supabase.from('round_lobbies').select('*').limit(100);
  if (error) return null;
  const membersResult = await supabase.from('round_lobby_members').select('*').limit(400);
  return {
    lobbies: data || [],
    members: membersResult.error ? [] : (membersResult.data || []),
  };
}

export default function SocialMatching({ onLaunchRound }) {
  const { user } = useAuth();
  const [panel, setPanel] = useState('tees');
  const [store, setStore] = useState(() => readStore());
  const [remoteReady, setRemoteReady] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feedReady, setFeedReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [postedCode, setPostedCode] = useState('');
  const [seatInput, setSeatInput] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [distanceFilter, setDistanceFilter] = useState('any');
  const [openOnly, setOpenOnly] = useState(true);
  const [origin, setOrigin] = useState(null);
  const [draft, setDraft] = useState({
    course_name: '',
    tee_time: '',
    spots_total: 4,
    pace_preference: 'Ready golf',
    notes: '',
  });

  const persist = useCallback((next) => {
    setStore(next);
    writeStore(next);
  }, []);

  const refreshLobbies = useCallback(async () => {
    const local = readStore();
    try {
      const remote = await readRemoteLobbies();
      const merged = mergeStores(local, remote);
      persist(merged);
      setRemoteReady(remote != null);
    } catch {
      persist(local);
      setRemoteReady(false);
    }
  }, [persist]);

  const refreshFeed = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('social_activity')
        .select('*')
        .limit(40);
      if (error) {
        setFeed([]);
      } else {
        const rows = Array.isArray(data) ? data : [];
        rows.sort((a, b) => {
          const left = Date.parse(firstField(a, ['created_at', 'completed_at', 'played_at']) || 0) || 0;
          const right = Date.parse(firstField(b, ['created_at', 'completed_at', 'played_at']) || 0) || 0;
          return right - left;
        });
        setFeed(rows);
      }
    } catch {
      setFeed([]);
    } finally {
      setFeedReady(true);
    }
  }, []);

  useEffect(() => {
    refreshLobbies();
    refreshFeed();
  }, [refreshLobbies, refreshFeed]);

  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    navigator.geolocation.getCurrentPosition(
      (position) => setOrigin({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
    );
    return undefined;
  }, []);

  const lobbies = useMemo(
    () => (store.lobbies || [])
      .map((row) => normalizeLobby(row, store.members))
      .filter(Boolean),
    [store]
  );

  const visibleLobbies = useMemo(() => {
    const courseQuery = courseFilter.trim().toLowerCase();
    const maxMiles = distanceFilter === 'any' ? null : Number(distanceFilter);
    return lobbies.filter((lobby) => {
      if (!isUpcoming(lobby.tee_time)) return false;
      const openSeats = lobby.spots_total - lobby.spots_filled;
      if (openOnly && openSeats <= 0) return false;
      if (courseQuery && !String(lobby.course_name || '').toLowerCase().includes(courseQuery)) return false;
      if (dateFilter) {
        const day = String(lobby.tee_time || '').slice(0, 10);
        if (day && day !== dateFilter) return false;
      }
      if (maxMiles != null && origin) {
        const lat = Number(lobby.lat);
        const lon = Number(lobby.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        const miles = haversineMeters(origin.lat, origin.lon, lat, lon) / MILES;
        if (miles > maxMiles) return false;
      }
      return true;
    });
  }, [lobbies, courseFilter, dateFilter, distanceFilter, openOnly, origin]);

  const joinedByMe = (lobby) => (lobby.members || []).some((member) => (
    sameId(member.user_id || member.member_id, user?.id) || sameId(lobby.host_id, user?.id)
  ));

  const rememberMember = (lobbyId, member) => {
    const local = readStore();
    const members = local.members.filter((item) => lobbyMemberKey(item) !== lobbyMemberKey(member));
    members.push(member);
    const lobbiesNext = local.lobbies.map((lobby) => (
      sameId(lobby.id, lobbyId)
        ? { ...lobby, spots_filled: rosterFor(lobbyId, members).length }
        : lobby
    ));
    persist({ lobbies: lobbiesNext, members });
  };

  const joinLobby = async (lobby) => {
    if (!lobby?.id) return;
    if (joinedByMe(lobby)) {
      setNotice('You already have a seat in this foursome.');
      return;
    }
    if (lobby.spots_filled >= lobby.spots_total) {
      setNotice('That foursome is full.');
      return;
    }
    const member = {
      id: globalThis.crypto?.randomUUID?.() || `member-${Date.now()}`,
      lobby_id: lobby.id,
      user_id: user?.id || null,
      display_name: displayNameOf(user),
      joined_at: new Date().toISOString(),
    };
    let remoteOk = false;
    try {
      const { error } = await supabase.from('round_lobby_members').insert({
        lobby_id: lobby.id,
        user_id: user?.id || null,
        display_name: member.display_name,
      });
      remoteOk = !error;
    } catch {
      remoteOk = false;
    }
    rememberMember(lobby.id, member);
    setNotice(remoteOk ? 'Seat claimed.' : 'Seat kept on this device.');
    setPostedCode(lobby.seat_code || '');
  };

  const redeemSeat = async (event) => {
    event.preventDefault();
    const code = normalizeSeatCode(seatInput);
    if (!/^TURN-[A-Z0-9]{6}$/.test(code)) {
      setNotice('Enter a foursome seat code like TURN- followed by 6 characters.');
      return;
    }
    let match = lobbies.find((lobby) => String(lobby.seat_code || '').toUpperCase() === code);
    if (!match) {
      try {
        const { data, error } = await supabase
          .from('round_lobbies')
          .select('*')
          .eq('seat_code', code)
          .limit(1);
        if (!error && data?.[0]) {
          const local = readStore();
          const merged = mergeStores(local, { lobbies: [data[0]], members: [] });
          persist(merged);
          match = normalizeLobby(data[0], merged.members);
        }
      } catch {
        match = null;
      }
    }
    if (!match) {
      setNotice('No open foursome for that seat code.');
      return;
    }
    await joinLobby(match);
    setSeatInput('');
  };

  const postRound = async (event) => {
    event.preventDefault();
    const courseName = draft.course_name.trim();
    const teeTime = draft.tee_time;
    if (!courseName || !teeTime) {
      setNotice('Add a course and a tee time.');
      return;
    }
    setSaving(true);
    const seatCode = makeSeatCode();
    const localId = globalThis.crypto?.randomUUID?.() || `lobby-${Date.now()}`;
    const spotsTotal = Math.max(1, Math.min(8, Number(draft.spots_total) || 4));
    const hostMember = {
      id: globalThis.crypto?.randomUUID?.() || `member-${Date.now()}`,
      lobby_id: localId,
      user_id: user?.id || null,
      display_name: displayNameOf(user),
      joined_at: new Date().toISOString(),
    };
    const localLobby = {
      id: localId,
      course_name: courseName,
      tee_time: teeTime,
      spots_total: spotsTotal,
      spots_filled: 1,
      pace_preference: draft.pace_preference,
      notes: draft.notes.trim(),
      seat_code: seatCode,
      host_id: user?.id || null,
      lat: origin?.lat ?? null,
      lon: origin?.lon ?? null,
      created_at: new Date().toISOString(),
      source: 'local',
    };

    let saved = localLobby;
    let remoteOk = false;
    try {
      const payload = {
        course_name: courseName,
        tee_time: teeTime,
        spots_total: spotsTotal,
        pace_preference: draft.pace_preference,
        notes: draft.notes.trim(),
        seat_code: seatCode,
        host_id: user?.id || null,
        lat: origin?.lat ?? null,
        lon: origin?.lon ?? null,
        status: 'open',
      };
      let inserted = await supabase.from('round_lobbies').insert(payload).select('*').maybeSingle();
      if (inserted.error) {
        const slim = {
          course_name: courseName,
          tee_time: teeTime,
          spots_total: spotsTotal,
          notes: draft.notes.trim(),
          seat_code: seatCode,
          host_id: user?.id || null,
        };
        inserted = await supabase.from('round_lobbies').insert(slim).select('*').maybeSingle();
      }
      if (!inserted.error && inserted.data?.id) {
        remoteOk = true;
        saved = {
          ...localLobby,
          ...inserted.data,
          id: inserted.data.id,
          seat_code: inserted.data.seat_code || seatCode,
          source: 'remote',
        };
        hostMember.lobby_id = saved.id;
        await supabase.from('round_lobby_members').insert({
          lobby_id: saved.id,
          user_id: user?.id || null,
          display_name: hostMember.display_name,
        });
      }
    } catch {
      remoteOk = false;
      saved = localLobby;
    }

    const local = readStore();
    persist({
      lobbies: [saved, ...local.lobbies.filter((lobby) => !sameId(lobby.id, saved.id) && !sameId(lobby.id, localId))],
      members: [...local.members.filter((member) => !sameId(member.lobby_id, saved.id)), { ...hostMember, lobby_id: saved.id }],
    });
    setPostedCode(saved.seat_code || seatCode);
    setNotice(remoteOk ? 'Open round posted.' : 'Saved on this device. Share the seat code.');
    setDraft((current) => ({ ...current, notes: '' }));
    setSaving(false);
    setDrawerOpen(false);
  };

  const launchLobby = (lobby) => {
    const partners = (lobby.members || [])
      .map((member) => member.display_name || member.name)
      .filter(Boolean);
    onLaunchRound?.({
      token: `${lobby.id}-${Date.now()}`,
      lobbyId: lobby.id,
      courseName: lobby.course_name,
      courseId: lobby.course_id || '',
      teeTime: lobby.tee_time,
      partners,
      lat: lobby.lat,
      lon: lobby.lon,
    });
  };

  const inviteFromActivity = (row) => {
    const name = activityName(row);
    const course = activityCourse(row);
    setPanel('tees');
    setDraft((current) => ({
      ...current,
      course_name: course || current.course_name,
      notes: name ? `Invite ${name}` : current.notes,
    }));
    setDrawerOpen(true);
  };

  const inputClass = 'w-full min-h-[44px] rounded-2xl border px-3 text-sm bg-[#0B0D0C] text-white placeholder:text-white/40';

  return (
    <div className="space-y-4 pb-4">
      <div className="rounded-3xl border p-4 space-y-2" style={{ backgroundColor: '#0B0D0C', borderColor: 'rgba(212, 175, 55, 0.45)', color: '#F8F7F4' }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>Social & Match</div>
        <h1 className="text-lg font-semibold">Find playing partners</h1>
        <p className="text-sm text-white/70">Post an open tee time or claim a foursome seat with a TURN- seat code.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setPanel('tees')}
          className="min-h-[44px] rounded-2xl text-sm font-semibold"
          style={{
            backgroundColor: panel === 'tees' ? '#10B981' : '#0B0D0C',
            color: panel === 'tees' ? '#0B0D0C' : '#F8F7F4',
            border: '1px solid #10B981',
          }}
        >
          Open Tee Times
        </button>
        <button
          type="button"
          onClick={() => setPanel('feed')}
          className="min-h-[44px] rounded-2xl text-sm font-semibold"
          style={{
            backgroundColor: panel === 'feed' ? '#10B981' : '#0B0D0C',
            color: panel === 'feed' ? '#0B0D0C' : '#F8F7F4',
            border: '1px solid #10B981',
          }}
        >
          Clubhouse Feed
        </button>
      </div>

      {notice ? (
        <div className="rounded-3xl border px-4 py-3 text-sm" style={{ backgroundColor: '#0B0D0C', borderColor: '#10B981', color: '#F8F7F4' }}>
          {notice}
          {postedCode ? (
            <div className="mt-1 font-semibold tabular-nums" style={{ color: '#D4AF37' }}>{postedCode}</div>
          ) : null}
        </div>
      ) : null}

      {panel === 'tees' ? (
        <div className="space-y-3">
          <form onSubmit={redeemSeat} className="rounded-3xl border p-4 space-y-3" style={{ backgroundColor: '#0B0D0C', borderColor: 'rgba(255,255,255,0.16)', color: '#F8F7F4' }}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }} htmlFor="seat-code">
              Foursome seat code
            </label>
            <input
              id="seat-code"
              value={seatInput}
              onChange={(event) => setSeatInput(event.target.value)}
              placeholder="TURN-XXXXXX"
              autoCapitalize="characters"
              className={`${inputClass} tabular-nums`}
            />
            <button type="submit" className="w-full min-h-[44px] rounded-2xl text-sm font-semibold" style={{ backgroundColor: '#10B981', color: '#0B0D0C' }}>
              Join Foursome
            </button>
          </form>

          <div className="rounded-3xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs">
                <span className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>Course</span>
                <input value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} placeholder="Filter by course" className="w-full min-h-[44px] rounded-2xl border px-3 text-sm" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }} />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block" style={{ color: 'var(--text-secondary)' }}>Date</span>
                <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="w-full min-h-[44px] rounded-2xl border px-3 text-sm tabular-nums" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }} />
              </label>
            </div>
            <label className="block text-xs">
              <span className="mb-1 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}><MapPin size={12} /> Distance</span>
              <select value={distanceFilter} onChange={(event) => setDistanceFilter(event.target.value)} className="w-full min-h-[44px] rounded-2xl border px-3 text-sm" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <option value="any">Any distance</option>
                <option value="10">Within 10 mi</option>
                <option value="25">Within 25 mi</option>
                <option value="50">Within 50 mi</option>
              </select>
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
              Open seats only
            </label>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="w-full min-h-[44px] rounded-2xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#10B981' }}
            >
              Post Open Round
            </button>
          </div>

          {visibleLobbies.length === 0 ? (
            <div className="rounded-3xl border p-4 text-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {remoteReady || lobbies.length > 0
                ? 'No open tee times match these filters.'
                : 'No open tee times yet. Post a round and share the seat code.'}
            </div>
          ) : visibleLobbies.map((lobby) => {
            const openSeats = Math.max(0, lobby.spots_total - lobby.spots_filled);
            const mine = joinedByMe(lobby);
            const when = formatWhen(lobby.tee_time);
            return (
              <article key={lobby.id} className="rounded-3xl border p-4 space-y-3" style={{ backgroundColor: '#0B0D0C', borderColor: 'rgba(255,255,255,0.16)', color: '#F8F7F4' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold truncate">{lobby.course_name || 'Course name pending'}</h2>
                    {when ? (
                      <p className="mt-1 flex items-center gap-1 text-sm tabular-nums text-white/70">
                        <Calendar size={14} /> {when}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-bold tabular-nums" style={{ color: '#10B981' }}>{lobby.spots_filled}/{lobby.spots_total}</div>
                    <div className="text-[11px] tabular-nums text-white/60">{openSeats} open</div>
                  </div>
                </div>
                {lobby.pace_preference ? <p className="text-xs text-white/70">{lobby.pace_preference}</p> : null}
                {lobby.notes ? <p className="text-sm text-white/80">{lobby.notes}</p> : null}
                {lobby.seat_code ? (
                  <p className="text-sm font-semibold tabular-nums" style={{ color: '#D4AF37' }}>{lobby.seat_code}</p>
                ) : null}
                {(lobby.members || []).length > 0 ? (
                  <p className="flex items-start gap-1 text-xs text-white/70">
                    <Users size={14} className="mt-0.5 shrink-0" />
                    {(lobby.members || []).map((member) => member.display_name || 'Golfer').join(', ')}
                  </p>
                ) : null}
                {mine ? (
                  <button
                    type="button"
                    onClick={() => launchLobby(lobby)}
                    className="w-full min-h-[44px] rounded-2xl text-sm font-semibold"
                    style={{ backgroundColor: '#10B981', color: '#0B0D0C' }}
                  >
                    Launch into Round
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => joinLobby(lobby)}
                    disabled={openSeats <= 0}
                    className="w-full min-h-[44px] rounded-2xl text-sm font-semibold disabled:opacity-40"
                    style={{ backgroundColor: '#10B981', color: '#0B0D0C' }}
                  >
                    Join Foursome
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {!feedReady ? (
            <div className="rounded-3xl border p-4 text-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Loading clubhouse…
            </div>
          ) : feed.length === 0 ? (
            <div className="rounded-3xl border p-4 text-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Clubhouse is quiet. Completed rounds will show up here.
            </div>
          ) : feed.map((row, index) => {
            const name = activityName(row);
            const course = activityCourse(row);
            const when = formatWhen(firstField(row, ['completed_at', 'played_at', 'tee_time', 'created_at']) || '');
            const strokes = firstField(row, ['strokes', 'total_strokes', 'score']);
            const gained = firstField(row, ['strokes_gained', 'sg_total', 'strokes_gained_total']);
            const pinScout = firstField(row, ['pin_scout_xp', 'pin_scout_verified', 'pin_scout', 'xp_pin_scout']);
            const summary = firstField(row, ['summary', 'note', 'body', 'headline']);
            const pinAmount = Number(pinScout);
            const pinLabel = pinScout == null || pinScout === false || pinScout === 0 || pinScout === ''
              ? ''
              : (pinScout === true
                ? '+25 XP Pin Scout'
                : (Number.isFinite(pinAmount) && pinAmount > 0 ? `+${pinAmount} XP Pin Scout` : '+25 XP Pin Scout'));
            const kind = firstField(row, ['activity_type', 'kind', 'type']);
            const roundLabel = course || strokes != null || gained != null ? 'Completed round' : (kind ? String(kind) : '');
            return (
              <article key={row.id || `activity-${index}`} className="rounded-3xl border p-4 space-y-2" style={{ backgroundColor: '#0B0D0C', borderColor: 'rgba(255,255,255,0.16)', color: '#F8F7F4' }}>
                {roundLabel ? <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>{roundLabel}</div> : null}
                {name ? <h2 className="text-base font-semibold">{name}</h2> : null}
                {course ? <p className="text-sm">{course}</p> : null}
                {when ? <p className="text-sm tabular-nums text-white/70">{when}</p> : null}
                {strokes != null ? <p className="text-sm tabular-nums">Score <span className="font-semibold">{strokes}</span></p> : null}
                {gained != null ? <p className="text-sm tabular-nums" style={{ color: '#10B981' }}>Strokes gained {gained}</p> : null}
                {pinLabel ? <p className="text-sm font-semibold tabular-nums" style={{ color: '#D4AF37' }}>{pinLabel}</p> : null}
                {summary ? <p className="text-sm text-white/80">{summary}</p> : null}
                <button
                  type="button"
                  onClick={() => inviteFromActivity(row)}
                  className="w-full min-h-[44px] rounded-2xl text-sm font-semibold"
                  style={{ backgroundColor: '#10B981', color: '#0B0D0C' }}
                >
                  Invite to Foursome
                </button>
              </article>
            );
          })}
        </div>
      )}

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(11, 13, 12, 0.72)' }} onClick={() => setDrawerOpen(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Post Open Round"
            onSubmit={postRound}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl border p-4 space-y-3 max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: '#0B0D0C', borderColor: 'rgba(212, 175, 55, 0.45)', color: '#F8F7F4' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#D4AF37' }}>Open seats</div>
                <h2 className="text-lg font-semibold">Post Open Round</h2>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" aria-label="Close post round">
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs">
              <span className="mb-1 block text-white/70">Course</span>
              <input required value={draft.course_name} onChange={(event) => setDraft((current) => ({ ...current, course_name: event.target.value }))} className={inputClass} placeholder="Course name" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-white/70">Tee time</span>
              <input required type="datetime-local" value={draft.tee_time} onChange={(event) => setDraft((current) => ({ ...current, tee_time: event.target.value }))} className={`${inputClass} tabular-nums`} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-white/70">Spots</span>
              <input required type="number" min="1" max="8" value={draft.spots_total} onChange={(event) => setDraft((current) => ({ ...current, spots_total: event.target.value }))} className={`${inputClass} tabular-nums`} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-white/70">Pace</span>
              <select value={draft.pace_preference} onChange={(event) => setDraft((current) => ({ ...current, pace_preference: event.target.value }))} className={inputClass}>
                {PACE_OPTIONS.map((pace) => <option key={pace} value={pace}>{pace}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-white/70">Notes</span>
              <textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className="w-full rounded-2xl border px-3 py-2 text-sm bg-[#0B0D0C] text-white placeholder:text-white/40" placeholder="Walking, carts, or who you are looking for" />
            </label>
            <button type="submit" disabled={saving} className="w-full min-h-[44px] rounded-2xl text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: '#10B981', color: '#0B0D0C' }}>
              {saving ? 'Saving…' : 'Save open round'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
