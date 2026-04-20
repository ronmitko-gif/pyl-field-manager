import { revalidatePath } from 'next/cache';

async function postSync(path: string) {
  'use server';
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET not set');
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001');
  await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });
  revalidatePath('/admin');
}

async function syncRec() { 'use server'; await postSync('/api/sync/sports-connect'); }
async function syncTravel() { 'use server'; await postSync('/api/sync/travel-slots'); }

export function SyncButtons() {
  return (
    <div className="flex gap-2">
      <form action={syncRec}>
        <button className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">Sync rec</button>
      </form>
      <form action={syncTravel}>
        <button className="rounded bg-tj-gold px-3 py-1.5 text-sm text-tj-black hover:bg-tj-gold-soft">Sync travel</button>
      </form>
    </div>
  );
}
