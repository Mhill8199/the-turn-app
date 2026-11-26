import { useState, useEffect } from 'react';
import { Sparkles, Sliders, Image, Palette, Lock, RefreshCw, Check, Plus, Luggage } from 'lucide-react';
import AddClosetModal from '../components/AddClosetModal';
import WardrobeFlatLay from '../components/WardrobeFlatLay';
import VirtualTryOnStudio from '../components/VirtualTryOnStudio';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const INITIAL_CLOSET = [
  { id: '1', category: 'top', brand: 'TravisMathew', name: 'White Performance Polo', hex: '#F4F4F2', vibe: 'classic', weather: 'warm', lastWornDays: 1, imageUrl: null },
  { id: '2', category: 'top', brand: 'Peter Millar', name: 'Deep Navy Polo', hex: '#1B2A4A', vibe: 'classic', weather: 'all', lastWornDays: 6, imageUrl: null },
  { id: '3', category: 'top', brand: 'Bad Birdie', name: 'Tropicana Print Polo', hex: '#2E8B75', vibe: 'resort', weather: 'hot', lastWornDays: 9, imageUrl: null },
  { id: '4', category: 'bottom', brand: 'Lululemon', name: 'Obsidian Golf Pants', hex: '#1A1D20', vibe: 'classic', weather: 'cool', lastWornDays: 5, imageUrl: null },
  { id: '5', category: 'bottom', brand: 'Bonobos', name: 'Stone Chino Shorts', hex: '#D6CFC2', vibe: 'resort', weather: 'hot', lastWornDays: 8, imageUrl: null },
  { id: '6', category: 'shoes', brand: 'FootJoy', name: 'Premiere White', hex: '#FFFFFF', vibe: 'classic', weather: 'all', lastWornDays: 5, imageUrl: null },
  { id: '7', category: 'shoes', brand: 'Jordan', name: 'Low Grey/White', hex: '#8E9399', vibe: 'bold', weather: 'all', lastWornDays: 7, imageUrl: null },
  { id: '8', category: 'hat', brand: 'Waddle', name: 'White Penguin Rope Hat', hex: '#F9F9F7', vibe: 'resort', weather: 'all', lastWornDays: 6, imageUrl: null },
];

