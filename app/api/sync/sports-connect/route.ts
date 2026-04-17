import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAndParseIcal } from '@/lib/ical/parser';
import { ingestEvents } from '@/lib/ical/ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const icalUrl = process.env.SPORTS_CONNECT_ICAL_URL;
  if (!icalUrl) {
    return NextResponse.json(
      { error: 'SPORTS_CONNECT_ICAL_URL is not set' },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', 'tjybb')
    .single();
  if (orgErr || !org) {
    return NextResponse.json(
      { error: `org lookup failed: ${orgErr?.message ?? 'not found'}` },
      { status: 500 }
    );
  }

  const { data: run, error: runErr } = await supabase
    .from('sync_runs')
    .insert({ source: 'sports_connect', status: 'running' })
    .select()
    .single();
  if (runErr || !run) {
    return NextResponse.json(
      { error: `sync_runs insert failed: ${runErr?.message}` },
      { status: 500 }
    );
  }

  try {
    const events = await fetchAndParseIcal(icalUrl);
    const counts = await ingestEvents(supabase, org.id, events);
    const status = counts.errors.length === 0 ? 'success' : 'partial';
    await supabase
      .from('sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        events_seen: counts.seen,
        events_inserted: counts.inserted,
        events_updated: counts.updated,
        events_unchanged: counts.unchanged,
        errors: counts.errors.length ? counts.errors : null,
        status,
      })
      .eq('id', run.id);
    return NextResponse.json({ run_id: run.id, ...counts, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        errors: [{ uid: null, message }],
        status: 'failed',
      })
      .eq('id', run.id);
    return NextResponse.json(
      { error: message, run_id: run.id },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
