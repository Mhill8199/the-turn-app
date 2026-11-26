import { useEffect, useState } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, Compass, Layers, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { YARDS_TO_METERS, useUnits } from '../utils/distanceUnits';
import { activeBagClubs, clubSpecSubtitle, mergeCloudClub, normalizeClub } from '../utils/bagClubs';

export const DEFAULT_CUSTOM_BAG = [
  { id: '1', club_type: 'Driver', loft: 10.5, bounce_grind: 'Std', carry_yards: 265, total_yards: 284, shot_shape: 'Straight', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14, manufacturer: '', model: '', archived: false },
  { id: '2', club_type: '3-Wood', loft: 15, bounce_grind: 'Std', carry_yards: 240, total_yards: 254, shot_shape: 'Fade', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14, manufacturer: '', model: '', archived: false },
  { id: '3', club_type: '4-Hybrid', loft: 22, bounce_grind: 'Std', carry_yards: 215, total_yards: 225, shot_shape: 'Straight', grip_model: 'Golf Pride MCC Plus4', rounds_on_grip: 14, manufacturer: '', model: '', archived: false },
  { id: '4', club_type: '5-Iron', loft: 25, bounce_grind: 'Std', carry_yards: 196, total_yards: 204, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '5', club_type: '6-Iron', loft: 28, bounce_grind: 'Std', carry_yards: 184, total_yards: 191, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '6', club_type: '7-Iron', loft: 32, bounce_grind: 'Std', carry_yards: 172, total_yards: 178, shot_shape: 'Draw', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '7', club_type: '8-Iron', loft: 36, bounce_grind: 'Std', carry_yards: 160, total_yards: 165, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '8', club_type: '9-Iron', loft: 41, bounce_grind: 'Std', carry_yards: 148, total_yards: 152, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '9', club_type: 'PW', loft: 46, bounce_grind: '10F', carry_yards: 135, total_yards: 138, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 22, manufacturer: '', model: '', archived: false },
  { id: '10', club_type: '54° Wedge', loft: 54, bounce_grind: '10S', carry_yards: 112, total_yards: 114, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31, manufacturer: '', model: '', archived: false },
  { id: '11', club_type: '58° Wedge', loft: 58, bounce_grind: '12D', carry_yards: 98, total_yards: 100, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31, manufacturer: '', model: '', archived: false },
  { id: '12', club_type: '60° Wedge', loft: 60, bounce_grind: '04T', carry_yards: 84, total_yards: 85, shot_shape: 'Straight', grip_model: 'Golf Pride Tour Velvet', rounds_on_grip: 31, manufacturer: '', model: '', archived: false },
];

const CLUB_SLOTS = [
  { slot: 'Driver', loft: 10.5, carry: 250 },
  { slot: '3W', loft: 15, carry: 230 },
  { slot: '5W', loft: 18, carry: 215 },
  { slot: '7W', loft: 21, carry: 200 },
  { slot: '2H', loft: 17, carry: 215 },
  { slot: '3H', loft: 19, carry: 205 },
  { slot: '4H', loft: 22, carry: 195 },
  { slot: '5H', loft: 25, carry: 185 },
  { slot: '2i', loft: 18, carry: 205 },
  { slot: '3i', loft: 21, carry: 195 },
  { slot: '4i', loft: 24, carry: 185 },
  { slot: '5i', loft: 27, carry: 175 },
  { slot: '6i', loft: 31, carry: 165 },
  { slot: '7i', loft: 34, carry: 155 },
  { slot: '8i', loft: 38, carry: 145 },
  { slot: '9i', loft: 42, carry: 135 },
  { slot: 'PW', loft: 46, carry: 125 },
  { slot: 'GW/50°', loft: 50, carry: 110 },
  { slot: 'SW/54°', loft: 54, carry: 95 },
  { slot: 'SW/56°', loft: 56, carry: 85 },
  { slot: 'LW/58°', loft: 58, carry: 75 },
  { slot: 'LW/60°', loft: 60, carry: 65 },
  { slot: 'Putter', loft: 3, carry: 0 },
  { slot: 'Custom', loft: 30, carry: 140 },
];

