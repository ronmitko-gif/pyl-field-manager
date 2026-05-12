'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { ClaimForm } from './claim-form';

const TZ = 'America/New_York';

type Slot = { id: string; start_at: string; end_at: string; capacity: number };
type Signup = { id: string; name: string };

function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function SlotRow({ slot, signups }: { slot: Slot; signups: Signup[] }) {
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  const start = formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a');
  const end = formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a');

  return (
    <article className="rounded border border-tj-black/10 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{start} – {end}</h3>
        <span className="text-xs opacity-60">{signups.length}/{slot.capacity}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: slot.capacity }).map((_, i) => {
          const s = signups[i];
          if (s) {
            return (
              <div key={s.id} className="rounded border border-tj-black/10 bg-tj-cream px-3 py-2 text-sm">
                {shortenName(s.name)}
              </div>
            );
          }
          return (
            <button
              key={`open-${i}`}
              onClick={() => setModalOpen(true)}
              className="rounded border border-dashed border-tj-gold bg-white px-3 py-2 text-sm text-tj-black hover:bg-tj-gold-soft"
            >
              Claim →
            </button>
          );
        })}
      </div>
      {modalOpen && (
        <ClaimForm
          slotId={slot.id}
          onClose={() => setModalOpen(false)}
          onClaimed={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </article>
  );
}
