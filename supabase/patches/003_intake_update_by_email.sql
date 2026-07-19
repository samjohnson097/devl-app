-- Allow existing players to update Monday availability via the intake form
-- (matched by email) without creating a duplicate roster entry.
--
-- Run this in the Supabase SQL editor (or re-run the matching functions from schema.sql).

drop function if exists public.register_player_with_monday_availability(text, text, text, text, jsonb);
create or replace function public.register_player_with_monday_availability(
  p_season_slug text,
  p_display_name text,
  p_email text default null,
  p_pronouns text default null,
  p_availability jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_player uuid;
  v_email text;
  v_updated boolean := false;
  a jsonb;
begin
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;
  if length(trim(p_display_name)) < 1 then
    raise exception 'Name required';
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');

  if v_email is not null then
    select id into v_player
    from public.players
    where season_id = v_season
      and removed_at is null
      and email is not null
      and lower(trim(email)) = v_email
    order by created_at asc
    limit 1;

    if v_player is not null then
      update public.players
      set
        display_name = trim(p_display_name),
        email = v_email,
        pronouns = coalesce(nullif(trim(p_pronouns), ''), pronouns)
      where id = v_player;
      v_updated := true;
    end if;
  end if;

  if v_player is null then
    insert into public.players (season_id, display_name, email, pronouns, monday_available, thursday_available)
    values (
      v_season,
      trim(p_display_name),
      v_email,
      nullif(trim(p_pronouns), ''),
      true,
      false
    )
    returning id into v_player;
  end if;

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

  return jsonb_build_object(
    'player_id', v_player,
    'updated', v_updated
  );
end;
$$;

drop function if exists public.get_player_intake_by_email(text, text);
create or replace function public.get_player_intake_by_email(
  p_season_slug text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_player uuid;
  v_name text;
  v_pronouns text;
  v_email text;
  v_availability jsonb;
begin
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if v_email is null then
    return null;
  end if;

  select p.id, p.display_name, p.pronouns
  into v_player, v_name, v_pronouns
  from public.players p
  where p.season_id = v_season
    and p.removed_at is null
    and p.email is not null
    and lower(trim(p.email)) = v_email
  order by p.created_at asc
  limit 1;

  if v_player is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', m.monday_date,
        'available', coalesce(pma.available, false)
      )
      order by m.display_order
    ),
    '[]'::jsonb
  )
  into v_availability
  from public.season_intake_mondays m
  left join public.player_monday_availability pma
    on pma.player_id = v_player
   and pma.monday_date = m.monday_date
  where m.season_id = v_season;

  return jsonb_build_object(
    'player_id', v_player,
    'display_name', v_name,
    'pronouns', v_pronouns,
    'availability', v_availability
  );
end;
$$;

grant execute on function public.register_player_with_monday_availability(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_player_intake_by_email(text, text) to anon, authenticated;
