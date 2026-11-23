import { useState, useEffect } from 'react';
import { Send, Share2, Check, Shirt, Trophy, Receipt, Award, Cloud, UserPlus, Crown, Ticket } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { COURSE_PRESETS } from '../lib/weatherPhysics';

function computeLiveRoundStats() {
  try {
    const scoresMap = JSON.parse(localStorage.getItem('the-turn-scores-v2') || '{}');
    const customCourses = JSON.parse(localStorage.getItem('the-turn-custom-courses') || '[]');
    const allCourses = [...customCourses, ...COURSE_PRESETS];

    let bestStats = null;

    for (const [courseKey, holeMap] of Object.entries(scoresMap)) {
      if (!holeMap || typeof holeMap !== 'object') continue;
      const holeNums = Object.keys(holeMap).map(Number).filter((n) => !Number.isNaN(n));
      if (holeNums.length === 0) continue;

      const matchedCourse = allCourses.find((c) => c.id === courseKey);
      let totalStrokes = 0;
      let totalPutts = 0;
      let girHits = 0;
      let firHits = 0;
      let firEligible = 0;

      for (const hNum of holeNums) {
        const holeMeta = matchedCourse?.holes?.find((h) => h.number === hNum) || { par: 4 };
        const entry = holeMap[hNum];
        const st = typeof entry === 'number' ? entry : Number(entry?.strokes ?? holeMeta.par);
        const pt = typeof entry === 'number' ? 2 : Number(entry?.putts ?? 2);
        const isGir =
          typeof entry === 'number'
            ? st - pt <= holeMeta.par - 2
            : entry?.gir !== undefined
            ? Boolean(entry.gir)
            : st - pt <= holeMeta.par - 2;
        const firVal = typeof entry === 'number' ? 'hit' : entry?.fir;

        totalStrokes += st;
        totalPutts += pt;
        if (isGir) girHits += 1;
        if (holeMeta.par > 3) {
          firEligible += 1;
          if (firVal === 'hit') firHits += 1;
        }
      }

      const holesCount = holeNums.length;
      const girPct = Math.round((girHits / holesCount) * 100);
      const firPct = firEligible > 0 ? Math.round((firHits / firEligible) * 100) : null;

      if (!bestStats || holesCount >= bestStats.holesCount) {
        bestStats = {
          holesCount,
          totalStrokes,
          totalPutts,
          girHits,
          girPct,
          firHits,
          firEligible,
          firPct,
          courseName: matchedCourse?.name || null,
        };
      }
    }

    return bestStats;
  } catch {
    return null;
  }
}

