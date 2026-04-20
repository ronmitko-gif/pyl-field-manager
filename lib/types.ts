export type Role = 'admin' | 'coach';

export type BlockSource =
  | 'sports_connect'
  | 'travel_recurring'
  | 'manual'
  | 'override'
  | 'open_slot';

export type BlockStatus =
  | 'confirmed'
  | 'tentative'
  | 'overridden'
  | 'cancelled'
  | 'open';

export type TeamType = 'rec' | 'travel';

export type Coach = {
  id: string;
  org_id: string;
  team_id: string | null;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
};

export type ScheduleBlock = {
  id: string;
  org_id: string;
  field_id: string;
  start_at: string;
  end_at: string;
  source: BlockSource;
  source_uid: string | null;
  team_id: string | null;
  home_team_raw: string | null;
  away_team_raw: string | null;
  status: BlockStatus;
  notes: string | null;
  raw_summary: string | null;
  raw_description: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TravelRecurringSlot = {
  id: string;
  team_id: string;
  field_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_to: string | null;
};

export type MaterializedBlock = {
  org_id: string;
  team_id: string;
  field_id: string;
  start_at: Date;
  end_at: Date;
  source_uid: string;
};

export type NormalizedEvent = {
  uid: string;
  start_at: Date;
  end_at: Date;
  summary: string;
  description: string;
  park: string | null;
  field_name: string | null;
  home_team_raw: string | null;
  away_team_raw: string | null;
};
