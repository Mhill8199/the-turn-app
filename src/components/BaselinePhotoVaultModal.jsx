import { useEffect, useState } from 'react';
import { Camera, Lock, Trash2, X } from 'lucide-react';
import { loadEncryptedPhoto, saveEncryptedPhoto, wipePhotoVault } from '../utils/localPhotoVault';

const BASELINE_SLOT = 'baseline-full-body';

const ZONES = [
  { label: 'Head / Hat', height: '16%' },
  { label: 'Torso / Polo', height: '26%' },
  { label: 'Waist / Skort-Pant', height: '32%' },
  { label: 'Footwear', height: '26%' },
];

export default function BaselinePhotoVaultModal({ onClose, onPhotoSaved }) {
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadEncryptedPhoto(BASELINE_SLOT).then((dataUrl) => {
      if (!cancelled && dataUrl) setPreview(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      setPreview(dataUrl);
      setBusy(true);
      setStatus('');
      try {
        await saveEncryptedPhoto(BASELINE_SLOT, dataUrl, { kind: 'baseline-full-body', fileName: file.name });
        onPhotoSaved?.(dataUrl);
        setStatus('Baseline saved in the on-device vault.');
      } catch (err) {
        setStatus(err?.message || 'Could not encrypt this photo.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const wipe = async () => {
    setBusy(true);
    setStatus('');
    try {
      await wipePhotoVault();
      setPreview('');
      onPhotoSaved?.(null);
      setStatus('Local vault wiped. Nothing remains on this device.');
    } catch (err) {
      setStatus(err?.message || 'Could not wipe the vault.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center p-4">
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl p-4 border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">Baseline Photo Vault</span>
          <button type="button" onClick={onClose} aria-label="Close baseline vault" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >
          <Lock size={12} /> 100% On-Device AES-256 Encrypted • Never Uploaded to Cloud
        </div>

        <div className="relative mx-auto w-full max-w-[240px] aspect-[3/5] rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#0B0D0C' }}>
          {preview ? (
            <img src={preview} alt="Decrypted full-body baseline" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400 px-4 text-center">
              Capture or upload a head-to-toe photo. It stays encrypted on this device.
            </div>
          )}
          <div className="absolute inset-0 flex flex-col pointer-events-none">
            {ZONES.map((zone) => (
              <div
                key={zone.label}
                className="border-b border-white/40 flex items-start justify-center"
                style={{ height: zone.height }}
              >
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white bg-black/50 px-2 py-0.5 rounded-full">
                  {zone.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <label
          className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 cursor-pointer"
          style={{ backgroundColor: 'var(--accent-emerald)', opacity: busy ? 0.6 : 1 }}
        >
          <Camera size={16} /> {preview ? 'Replace Baseline Photo' : 'Capture or Upload Baseline'}
          <input
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            disabled={busy}
            onChange={onFile}
          />
        </label>

        <button
          type="button"
          onClick={wipe}
          disabled={busy}
          className="w-full py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Trash2 size={14} /> Wipe Local Vault
        </button>

        {status && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{status}</p>}
      </div>
    </div>
  );
}
