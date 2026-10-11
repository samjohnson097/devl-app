-- Walk-ons (no intake form) are not auto-checked on later game nights.
-- Run this whole file in the Supabase SQL editor.

alter table public.attendance
  add column if not exists manual boolean not null default false;

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
      where public.attendance.manual is not true;
  end loop;
end;
$function$;
