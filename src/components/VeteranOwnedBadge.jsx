import { ShieldCheck } from 'lucide-react';

const CHARCOAL = '#0B0D0C';
const EMERALD = '#10B981';
const GOLD = '#D4AF37';

export default function VeteranOwnedBadge({ compact = false }) {
  const shield = (
    <ShieldCheck
      size={compact ? 14 : 22}
      strokeWidth={2}
      aria-hidden="true"
      className="shrink-0"
      style={{ color: EMERALD }}
    />
  );

  if (compact) {
    return (
      <span
        className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full border px-2 py-1 text-[10px] font-semibold leading-tight tracking-wide"
        style={{
          borderColor: GOLD,
          color: GOLD,
          backgroundColor: CHARCOAL,
        }}
        title="Solis Noir LLC is a veteran-owned business"
      >
        {shield}
        <span>Veteran-Owned Business</span>
        <span className="font-medium">(Solis Noir LLC)</span>
        <span
          className="rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wider"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          VET OWNED
        </span>
      </span>
    );
  }

  return (
    <div
      className="flex w-full items-center gap-3 rounded-3xl border px-4 py-3.5"
      style={{
        borderColor: GOLD,
        color: GOLD,
        backgroundColor: CHARCOAL,
      }}
      role="note"
      aria-label="Veteran-Owned Business, Solis Noir LLC, VET OWNED"
    >
      {shield}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight tracking-wide">
          Veteran-Owned Business
        </div>
        <div className="mt-0.5 text-xs font-medium leading-tight tracking-wide">
          Solis Noir LLC
        </div>
      </div>
      <span
        className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest"
        style={{ borderColor: GOLD, color: GOLD }}
      >
        VET OWNED
      </span>
    </div>
  );
}
