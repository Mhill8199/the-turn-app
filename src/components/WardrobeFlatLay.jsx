import React, { useState } from 'react';
import { Shirt, Sparkles, AlertTriangle, CheckCircle2, Sun } from 'lucide-react';

const WARDROBE_CATALOG = {
  hats: [
    { id: 'h1', name: 'Waddle White Penguin Hat', brand: 'Waddle', color: '#F8FAFC', accent: '#0F172A', style: 'Rope Cap', courseToStreet: true },
    { id: 'h2', name: 'Good Navy Rope Hat', brand: 'Good', color: '#1E3A8A', accent: '#F8FAFC', style: 'Rope Cap', courseToStreet: true },
    { id: 'h3', name: 'Tour Wide-Brim Sun Visor', brand: 'Tail', color: '#FEF3C7', accent: '#92400E', style: 'Visor (UPF 50+)', courseToStreet: true },
  ],
  tops: [
    { id: 't1', name: 'White Performance Polo', brand: 'TravisMathew', color: '#FFFFFF', accent: '#334155', style: 'Polo', courseToStreet: true },
    { id: 't2', name: 'Coastal Blue Tech Polo', brand: 'Peter Millar', color: '#0284C7', accent: '#E0F2FE', style: 'Polo', courseToStreet: true },
    { id: 't3', name: 'Sleeveless Mock-Neck + Sun Sleeves', brand: 'G/FORE', color: '#F43F5E', accent: '#FFE4E6', style: 'Women’s Top + UV Sleeves', courseToStreet: true },
    { id: 't4', name: 'Pleated Sleeveless Golf Dress', brand: 'Lululemon', color: '#065F46', accent: '#D1FAE5', style: 'One-Piece Golf Dress', courseToStreet: true },
  ],
  bottoms: [
    { id: 'b1', name: 'Charcoal Tour Tapered Pants', brand: 'Nike', color: '#334155', accent: '#94A3B8', style: 'Pants', courseToStreet: true },
    { id: 'b2', name: 'Obsidian Stretch Golf Pants', brand: 'Lululemon', color: '#09090B', accent: '#3F3F46', style: 'Pants', courseToStreet: true },
    { id: 'b3', name: 'High-Rise Pleated Performance Skort', brand: 'Greyson', color: '#F8FAFC', accent: '#CBD5E1', style: 'Women’s Skort', courseToStreet: true },
  ],
  belts: [
    { id: 'bl1', name: 'Braided White Web Belt', brand: 'Cuater', color: '#F8FAFC', accent: '#CBD5E1', style: 'Belt' },
    { id: 'bl2', name: 'Matte Black Leather Belt', brand: 'TravisMathew', color: '#18181B', accent: '#52525B', style: 'Belt' },
    { id: 'bl3', name: 'None (Golf Dress / Pull-On Skort)', brand: '—', color: 'transparent', accent: '#64748B', style: 'No Belt' },
  ],
  shoes: [
    { id: 's1', name: 'Grey Jordan Retro Low G', brand: 'Jordan', color: '#94A3B8', accent: '#1E293B', style: 'Spikeless', courseToStreet: true },
    { id: 's2', name: 'Grey Nike Air Zoom Infinity', brand: 'Nike', color: '#64748B', accent: '#F8FAFC', style: 'Spiked' },
    { id: 's3', name: 'White FootJoy Premiere Series', brand: 'FootJoy', color: '#FFFFFF', accent: '#0F172A', style: 'Tour Spiked' },
  ],
};

