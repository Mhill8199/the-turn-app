import { useState } from 'react';
import { X, Upload, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';

const SWATCH_PRESETS = [
  { name: 'Pure White', hex: '#F8F8F6' },
  { name: 'Heather Grey', hex: '#8E9399' },
  { name: 'Obsidian Black', hex: '#16181A' },
  { name: 'Tour Navy', hex: '#1B2A4A' },
  { name: 'Stone Khaki', hex: '#D6CFC2' },
  { name: 'Augusta Green', hex: '#1E6B4B' },
  { name: 'Sky Blue', hex: '#5B9BD5' },
  { name: 'Coral / Tropic', hex: '#E06D53' },
];

export default function AddClosetModal({ userId, isPro, currentCount, onClose, onSaved, onTriggerPaywall }) {
  const [category, setCategory] = useState('top');
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#1B2A4A');
  const [vibe, setVibe] = useState('classic');
  const [weather, setWeather] = useState('all');
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!isPro && currentCount >= 20) {
      onTriggerPaywall('Unlimited Closet Items (20-Item Clubhouse Cap Reached)');
      return;
    }

    setSaving(true);
    let imageUrl = null;

    if (photoFile && isPro && userId) {
      const fileExt = photoFile.name.split('.').pop();
      const filePath = `${userId}/${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await supabase.storage
        .from('wardrobe-photos')
        .upload(filePath, photoFile);

      if (!uploadErr) {
        const { data } = supabase.storage.from('wardrobe-photos').getPublicUrl(filePath);
        imageUrl = data.publicUrl;
      }
    }

    const newItem = {
      user_id: userId,
      category,
      brand: brand.trim() || 'Custom',
      name: name.trim(),
      primary_color_hex: hex,
      vibe_tag: vibe,
      weather_tag: weather,
      image_url: imageUrl,
    };

    if (userId) {
      const { data, error } = await supabase.from('wardrobe_items').insert(newItem).select().single();
      if (!error && data) {
        onSaved({
          id: data.id,
          category: data.category,
          brand: data.brand,
          name: data.name,
          hex: data.primary_color_hex,
          vibe: data.vibe_tag,
          weather: data.weather_tag,
          lastWornDays: 99,
          imageUrl: data.image_url,
        });
      }
    } else {
      onSaved({
        id: crypto.randomUUID(),
        category,
        brand: brand.trim() || 'Custom',
        name: name.trim(),
        hex,
        vibe,
        weather,
        lastWornDays: 99,
        imageUrl,
      });
    }

    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-end sm:items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        className="w-full max-w-md rounded-2xl p-5 border space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Add to Closet ({currentCount}/{isPro ? '∞' : '20'})</h3>
          <button type="button" onClick={onClose} className="p-1 opacity-75 hover:opacity-100"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <option value="top">Polo / Top</option>
              <option value="bottom">Pants / Shorts</option>
              <option value="layer">Quarter-Zip / Vest</option>
              <option value="shoes">Golf Shoes</option>
              <option value="hat">Hat / Visor</option>
              <option value="belt">Belt</option>
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Brand</label>
            <input
              type="text"
              placeholder="e.g., TravisMathew, Waddle"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>Item Name</label>
          <input
            type="text"
            required
            placeholder="e.g., Navy Performance Polo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm border"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
          />
        </div>

        <div>
          <label className="text-xs block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Color Swatch (No-Pictures Mode)</label>
          <div className="flex flex-wrap gap-2">
            {SWATCH_PRESETS.map((s) => (
              <button
                key={s.hex}
                type="button"
                onClick={() => setHex(s.hex)}
                title={s.name}
                className={`w-7 h-7 rounded-full border-2 transition ${hex === s.hex ? 'scale-110 border-emerald-500' : 'border-transparent'}`}
                style={{ backgroundColor: s.hex }}
              />
            ))}
          </div>
        </div>

        <div
          onClick={() => !isPro && onTriggerPaywall('Pictures Mode Flat-Lay Uploads')}
          className="p-3 rounded-xl border border-dashed flex items-center justify-between cursor-pointer"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center gap-2 text-xs">
            <Upload size={15} />
            <span>{photoFile ? photoFile.name : 'Upload Flat-Lay Photo (Optional)'}</span>
          </div>
          {!isPro ? (
            <span className="text-[11px] font-semibold text-amber-500 flex items-center gap-1"><Lock size={12} /> Tour Pro</span>
          ) : (
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              className="text-xs w-28"
            />
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-xl font-semibold text-sm text-white"
          style={{ backgroundColor: 'var(--accent-emerald)' }}
        >
          {saving ? 'Saving...' : 'Save to Closet'}
        </button>
      </form>
    </div>
  );
}
