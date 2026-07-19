-- Fix cancel-week: remove only the selected Monday, keep other dates + availability,
-- append one new final Monday. (Old logic shifted later weeks +7 and final +14,
-- which effectively dropped two calendar weeks and wiped availability.)

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
  v_new_final date;
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
  for v_i in (v_k + 1)..8 loop
    v_new[v_i - 1] := v_d[v_i];
  end loop;
  v_new_final := v_d[8] + 7;
  v_new[8] := v_new_final;

  delete from public.game_nights
  where season_id = v_season and night_date = p_cancel_monday;

  delete from public.season_intake_mondays where season_id = v_season;
  for v_i in 1..8 loop
    insert into public.season_intake_mondays (season_id, monday_date, display_order)
    values (v_season, v_new[v_i], v_i - 1);
  end loop;

  delete from public.player_monday_availability pma
  using public.players p
  where p.id = pma.player_id
    and p.season_id = v_season
    and pma.monday_date = p_cancel_monday;

  insert into public.player_monday_availability (player_id, monday_date, available)
  select pl.id, v_new_final, false
  from public.players pl
  where pl.season_id = v_season
    and pl.removed_at is null
  on conflict (player_id, monday_date) do update
    set available = excluded.available;
end;
$$;

grant execute on function public.admin_cancel_and_shift_intake_week(date, text) to authenticated;
revoke execute on function public.admin_cancel_and_shift_intake_week(date, text) from anon;