export default function FoursomeHub({ isPro = false, onOpenPaywall, onRequireAuth }) {
  const { user, refreshProfile } = useAuth();
  const initialInviteId = new URLSearchParams(window.location.search).get('invite');
  const initialLockedFit = localStorage.getItem('the-turn-locked-fit') || 'Navy Polo - Stone Shorts - FJ White';
  const liveStats = computeLiveRoundStats();

  const [roundId, setRoundId] = useState(initialInviteId);
  const [course, setCourse] = useState(liveStats?.courseName || 'Dos Lagos Golf Club');
  const [teeTime, setTeeTime] = useState('Saturday - 7:00 AM');
  const [sideGame, setSideGame] = useState('$5 Nassau (Auto-Press)');
  const [skinValue, setSkinValue] = useState(5);
  const [clubhouseTab, setClubhouseTab] = useState(84);
  const [copied, setCopied] = useState(false);
  const [crewCopied, setCrewCopied] = useState(false);
  const [recapCopied, setRecapCopied] = useState(false);
  const [syncStatus, setSyncStatus] = useState(initialInviteId ? 'Live Invite Link Active' : 'Local Foursome');

  const [crewPass, setCrewPass] = useState(null);
  const [crewSeats, setCrewSeats] = useState([]);
  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState('');

  const [joinName, setJoinName] = useState('');
  const [joinFit, setJoinFit] = useState('Blue Polo - Dark Pants - Grey Shoes');
  const [joinHcp, setJoinHcp] = useState(12);

  const [players, setPlayers] = useState([
    {
      id: '1',
      name: 'You',
      status: 'IN',
      fit: initialLockedFit,
      tee: 'Blue',
      hcp: 10,
      skins: 2,
      score: liveStats ? liveStats.totalStrokes : 78,
      putts: liveStats ? liveStats.totalPutts : null,
      girPct: liveStats ? liveStats.girPct : null,
      firPct: liveStats ? liveStats.firPct : null,
      holesCount: liveStats ? liveStats.holesCount : null,
    },
    { id: '2', name: 'Jason', status: 'IN', fit: 'Grey Polo - Black Pants - Jordan Low', tee: 'Blue', hcp: 14, skins: 1, score: 81 },
    { id: '3', name: 'Rylie', status: 'IN', fit: 'White Polo - Navy Shorts', tee: 'Blue', hcp: 8, skins: 2, score: 79 },
    { id: '4', name: 'Ryan', status: 'MAYBE', fit: 'Pending fit lock', tee: 'Blue', hcp: 18, skins: 0, score: 84 },
  ]);

  const loadCrewPass = async () => {
    if (!user?.id) return;
    const { data: passes } = await supabase
      .from('crew_passes')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (passes && passes.length > 0) {
      const pass = passes[0];
      setCrewPass(pass);
      const { data: seats } = await supabase
        .from('crew_pass_seats')
        .select('*')
        .eq('pass_id', pass.id)
        .order('claimed_at', { ascending: true });
      setCrewSeats(seats || []);
    }
  };

  useEffect(() => {
    loadCrewPass();
  }, [user?.id]);

  const handleCreateDemoPass = async () => {
    if (!user?.id) {
      onRequireAuth?.();
      return;
    }
    const code = `TURN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const { data: created } = await supabase
      .from('crew_passes')
      .insert({ owner_id: user.id, invite_code: code, max_seats: 4, active: true })
      .select()
      .single();

    if (created) {
      await supabase.from('crew_pass_seats').insert({
        pass_id: created.id,
        member_id: user.id,
        member_email: user.email,
      });
      await loadCrewPass();
    }
  };

  const handleRedeemCrewCode = async (e) => {
    e.preventDefault();
    if (!redeemCodeInput.trim()) return;
    if (!user?.id) {
      onRequireAuth?.();
      return;
    }
    setRedeemMsg('Checking Crew Pass...');
    const { data, error } = await supabase.rpc('claim_crew_seat', {
      p_invite_code: redeemCodeInput.trim(),
    });
    if (error) {
      setRedeemMsg(error.message);
    } else if (data?.ok) {
      setRedeemMsg(data.message || 'Tour Pro seat unlocked!');
      setRedeemCodeInput('');
      refreshProfile?.();
      loadCrewPass();
    } else {
      setRedeemMsg(data?.error || 'Unable to claim seat.');
    }
  };

  useEffect(() => {
    if (!roundId) return;

    const loadLiveRound = async () => {
      const { data: roundRow } = await supabase.from('rounds').select('*').eq('id', roundId).single();
      if (roundRow) {
        setCourse(roundRow.course_name);
        setTeeTime(roundRow.tee_time_label);
        if (roundRow.side_game) setSideGame(roundRow.side_game);
        setSyncStatus('Live Cloud Synced');
      }

      const { data: playerRows } = await supabase
        .from('round_players')
        .select('*')
        .eq('round_id', roundId)
        .order('updated_at', { ascending: true });

      if (playerRows && playerRows.length > 0) {
        setPlayers(
          playerRows.map((r) => ({
            id: r.id,
            name: r.player_name,
            status: r.status || 'MAYBE',
            fit: r.outfit_summary || 'Pending fit lock',
            tee: r.tee_box || 'Blue',
            hcp: Number(r.handicap) || 12,
            skins: r.skins || 0,
            score: r.score || 80,
          }))
        );
      }
    };

    loadLiveRound();

    const channel = supabase
      .channel(`round-${roundId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'round_players', filter: `round_id=eq.${roundId}` },
        () => loadLiveRound()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId]);

  const publishLiveInvite = async () => {
    if (roundId) return roundId;
    setSyncStatus('Publishing live link...');
    const { data: createdRound, error } = await supabase
      .from('rounds')
      .insert({
        host_id: user?.id || null,
        course_name: course,
        tee_time_label: teeTime,
        side_game: sideGame,
      })
      .select()
      .single();

    if (error || !createdRound) {
      setSyncStatus('Offline Link Mode');
      return null;
    }

    const rows = players.map((p) => ({
      round_id: createdRound.id,
      player_name: p.name,
      status: p.status,
      tee_box: p.tee,
      outfit_summary: p.fit,
      skins: p.skins,
      score: p.score,
    }));

    const { data: insertedPlayers } = await supabase.from('round_players').insert(rows).select();
    if (insertedPlayers) {
      setPlayers(
        insertedPlayers.map((r, idx) => ({
          id: r.id,
          name: r.player_name,
          status: r.status,
          fit: r.outfit_summary,
          tee: r.tee_box,
          hcp: players[idx]?.hcp ?? 12,
          skins: r.skins,
          score: r.score,
        }))
      );
    }

    setRoundId(createdRound.id);
    window.history.replaceState({}, '', `${window.location.pathname}?invite=${createdRound.id}`);
    setSyncStatus('Live Cloud Synced');
    return createdRound.id;
  };

  const inviteUrl = roundId
    ? `${window.location.origin}/?invite=${roundId}`
    : `${window.location.origin}/?invite=dos-lagos-7am`;

  const smsBody = encodeURIComponent(
    `Tee time locked for ${course} (${teeTime}). Side game: ${sideGame}. Tap IN & lock your outfit on The Turn: ${inviteUrl}`
  );

  const copyInviteLink = async () => {
    const activeId = await publishLiveInvite();
    const urlToCopy = activeId ? `${window.location.origin}/?invite=${activeId}` : inviteUrl;
    navigator.clipboard.writeText(urlToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const crewInviteUrl = crewPass ? `${window.location.origin}/?crew=${crewPass.invite_code}` : '';
  const crewSmsBody = crewPass
    ? encodeURIComponent(
        `I grabbed our 4-seat Foursome Crew Pass on The Turn ($299.99/yr). Tap this link to claim 1 of the 3 open Tour Pro seats automatically: ${crewInviteUrl}`
      )
    : '';

  const copyCrewInviteLink = () => {
    if (!crewInviteUrl) return;
    navigator.clipboard.writeText(crewInviteUrl);
    setCrewCopied(true);
    setTimeout(() => setCrewCopied(false), 2500);
  };

  const cycleStatus = async (id) => {
    const order = ['IN', 'MAYBE', 'OUT'];
    const target = players.find((p) => p.id === id);
    if (!target) return;
    const nextStatus = order[(order.indexOf(target.status) + 1) % order.length];

    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, status: nextStatus } : p)));
    if (roundId) {
      await supabase.from('round_players').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', id);
    }
  };

  const adjustSkins = async (id, delta) => {
    const target = players.find((p) => p.id === id);
    if (!target) return;
    const nextSkins = Math.max(0, target.skins + delta);

    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, skins: nextSkins } : p)));
    if (roundId) {
      await supabase.from('round_players').update({ skins: nextSkins, updated_at: new Date().toISOString() }).eq('id', id);
    }
  };

  const updatePlayerHcp = (id, hcpVal) => {
    const cleanHcp = Math.max(0, Math.min(54, Number(hcpVal) || 0));
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, hcp: cleanHcp } : p)));
  };

  const handleBuddyJoin = async (e) => {
    e.preventDefault();
    if (!joinName.trim()) return;
    const newEntry = {
      id: crypto.randomUUID(),
      name: joinName.trim(),
      status: 'IN',
      fit: joinFit.trim() || 'Fit locked',
      tee: 'Blue',
      hcp: Math.max(0, Math.min(54, Number(joinHcp) || 12)),
      skins: 0,
      score: 80,
    };

    if (roundId) {
      const { data } = await supabase
        .from('round_players')
        .insert({
          round_id: roundId,
          player_name: newEntry.name,
          status: 'IN',
          tee_box: 'Blue',
          outfit_summary: newEntry.fit,
          skins: 0,
          score: 80,
        })
        .select()
        .single();
      if (data) newEntry.id = data.id;
    }

    setPlayers((prev) => [...prev, newEntry]);
    setJoinName('');
  };

  const activePlayers = players.filter((p) => p.status !== 'OUT');
  const activeCount = Math.max(1, activePlayers.length);
  const totalSkins = activePlayers.reduce((sum, p) => sum + p.skins, 0);
  const perPlayerTab = Math.round((Number(clubhouseTab) || 0) / activeCount);
  const lowHcp = activePlayers.reduce((min, p) => Math.min(min, Number(p.hcp) || 0), Infinity);
  const baselineHcp = Number.isFinite(lowHcp) ? lowHcp : 0;

  const shareRecapCard = () => {
    const lines = activePlayers
      .map((p) => {
        const playingStrokes = Math.max(0, (Number(p.hcp) || 0) - baselineHcp);
        const netScore = p.score - playingStrokes;
        const skinNet = p.skins * skinValue * (activeCount - 1) - (totalSkins - p.skins) * skinValue;
        const finalNet = skinNet - perPlayerTab;
        const statDetail =
          p.id === '1' && liveStats
            ? ` | GIR ${liveStats.girPct}% | FIR ${liveStats.firPct !== null ? `${liveStats.firPct}%` : 'N/A'} | Putts ${liveStats.totalPutts} (${liveStats.holesCount}h)`
            : '';
        return `${p.name} (HCP ${p.hcp}): Gross ${p.score} / Net ${netScore}${statDetail} (${p.skins} skins | Net ${finalNet >= 0 ? `+$${finalNet}` : `-$${Math.abs(finalNet)}`})`;
      })
      .join('\n');

    const recapText = `THE TURN - Round Recap\n${course} (${teeTime})\n${lines}\nTracked on ${window.location.origin}`;
    navigator.clipboard.writeText(recapText);
    setRecapCopied(true);
    setTimeout(() => setRecapCopied(false), 2500);
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Live Scorecard Stats Banner (Total Strokes, GIR%, FIR%, Putts) */}
      {liveStats && (
        <div className="rounded-2xl p-3.5 border space-y-2" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-emerald)' }}>
              Your Live Round Stats ({liveStats.holesCount} Holes Logged)
            </span>
            <span className="font-mono text-[11px]" style={{ color: 'var(--accent-gold)' }}>
              Synced to Recap
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Strokes</div>
              <div className="font-mono font-bold">{liveStats.totalStrokes}</div>
            </div>
            <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>GIR %</div>
              <div className="font-mono font-bold">{liveStats.girPct}%</div>
            </div>
            <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>FIR %</div>
              <div className="font-mono font-bold">{liveStats.firPct !== null ? `${liveStats.firPct}%` : 'N/A'}</div>
            </div>
            <div className="p-2 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Putts</div>
              <div className="font-mono font-bold">{liveStats.totalPutts}</div>
            </div>
          </div>
        </div>
      )}

      {/* Foursome Crew Pass (4-Seat Manager & Buddy Redemption) */}
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-gold)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-gold)' }}>
            <Crown size={14} /> Foursome Crew Pass (4 Seats)
          </span>
          {crewPass && (
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent-emerald)' }}>
              {crewSeats.length}/{crewPass.max_seats} Claimed
            </span>
          )}
        </div>

        {crewPass ? (
          <>
            <div className="p-3 rounded-xl border flex items-center justify-between" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>Pass Invite Code</div>
                <div className="font-mono font-bold text-sm tracking-wider">{crewPass.invite_code}</div>
              </div>
              <div className="flex gap-1.5">
                <a
                  href={`sms:?&body=${crewSmsBody}`}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1"
                  style={{ backgroundColor: 'var(--accent-emerald)' }}
                >
                  <Send size={12} /> Text 3 Buddies
                </a>
                <button
                  type="button"
                  onClick={copyCrewInviteLink}
                  className="px-2.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-1"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  {crewCopied ? <Check size={13} className="text-emerald-500" /> : <Share2 size={13} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {[0, 1, 2, 3].map((slotIdx) => {
                const seat = crewSeats[slotIdx];
                return (
                  <div
                    key={slotIdx}
                    className="p-2 rounded-xl border truncate"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: seat ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                    }}
                  >
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      Seat {slotIdx + 1} {slotIdx === 0 ? '(Host)' : ''}
                    </div>
                    <div className="font-medium truncate">
                      {seat ? seat.member_email || 'Tour Pro Active' : 'Open - Share Link'}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Unlock Tour Pro for you and 3 playing partners with one Foursome Crew Pass ($299.99/yr), or enter a buddy&apos;s invite code below.
            </p>
            <div className="flex gap-2">
              {isPro && user ? (
                <button
                  type="button"
                  onClick={handleCreateDemoPass}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent-emerald)' }}
                >
                  Generate My 4-Seat Crew Code
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenPaywall?.('Foursome Crew Pass (4 Tour Pro Seats - $299.99/yr)')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent-emerald)' }}
                >
                  Get Foursome Crew Pass ($299.99/yr)
                </button>
              )}
            </div>

            <form onSubmit={handleRedeemCrewCode} className="flex gap-1.5 pt-1">
              <div className="relative flex-1">
                <Ticket size={13} className="absolute left-2.5 top-2.5 opacity-60" />
                <input
                  type="text"
                  placeholder="Have a code? e.g. TURN-8X92KP"
                  value={redeemCodeInput}
                  onChange={(e) => setRedeemCodeInput(e.target.value)}
                  className="w-full rounded-xl pl-8 pr-2.5 py-1.5 text-xs font-mono border uppercase"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
              >
                Claim Seat
              </button>
            </form>
            {redeemMsg && <p className="text-[11px] font-medium" style={{ color: 'var(--accent-emerald)' }}>{redeemMsg}</p>}
          </div>
        )}
      </div>

      {/* Active Foursome Tee Time & Invite */}
      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-gold)' }}>
            <Cloud size={13} /> {syncStatus}
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {activeCount}/{players.length} Confirmed
          </span>
        </div>

        <input
          type="text"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className="w-full font-bold text-base bg-transparent border-b pb-1 focus:outline-none"
          style={{ borderColor: 'var(--border-subtle)' }}
        />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <input
            type="text"
            value={teeTime}
            onChange={(e) => setTeeTime(e.target.value)}
            className="rounded-xl px-3 py-2 border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="text"
            value={sideGame}
            onChange={(e) => setSideGame(e.target.value)}
            className="rounded-xl px-3 py-2 border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <a
            href={`sms:?&body=${smsBody}`}
            onClick={publishLiveInvite}
            className="flex-1 py-2.5 rounded-xl font-semibold text-xs text-white flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            <Send size={14} /> Text Live Invite
          </a>
          <button
            type="button"
            onClick={copyInviteLink}
            className="px-3.5 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {copied ? <><Check size={14} className="text-emerald-500" /> Live Link Copied</> : <><Share2 size={14} /> Share Link</>}
          </button>
        </div>
      </div>

      <form onSubmit={handleBuddyJoin} className="rounded-2xl p-3.5 border space-y-2" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
          <UserPlus size={13} /> Quick RSVP, HCP & Outfit Lock
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          <input
            type="text"
            placeholder="Name"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            className="col-span-2 rounded-xl px-2 py-1.5 text-xs border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="number"
            placeholder="HCP"
            value={joinHcp}
            onChange={(e) => setJoinHcp(e.target.value)}
            className="col-span-1 rounded-xl px-1.5 py-1.5 text-xs font-mono border text-center"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            type="text"
            placeholder="Fit"
            value={joinFit}
            onChange={(e) => setJoinFit(e.target.value)}
            className="col-span-2 rounded-xl px-2 py-1.5 text-xs border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <button
            type="submit"
            className="col-span-1 rounded-xl text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            In
          </button>
        </div>
      </form>

      <div className="rounded-2xl p-4 border space-y-2.5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Shirt size={15} style={{ color: 'var(--accent-emerald)' }} /> Lineup, HCP & Outfit Check
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Low HCP: {baselineHcp}</span>
        </div>

        {players.map((p) => {
          const playingStrokes = Math.max(0, (Number(p.hcp) || 0) - baselineHcp);
          const netScore = p.score - playingStrokes;
          return (
            <div
              key={p.id}
              className="p-3 rounded-xl border flex items-center justify-between gap-2"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                  <span>{p.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    {p.tee} Tees
                  </span>
                  <label className="text-[10px] font-mono flex items-center gap-1" style={{ color: 'var(--accent-gold)' }}>
                    HCP
                    <input
                      type="number"
                      value={p.hcp}
                      onChange={(e) => updatePlayerHcp(p.id, e.target.value)}
                      className="w-10 rounded px-1 py-0.5 text-center border text-white bg-black/30"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    />
                  </label>
                </div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{p.fit}</div>
                <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--accent-emerald)' }}>
                  Gross {p.score} • Net {netScore} (-{playingStrokes} strokes)
                  {p.id === '1' && liveStats ? ` • GIR ${liveStats.girPct}% • FIR ${liveStats.firPct !== null ? `${liveStats.firPct}%` : 'N/A'} • ${liveStats.totalPutts} putts` : ''}
                </div>
              </div>

              <button
                onClick={() => cycleStatus(p.id)}
                className={`text-xs font-mono font-bold px-3 py-1 rounded-full shrink-0 ${
                  p.status === 'IN'
                    ? 'bg-emerald-700/20 text-emerald-500'
                    : p.status === 'MAYBE'
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'bg-red-500/20 text-red-400'
                }`}
              >
                {p.status}
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Trophy size={15} style={{ color: 'var(--accent-gold)' }} /> Skins & 19th-Hole Settlement
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>$/Skin:</span>
            <input
              type="number"
              value={skinValue}
              onChange={(e) => setSkinValue(Math.max(1, Number(e.target.value) || 1))}
              className="w-10 text-right font-mono font-bold rounded px-1.5 py-0.5 border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-2.5 rounded-xl border text-xs" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <span className="flex items-center gap-1.5 font-medium">
            <Receipt size={14} style={{ color: 'var(--accent-emerald)' }} /> 19th-Hole Tab ($ Total)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={clubhouseTab}
              onChange={(e) => setClubhouseTab(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 text-right font-mono font-bold rounded px-2 py-1 border"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            />
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              (${perPlayerTab}/ea)
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {activePlayers.map((p) => {
            const playingStrokes = Math.max(0, (Number(p.hcp) || 0) - baselineHcp);
            const netScore = p.score - playingStrokes;
            const skinNet = p.skins * skinValue * (activeCount - 1) - (totalSkins - p.skins) * skinValue;
            const totalSettlement = skinNet - perPlayerTab;
            return (
              <div key={p.id} className="flex items-center justify-between text-xs p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <div>
                  <div className="font-semibold">{p.name} <span className="font-mono text-[10px] opacity-75">(Net {netScore})</span></div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    Skins: {skinNet >= 0 ? `+$${skinNet}` : `-$${Math.abs(skinNet)}`} - Tab: -${perPlayerTab}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustSkins(p.id, -1)} className="w-6 h-6 rounded border font-bold" style={{ borderColor: 'var(--border-subtle)' }}>-</button>
                  <span className="font-mono w-10 text-center">{p.skins} sk</span>
                  <button onClick={() => adjustSkins(p.id, 1)} className="w-6 h-6 rounded border font-bold" style={{ borderColor: 'var(--border-subtle)' }}>+</button>
                  <span className={`font-mono font-bold w-13 text-right ${totalSettlement >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {totalSettlement >= 0 ? `+$${totalSettlement}` : `-$${Math.abs(totalSettlement)}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-emerald)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-emerald)' }}>
            <Award size={15} /> Post-Round Recap Card
          </span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>GROSS + NET + STATS</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Copy a clean summary of today&apos;s handicaps, gross/net scores, GIR%, FIR%, putts, skins, and 19th-hole split to drop straight into your foursome group chat.
        </p>
        <button
          type="button"
          onClick={shareRecapCard}
          className="w-full py-2.5 rounded-xl font-semibold text-xs text-white flex items-center justify-center gap-1.5"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          {recapCopied ? <><Check size={14} /> Recap Copied to Clipboard</> : <><Share2 size={14} /> Copy Round Recap for Group Chat</>}
        </button>
      </div>
    </div>
  );
}