import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, ShoppingBag, Upload } from 'lucide-react';
import { APPAREL_SLOTS, SHOPPABLE_APPAREL } from '../data/shoppableGolfApparel';
import { loadEncryptedPhoto, saveEncryptedPhoto } from '../utils/localPhotoVault';
import BaselinePhotoVaultModal from './BaselinePhotoVaultModal';

const EMPTY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function itemAt(catalogKey, index) {
  const items = SHOPPABLE_APPAREL[catalogKey];
  return items[index % items.length];
}

function ApparelOverlay({ item, fitOffset }) {
  const style = item.overlayStyle || {};
  const isDress = /dress/i.test(item.categoryTag || '');
  const isSkort = /skort/i.test(item.categoryTag || '');
  const isHat = item.slot === 'hat';
  const isShoes = item.slot === 'shoes';

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        top: style.top,
        left: style.left,
        width: style.width,
        height: isDress ? '54%' : style.height,
        transform: `translateY(${fitOffset}px)`,
      }}
    >
      {isHat && (
        <div className="w-full h-full relative">
          <div className="absolute left-[18%] right-[18%] top-0 h-[70%] rounded-t-full border-2" style={{ backgroundColor: item.colorHex, borderColor: item.accentHex }} />
          <div className="absolute left-0 right-0 bottom-0 h-[38%] rounded-full" style={{ backgroundColor: item.colorHex, boxShadow: `0 0 0 2px ${item.accentHex}` }} />
        </div>
      )}
      {item.slot === 'top' && (
        <div className="w-full h-full rounded-b-3xl border-2" style={{ backgroundColor: item.colorHex, borderColor: item.accentHex, opacity: 0.92 }} />
      )}
      {item.slot === 'bottom' && (
        <div
          className="w-full h-full border-2"
          style={{
            backgroundColor: item.colorHex,
            borderColor: item.accentHex,
            borderRadius: isSkort ? '12px 12px 40% 40%' : '10px',
            opacity: 0.92,
          }}
        />
      )}
      {isShoes && (
        <div className="w-full h-full flex items-end justify-between px-1">
          <div className="w-[42%] h-[80%] rounded-full border-2" style={{ backgroundColor: item.colorHex, borderColor: item.accentHex }} />
          <div className="w-[42%] h-[80%] rounded-full border-2" style={{ backgroundColor: item.colorHex, borderColor: item.accentHex }} />
        </div>
      )}
    </div>
  );
}

function Silhouette() {
  return (
    <svg viewBox="0 0 200 420" className="absolute inset-0 w-full h-full" aria-hidden="true">
      <ellipse cx="100" cy="42" rx="28" ry="32" fill="#3F3F46" />
      <rect x="78" y="72" width="44" height="22" rx="10" fill="#3F3F46" />
      <path d="M58 110 Q100 96 142 110 L156 210 Q100 228 44 210 Z" fill="#52525B" />
      <path d="M62 208 L78 360 L92 360 L100 240 L108 360 L122 360 L138 208 Z" fill="#3F3F46" />
      <ellipse cx="74" cy="386" rx="22" ry="10" fill="#27272A" />
      <ellipse cx="126" cy="386" rx="22" ry="10" fill="#27272A" />
    </svg>
  );
}