export default function PrepWardrobe({ isPro = false, onOpenPaywall }) {
  const { user } = useAuth();
  const [closet, setCloset] = useState(INITIAL_CLOSET);
  const [mode, setMode] = useState('easy');
  const [visualMode, setVisualMode] = useState('no-pics');
  const [weather, setWeather] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('the-turn-fit-prefs') || '{}').weather || 'warm';
    } catch {
      return 'warm';
    }
  });
  const [vibe, setVibe] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('the-turn-fit-prefs') || '{}').vibe || 'classic';
    } catch {
      return 'classic';
    }
  });
  const [lockedIn, setLockedIn] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [prepSurface, setPrepSurface] = useState('wardrobe');

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('wardrobe_items')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setCloset(
            data.map((row) => {
              const daysAgo = row.last_worn_at
                ? Math.floor((Date.now() - new Date(row.last_worn_at).getTime()) / (1000 * 60 * 60 * 24))
                : 99;
              return {
                id: row.id,
                category: row.category,
                brand: row.brand || 'Custom',
                name: row.name,
                hex: row.primary_color_hex,
                vibe: row.vibe_tag || 'classic',
                weather: row.weather_tag || 'all',
                lastWornDays: daysAgo,
                imageUrl: row.image_url,
              };
            })
          );
        }
      });
  }, [user?.id]);

  const handleModeSwitch = (targetMode) => {
    if (targetMode === 'hard' && !isPro) {
      onOpenPaywall('Hard Mode ("Tour Stylist") & 3-Day Trip Packer');
      return;
    }
    setMode(targetMode);
  };

  const handleVisualSwitch = (targetVisual) => {
    if (targetVisual === 'pics' && !isPro) {
      onOpenPaywall('Pictures Mode (AI Flat-Lay Closet)');
      return;
    }
    setVisualMode(targetVisual);
  };

  const freshItems = closet.filter((item) => item.lastWornDays >= 3);
  const pickedTop = freshItems.find((i) => i.category === 'top' && (i.vibe === vibe || i.weather === weather)) || freshItems.find((i) => i.category === 'top');
  const pickedBottom = freshItems.find((i) => i.category === 'bottom');
  const pickedShoes = freshItems.find((i) => i.category === 'shoes');
  const pickedHat = freshItems.find((i) => i.category === 'hat');

  const activeOutfit = [pickedTop, pickedBottom, pickedShoes, pickedHat].filter(Boolean);

  const handleLockOutfit = async () => {
    setLockedIn(true);
    const summary = activeOutfit.slice(0, 3).map((i) => i.name).join(' • ');
    if (summary) {
      localStorage.setItem('the-turn-locked-fit', summary);
    }
    if (user?.id && activeOutfit.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const ids = activeOutfit.map((i) => i.id);
      await supabase.from('wardrobe_items').update({ last_worn_at: today }).in('id', ids);
    }
  };

  const tripTops = closet.filter((i) => i.category === 'top').slice(0, 3);
  const tripBottoms = closet.filter((i) => i.category === 'bottom').slice(0, 2);
  const tripShoes = closet.filter((i) => i.category === 'shoes').slice(0, 2);

  return (
    <div className="space-y-4 pb-24">
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Prep mode">
        <button
          type="button"
          role="tab"
          aria-selected={prepSurface === 'wardrobe'}
          onClick={() => setPrepSurface('wardrobe')}
          className={`min-h-[44px] rounded-xl text-sm font-semibold border ${
            prepSurface === 'wardrobe' ? 'bg-emerald-700 text-white border-emerald-700' : ''
          }`}
          style={prepSurface !== 'wardrobe' ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
        >
          Wardrobe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={prepSurface === 'try-on'}
          onClick={() => setPrepSurface('try-on')}
          className={`min-h-[44px] rounded-xl text-sm font-semibold border ${
            prepSurface === 'try-on' ? 'bg-emerald-700 text-white border-emerald-700' : ''
          }`}
          style={prepSurface !== 'try-on' ? { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' } : {}}
        >
          Try-On
        </button>
      </div>

      {prepSurface === 'try-on' ? (
        <VirtualTryOnStudio />
      ) : (
      <>
      <div className="rounded-3xl p-4 border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          <span>Pre-Round Prep • Sat 7:00 AM</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--accent-emerald)' }}>56°F → 74°F</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <h2 className="text-lg font-semibold">Wardrobe & Layering</h2>
          <button
            onClick={() => setAddModalOpen(true)}
            className="min-h-[44px] text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            <Plus size={13} /> Add Piece
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex rounded-xl p-1 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => handleModeSwitch('easy')}
            className={`flex-1 min-h-[44px] py-2 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition ${
              mode === 'easy' ? 'bg-emerald-700 text-white shadow-sm' : ''
            }`}
          >
            <Sparkles size={14} /> Easy
          </button>
          <button
            onClick={() => handleModeSwitch('hard')}
            className={`flex-1 min-h-[44px] py-2 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition ${
              mode === 'hard' ? 'bg-emerald-700 text-white shadow-sm' : ''
            }`}
          >
            <Sliders size={14} /> Hard {!isPro && <Lock size={11} className="opacity-75" />}
          </button>
        </div>

        <div className="flex rounded-xl p-1 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => handleVisualSwitch('no-pics')}
            className={`flex-1 min-h-[44px] py-2 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition ${
              visualMode === 'no-pics' ? 'bg-emerald-700 text-white shadow-sm' : ''
            }`}
          >
            <Palette size={14} /> Swatches
          </button>
          <button
            onClick={() => handleVisualSwitch('pics')}
            className={`flex-1 min-h-[44px] py-2 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition ${
              visualMode === 'pics' ? 'bg-emerald-700 text-white shadow-sm' : ''
            }`}
          >
            <Image size={14} /> Photos {!isPro && <Lock size={11} className="opacity-75" />}
          </button>
        </div>
      </div>

      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Weather</span>
          <div className="flex gap-1.5">
            {['cool', 'warm', 'hot'].map((w) => (
              <button
                key={w}
                onClick={() => { setWeather(w); setLockedIn(false); }}
                className={`min-h-[44px] px-3 py-1 rounded-full text-xs capitalize border ${
                  weather === w ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={weather !== w ? { borderColor: 'var(--border-subtle)' } : {}}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Vibe</span>
          <div className="flex gap-1.5">
            {['classic', 'resort', 'bold'].map((v) => (
              <button
                key={v}
                onClick={() => { setVibe(v); setLockedIn(false); }}
                className={`min-h-[44px] px-3 py-1 rounded-full text-xs capitalize border ${
                  vibe === v ? 'bg-emerald-700 text-white border-emerald-700' : ''
                }`}
                style={vibe !== v ? { borderColor: 'var(--border-subtle)' } : {}}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">Recommended Lineup</h3>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Syncs to Foursome</span>
        </div>

        <div className="space-y-2.5">
          {closet.length === 0 && (
            <div className="rounded-3xl border px-3 py-3" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Your closet is empty. Add a piece to build a lineup.
              </p>
            </div>
          )}
          {closet.length > 0 && activeOutfit.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No pieces match this weather and vibe yet. Add a piece to fill the lineup.
            </p>
          )}
          {activeOutfit.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-xl border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-3">
                {visualMode === 'pics' && item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="w-10 h-10 rounded-lg object-cover border" style={{ borderColor: 'var(--border-subtle)' }} />
                ) : (
                  <div
                    className="w-9 h-9 rounded-lg border shadow-inner shrink-0"
                    style={{ backgroundColor: item.hex, borderColor: 'var(--border-subtle)' }}
                  />
                )}
                <div>
                  <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {item.category} • {item.brand}
                  </div>
                  <div className="text-sm font-medium">{item.name}</div>
                </div>
              </div>
              <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                {item.lastWornDays >= 90 ? 'New' : `${item.lastWornDays}d ago`}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleLockOutfit}
            className="flex-1 py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition"
            style={{ backgroundColor: 'var(--accent-emerald)' }}
          >
            {lockedIn ? <><Check size={16} /> Fit Locked & Synced to Crew</> : 'Lock In This Fit'}
          </button>
          <button
            onClick={() => setLockedIn(false)}
            className="px-4 py-3 rounded-xl border flex items-center justify-center"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
            aria-label="Shuffle Outfit"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {mode === 'hard' && isPro && (
        <div className="rounded-3xl p-4 border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--accent-gold)' }}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
            <Luggage size={15} /> Tour Stylist • 3-Day Golf Trip Capsule
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            3 Tops × 2 Bottoms × 2 Pairs of Shoes = 6 non-repeating course combinations in one carry-on.
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="font-semibold mb-1">3 Polos</div>
              {tripTops.map((t) => <div key={t.id} className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>• {t.name}</div>)}
            </div>
            <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="font-semibold mb-1">2 Bottoms</div>
              {tripBottoms.map((b) => <div key={b.id} className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>• {b.name}</div>)}
            </div>
            <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div className="font-semibold mb-1">2 Shoes</div>
              {tripShoes.map((s) => <div key={s.id} className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>• {s.name}</div>)}
            </div>
          </div>
        </div>
      )}

      {addModalOpen && (
        <AddClosetModal
          userId={user?.id}
          isPro={isPro}
          currentCount={closet.length}
          onClose={() => setAddModalOpen(false)}
          onSaved={(newItem) => setCloset((prev) => [newItem, ...prev])}
          onTriggerPaywall={(feat) => { setAddModalOpen(false); onOpenPaywall(feat); }}
        />
      )}
      <WardrobeFlatLay onLockOutfit={handleLockOutfit} />
      </>
      )}
    </div>
  );
}
