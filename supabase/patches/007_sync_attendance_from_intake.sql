-- Apply intake Monday availability when a game night is created or opened.
-- Nights that already have matches keep existing attendance.
-- Organizer toggles set attendance.manual and are not overwritten.

alter table public.attendance
  add column if not exists manual boolean not null default false;

drop function if exists public.admin_seed_attendance(uuid, uuid);
create or replace function public.admin_seed_attendance(p_game_night_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
      case
        when pma.player_id is not null then pma.available
        when exists (
          select 1
          from public.player_monday_availability any_pma
          where any_pma.player_id = p.id
        ) then false
        else false
      end as default_attending
    from public.players p
    left join public.player_monday_availability pma
      on pma.player_id = p.id
     and pma.monday_date = v_night_date
    where p.season_id = v_season
      and p.removed_at is null
  loop
    insert into public.attendance (game_night_id, player_id, attending, manual)
    values (p_game_night_id, r.player_id, r.default_attending, false)
    on conflict (game_night_id, player_id) do update
      set attending = excluded.attending
      where public.attendance.manual is not true
        and not exists (
          select 1
          from public.matches m
          where m.game_night_id = p_game_night_id
        );
  end loop;
end;
$function$;

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
as $function$
declare
  v_season uuid;
begin
  perform public.assert_authenticated();
  select gn.season_id into v_season
  from public.game_nights gn where gn.id = p_game_night_id;
  if v_season is null then raise exception 'Game night not found'; end if;

  insert into public.attendance (game_night_id, player_id, attending, manual)
  values (p_game_night_id, p_player_id, p_attending, true)
  on conflict (game_night_id, player_id) do update
    set attending = excluded.attending,
        manual = true;
end;
$function$;

grant execute on function public.admin_seed_attendance(uuid) to authenticated;
grant execute on function public.admin_set_attendance(uuid, uuid, boolean) to authenticated;
revoke execute on function public.admin_seed_attendance(uuid) from anon;
revoke execute on function public.admin_set_attendance(uuid, uuid, boolean) from anon;