const MANUFACTURERS = ['Titleist', 'TaylorMade', 'Callaway', 'Ping', 'Cobra', 'Mizuno', 'Srixon', 'Cleveland', 'Wilson', 'PXG'];
const OPTIONAL_COLUMNS = ['manufacturer', 'model', 'archived'];

function parseBounceDeg(bounceGrind = '') {
  const match = String(bounceGrind).match(/(\d{1,2})/);
  return match ? Number(match[1]) : null;
}

function yardsToInput(yards, unit) {
  const value = Number(yards);
  if (!Number.isFinite(value)) return '';
  if (unit === 'm') return String(Math.round(value * YARDS_TO_METERS));
  return String(Math.round(value));
}

function inputToYards(value, unit) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (unit === 'm') return Math.round(parsed / YARDS_TO_METERS);
  return Math.round(parsed);
}

function rolloutYards(clubType, previous) {
  if (previous) {
    const carry = Number(previous.carry_yards);
    const total = Number(previous.total_yards);
    if (Number.isFinite(carry) && Number.isFinite(total)) return total - carry;
  }
  const name = String(clubType || '');
  if (/putter/i.test(name)) return 0;
  if (/driver/i.test(name)) return 19;
  if (/wood|\dW$/i.test(name)) return 12;
  if (/hybrid|\dH$/i.test(name)) return 8;
  if (/wedge|pw|gw|sw|lw/i.test(name)) return 3;
  return 6;
}

function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return code === 'PGRST204' || code === '42703' || message.includes('column') || message.includes('schema cache');
}

function withoutOptionalColumns(payload) {
  const next = { ...payload };
  for (const key of OPTIONAL_COLUMNS) delete next[key];
  return next;
}

async function writeClubRow(mode, payload, { userId, id }) {
  const run = (body) => {
    if (mode === 'insert') return supabase.from('golf_clubs').insert(body);
    return supabase.from('golf_clubs').update(body).eq('id', id).eq('user_id', userId);
  };
  try {
    const { error } = await run(payload);
    if (!error) return;
    if (!isMissingColumnError(error)) return;
    const fallback = withoutOptionalColumns(payload);
    if (Object.keys(fallback).length === 0) return;
    await run(fallback);
  } catch {
    // A missing column or a dropped request must leave the local bag and the rest of the page usable.
  }
}