export default function WardrobeFlatLay({
  recentPartnerRounds = [
    { partner: 'Jason', date: 'Last Sunday', itemIds: ['h1', 't1', 'b2', 'bl2', 's3'] },
    { partner: 'Rylie', date: 'Last Sunday', itemIds: ['h2', 't2', 'b1', 'bl1', 's1'] },
  ],
  selectedPartners = ['Jason', 'Rylie', 'Ryan'],
  onLockOutfit,
}) {
  const [fit, setFit] = useState({
    hat: WARDROBE_CATALOG.hats[1],
    top: WARDROBE_CATALOG.tops[1],
    bottom: WARDROBE_CATALOG.bottoms[0],
    belt: WARDROBE_CATALOG.belts[0],
    shoes: WARDROBE_CATALOG.shoes[0],
  });
  const [locked, setLocked] = useState(false);

  const selectedIds = [fit.hat.id, fit.top.id, fit.bottom.id, fit.belt.id, fit.shoes.id];

  // Detect exact repeat ensemble with any currently selected playing partner
  const repeatWarning = recentPartnerRounds.find(
    (round) =>
      selectedPartners.includes(round.partner) &&
      round.itemIds.every((id) => selectedIds.includes(id))
  );

  const isCourseToStreetReady =
    fit.top.courseToStreet && fit.bottom.courseToStreet && (fit.shoes.courseToStreet || fit.hat.courseToStreet);

  const handleSelect = (slot, item) => {
    setLocked(false);
    setFit((prev) => ({ ...prev, [slot]: item }));
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-1.5">
            <Shirt size={16} className="text-emerald-400" /> Sunday Scripting Flat-Lay
          </h2>
          <p className="text-xs opacity-70">
            Playing with: <span className="font-semibold">{selectedPartners.join(', ')}</span>
          </p>
        </div>

        {isCourseToStreetReady && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <Sparkles size={11} /> Course-to-Street
          </span>
        )}
      </div>

      {/* Repeat Outfit Guardrail Alert */}
      {repeatWarning ? (
        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/60 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 text-amber-400 mt-0.5" />
          <div>
            <span className="font-bold">Outfit Repeat Alert:</span> You wore this exact combo with{' '}
            <span className="underline">{repeatWarning.partner}</span> ({repeatWarning.date}). Swap shoes, hat, or belt to keep the rotation fresh.
          </div>
        </div>
      ) : (
        <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>Fresh ensemble — zero repeats with today’s foursome.</span>
        </div>
      )}

      {/* Visual Flat-Lay Board */}
      <div className="relative rounded-3xl p-5 border border-zinc-700/80 bg-gradient-to-br from-zinc-900 via-zinc-950 to-emerald-950/40 shadow-xl">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-3 flex justify-between">
          <span>FLAT-LAY PREVIEW</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <Sun size={11} /> {fit.hat.style.includes('UPF') || fit.top.style.includes('UV') ? 'HIGH UV SHIELD' : 'STANDARD SUN'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 items-center text-center">
          {/* Top-Left: Hat / Visor */}
          <div className="p-3 rounded-2xl bg-black/50 border border-zinc-800 flex flex-col items-center">
            <div
              className="w-12 h-8 rounded-t-full border-2 mb-1.5 shadow"
              style={{ backgroundColor: fit.hat.color, borderColor: fit.hat.accent }}
            />
            <span className="text-[10px] font-bold text-zinc-200 leading-tight">{fit.hat.name}</span>
            <span className="text-[9px] text-zinc-400">{fit.hat.style}</span>
          </div>

          {/* Center: Top / Dress */}
          <div className="p-3.5 rounded-2xl bg-black/60 border border-emerald-500/40 flex flex-col items-center">
            <div
              className="w-16 h-16 rounded-xl border-2 mb-1.5 flex items-center justify-center shadow-md"
              style={{ backgroundColor: fit.top.color, borderColor: fit.top.accent }}
            >
              <Shirt size={24} style={{ color: fit.top.color === '#FFFFFF' ? '#0F172A' : '#FFFFFF' }} />
            </div>
            <span className="text-[11px] font-extrabold text-white leading-tight">{fit.top.name}</span>
            <span className="text-[9px] text-emerald-400">{fit.top.brand}</span>
          </div>

          {/* Top-Right: Belt */}
          <div className="p-3 rounded-2xl bg-black/50 border border-zinc-800 flex flex-col items-center">
            <div
              className="w-14 h-3 rounded-full border my-2.5"
              style={{
                backgroundColor: fit.belt.color === 'transparent' ? '#27272A' : fit.belt.color,
                borderColor: fit.belt.accent,
              }}
            />
            <span className="text-[10px] font-bold text-zinc-200 leading-tight">{fit.belt.name}</span>
            <span className="text-[9px] text-zinc-400">{fit.belt.style}</span>
          </div>

          {/* Bottom-Left: Pants / Skort */}
          <div className="col-span-2 p-3 rounded-2xl bg-black/50 border border-zinc-800 flex items-center gap-3 text-left">
            <div
              className="w-10 h-12 rounded-lg border-2 shrink-0"
              style={{ backgroundColor: fit.bottom.color, borderColor: fit.bottom.accent }}
            />
            <div>
              <div className="text-[11px] font-bold text-white">{fit.bottom.name}</div>
              <div className="text-[10px] text-zinc-400">{fit.bottom.brand} • {fit.bottom.style}</div>
            </div>
          </div>

          {/* Bottom-Right: Shoes */}
          <div className="p-3 rounded-2xl bg-black/50 border border-zinc-800 flex flex-col items-center">
            <div
              className="w-12 h-6 rounded-lg border-2 mb-1.5"
              style={{ backgroundColor: fit.shoes.color, borderColor: fit.shoes.accent }}
            />
            <span className="text-[10px] font-bold text-zinc-200 leading-tight">{fit.shoes.name}</span>
            <span className="text-[9px] text-zinc-400">{fit.shoes.style}</span>
          </div>
        </div>
      </div>

      {/* Category Selectors */}
      <div className="space-y-3">
        {Object.entries(WARDROBE_CATALOG).map(([slotKey, items]) => {
          const singularKey = slotKey === 'shoes' ? 'shoes' : slotKey.slice(0, -1);
          return (
            <div key={slotKey} className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">
                {slotKey}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {items.map((item) => {
                  const active = fit[singularKey]?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(singularKey, item)}
                      className={`px-3 py-2 rounded-xl border text-left shrink-0 transition ${
                        active
                          ? 'border-emerald-400 bg-emerald-950/50 text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.name}</div>
                      <div className="text-[10px] opacity-70">{item.brand} • {item.style}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lock Outfit CTA */}
      <button
        type="button"
        onClick={() => {
          setLocked(true);
          onLockOutfit?.(fit);
        }}
        className="w-full py-3.5 rounded-2xl font-extrabold text-sm bg-emerald-500 text-black uppercase tracking-wide shadow-lg"
      >
        {locked ? '✓ Outfit Locked for Round' : 'Lock Sunday Script'}
      </button>
    </div>
  );
}