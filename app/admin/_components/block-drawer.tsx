import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { updateBlock } from '../_actions';
import { OverrideForm } from './override-form';

const TZ = 'America/New_York';

const SOURCE_LABEL: Record<string, string> = {
  sports_connect: 'Rec (Sports Connect)',
  travel_recurring: 'Travel practice',
  manual: 'Manual',
  override: 'Rec override',
  open_slot: 'Open slot',
};

export async function BlockDrawer({ blockId, weekParam }: { blockId: string; weekParam: string }) {
  const supabase = await createClient();
  const { data: block } = await supabase
    .from('schedule_blocks').select('*').eq('id', blockId).maybeSingle();
  if (!block) return null;

  const { data: team } = block.team_id
    ? await supabase.from('teams').select('name').eq('id', block.team_id).maybeSingle()
    : { data: null };
  const { data: field } = await supabase.from('fields').select('name').eq('id', block.field_id).maybeSingle();

  const { data: replacement } = block.overridden_by_block_id
    ? await supabase
        .from('schedule_blocks')
        .select('id, home_team_raw, away_team_raw, notes')
        .eq('id', block.overridden_by_block_id)
        .maybeSingle()
    : { data: null };

  const start = new Date(block.start_at);
  const end = new Date(block.end_at);
  const editable = ['confirmed', 'cancelled', 'tentative'].includes(block.status);
  const isOverridden = block.status === 'overridden';
  const canOverride =
    ['travel_recurring', 'manual'].includes(block.source) &&
    block.status === 'confirmed' &&
    start > new Date();

  return (
    <>
      <Link href={`?week=${weekParam}`} scroll={false} className="fixed inset-0 z-40 bg-black/40" aria-label="Close" />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-tj-black/10 bg-tj-black px-4 py-3 text-tj-cream">
          <div>
            <div className="text-xs uppercase tracking-wide text-tj-gold">{SOURCE_LABEL[block.source] ?? block.source}</div>
            <h2 className="text-sm font-semibold">{field?.name ?? block.field_id}</h2>
          </div>
          <Link href={`?week=${weekParam}`} scroll={false} className="text-tj-gold-soft hover:text-tj-gold" aria-label="Close">✕</Link>
        </header>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-tj-black/50">Date</div>
            <div>{formatInTimeZone(start, TZ, 'EEEE, MMMM d, yyyy')}</div>
            <div className="opacity-70">{formatInTimeZone(start, TZ, 'h:mm a')} – {formatInTimeZone(end, TZ, 'h:mm a')}</div>
          </div>
          {team?.name && (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Team</div>
              <div>{team.name}</div>
            </div>
          )}
          {(block.home_team_raw || block.away_team_raw) && (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Matchup</div>
              <div>{block.away_team_raw} @ {block.home_team_raw}</div>
            </div>
          )}

          {isOverridden && (
            <div className="rounded border border-override-red bg-override-red/10 p-3 text-sm">
              <div className="font-semibold text-override-red">Overridden for rec makeup</div>
              {block.override_reason && <div className="mt-1 text-xs">Reason: {block.override_reason}</div>}
              {replacement && (
                <div className="mt-1 text-xs opacity-80">
                  Replaced by: {replacement.away_team_raw} @ {replacement.home_team_raw}
                  {' · '}
                  <Link href={`?week=${weekParam}&block=${replacement.id}`} scroll={false} className="underline">
                    View replacement
                  </Link>
                </div>
              )}
            </div>
          )}

          {editable ? (
            <form action={updateBlock} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={block.id} />
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-tj-black/50">Status</span>
                <select name="status" defaultValue={block.status} className="rounded border border-tj-black/20 px-2 py-1 text-sm">
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-tj-black/50">Notes</span>
                <textarea name="notes" defaultValue={block.notes ?? ''} maxLength={500} rows={3} className="rounded border border-tj-black/20 px-2 py-1 text-sm" />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">Save</button>
                <Link href={`?week=${weekParam}`} scroll={false} className="rounded border border-tj-black/20 px-3 py-1.5 text-sm hover:bg-tj-cream">Cancel</Link>
              </div>
            </form>
          ) : (
            <div>
              <div className="text-xs uppercase tracking-wide text-tj-black/50">Status</div>
              <div className="opacity-70">{block.status} <span className="text-xs">(not editable in this session)</span></div>
              {block.notes && <div className="mt-2 text-sm opacity-80">{block.notes}</div>}
            </div>
          )}

          {canOverride && <OverrideForm blockId={block.id} />}

          <div className="text-xs opacity-50">Updated {formatInTimeZone(new Date(block.updated_at ?? block.created_at), TZ, 'MMM d, h:mm a')}</div>
        </div>
      </aside>
    </>
  );
}