const fieldClass = 'w-full min-h-[44px] rounded-xl px-3 text-sm border';
const fieldStyle = { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' };

export default function StockBag({ clubs, setClubs }) {
  const { user } = useAuth();
  const { distanceUnit, formatDistance, tabularNumsClass } = useUnits();
  const unitLabel = distanceUnit === 'm' ? 'm' : 'yds';
  const [turfCondition, setTurfCondition] = useState('balanced');
  const [garageOpen, setGarageOpen] = useState(false);
  const [carryDraft, setCarryDraft] = useState('');
  const [sheet, setSheet] = useState(null);

  useEffect(() => {
    localStorage.setItem('the-turn-bag', JSON.stringify(clubs));
  }, [clubs]);

  useEffect(() => {
    setClubs((prev) => (Array.isArray(prev) ? prev.map((club) => normalizeClub(club)) : prev));
  }, [setClubs]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    supabase
      .from('golf_clubs')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data) || data.length === 0) return;
        setClubs((local) => {
          const localById = new Map((Array.isArray(local) ? local : []).map((club) => [String(club.id), club]));
          return data.map((row) => mergeCloudClub(localById.get(String(row.id)), row));
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, setClubs]);

  const sheetSyncKey = sheet?.open ? `${sheet.editingId || 'new'}:${distanceUnit}` : '';
  useEffect(() => {
    if (!sheet?.open) return;
    setCarryDraft(yardsToInput(sheet.carryYards, distanceUnit));
    // Re-sync the visible carry only when the sheet opens or the YDS/M unit changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetSyncKey]);

  const updateClub = (id, patch) => {
    setClubs((prev) => (Array.isArray(prev) ? prev : []).map((club) => (
      club.id === id ? normalizeClub({ ...club, ...patch }) : club
    )));
    if (user?.id) void writeClubRow('update', patch, { userId: user.id, id });
  };

  const removeClub = (id) => {
    setClubs((prev) => (Array.isArray(prev) ? prev : []).filter((club) => club.id !== id));
    if (!user?.id) return;
    void supabase.from('golf_clubs').delete().eq('id', id).eq('user_id', user.id).then(() => {}, () => {});
  };

  const openAdd = () => {
    const preset = CLUB_SLOTS.find((slot) => slot.slot === '7i') || CLUB_SLOTS[0];
    setCarryDraft(yardsToInput(preset.carry, distanceUnit));
    setSheet({
      open: true,
      editingId: null,
      slot: preset.slot,
      customName: '',
      loft: String(preset.loft),
      carryYards: preset.carry,
      manufacturer: '',
      customManufacturer: '',
      model: '',
      specsOpen: false,
    });
  };

  const openEdit = (club) => {
    const known = CLUB_SLOTS.some((slot) => slot.slot === club.club_type);
    const maker = String(club.manufacturer || '').trim();
    const knownMaker = MANUFACTURERS.includes(maker);
    setCarryDraft(yardsToInput(club.carry_yards, distanceUnit));
    setSheet({
      open: true,
      editingId: club.id,
      slot: known ? club.club_type : 'Custom',
      customName: known ? '' : String(club.club_type || ''),
      loft: club.loft == null ? '' : String(club.loft),
      carryYards: Number(club.carry_yards) || 0,
      manufacturer: knownMaker ? maker : '',
      customManufacturer: maker && !knownMaker ? maker : '',
      model: String(club.model || ''),
      specsOpen: Boolean(maker || club.model),
    });
  };

  const closeSheet = () => setSheet(null);

  const chooseSlot = (slot) => {
    const preset = CLUB_SLOTS.find((item) => item.slot === slot);
    if (!sheet?.editingId && preset) {
      setCarryDraft(yardsToInput(preset.carry, distanceUnit));
      setSheet((current) => (current ? { ...current, slot, loft: String(preset.loft), carryYards: preset.carry } : current));
      return;
    }
    setSheet((current) => (current ? { ...current, slot } : current));
  };

  const saveSheet = (event) => {
    event.preventDefault();
    if (!sheet) return;
    const clubType = sheet.slot === 'Custom' ? sheet.customName.trim() : sheet.slot;
    if (!clubType) return;
    const existing = (Array.isArray(clubs) ? clubs : []).find((club) => club.id === sheet.editingId) || null;
    const parsedCarry = inputToYards(carryDraft, distanceUnit);
    const carry = parsedCarry == null ? Number(existing?.carry_yards) || Number(sheet.carryYards) || 0 : parsedCarry;
    const loftNum = sheet.loft === '' || sheet.loft == null ? null : Number(sheet.loft);
    const loft = Number.isFinite(loftNum) ? loftNum : (existing?.loft ?? null);
    const manufacturer = (sheet.customManufacturer.trim() || sheet.manufacturer || '').trim();
    const model = sheet.model.trim();
    const total = carry + rolloutYards(clubType, existing);

    if (existing) {
      updateClub(existing.id, {
        club_type: clubType,
        loft,
        carry_yards: carry,
        total_yards: total,
        manufacturer,
        model,
      });
    } else {
      const newItem = normalizeClub({
        id: crypto.randomUUID(),
        club_type: clubType,
        loft,
        bounce_grind: 'Std',
        carry_yards: carry,
        total_yards: total,
        shot_shape: 'Straight',
        grip_model: 'Golf Pride MCC',
        rounds_on_grip: 0,
        manufacturer,
        model,
        archived: false,
      });
      const next = [...(Array.isArray(clubs) ? clubs : []), newItem].sort((a, b) => (Number(b.carry_yards) || 0) - (Number(a.carry_yards) || 0));
      setClubs(next);
      if (user?.id) {
        void writeClubRow('insert', {
          user_id: user.id,
          club_type: newItem.club_type,
          loft: newItem.loft,
          bounce_grind: newItem.bounce_grind,
          carry_yards: newItem.carry_yards,
          total_yards: newItem.total_yards,
          shot_shape: newItem.shot_shape,
          grip_model: newItem.grip_model,
          rounds_on_grip: 0,
          sort_order: next.length,
          manufacturer: newItem.manufacturer,
          model: newItem.model,
          archived: false,
        }, { userId: user.id });
      }
    }
    closeSheet();
  };

  const commitDistance = (club, field, raw) => {
    const yards = inputToYards(raw, distanceUnit);
    if (yards == null) return;
    if (field === 'carry_yards') {
      updateClub(club.id, { carry_yards: yards, total_yards: yards + rolloutYards(club.club_type, club) });
      return;
    }
    updateClub(club.id, { [field]: yards });
  };

  const list = Array.isArray(clubs) ? clubs : [];
  const activeClubs = activeBagClubs(list);
  const archivedClubs = list.filter((club) => club?.archived === true);
  const sortByCarry = (rows) => [...rows].sort((a, b) => (Number(b.carry_yards) || 0) - (Number(a.carry_yards) || 0));
  const activeSorted = sortByCarry(activeClubs);
  const archivedSorted = sortByCarry(archivedClubs);
  const gappingClubs = activeSorted.filter((club) => Number(club.carry_yards) > 0 && !/putter/i.test(String(club.club_type || '')));
  const overTournamentLimit = activeClubs.length > 14;

  const gapAlerts = [];
  for (let i = 0; i < gappingClubs.length - 1; i += 1) {
    const upper = gappingClubs[i];
    const lower = gappingClubs[i + 1];
    const diff = (Number(upper.carry_yards) || 0) - (Number(lower.carry_yards) || 0);
    if (diff > 18) {
      gapAlerts.push({
        type: 'deadzone',
        pair: `${upper.club_type} -> ${lower.club_type}`,
        diff,
        advice: `${formatDistance(diff)} dead zone (${formatDistance(lower.carry_yards)} to ${formatDistance(upper.carry_yards)}). Consider strengthening ${lower.club_type} or adding a ~${formatDistance(Math.round(((Number(upper.carry_yards) || 0) + (Number(lower.carry_yards) || 0)) / 2))} gap club.`,
      });
    } else if (diff < 7) {
      gapAlerts.push({
        type: 'overlap',
        pair: `${upper.club_type} / ${lower.club_type}`,
        diff,
        advice: `Only ${formatDistance(diff)} separation — redundant slot you could free up for a specialty wedge or hybrid.`,
      });
    }
  }

  const wedges = activeSorted.filter(
    (club) => /wedge|pw|gw|sw|lw|50|52|54|56|58|60|62/i.test(club.club_type) || (Number(club.loft) >= 45 && Number(club.loft) <= 64)
  );
  const scoredWedges = wedges.map((wedge) => {
    const bounce = parseBounceDeg(wedge.bounce_grind);
    const bounceVal = bounce ?? 10;
    let fitScore = 50;
    if (turfCondition === 'soft') fitScore = bounceVal >= 10 ? 95 : bounceVal >= 8 ? 70 : 35;
    else if (turfCondition === 'firm') fitScore = bounceVal <= 6 ? 95 : bounceVal <= 10 ? 72 : 38;
    else fitScore = bounceVal >= 8 && bounceVal <= 12 ? 92 : 70;
    return { ...wedge, bounceDeg: bounce, fitScore };
  });
  const leadWedge = [...scoredWedges].sort((a, b) => b.fitScore - a.fitScore)[0];
  const turfSummary = turfCondition === 'soft'
    ? 'Morning Dew / Soft Turf: Higher bounce (10°-14°, D/S/K grinds) prevents leading-edge digging on pitches and wet bunker shots.'
    : turfCondition === 'firm'
      ? 'Dry & Firm / Tight Lies: Low bounce (04°-08°, T/M/L grinds) keeps the leading edge under the ball without skidding.'
      : 'Balanced Fairway Turf: Mid-bounce (08°-12°, S/M/F grinds) handles full swings, square pitches, and open-face bunker shots cleanly.';

  const renderClubCard = (club, { archived }) => {
    const gripDue = (club.rounds_on_grip || 0) >= 30;
    const spec = clubSpecSubtitle(club);
    return (
      <div
        key={club.id}
        className="rounded-3xl p-3.5 border space-y-2.5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-sm">{club.club_type}</div>
            {spec ? (
              <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{spec}</div>
            ) : null}
            <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {club.loft == null || club.loft === '' ? 'Loft —' : `${club.loft}°`} · {club.bounce_grind || 'Std'}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEdit(club)}
              className="min-h-[44px] rounded-xl border px-3 text-xs font-semibold"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
            >
              Edit
            </button>
            {archived ? (
              <button
                type="button"
                onClick={() => updateClub(club.id, { archived: false })}
                className="min-h-[44px] rounded-xl px-3 text-xs font-semibold text-[#0B0D0C]"
                style={{ backgroundColor: '#10B981' }}
              >
                Restore to Bag
              </button>
            ) : (
              <button
                type="button"
                onClick={() => updateClub(club.id, { archived: true })}
                className="min-h-[44px] rounded-xl border px-3 text-xs font-semibold"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
              >
                Archive
              </button>
            )}
            {archived && (
              <button
                type="button"
                onClick={() => removeClub(club.id)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border"
                style={{ borderColor: 'var(--border-subtle)' }}
                aria-label={`Delete ${club.club_type}`}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {!archived && (
          <>
            <div className="flex items-center justify-between gap-2">
              <select
                value={club.shot_shape || 'Straight'}
                onChange={(event) => updateClub(club.id, { shot_shape: event.target.value })}
                className="min-h-[44px] rounded-lg px-2 text-xs border"
                style={fieldStyle}
              >
                <option value="Straight">Straight</option>
                <option value="Draw">Draw</option>
                <option value="Fade">Fade</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs" data-numeric>
              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Carry · <span className={tabularNumsClass}>{formatDistance(club.carry_yards)}</span>
                </label>
                <input
                  type="number"
                  value={yardsToInput(club.carry_yards, distanceUnit)}
                  onChange={(event) => commitDistance(club, 'carry_yards', event.target.value)}
                  className={`w-full min-h-[44px] font-mono font-bold rounded-lg px-2 border ${tabularNumsClass}`}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Total · <span className={tabularNumsClass}>{formatDistance(club.total_yards)}</span>
                </label>
                <input
                  type="number"
                  value={yardsToInput(club.total_yards, distanceUnit)}
                  onChange={(event) => commitDistance(club, 'total_yards', event.target.value)}
                  className={`w-full min-h-[44px] font-mono font-bold rounded-lg px-2 border ${tabularNumsClass}`}
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>Grip Rounds</label>
                <input
                  type="number"
                  value={club.rounds_on_grip || 0}
                  onChange={(event) => updateClub(club.id, { rounds_on_grip: Number(event.target.value) })}
                  className={`w-full min-h-[44px] font-mono font-bold rounded-lg px-2 border ${tabularNumsClass}`}
                  style={fieldStyle}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{club.grip_model}</span>
              {gripDue ? (
                <span className="text-amber-500 font-medium flex items-center gap-1">
                  <AlertTriangle size={12} /> Fresh grip due
                </span>
              ) : (
                <span className="flex items-center gap-1" style={{ color: '#10B981' }}>
                  <CheckCircle2 size={12} /> Tack OK
                </span>
              )}
            </div>
          </>
        )}
        {archived && (
          <div className={`text-xs ${tabularNumsClass}`} style={{ color: 'var(--text-secondary)' }}>
            Carry {formatDistance(club.carry_yards)} saved on the bench
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#10B981' }}>
              Active Bag ({activeClubs.length} / 14 Clubs)
            </div>
            <h2 className="text-lg font-semibold mt-0.5 flex items-center gap-2">
              <Briefcase size={18} style={{ color: '#10B981' }} /> My Bag
            </h2>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {user ? 'Cloud Synced' : 'Local Bag'}
          </span>
        </div>
        {overTournamentLimit && (
          <p className="text-xs rounded-2xl px-3 py-2 border" style={{ color: '#D4AF37', borderColor: '#D4AF37' }}>
            More than 14 clubs are in the active bag. Tournament play allows 14 — archive one to bench it. Yardages, loft, and specs stay saved.
          </p>
        )}
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-3xl text-sm font-semibold text-[#0B0D0C]"
          style={{ backgroundColor: '#10B981' }}
        >
          <Plus size={16} /> + Add Club
        </button>
      </div>

      <div className="rounded-3xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: gapAlerts.length > 0 ? 'var(--border-subtle)' : '#10B981' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: gapAlerts.length > 0 ? 'var(--text-primary)' : '#10B981' }}>
            <Layers size={14} /> Yardage Gap & Dead-Zone Detector
          </span>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            Target 10–15y gaps
          </span>
        </div>
        {gapAlerts.length === 0 ? (
          <div className="text-xs flex items-center gap-1.5" style={{ color: '#10B981' }}>
            <CheckCircle2 size={14} /> Clean gapping across your active bag — zero dead zones over 18 yards.
          </div>
        ) : (
          <div className="space-y-1.5">
            {gapAlerts.slice(0, 4).map((gap) => (
              <div key={gap.pair} className="p-2.5 rounded-xl border text-xs space-y-0.5" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <div className="font-semibold flex items-center gap-1.5 tabular-nums" style={{ color: gap.type === 'deadzone' ? 'var(--text-primary)' : '#B91C1C' }}>
                  <AlertTriangle size={13} /> {gap.pair} ({formatDistance(gap.diff)} gap)
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{gap.advice}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#10B981' }}>
            <Compass size={14} /> Wedge Bounce & Turf Advisor
          </span>
          <div className="flex gap-1">
            {[
              { id: 'soft', label: 'Dew / Soft' },
              { id: 'balanced', label: 'Balanced' },
              { id: 'firm', label: 'Dry / Firm' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTurfCondition(option.id)}
                className={`min-h-[44px] px-2 rounded-lg text-[10px] font-semibold border transition ${option.id === turfCondition ? 'bg-emerald-700 text-white border-emerald-700' : ''}`}
                style={option.id !== turfCondition ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{turfSummary}</p>
        {leadWedge && (
          <div className="p-2.5 rounded-xl border flex items-center justify-between text-xs" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: '#10B981' }}>
            <span className="flex items-center gap-1.5">
              <Sparkles size={13} style={{ color: '#10B981' }} />
              <strong>Primary Greenside Wedge:</strong> {leadWedge.club_type} ({leadWedge.bounce_grind})
            </span>
            <span className={`font-mono text-[11px] ${tabularNumsClass}`} style={{ color: '#10B981' }}>
              {formatDistance(leadWedge.carry_yards)} carry
            </span>
          </div>
        )}
        {scoredWedges.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {scoredWedges.map((wedge) => (
              <div
                key={wedge.id}
                className="p-2 rounded-xl border flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: wedge.fitScore >= 85 ? '#10B981' : 'var(--border-subtle)',
                }}
              >
                <div>
                  <div className="font-semibold">{wedge.club_type}</div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    Bounce/Grind: {wedge.bounce_grind}
                  </div>
                </div>
                <span
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: wedge.fitScore >= 85 ? 'rgba(16,185,129,0.18)' : 'var(--bg-surface)',
                    color: wedge.fitScore >= 85 ? '#10B981' : 'var(--text-primary)',
                  }}
                >
                  {wedge.fitScore >= 85 ? 'Ideal' : wedge.fitScore >= 65 ? 'Playable' : 'Dig/Skid Risk'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {activeSorted.map((club) => renderClubCard(club, { archived: false }))}
      </div>

      <div className="rounded-3xl border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => setGarageOpen((open) => !open)}
          aria-expanded={garageOpen}
          className="flex min-h-[44px] w-full items-center justify-between px-4 text-left text-sm font-semibold"
        >
          <span>Archived / Garage Clubs ({archivedClubs.length})</span>
          <span aria-hidden>{garageOpen ? '▴' : '▾'}</span>
        </button>
        {garageOpen && (
          <div className="space-y-2.5 px-3 pb-3">
            {archivedSorted.length === 0 ? (
              <p className="px-1 pb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                No clubs on the bench. Archive keeps yardages, loft, and specs until you restore or delete.
              </p>
            ) : (
              archivedSorted.map((club) => renderClubCard(club, { archived: true }))
            )}
          </div>
        )}
      </div>

      {sheet?.open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-3 sm:items-center" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <form
            onSubmit={saveSheet}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{sheet.editingId ? 'Edit Club' : 'Add Club'}</h3>
              <button type="button" onClick={closeSheet} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Club Type / Slot
              <select
                value={sheet.slot}
                onChange={(event) => chooseSlot(event.target.value)}
                className={`${fieldClass} mt-1`}
                style={fieldStyle}
              >
                {CLUB_SLOTS.map((slot) => (
                  <option key={slot.slot} value={slot.slot}>{slot.slot}</option>
                ))}
              </select>
            </label>
            {sheet.slot === 'Custom' && (
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Custom name
                <input
                  type="text"
                  value={sheet.customName}
                  onChange={(event) => setSheet((current) => (current ? { ...current, customName: event.target.value } : current))}
                  placeholder="e.g. 62° Lob"
                  className={`${fieldClass} mt-1`}
                  style={fieldStyle}
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Loft (°)
                <input
                  type="number"
                  step="0.5"
                  value={sheet.loft}
                  onChange={(event) => setSheet((current) => (current ? { ...current, loft: event.target.value } : current))}
                  className={`${fieldClass} mt-1 tabular-nums`}
                  style={fieldStyle}
                />
              </label>
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Carry Distance ({unitLabel})
                <input
                  type="number"
                  inputMode="decimal"
                  value={carryDraft}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCarryDraft(next);
                    const yards = inputToYards(next, distanceUnit);
                    if (yards == null) return;
                    setSheet((current) => (current ? { ...current, carryYards: yards } : current));
                  }}
                  className={`${fieldClass} mt-1 tabular-nums`}
                  style={fieldStyle}
                />
              </label>
            </div>
            <div className="rounded-3xl border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setSheet((current) => (current ? { ...current, specsOpen: !current.specsOpen } : current))}
                aria-expanded={sheet.specsOpen}
                className="flex min-h-[44px] w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span>Optional specs</span>
                <span>{sheet.specsOpen ? '▴' : '▾'}</span>
              </button>
              {sheet.specsOpen && (
                <div className="space-y-2">
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Manufacturer</div>
                  <div className="flex flex-wrap gap-1.5">
                    {MANUFACTURERS.map((name) => {
                      const selected = sheet.manufacturer === name && !sheet.customManufacturer.trim();
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSheet((current) => (current ? {
                            ...current,
                            manufacturer: current.manufacturer === name ? '' : name,
                            customManufacturer: '',
                          } : current))}
                          className="min-h-[44px] rounded-full border px-3 text-xs font-semibold"
                          style={{
                            borderColor: selected ? '#10B981' : 'var(--border-subtle)',
                            color: selected ? '#10B981' : 'inherit',
                            backgroundColor: 'var(--bg-elevated)',
                          }}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={sheet.customManufacturer}
                    onChange={(event) => setSheet((current) => (current ? { ...current, customManufacturer: event.target.value } : current))}
                    placeholder="Or type a manufacturer"
                    className={fieldClass}
                    style={fieldStyle}
                  />
                  <label className="block text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Model
                    <input
                      type="text"
                      value={sheet.model}
                      onChange={(event) => setSheet((current) => (current ? { ...current, model: event.target.value } : current))}
                      placeholder="Vokey SM9 60° T-Grind, Qi10 Max, Ai Smoke, G430 Max"
                      className={`${fieldClass} mt-1`}
                      style={fieldStyle}
                    />
                  </label>
                </div>
              )}
            </div>
            <button
              type="submit"
              className="inline-flex w-full min-h-[44px] items-center justify-center rounded-3xl text-sm font-semibold text-[#0B0D0C]"
              style={{ backgroundColor: '#10B981' }}
            >
              {sheet.editingId ? 'Save Club' : 'Add to Bag'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
