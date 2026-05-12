import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatInTimeZone } from 'date-fns-tz';

export const dynamic = 'force-dynamic';
const TZ = 'America/New_York';

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: signup } = await admin
    .from('concession_signups')
    .select('id, volunteer_name, volunteer_email, cancelled_at, slot_id')
    .eq('cancel_token', token)
    .maybeSingle();

  if (!signup) {
    return (
      <main className="min-h-screen bg-tj-cream p-8">
        <div className="mx-auto max-w-md rounded border border-tj-black/10 bg-white p-6 text-sm">
          <p>This cancellation link is no longer valid.</p>
          <p className="mt-3"><Link href="/concessions" className="underline">Back to concessions</Link></p>
        </div>
      </main>
    );
  }

  if (!signup.cancelled_at) {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fields.poweryourleague.com';
    await fetch(`${base}/api/concessions/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
  }

  const { data: slot } = await admin
    .from('concession_slots')
    .select('start_at, end_at')
    .eq('id', signup.slot_id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-tj-cream p-8">
      <div className="mx-auto max-w-md rounded border border-tj-black/10 bg-white p-6 text-sm">
        <h1 className="text-base font-semibold">Cancellation confirmed</h1>
        <p className="mt-2 opacity-80">
          {signup.volunteer_name}, your shift has been cancelled.
        </p>
        {slot && (
          <p className="mt-2 text-xs opacity-70">
            {formatInTimeZone(new Date(slot.start_at), TZ, 'EEEE, MMM d')} ·{' '}
            {formatInTimeZone(new Date(slot.start_at), TZ, 'h:mm a')} –{' '}
            {formatInTimeZone(new Date(slot.end_at), TZ, 'h:mm a')}
          </p>
        )}
        <p className="mt-4"><Link href="/concessions" className="underline">Sign up for another shift</Link></p>
      </div>
    </main>
  );
}