export default function VirtualTryOnStudio() {
  const [baseline, setBaseline] = useState(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState('hat');
  const [indexes, setIndexes] = useState({ hat: 0, top: 0, bottom: 0, shoes: 0 });
  const [fitOffset, setFitOffset] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const touchX = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadEncryptedPhoto('baseline-full-body').then((dataUrl) => {
      if (!cancelled) setBaseline(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selection = {
    hat: itemAt('hats', indexes.hat),
    top: itemAt('tops', indexes.top),
    bottom: itemAt('bottoms', indexes.bottom),
    shoes: itemAt('shoes', indexes.shoes),
  };
  const dressOn = /dress/i.test(selection.top.categoryTag || '');
  const activeMeta = APPAREL_SLOTS.find((slot) => slot.id === activeSlot);
  const activeItem = selection[activeSlot];

  const step = (direction) => {
    setIndexes((prev) => {
      const key = activeMeta.catalogKey;
      const count = SHOPPABLE_APPAREL[key].length;
      const next = (prev[activeSlot] + direction + count) % count;
      return { ...prev, [activeSlot]: next };
    });
  };

  const saveLook = async () => {
    setSaving(true);
    setStatus('');
    try {
      const metadata = {
        kind: 'saved-look',
        fitOffset,
        items: {
          hat: selection.hat.id,
          top: selection.top.id,
          bottom: dressOn ? null : selection.bottom.id,
          shoes: selection.shoes.id,
        },
      };
      await saveEncryptedPhoto(`saved-look-${Date.now()}`, baseline || EMPTY_PIXEL, metadata);
      setStatus('Look saved in the encrypted vault.');
    } catch (err) {
      setStatus(err?.message || 'Could not save this look.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <Lock size={12} /> On-device vault
        </span>
        <button
          type="button"
          onClick={() => setVaultOpen(true)}
          className="min-h-[44px] text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <Upload size={12} /> {baseline ? 'Update Baseline' : 'Add Baseline Photo'}
        </button>
      </div>
      {!baseline && (
        <div className="rounded-3xl border px-3 py-3" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            No baseline photo in the vault yet. Add one to try clothes on your photo.
          </p>
        </div>
      )}

      <div
        className="relative mx-auto w-full max-w-[260px] aspect-[3/5] rounded-3xl overflow-hidden border touch-pan-y"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#18181B' }}
        onTouchStart={(event) => {
          touchX.current = event.changedTouches[0].clientX;
        }}
        onTouchEnd={(event) => {
          if (touchX.current == null) return;
          const delta = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (delta > 40) step(-1);
          else if (delta < -40) step(1);
        }}
      >
        {baseline ? (
          <img src={baseline} alt="Your encrypted baseline" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <Silhouette />
        )}
        <ApparelOverlay item={selection.hat} fitOffset={fitOffset} />
        <ApparelOverlay item={selection.top} fitOffset={fitOffset} />
        {!dressOn && <ApparelOverlay item={selection.bottom} fitOffset={fitOffset} />}
        <ApparelOverlay item={selection.shoes} fitOffset={fitOffset} />
      </div>

      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{activeMeta.label}</div>
        <div className="text-sm font-bold">{activeItem.name}</div>
        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{activeItem.brand} • {activeItem.price}</div>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        {APPAREL_SLOTS.map((slot) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => setActiveSlot(slot.id)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border"
            style={{
              borderColor: activeSlot === slot.id ? 'var(--accent-emerald)' : 'var(--border-subtle)',
              backgroundColor: activeSlot === slot.id ? 'var(--bg-elevated)' : 'transparent',
            }}
          >
            {slot.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        <button type="button" onClick={() => step(-1)} className="p-2 rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Previous item">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Swipe the figure or use Prev / Next</span>
        <button type="button" onClick={() => step(1)} className="p-2 rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Next item">
          <ChevronRight size={16} />
        </button>
      </div>

      <label className="block text-[11px] font-semibold space-y-1" style={{ color: 'var(--text-secondary)' }}>
        <span className="flex justify-between"><span>Fit Offset</span><span>{fitOffset}px</span></span>
        <input
          type="range"
          min={-48}
          max={48}
          value={fitOffset}
          onChange={(event) => setFitOffset(Number(event.target.value))}
          className="w-full"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShopOpen((open) => !open)}
          className="flex-1 py-2.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <ShoppingBag size={14} /> Shop the Look
        </button>
        <button
          type="button"
          onClick={saveLook}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          {saving ? 'Saving…' : 'Save Look to Encrypted Vault'}
        </button>
      </div>

      {shopOpen && (
        <div className="rounded-2xl border p-3 space-y-2" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          {[selection.hat, selection.top, dressOn ? null : selection.bottom, selection.shoes].filter(Boolean).map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-2 text-xs">
              <div>
                <div className="font-semibold">{item.name}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{item.brand} • {item.price}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--border-subtle)' }}>{item.categoryTag}</span>
                  {item.courseToStreet && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent-emerald-fill)', color: '#0B0D0C' }}>
                      Course-to-Street
                    </span>
                  )}
                </div>
              </div>
              <a
                href={item.shopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-semibold underline"
                style={{ color: 'var(--accent-emerald)' }}
              >
                Shop Brand
              </a>
            </div>
          ))}
        </div>
      )}

      {status && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{status}</p>}

      {vaultOpen && (
        <BaselinePhotoVaultModal
          onClose={() => setVaultOpen(false)}
          onPhotoSaved={(dataUrl) => setBaseline(dataUrl)}
        />
      )}
    </div>
  );
}
