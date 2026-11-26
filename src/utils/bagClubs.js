/** Shared bag shape. Carry stays in yards. `archived` defaults to active. */

export function isActiveClub(club) {
  return Boolean(club) && club.archived !== true;
}

export function activeBagClubs(clubs) {
  return (Array.isArray(clubs) ? clubs : []).filter(isActiveClub);
}

export function clubSpecSubtitle(club) {
  if (!club || typeof club !== 'object') return '';
  return [club.manufacturer, club.model]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

export function normalizeClub(club) {
  if (!club || typeof club !== 'object') return club;
  let loft = club.loft ?? null;
  if (loft != null && loft !== '') {
    const parsed = Number(loft);
    if (Number.isFinite(parsed)) loft = parsed;
  } else {
    loft = null;
  }
  return {
    ...club,
    manufacturer: club.manufacturer == null ? '' : String(club.manufacturer),
    model: club.model == null ? '' : String(club.model),
    loft,
    archived: club.archived === true,
  };
}

/** Keep local manufacturer, model, loft, and archived when a cloud row predates those columns. */
export function mergeCloudClub(localClub, row) {
  const base = localClub && typeof localClub === 'object' ? localClub : {};
  const remote = row && typeof row === 'object' ? row : {};
  const merged = { ...base, ...remote };
  if (remote.manufacturer == null && base.manufacturer) merged.manufacturer = base.manufacturer;
  if (remote.model == null && base.model) merged.model = base.model;
  if (remote.loft == null && base.loft != null) merged.loft = base.loft;
  if (remote.archived == null && base.archived === true) merged.archived = true;
  return normalizeClub(merged);
}

export function closestActiveClub(clubs, yards) {
  const active = activeBagClubs(clubs);
  const ranged = active.filter((club) => {
    if (/putter/i.test(String(club?.club_type || club?.name || ''))) return false;
    return Number(club?.carry_yards) > 0;
  });
  const list = ranged.length > 0 ? ranged : active;
  const target = Number(yards);
  if (!Number.isFinite(target)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const club of list) {
    const carry = Number(club?.carry_yards);
    if (!Number.isFinite(carry)) continue;
    const diff = Math.abs(carry - target);
    if (diff < bestDiff) {
      best = club;
      bestDiff = diff;
    }
  }
  return best;
}
