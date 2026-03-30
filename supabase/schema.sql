-- Volleyball league schema for Supabase (Postgres).
-- Run in SQL Editor after creating a project: https://supabase.com/dashboard/project/_/sql

-- Extensions
create extension if not exists "pgcrypto";

-- Seasons (no secrets here — safe for broad SELECT grants)
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  default_nets int not null default 4 check (default_nets >= 1 and default_nets <= 12),
  games_per_night int not null default 5 check (games_per_night >= 1 and games_per_night <= 20),
  primary_play_day text not null default 'monday',
  created_at timestamptz not null default now()
);

create table if not exists public.season_secrets (
  season_id uuid primary key references public.seasons (id) on delete cascade,
  admin_token uuid not null default gen_random_uuid()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  display_name text not null,
  email text,
  monday_available boolean not null default true,
  thursday_available boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists players_season_idx on public.players (season_id);

create table if not exists public.game_nights (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  night_date date not null,
  net_count int check (net_count is null or (net_count >= 1 and net_count <= 12)),
  created_at timestamptz not null default now(),
  unique (season_id, night_date)
);

create index if not exists game_nights_season_idx on public.game_nights (season_id);

create table if not exists public.attendance (
  game_night_id uuid not null references public.game_nights (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  attending boolean not null default true,
  primary key (game_night_id, player_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  game_night_id uuid not null references public.game_nights (id) on delete cascade,
  round_index int not null check (round_index >= 0),
  court_index int not null check (court_index >= 0),
  team_a_p1 uuid not null references public.players (id) on delete cascade,
  team_a_p2 uuid not null references public.players (id) on delete cascade,
  team_a_p3 uuid references public.players (id) on delete cascade,
  team_b_p1 uuid not null references public.players (id) on delete cascade,
  team_b_p2 uuid not null references public.players (id) on delete cascade,
  team_b_p3 uuid references public.players (id) on delete cascade,
  score_a int check (score_a is null or score_a >= 0),
  score_b int check (score_b is null or score_b >= 0),
  stage text not null default 'regular', -- regular | playoffs_pool | playoffs_gold | playoffs_silver
  stage_round int, -- round index within the stage (for display)
  pool_index int, -- 0..N-1 for playoffs_pool
  bracket text, -- gold | silver (for elimination stages)
  unique (game_night_id, round_index, court_index)
);
alter table public.matches add column if not exists team_a_p3 uuid references public.players (id) on delete cascade;
alter table public.matches add column if not exists team_b_p3 uuid references public.players (id) on delete cascade;
alter table public.matches add column if not exists stage text not null default 'regular';
alter table public.matches add column if not exists stage_round int;
alter table public.matches add column if not exists pool_index int;
alter table public.matches add column if not exists bracket text;

create index if not exists matches_night_idx on public.matches (game_night_id);

-- --- RPCs ---

-- Requires a logged-in Supabase Auth user (shared organizer account is fine).
create or replace function public.assert_authenticated()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
end;
$$;

create or replace function public.create_season(
  p_name text,
  p_default_nets int default 4,
  p_games_per_night int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_slug text;
  v_id uuid;
  v_token uuid;
begin
  perform public.assert_authenticated();
  if length(trim(p_name)) < 2 then
    raise exception 'Season name too short';
  end if;
  v_slug := trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug is null or length(v_slug) < 2 then
    v_slug := 'season';
  end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.seasons (slug, name, default_nets, games_per_night)
  values (v_slug, trim(p_name), p_default_nets, p_games_per_night)
  returning id into v_id;

  insert into public.season_secrets (season_id) values (v_id)
  returning admin_token into v_token;

  return jsonb_build_object(
    'id', v_id,
    'slug', v_slug
  );
end;
$$;

create or replace function public.register_player(
  p_season_slug text,
  p_display_name text,
  p_email text default null,
  p_monday boolean default true,
  p_thursday boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_player uuid;
begin
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then
    raise exception 'Season not found';
  end if;
  if length(trim(p_display_name)) < 1 then
    raise exception 'Name required';
  end if;

  insert into public.players (season_id, display_name, email, monday_available, thursday_available)
  values (v_season, trim(p_display_name), nullif(trim(p_email), ''), p_monday, p_thursday)
  returning id into v_player;

  return v_player;
end;
$$;

create or replace function public.assert_season_admin(p_season_id uuid, p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.season_secrets s
    where s.season_id = p_season_id and s.admin_token = p_token
  ) then
    raise exception 'unauthorized';
  end if;
end;
$$;

drop function if exists public.admin_create_game_night(text, uuid, date, int);
create or replace function public.admin_create_game_night(
  p_season_slug text,
  p_date date,
  p_net_count int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_id uuid;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;

  insert into public.game_nights (season_id, night_date, net_count)
  values (v_season, p_date, p_net_count)
  on conflict (season_id, night_date) do update
    set net_count = coalesce(excluded.net_count, public.game_nights.net_count)
  returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.admin_seed_attendance(uuid, uuid);
create or replace function public.admin_seed_attendance(
  p_game_night_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_night_date date;
  r record;
begin
  perform public.assert_authenticated();
  select season_id, night_date
  into v_season, v_night_date
  from public.game_nights
  where id = p_game_night_id;
  if v_season is null then raise exception 'Game night not found'; end if;

  for r in
    select
      p.id as player_id,
      coalesce(pma.available, p.monday_available) as default_attending
    from public.players p
    left join public.player_monday_availability pma
      on pma.player_id = p.id
     and pma.monday_date = v_night_date
    where p.season_id = v_season
  loop
    insert into public.attendance (game_night_id, player_id, attending)
    values (p_game_night_id, r.player_id, r.default_attending)
    on conflict (game_night_id, player_id) do nothing;
  end loop;
end;
$$;

drop function if exists public.admin_set_attendance(uuid, uuid, uuid, boolean);
create or replace function public.admin_set_attendance(
  p_game_night_id uuid,
  p_player_id uuid,
  p_attending boolean
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select gn.season_id into v_season
  from public.game_nights gn where gn.id = p_game_night_id;
  if v_season is null then raise exception 'Game night not found'; end if;

  insert into public.attendance (game_night_id, player_id, attending)
  values (p_game_night_id, p_player_id, p_attending)
  on conflict (game_night_id, player_id) do update
    set attending = excluded.attending;
end;
$$;

drop function if exists public.admin_add_player(text, uuid, text, boolean, boolean);
create or replace function public.admin_add_player(
  p_season_slug text,
  p_display_name text,
  p_monday boolean default true,
  p_thursday boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_player uuid;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;

  insert into public.players (season_id, display_name, monday_available, thursday_available)
  values (v_season, trim(p_display_name), p_monday, p_thursday)
  returning id into v_player;

  return v_player;
end;
$$;

drop function if exists public.admin_remove_player(uuid, uuid);
create or replace function public.admin_remove_player(
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select season_id into v_season from public.players where id = p_player_id;
  if v_season is null then raise exception 'Player not found'; end if;

  delete from public.players where id = p_player_id;
end;
$$;

drop function if exists public.admin_save_schedule(uuid, uuid, jsonb);
create or replace function public.admin_save_schedule(
  p_game_night_id uuid,
  p_matches jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  m jsonb;
  sa int;
  sb int;
  ta3 uuid;
  tb3 uuid;
begin
  perform public.assert_authenticated();
  select season_id into v_season from public.game_nights where id = p_game_night_id;
  if v_season is null then raise exception 'Game night not found'; end if;

  delete from public.matches where game_night_id = p_game_night_id;

  for m in select * from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb))
  loop
    sa := null;
    sb := null;
    ta3 := null;
    tb3 := null;
    if m ? 'score_a' and m->>'score_a' is not null and m->>'score_a' != 'null' then
      sa := (m->>'score_a')::int;
    end if;
    if m ? 'score_b' and m->>'score_b' is not null and m->>'score_b' != 'null' then
      sb := (m->>'score_b')::int;
    end if;
    if m ? 'team_a_p3' and m->>'team_a_p3' is not null and m->>'team_a_p3' != 'null' and m->>'team_a_p3' != '' then
      ta3 := (m->>'team_a_p3')::uuid;
    end if;
    if m ? 'team_b_p3' and m->>'team_b_p3' is not null and m->>'team_b_p3' != 'null' and m->>'team_b_p3' != '' then
      tb3 := (m->>'team_b_p3')::uuid;
    end if;

    insert into public.matches (
      game_night_id, round_index, court_index,
      team_a_p1, team_a_p2, team_a_p3, team_b_p1, team_b_p2, team_b_p3,
      score_a, score_b,
      stage, stage_round, pool_index, bracket
    )
    values (
      p_game_night_id,
      (m->>'round_index')::int,
      (m->>'court_index')::int,
      (m->>'team_a_p1')::uuid,
      (m->>'team_a_p2')::uuid,
      ta3,
      (m->>'team_b_p1')::uuid,
      (m->>'team_b_p2')::uuid,
      tb3,
      sa,
      sb,
      coalesce(nullif(m->>'stage', ''), 'regular'),
      case when m ? 'stage_round' then (m->>'stage_round')::int else null end,
      case when m ? 'pool_index' then (m->>'pool_index')::int else null end,
      nullif(m->>'bracket', '')
    );
  end loop;
end;
$$;

-- Save matches for a specific stage without wiping other stages.
-- Incoming matches use round_index/court_index local to the stage; they are offset
-- behind the max existing round_index for this night to avoid unique conflicts.
drop function if exists public.admin_save_stage_matches(uuid, text, jsonb);
create or replace function public.admin_save_stage_matches(
  p_game_night_id uuid,
  p_stage text,
  p_matches jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_base int;
  m jsonb;
  sa int;
  sb int;
  ta3 uuid;
  tb3 uuid;
begin
  perform public.assert_authenticated();
  select season_id into v_season from public.game_nights where id = p_game_night_id;
  if v_season is null then raise exception 'Game night not found'; end if;

  delete from public.matches
  where game_night_id = p_game_night_id
    and stage = p_stage;

  select coalesce(max(round_index), -1) + 1
  into v_base
  from public.matches
  where game_night_id = p_game_night_id;

  for m in select * from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb))
  loop
    sa := null;
    sb := null;
    ta3 := null;
    tb3 := null;
    if m ? 'score_a' and m->>'score_a' is not null and m->>'score_a' != 'null' then
      sa := (m->>'score_a')::int;
    end if;
    if m ? 'score_b' and m->>'score_b' is not null and m->>'score_b' != 'null' then
      sb := (m->>'score_b')::int;
    end if;
    if m ? 'team_a_p3' and m->>'team_a_p3' is not null and m->>'team_a_p3' != 'null' and m->>'team_a_p3' != '' then
      ta3 := (m->>'team_a_p3')::uuid;
    end if;
    if m ? 'team_b_p3' and m->>'team_b_p3' is not null and m->>'team_b_p3' != 'null' and m->>'team_b_p3' != '' then
      tb3 := (m->>'team_b_p3')::uuid;
    end if;

    insert into public.matches (
      game_night_id, round_index, court_index,
      team_a_p1, team_a_p2, team_a_p3, team_b_p1, team_b_p2, team_b_p3,
      score_a, score_b,
      stage, stage_round, pool_index, bracket
    )
    values (
      p_game_night_id,
      v_base + (m->>'round_index')::int,
      (m->>'court_index')::int,
      (m->>'team_a_p1')::uuid,
      (m->>'team_a_p2')::uuid,
      ta3,
      (m->>'team_b_p1')::uuid,
      (m->>'team_b_p2')::uuid,
      tb3,
      sa,
      sb,
      p_stage,
      (m->>'round_index')::int,
      case when m ? 'pool_index' then (m->>'pool_index')::int else null end,
      nullif(m->>'bracket', '')
    );
  end loop;
end;
$$;

drop function if exists public.admin_set_match_score(uuid, uuid, int, int);
create or replace function public.admin_set_match_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select gn.season_id into v_season
  from public.matches m
  join public.game_nights gn on gn.id = m.game_night_id
  where m.id = p_match_id;
  if v_season is null then raise exception 'Match not found'; end if;

  update public.matches
  set score_a = p_score_a, score_b = p_score_b
  where id = p_match_id;
end;
$$;

-- Edit a single matchup (swap players into slots). Clears scores for that match.
drop function if exists public.admin_update_match_players(uuid, uuid, uuid, uuid, uuid, uuid, uuid);
create or replace function public.admin_update_match_players(
  p_match_id uuid,
  p_team_a_p1 uuid,
  p_team_a_p2 uuid,
  p_team_b_p1 uuid,
  p_team_b_p2 uuid,
  p_team_a_p3 uuid default null,
  p_team_b_p3 uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select gn.season_id into v_season
  from public.matches m
  join public.game_nights gn on gn.id = m.game_night_id
  where m.id = p_match_id;
  if v_season is null then raise exception 'Match not found'; end if;

  update public.matches
  set
    team_a_p1 = p_team_a_p1,
    team_a_p2 = p_team_a_p2,
    team_a_p3 = p_team_a_p3,
    team_b_p1 = p_team_b_p1,
    team_b_p2 = p_team_b_p2,
    team_b_p3 = p_team_b_p3,
    score_a = null,
    score_b = null
  where id = p_match_id;
end;
$$;

-- Grants: adjust in production (tighten table policies).
grant usage on schema public to anon, authenticated;

grant select on public.seasons to anon, authenticated;
grant select on public.players to anon, authenticated;
grant select on public.game_nights to anon, authenticated;
grant select on public.attendance to anon, authenticated;
grant select on public.matches to anon, authenticated;

-- Public signup RPCs only for anon; organizer RPCs require authenticated session.
grant execute on function public.register_player(text, text, text, boolean, boolean) to anon, authenticated;

grant execute on function public.create_season(text, int, int) to authenticated;
grant execute on function public.admin_create_game_night(text, date, int) to authenticated;
grant execute on function public.admin_seed_attendance(uuid) to authenticated;
grant execute on function public.admin_set_attendance(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_add_player(text, text, boolean, boolean) to authenticated;
grant execute on function public.admin_remove_player(uuid) to authenticated;
grant execute on function public.admin_save_schedule(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_stage_matches(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_set_match_score(uuid, int, int) to authenticated;
grant execute on function public.admin_update_match_players(uuid, uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

revoke execute on function public.create_season(text, int, int) from anon;
revoke execute on function public.admin_create_game_night(text, date, int) from anon;
revoke execute on function public.admin_seed_attendance(uuid) from anon;
revoke execute on function public.admin_set_attendance(uuid, uuid, boolean) from anon;
revoke execute on function public.admin_add_player(text, text, boolean, boolean) from anon;
revoke execute on function public.admin_remove_player(uuid) from anon;
revoke execute on function public.admin_save_schedule(uuid, jsonb) from anon;
revoke execute on function public.admin_save_stage_matches(uuid, text, jsonb) from anon;
revoke execute on function public.admin_set_match_score(uuid, int, int) from anon;
revoke execute on function public.admin_update_match_players(uuid, uuid, uuid, uuid, uuid, uuid, uuid) from anon;

-- Announcements and intake windows (8 Mondays).
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_season_idx
  on public.announcements (season_id, created_at desc);

create table if not exists public.season_intake_mondays (
  season_id uuid not null references public.seasons (id) on delete cascade,
  monday_date date not null,
  display_order int not null check (display_order >= 0),
  primary key (season_id, monday_date)
);

create unique index if not exists season_intake_mondays_order_idx
  on public.season_intake_mondays (season_id, display_order);

create table if not exists public.player_monday_availability (
  player_id uuid not null references public.players (id) on delete cascade,
  monday_date date not null,
  available boolean not null default false,
  primary key (player_id, monday_date)
);

create or replace function public.create_season_with_mondays(
  p_name text,
  p_default_nets int default 4,
  p_games_per_night int default 5,
  p_first_monday date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_slug text;
  v_id uuid;
  v_token uuid;
  v_first date;
  i int;
begin
  perform public.assert_authenticated();
  if length(trim(p_name)) < 2 then
    raise exception 'Season name too short';
  end if;
  v_slug := trim(both '-' from lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')));
  if v_slug is null or length(v_slug) < 2 then
    v_slug := 'season';
  end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.seasons (slug, name, default_nets, games_per_night)
  values (v_slug, trim(p_name), p_default_nets, p_games_per_night)
  returning id into v_id;

  insert into public.season_secrets (season_id) values (v_id)
  returning admin_token into v_token;

  v_first := coalesce(p_first_monday, current_date);
  while extract(dow from v_first) != 1 loop
    v_first := v_first + 1;
  end loop;

  for i in 0..7 loop
    insert into public.season_intake_mondays (season_id, monday_date, display_order)
    values (v_id, v_first + (i * 7), i);
  end loop;

  return jsonb_build_object(
    'id', v_id,
    'slug', v_slug
  );
end;
$$;

drop function if exists public.admin_set_intake_mondays(text, uuid, jsonb);
create or replace function public.admin_set_intake_mondays(
  p_season_slug text,
  p_dates jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  d jsonb;
  i int := 0;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;

  delete from public.season_intake_mondays where season_id = v_season;

  for d in select * from jsonb_array_elements(coalesce(p_dates, '[]'::jsonb))
  loop
    insert into public.season_intake_mondays (season_id, monday_date, display_order)
    values (v_season, (d #>> '{}')::date, i);
    i := i + 1;
  end loop;
end;
$$;

create or replace function public.register_player_with_monday_availability(
  p_season_slug text,
  p_display_name text,
  p_email text default null,
  p_availability jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_player uuid;
  a jsonb;
begin
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;
  if length(trim(p_display_name)) < 1 then
    raise exception 'Name required';
  end if;

  insert into public.players (season_id, display_name, email, monday_available, thursday_available)
  values (v_season, trim(p_display_name), nullif(trim(p_email), ''), true, false)
  returning id into v_player;

  for a in select * from jsonb_array_elements(coalesce(p_availability, '[]'::jsonb))
  loop
    insert into public.player_monday_availability (player_id, monday_date, available)
    values (
      v_player,
      (a->>'date')::date,
      coalesce((a->>'available')::boolean, false)
    )
    on conflict (player_id, monday_date) do update
      set available = excluded.available;
  end loop;

  return v_player;
end;
$$;

drop function if exists public.admin_add_announcement(text, uuid, text);
create or replace function public.admin_add_announcement(
  p_season_slug text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_id uuid;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;
  if length(trim(p_message)) < 1 then
    raise exception 'Message required';
  end if;
  insert into public.announcements (season_id, message)
  values (v_season, trim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.admin_delete_announcement(uuid, uuid);
create or replace function public.admin_delete_announcement(
  p_announcement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select season_id into v_season from public.announcements where id = p_announcement_id;
  if v_season is null then raise exception 'Announcement not found'; end if;
  delete from public.announcements where id = p_announcement_id;
end;
$$;

grant select on public.announcements to anon, authenticated;
grant select on public.season_intake_mondays to anon, authenticated;
grant select on public.player_monday_availability to anon, authenticated;

grant execute on function public.register_player_with_monday_availability(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_season_with_mondays(text, int, int, date) to authenticated;
grant execute on function public.admin_set_intake_mondays(text, jsonb) to authenticated;
grant execute on function public.admin_add_announcement(text, text) to authenticated;
grant execute on function public.admin_delete_announcement(uuid) to authenticated;

revoke execute on function public.create_season_with_mondays(text, int, int, date) from anon;
revoke execute on function public.admin_set_intake_mondays(text, jsonb) from anon;
revoke execute on function public.admin_add_announcement(text, text) from anon;
revoke execute on function public.admin_delete_announcement(uuid) from anon;

-- Cancel one intake/play week: remove that Monday, shift all later Mondays by +7 days,
-- add a new 8th Monday at the end. Per-player Monday availability for the shifted and
-- new weeks is reset to false (admin re-checks). Game nights on the canceled date are
-- removed; nights on shifted dates move +7 (updates applied from latest date backward).
-- Parameter order is (date, text): PostgREST matches args by name sorted alphabetically
-- (p_cancel_monday before p_season_slug), which yields types (date, text).
drop function if exists public.admin_cancel_and_shift_intake_week(text, date);
drop function if exists public.admin_cancel_and_shift_intake_week(date, text);
create or replace function public.admin_cancel_and_shift_intake_week(
  p_cancel_monday date,
  p_season_slug text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_d date[];
  v_new date[];
  v_k int;
  v_i int;
  v_dt date;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then
    raise exception 'Season not found';
  end if;

  select array_agg(monday_date order by display_order)
  into v_d
  from public.season_intake_mondays
  where season_id = v_season;

  if v_d is null or cardinality(v_d) <> 8 then
    raise exception 'Season must have exactly 8 intake Mondays';
  end if;

  v_k := null;
  for v_i in 1..8 loop
    if v_d[v_i] = p_cancel_monday then
      v_k := v_i;
      exit;
    end if;
  end loop;

  if v_k is null then
    raise exception 'Cancel date must match one of the season intake Mondays';
  end if;

  for v_i in 1..(v_k - 1) loop
    v_new[v_i] := v_d[v_i];
  end loop;

  for v_i in v_k..7 loop
    v_new[v_i] := v_d[v_i + 1] + 7;
  end loop;

  if v_k < 8 then
    v_new[8] := v_d[8] + 14;
  else
    v_new[8] := v_d[8] + 7;
  end if;

  delete from public.game_nights
  where season_id = v_season and night_date = p_cancel_monday;

  for v_i in reverse (v_k + 1)..8 loop
    v_dt := v_d[v_i];
    update public.game_nights
    set night_date = night_date + 7
    where season_id = v_season and night_date = v_dt;
  end loop;

  delete from public.season_intake_mondays where season_id = v_season;
  for v_i in 1..8 loop
    insert into public.season_intake_mondays (season_id, monday_date, display_order)
    values (v_season, v_new[v_i], v_i - 1);
  end loop;

  delete from public.player_monday_availability pma
  using public.players p
  where p.id = pma.player_id
    and p.season_id = v_season
    and pma.monday_date in (
      select unnest(v_d[v_k:8])
    );

  for v_i in v_k..8 loop
    insert into public.player_monday_availability (player_id, monday_date, available)
    select pl.id, v_new[v_i], false
    from public.players pl
    where pl.season_id = v_season
    on conflict (player_id, monday_date) do update
      set available = false;
  end loop;
end;
$$;

grant execute on function public.admin_cancel_and_shift_intake_week(date, text) to authenticated;
revoke execute on function public.admin_cancel_and_shift_intake_week(date, text) from anon;

-- Optional: enable RLS later and replace broad grants with policies + service role for secrets.
