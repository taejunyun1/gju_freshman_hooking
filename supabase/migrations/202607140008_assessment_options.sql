create function public.is_valid_assessment_interest_tags(p_tags jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_tag jsonb;
begin
  if pg_catalog.jsonb_typeof(p_tags) <> 'array'
    or pg_catalog.jsonb_array_length(p_tags) not between 1 and 8
  then
    return false;
  end if;

  for v_tag in select value from pg_catalog.jsonb_array_elements(p_tags)
  loop
    if pg_catalog.jsonb_typeof(v_tag) <> 'string'
      or v_tag #>> '{}' !~ '^[a-z][a-z0-9_]{0,63}$'
    then
      return false;
    end if;
  end loop;

  return (
    select pg_catalog.count(*) = pg_catalog.count(distinct tag.value)
    from pg_catalog.jsonb_array_elements_text(p_tags) as tag(value)
  );
end;
$$;

create function public.is_valid_assessment_track_weights(p_weights jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key text;
  v_total integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_weights) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_weights)) <> 4
    or not p_weights ?& array['documentary', 'art_photo', 'commercial', 'video']
  then
    return false;
  end if;

  foreach v_key in array array['documentary', 'art_photo', 'commercial', 'video']
  loop
    if pg_catalog.jsonb_typeof(p_weights -> v_key) <> 'number'
      or p_weights ->> v_key !~ '^[0-3]$'
    then
      return false;
    end if;
    v_total := v_total + (p_weights ->> v_key)::integer;
  end loop;

  return v_total > 0;
end;
$$;

create table public.assessment_options (
  id bigint generated always as identity primary key,
  question_group text not null check (question_group in ('work', 'result', 'style', 'career')),
  option_key text not null check (
    option_key ~ ('^' || question_group || '\.[a-z][a-z0-9_]*$')
  ),
  label text not null check (pg_catalog.char_length(label) between 1 and 200),
  description text check (
    description is null or pg_catalog.char_length(description) between 1 and 500
  ),
  visual_key text not null check (visual_key in (
    'photo_frame',
    'video_frame',
    'edit_timeline',
    'studio_still',
    'interview_strip',
    'location_board',
    'gallery_grid',
    'music_cuts',
    'photobook_spread',
    'project_board',
    'contact_sheet'
  )),
  track_weights jsonb not null check (public.is_valid_assessment_track_weights(track_weights)),
  interest_tags jsonb not null check (public.is_valid_assessment_interest_tags(interest_tags)),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  sort_order smallint not null check (sort_order between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_group, option_key),
  unique (question_group, sort_order)
);

alter table public.assessment_options enable row level security;

revoke all privileges on table public.assessment_options
  from public, anon, authenticated, service_role;
grant select on table public.assessment_options to service_role;

revoke all privileges on sequence public.assessment_options_id_seq
  from public, anon, authenticated, service_role;

revoke all privileges on function public.is_valid_assessment_interest_tags(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_assessment_track_weights(jsonb)
  from public, anon, authenticated, service_role;
