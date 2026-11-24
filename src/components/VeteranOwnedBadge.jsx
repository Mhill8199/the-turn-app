import { ShieldCheck } from 'lucide-react';

export default function VeteranOwnedBadge({ compact = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wider ${compact ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1'}`}
      style={{
        borderColor: 'var(--accent-gold)',
        color: 'var(--accent-gold)',
        backgroundColor: 'var(--bg-elevated)',
      }}
      title="Solis Noir LLC is veteran-owned"
    >
      <ShieldCheck size={compact ? 11 : 13} />
      Veteran-Owned
    </span>
  );
}
