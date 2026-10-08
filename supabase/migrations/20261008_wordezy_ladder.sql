-- Wordezy Ladder: daily leaderboard tables + RPCs.
-- Lives in the same Supabase project as the other Wordezy games, so one
-- account works across all of them. Same design as Wordezy Scramble: tables
-- are public-readable where needed and never directly writable — every write
-- goes through a SECURITY DEFINER function that takes the player's identity
-- from auth.uid(), not from anything the client sends.

create table if not exists public.wordezy_ladder_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.wordezy_ladder_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  puzzle_date date not null,
  -- Words entered (start word not counted). Daily par is always 4–6, so
  -- anything under 4 can't be a real finish.
  steps integer not null check (steps between 4 and 100),
  hints integer not null default 0 check (hints between 0 and 100),
  -- The day's par, as worked out by the game (for "at par" counts).
  par integer not null check (par between 1 and 20),
  time_ms integer not null check (time_ms > 0 and time_ms < 24 * 60 * 60 * 1000),
  created_at timestamptz not null default now(),
  constraint wordezy_ladder_scores_player_date_key unique (player_id, puzzle_date)
);

create index if not exists wordezy_ladder_scores_date_rank_idx
  on public.wordezy_ladder_scores (puzzle_date, (steps + hints), time_ms);

alter table public.wordezy_ladder_profiles enable row level security;
alter table public.wordezy_ladder_scores enable row level security;

drop policy if exists wordezy_ladder_profiles_select_own on public.wordezy_ladder_profiles;
create policy wordezy_ladder_profiles_select_own on public.wordezy_ladder_profiles
  for select using (id = (select auth.uid()));

drop policy if exists wordezy_ladder_scores_public_read on public.wordezy_ladder_scores;
create policy wordezy_ladder_scores_public_read on public.wordezy_ladder_scores
  for select using (true);

-- Sets (or changes) the caller's display name.
create or replace function public.wordezy_ladder_update_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(trim(p_display_name), '')) < 1 or char_length(trim(p_display_name)) > 20 then
    raise exception 'invalid display_name';
  end if;

  insert into public.wordezy_ladder_profiles (id, display_name)
  values (auth.uid(), trim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
end;
$$;

-- Returns the caller's display name for this game. A signed-in (non-guest)
-- player with a name in another Wordezy game gets it copied over the first
-- time. The other games' profile tables are looked up only if they exist,
-- so this works whether or not Wordezy Scramble's tables have been created.
create or replace function public.wordezy_ladder_ensure_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_table text;
begin
  if v_uid is null then
    return null;
  end if;

  select display_name into v_name from public.wordezy_ladder_profiles where id = v_uid;
  if v_name is not null or v_is_anon then
    return v_name;
  end if;

  foreach v_table in array array['wordezy_scramble_profiles', 'wordezy_search_profiles', 'profiles'] loop
    exit when v_name is not null;
    if to_regclass('public.' || v_table) is not null then
      execute format('select display_name from public.%I where id = $1', v_table) into v_name using v_uid;
    end if;
  end loop;

  v_name := left(trim(coalesce(v_name, '')), 20);
  if v_name = '' then
    v_name := 'Player';
  end if;

  insert into public.wordezy_ladder_profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do nothing;
  return v_name;
end;
$$;

-- Records the caller's result for a daily ladder. The FIRST finish of the day
-- is the one that counts: once a player has climbed today's ladder they know
-- the route, so a replay must never be able to improve it.
create or replace function public.submit_wordezy_ladder_score(p_puzzle_date date, p_steps integer, p_hints integer, p_par integer, p_time_ms integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_steps is null or p_steps < 4 or p_steps > 100 then
    raise exception 'invalid steps';
  end if;
  if p_hints is null or p_hints < 0 or p_hints > 100 then
    raise exception 'invalid hints';
  end if;
  if p_par is null or p_par < 1 or p_par > 20 then
    raise exception 'invalid par';
  end if;
  if p_time_ms is null or p_time_ms <= 0 or p_time_ms >= 24 * 60 * 60 * 1000 then
    raise exception 'invalid time_ms';
  end if;
  -- Daily ladders roll over at midnight UTC; allow one day either side for
  -- players finishing across the boundary, but never a far past/future date.
  if p_puzzle_date is null or abs(p_puzzle_date - (now() at time zone 'utc')::date) > 1 then
    raise exception 'invalid puzzle_date';
  end if;
  if to_regclass('public.profiles') is not null
     and exists (select 1 from public.profiles where id = auth.uid() and is_banned) then
    raise exception 'account suspended';
  end if;

  select display_name into v_name from public.wordezy_ladder_profiles where id = auth.uid();
  if v_name is null then
    raise exception 'profile not set up';
  end if;

  insert into public.wordezy_ladder_scores (player_id, display_name, puzzle_date, steps, hints, par, time_ms)
  values (auth.uid(), v_name, p_puzzle_date, p_steps, p_hints, p_par, p_time_ms)
  on conflict (player_id, puzzle_date) do nothing;
end;
$$;

-- Fewest moves (steps + hints) for one day, fastest time as the tiebreaker.
create or replace function public.wordezy_ladder_daily_leaderboard(p_puzzle_date date, p_limit integer default 10)
returns table (player_id uuid, display_name text, steps integer, hints integer, time_ms integer)
language sql
stable
set search_path = public
as $$
  select s.player_id, s.display_name, s.steps, s.hints, s.time_ms
  from public.wordezy_ladder_scores s
  where s.puzzle_date = p_puzzle_date
  order by (s.steps + s.hints) asc, s.time_ms asc, s.created_at asc
  limit greatest(1, least(p_limit, 100))
$$;

-- All-time standings: most daily finishes, then most perfect climbs (at or
-- under par with no hints).
create or replace function public.wordezy_ladder_alltime_leaderboard(p_limit integer default 10)
returns table (player_id uuid, display_name text, wins bigint, pars bigint)
language sql
stable
set search_path = public
as $$
  select
    s.player_id,
    (array_agg(s.display_name order by s.created_at desc))[1] as display_name,
    count(*) as wins,
    count(*) filter (where s.hints = 0 and s.steps <= s.par) as pars
  from public.wordezy_ladder_scores s
  group by s.player_id
  order by wins desc, pars desc
  limit greatest(1, least(p_limit, 100))
$$;

-- Functions are executable by PUBLIC by default in Postgres; lock the
-- writers down to signed-in sessions (guests are signed in anonymously and
-- carry the "authenticated" role too) and leave the readers open.
revoke all on function public.wordezy_ladder_update_profile(text) from public, anon;
revoke all on function public.wordezy_ladder_ensure_profile() from public, anon;
revoke all on function public.submit_wordezy_ladder_score(date, integer, integer, integer, integer) from public, anon;
grant execute on function public.wordezy_ladder_update_profile(text) to authenticated;
grant execute on function public.wordezy_ladder_ensure_profile() to authenticated;
grant execute on function public.submit_wordezy_ladder_score(date, integer, integer, integer, integer) to authenticated;
grant execute on function public.wordezy_ladder_daily_leaderboard(date, integer) to anon, authenticated;
grant execute on function public.wordezy_ladder_alltime_leaderboard(integer) to anon, authenticated;
