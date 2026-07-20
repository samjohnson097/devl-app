-- Season gold/silver winners photos (Storage + season URL columns + admin RPC).

alter table public.seasons
  add column if not exists gold_winners_photo_url text,
  add column if not exists silver_winners_photo_url text;

drop function if exists public.admin_set_winners_photo(text, text, text);
create or replace function public.admin_set_winners_photo(
  p_season_slug text,
  p_bracket text,
  p_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_season uuid;
  v_bracket text;
  v_url text;
begin
  perform public.assert_authenticated();
  select id into v_season from public.seasons where slug = p_season_slug;
  if v_season is null then raise exception 'Season not found'; end if;

  v_bracket := lower(trim(coalesce(p_bracket, '')));
  if v_bracket not in ('gold', 'silver') then
    raise exception 'Bracket must be gold or silver';
  end if;

  v_url := nullif(trim(coalesce(p_photo_url, '')), '');

  if v_bracket = 'gold' then
    update public.seasons
    set gold_winners_photo_url = v_url
    where id = v_season;
  else
    update public.seasons
    set silver_winners_photo_url = v_url
    where id = v_season;
  end if;
end;
$$;

grant execute on function public.admin_set_winners_photo(text, text, text) to authenticated;
revoke execute on function public.admin_set_winners_photo(text, text, text) from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'season-winners',
  'season-winners',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "season_winners_public_read" on storage.objects;
create policy "season_winners_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'season-winners');

drop policy if exists "season_winners_auth_insert" on storage.objects;
create policy "season_winners_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'season-winners');

drop policy if exists "season_winners_auth_update" on storage.objects;
create policy "season_winners_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'season-winners')
  with check (bucket_id = 'season-winners');

drop policy if exists "season_winners_auth_delete" on storage.objects;
create policy "season_winners_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'season-winners');
