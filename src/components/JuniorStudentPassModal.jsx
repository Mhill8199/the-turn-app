import { useState } from 'react';
import { Check, GraduationCap, X } from 'lucide-react';

const PASSES = [
  {
    id: 'junior',
    title: 'Junior Pass',
    price: '$49.99',
    detail: '17 and under • one Tour Pro seat',
    note: 'A parent or guardian confirms age at checkout.',
  },
  {
    id: 'student',
    title: 'Student Pass',
    price: '$69.99',
    detail: 'Current student • one Tour Pro seat',
    note: 'Use a school email so the pass can be verified.',
  },
];

function makeAdultVoucherCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `TURN-${suffix}`;
}

export default function JuniorStudentPassModal({
  open: openProp,
  onClose,
  onSelectPass,
  onUnlockStudentPro,
}) {
  const currentYear = new Date().getFullYear();
  const graduationYears = [0, 1, 2, 3, 4].map((offset) => currentYear + offset);
  const [internalOpen, setInternalOpen] = useState(false);
  const [selected, setSelected] = useState('junior');
  const [graduationYear, setGraduationYear] = useState(currentYear);
  const unlockMode = typeof onUnlockStudentPro === 'function';
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : unlockMode ? true : internalOpen;

  const close = () => {
    if (controlled || unlockMode) onClose?.();
    else setInternalOpen(false);
  };

  const claim = () => {
    const pass = PASSES.find((p) => p.id === selected);
    if (unlockMode) {
      const verifiedAtDate = new Date();
      const expiresAtDate = new Date(verifiedAtDate.getTime());
      expiresAtDate.setFullYear(expiresAtDate.getFullYear() + 4);
      onUnlockStudentPro({
        verified: true,
        verifiedAt: verifiedAtDate.toISOString(),
        expiresAt: expiresAtDate.toISOString(),
        maxRenewals: 4,
        graduationYear,
        id: pass.id,
        title: pass.title,
        price: pass.price,
        adultVoucherCode: makeAdultVoucherCode(),
      });
      onClose?.();
      return;
    }
    onSelectPass?.(pass);
    close();
  };

  return (
    <>
      {!unlockMode && !controlled && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          className="w-full text-left rounded-2xl border p-4 flex items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <span>
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
              <GraduationCap size={14} /> Junior & Student
            </span>
            <span className="block font-bold mt-1">Verified Tour Pro passes</span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              $49.99 junior • $69.99 student, billed yearly
            </span>
          </span>
          <span className="text-xs font-semibold px-3 py-2 rounded-xl text-white shrink-0" style={{ backgroundColor: 'var(--accent-emerald)' }}>
            View
          </span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-5 border space-y-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
                <GraduationCap size={16} /> Junior & Student Pass
              </div>
              <button type="button" onClick={close} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Same Tour Pro bag, course, and wearable tools. These seats are priced for juniors and students and stay on a yearly plan.
            </p>
            <div className="space-y-2">
              {PASSES.map((pass) => {
                const active = selected === pass.id;
                return (
                  <button
                    key={pass.id}
                    type="button"
                    onClick={() => setSelected(pass.id)}
                    className="w-full text-left p-3.5 rounded-xl border"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: active ? 'var(--accent-emerald)' : 'var(--border-subtle)',
                      borderWidth: active ? '2px' : '1px',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-sm">{pass.title}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{pass.detail}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold">{pass.price}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>per year</div>
                      </div>
                    </div>
                    <div className="text-[11px] mt-2" style={{ color: 'var(--text-secondary)' }}>{pass.note}</div>
                  </button>
                );
              })}
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Graduation Year</span>
              <select
                value={graduationYear}
                onChange={(event) => setGraduationYear(Number(event.target.value))}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {graduationYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              4-year maximum eligibility (4 annual renewals) from initial verification; transitions to standard Adult Tour Pro ($119.99/yr) after Year 4.
            </p>
            <button
              type="button"
              onClick={claim}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'var(--accent-emerald)' }}
            >
              <Check size={16} /> Continue with {PASSES.find((p) => p.id === selected)?.title}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
