create function public.is_valid_result_track_scores(p_scores jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key text;
  v_score numeric;
begin
  if pg_catalog.jsonb_typeof(p_scores) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_scores)) <> 4
    or not p_scores ?& array['documentary', 'art_photo', 'commercial', 'video']
  then
    return false;
  end if;

  foreach v_key in array array['documentary', 'art_photo', 'commercial', 'video']
  loop
    if pg_catalog.jsonb_typeof(p_scores -> v_key) <> 'number' then
      return false;
    end if;

    v_score := (p_scores ->> v_key)::numeric;
    if v_score < 0 or v_score > 100 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function public.compact_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_type text;
  v_serialized text;
begin
  v_type := pg_catalog.jsonb_typeof(p_value);

  case v_type
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(entry.key)::text
            || ':'
            || public.compact_jsonb_text(entry.value),
          ',' order by entry.key
        ),
        ''
      ) || '}'
      into v_serialized
      from pg_catalog.jsonb_each(p_value) as entry(key, value);
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          public.compact_jsonb_text(entry.value),
          ',' order by entry.position
        ),
        ''
      ) || ']'
      into v_serialized
      from pg_catalog.jsonb_array_elements(p_value) with ordinality as entry(value, position);
    when 'string' then v_serialized := p_value::text;
    when 'number' then v_serialized := p_value::text;
    when 'boolean' then v_serialized := p_value::text;
    when 'null' then v_serialized := p_value::text;
    else raise exception 'unsupported JSONB type';
  end case;

  return v_serialized;
end;
$$;

create function public.compact_jsonb_octet_length(p_value jsonb)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.octet_length(
    pg_catalog.convert_to(public.compact_jsonb_text(p_value), 'UTF8')
  );
$$;

create function public.is_valid_bounded_json_object(p_value jsonb, p_max_bytes integer)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_max_bytes between 2 and 1048576
    and pg_catalog.jsonb_typeof(p_value) = 'object'
    and public.compact_jsonb_octet_length(p_value) <= p_max_bytes;
$$;

create function public.is_safe_relative_asset_path(p_path text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.char_length(p_path) between 1 and 512
    and p_path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    and p_path !~ '(^|/)\.{1,2}(/|$)'
    and p_path !~ '//';
$$;

create function public.is_valid_faculty_contact_visibility(p_visibility jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_visibility) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_visibility)) = 4
    and p_visibility ?& array['office', 'phone', 'email', 'website']
    and not exists (
      select 1
      from pg_catalog.jsonb_each(p_visibility) as entry(key, value)
      where pg_catalog.jsonb_typeof(entry.value) <> 'string'
        or entry.value #>> '{}' not in ('hidden', 'admin_only', 'public')
    );
$$;

create table public.assessments (
  id bigint generated always as identity,
  public_id uuid not null default extensions.gen_random_uuid(),
  prospect_id bigint not null,
  campaign_id bigint,
  idempotency_key uuid not null,
  status text not null default 'completed',
  track_scores jsonb not null,
  environment_score numeric(5,2) not null,
  result_snapshot jsonb not null,
  completed_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  constraint assessments_pk primary key (id),
  constraint assessments_public_id_unique unique (public_id),
  constraint assessments_prospect_idempotency_unique unique (prospect_id, idempotency_key),
  constraint assessments_prospect_fk foreign key (prospect_id)
    references public.prospects(id) on delete cascade,
  constraint assessments_status_check check (status = 'completed'),
  constraint assessments_track_scores_check check (public.is_valid_result_track_scores(track_scores)),
  constraint assessments_environment_score_check check (environment_score between 0 and 100),
  constraint assessments_result_snapshot_check check (
    public.is_valid_bounded_json_object(result_snapshot, 262144)
    and result_snapshot <> '{}'::jsonb
  )
);

create table public.assessment_responses (
  id bigint generated always as identity,
  assessment_id bigint not null,
  question_group text not null,
  option_key text not null,
  option_label_snapshot text not null,
  weight_snapshot jsonb not null,
  free_text text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint assessment_responses_pk primary key (id),
  constraint assessment_responses_assessment_option_unique
    unique (assessment_id, question_group, option_key),
  constraint assessment_responses_assessment_fk foreign key (assessment_id)
    references public.assessments(id) on delete cascade,
  constraint assessment_responses_group_check check (
    question_group in ('work', 'result', 'style', 'career')
  ),
  constraint assessment_responses_option_key_check check (
    pg_catalog.char_length(option_key) between 6 and 71
    and option_key ~ ('^' || question_group || '\.[a-z][a-z0-9_]*$')
  ),
  constraint assessment_responses_label_check check (
    option_label_snapshot = pg_catalog.btrim(option_label_snapshot)
    and pg_catalog.char_length(option_label_snapshot) between 1 and 200
  ),
  constraint assessment_responses_weight_check check (
    public.is_valid_assessment_track_weights(weight_snapshot)
  ),
  constraint assessment_responses_free_text_check check (
    free_text is null
    or (
      question_group = 'career'
      and option_key = 'career.explore'
      and free_text = pg_catalog.btrim(free_text)
      and pg_catalog.char_length(free_text) between 1 and 30
      and free_text !~ '[[:cntrl:]]'
      and free_text !~* '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
      and free_text !~ '(\+?82[-. ]?0?[0-9]{1,2}|0[0-9]{1,2})[-. )]?[0-9]{3,4}[-. ]?[0-9]{4}'
    )
  )
);

create table public.resources (
  id bigint generated always as identity,
  type text not null,
  title text not null,
  summary text not null,
  connection_template text not null,
  status text not null default 'draft',
  visibility text not null default 'hidden',
  priority smallint not null default 0,
  source_date date not null,
  metadata jsonb not null default '{}'::jsonb,
  image_path text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint resources_pk primary key (id),
  constraint resources_type_check check (type in (
    'course', 'equipment', 'facility', 'extracurricular',
    'project', 'student_work', 'career', 'support'
  )),
  constraint resources_title_check check (
    title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 200
  ),
  constraint resources_summary_check check (
    summary = pg_catalog.btrim(summary) and pg_catalog.char_length(summary) between 1 and 1000
  ),
  constraint resources_connection_template_check check (
    connection_template = pg_catalog.btrim(connection_template)
    and pg_catalog.char_length(connection_template) between 1 and 1000
  ),
  constraint resources_status_check check (
    status in ('draft', 'active', 'next_year_confirmed', 'archived')
  ),
  constraint resources_visibility_check check (visibility in ('hidden', 'admin_only', 'public')),
  constraint resources_priority_check check (priority between 0 and 32767),
  constraint resources_metadata_check check (
    public.is_valid_bounded_json_object(metadata, 32768)
  ),
  constraint resources_image_path_check check (
    image_path is null or public.is_safe_relative_asset_path(image_path)
  )
);

create table public.resource_tags (
  id bigint generated always as identity,
  resource_id bigint not null,
  tag_key text not null,
  weight smallint not null,
  is_primary boolean not null default false,
  constraint resource_tags_pk primary key (id),
  constraint resource_tags_resource_tag_unique unique (resource_id, tag_key),
  constraint resource_tags_resource_fk foreign key (resource_id)
    references public.resources(id) on delete cascade,
  constraint resource_tags_key_check check (tag_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint resource_tags_weight_check check (weight between 0 and 3)
);

create table public.equipment_inventory_items (
  id bigint generated always as identity,
  equipment_resource_id bigint not null,
  inventory_code text not null,
  source_row integer not null,
  location_key text not null,
  access_mode text not null,
  availability_state text not null,
  note text,
  data_quality_status text not null,
  source_date date not null,
  constraint equipment_inventory_items_pk primary key (id),
  constraint equipment_inventory_items_resource_fk foreign key (equipment_resource_id)
    references public.resources(id) on delete restrict,
  constraint equipment_inventory_items_code_check check (
    inventory_code = pg_catalog.btrim(inventory_code)
    and pg_catalog.char_length(inventory_code) between 1 and 100
  ),
  constraint equipment_inventory_items_source_row_check check (source_row between 1 and 1000000),
  constraint equipment_inventory_items_location_check check (
    location_key in ('department_equipment_room', 'fantasy_lab')
  ),
  constraint equipment_inventory_items_access_check check (access_mode in ('reservation', 'inquiry')),
  constraint equipment_inventory_items_availability_check check (
    availability_state in ('available', 'unavailable', 'unknown')
  ),
  constraint equipment_inventory_items_note_check check (
    note is null or (
      note = pg_catalog.btrim(note) and pg_catalog.char_length(note) between 1 and 1000
    )
  ),
  constraint equipment_inventory_items_quality_check check (
    data_quality_status in ('verified', 'duplicate_code', 'unidentified', 'quantity_check')
  )
);

create table public.faculty (
  id bigint generated always as identity,
  name text not null,
  title text not null,
  employment_type text not null,
  consultation_role text not null,
  office text,
  phone text,
  email text,
  website text,
  contact_visibility jsonb not null default '{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"}'::jsonb,
  expertise_summary text not null,
  bio text not null,
  profile_sections jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  weekly_capacity smallint not null default 0,
  priority smallint not null default 0,
  source_date date not null,
  last_verified_at timestamptz,
  image_path text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint faculty_pk primary key (id),
  constraint faculty_name_check check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 100
  ),
  constraint faculty_title_check check (
    title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 100
  ),
  constraint faculty_employment_type_check check (
    employment_type in ('full_time', 'adjunct', 'practitioner')
  ),
  constraint faculty_consultation_role_check check (consultation_role in ('primary', 'specialist')),
  constraint faculty_office_check check (
    office is null or (office = pg_catalog.btrim(office) and pg_catalog.char_length(office) between 1 and 200)
  ),
  constraint faculty_phone_check check (
    phone is null or (
      phone = pg_catalog.btrim(phone)
      and pg_catalog.char_length(phone) between 1 and 40
      and phone ~ '^[+0-9(). -]+$'
    )
  ),
  constraint faculty_email_check check (
    email is null or (
      email = pg_catalog.btrim(email)
      and pg_catalog.char_length(email) between 3 and 254
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint faculty_website_check check (
    website is null or (
      website = pg_catalog.btrim(website)
      and pg_catalog.char_length(website) between 8 and 500
      and website ~ '^https://[A-Za-z0-9]'
    )
  ),
  constraint faculty_contact_visibility_check check (
    public.is_valid_faculty_contact_visibility(contact_visibility)
  ),
  constraint faculty_expertise_summary_check check (
    expertise_summary = pg_catalog.btrim(expertise_summary)
    and pg_catalog.char_length(expertise_summary) between 1 and 1000
  ),
  constraint faculty_bio_check check (
    bio = pg_catalog.btrim(bio) and pg_catalog.char_length(bio) between 1 and 8000
  ),
  constraint faculty_profile_sections_check check (
    public.is_valid_bounded_json_object(profile_sections, 65536)
  ),
  constraint faculty_status_check check (status in ('draft', 'active', 'archived')),
  constraint faculty_weekly_capacity_check check (weekly_capacity between 0 and 32767),
  constraint faculty_priority_check check (priority between 0 and 32767),
  constraint faculty_image_path_check check (
    image_path is null or public.is_safe_relative_asset_path(image_path)
  )
);

create table public.faculty_tags (
  id bigint generated always as identity,
  faculty_id bigint not null,
  tag_key text not null,
  tag_label text not null,
  category text not null,
  weight smallint not null,
  is_primary boolean not null default false,
  constraint faculty_tags_pk primary key (id),
  constraint faculty_tags_faculty_tag_category_unique unique (faculty_id, tag_key, category),
  constraint faculty_tags_faculty_fk foreign key (faculty_id)
    references public.faculty(id) on delete cascade,
  constraint faculty_tags_key_check check (tag_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint faculty_tags_label_check check (
    tag_label = pg_catalog.btrim(tag_label) and pg_catalog.char_length(tag_label) between 1 and 100
  ),
  constraint faculty_tags_category_check check (
    category in ('track', 'activity', 'result', 'career', 'specialist')
  ),
  constraint faculty_tags_weight_check check (weight between 0 and 3)
);

create table public.faculty_specialist_links (
  id bigint generated always as identity,
  primary_faculty_id bigint,
  specialist_faculty_id bigint not null,
  tag_key text not null,
  priority smallint not null default 0,
  explanation_template text not null,
  constraint faculty_specialist_links_pk primary key (id),
  constraint faculty_specialist_links_primary_fk foreign key (primary_faculty_id)
    references public.faculty(id) on delete restrict,
  constraint faculty_specialist_links_specialist_fk foreign key (specialist_faculty_id)
    references public.faculty(id) on delete restrict,
  constraint faculty_specialist_links_self_check check (
    primary_faculty_id is null or primary_faculty_id <> specialist_faculty_id
  ),
  constraint faculty_specialist_links_tag_key_check check (
    tag_key ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  constraint faculty_specialist_links_priority_check check (priority between 0 and 32767),
  constraint faculty_specialist_links_explanation_check check (
    explanation_template = pg_catalog.btrim(explanation_template)
    and pg_catalog.char_length(explanation_template) between 1 and 1000
  ),
  constraint faculty_specialist_links_unique_idx
    unique nulls not distinct (primary_faculty_id, specialist_faculty_id, tag_key)
);

create index assessments_recent_completed_idx
  on public.assessments(prospect_id, completed_at desc)
  where status = 'completed';

create index resources_matching_idx
  on public.resources(type, status, visibility, priority desc);

create index resources_publishable_source_date_idx
  on public.resources(source_date desc)
  where status in ('active', 'next_year_confirmed');

create index resource_tags_lookup_idx
  on public.resource_tags(tag_key, weight desc);

create index equipment_inventory_resource_quality_idx
  on public.equipment_inventory_items(equipment_resource_id, data_quality_status);

create index equipment_inventory_code_idx
  on public.equipment_inventory_items(inventory_code);

create index faculty_matching_idx
  on public.faculty(status, employment_type, consultation_role, priority desc);

create index faculty_tags_lookup_idx
  on public.faculty_tags(tag_key, category, weight desc);

create index faculty_specialist_links_lookup_idx
  on public.faculty_specialist_links(primary_faculty_id, tag_key, priority desc);

create index faculty_specialist_links_specialist_idx
  on public.faculty_specialist_links(specialist_faculty_id);

create function public.complete_assessment(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_campaign_id bigint,
  p_track_scores jsonb,
  p_environment_score numeric,
  p_result_snapshot jsonb,
  p_responses jsonb
)
returns table(
  assessment_id bigint,
  public_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked_prospect_id bigint;
  v_assessment_id bigint;
  v_public_id uuid;
  v_completed_at timestamptz;
  v_response jsonb;
begin
  select prospect.id
  into v_locked_prospect_id
  from public.prospects prospect
  where prospect.id = p_prospect_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'prospect not found';
  end if;

  select assessment.id, assessment.public_id
  into v_assessment_id, v_public_id
  from public.assessments assessment
  where assessment.prospect_id = p_prospect_id
    and assessment.idempotency_key = p_idempotency_key
  for update;

  if found then
    return query select v_assessment_id, v_public_id, false;
    return;
  end if;

  v_completed_at := pg_catalog.clock_timestamp();

  if p_responses is null
    or pg_catalog.jsonb_typeof(p_responses) <> 'array'
    or pg_catalog.jsonb_array_length(p_responses) not between 4 and 11
  then
    raise exception using
      errcode = '22023',
      message = 'responses must be an array containing 4 to 11 entries';
  end if;

  for v_response in
    select response.value
    from pg_catalog.jsonb_array_elements(p_responses) as response(value)
  loop
    if pg_catalog.jsonb_typeof(v_response) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_response)) <> 5
      or not v_response ?& array[
        'question_group',
        'option_key',
        'option_label_snapshot',
        'weight_snapshot',
        'free_text'
      ]
      or pg_catalog.jsonb_typeof(v_response -> 'question_group') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'option_key') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'option_label_snapshot') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'weight_snapshot') <> 'object'
      or pg_catalog.jsonb_typeof(v_response -> 'free_text') not in ('string', 'null')
    then
      raise exception using
        errcode = '22023',
        message = 'response entries must contain the exact snapshot fields';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_responses) as response(value)
    group by
      response.value ->> 'question_group',
      response.value ->> 'option_key'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'response identities must be unique';
  end if;

  insert into public.assessments (
    prospect_id,
    campaign_id,
    idempotency_key,
    track_scores,
    environment_score,
    result_snapshot,
    completed_at,
    created_at
  ) values (
    p_prospect_id,
    p_campaign_id,
    p_idempotency_key,
    p_track_scores,
    p_environment_score,
    p_result_snapshot,
    v_completed_at,
    v_completed_at
  )
  returning id, assessments.public_id
  into v_assessment_id, v_public_id;

  insert into public.assessment_responses (
    assessment_id,
    question_group,
    option_key,
    option_label_snapshot,
    weight_snapshot,
    free_text
  )
  select
    v_assessment_id,
    response.value ->> 'question_group',
    response.value ->> 'option_key',
    response.value ->> 'option_label_snapshot',
    response.value -> 'weight_snapshot',
    case
      when pg_catalog.jsonb_typeof(response.value -> 'free_text') = 'null' then null
      else response.value ->> 'free_text'
    end
  from pg_catalog.jsonb_array_elements(p_responses) as response(value);

  update public.prospects prospect
  set last_active_at = pg_catalog.clock_timestamp()
  where prospect.id = v_locked_prospect_id;

  delete from public.assessments assessment
  where assessment.prospect_id = p_prospect_id
    and assessment.id in (
      select retained.id
      from public.assessments retained
      where retained.prospect_id = p_prospect_id
      order by retained.completed_at desc, retained.id desc
      offset 3
    );

  return query select v_assessment_id, v_public_id, true;
end;
$$;

alter table public.assessments enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.resources enable row level security;
alter table public.resource_tags enable row level security;
alter table public.equipment_inventory_items enable row level security;
alter table public.faculty enable row level security;
alter table public.faculty_tags enable row level security;
alter table public.faculty_specialist_links enable row level security;

revoke all privileges on table
  public.assessments,
  public.assessment_responses,
  public.resources,
  public.resource_tags,
  public.equipment_inventory_items,
  public.faculty,
  public.faculty_tags,
  public.faculty_specialist_links
from public, anon, authenticated, service_role;

grant select on table
  public.assessments,
  public.assessment_responses,
  public.resources,
  public.resource_tags,
  public.equipment_inventory_items,
  public.faculty,
  public.faculty_tags,
  public.faculty_specialist_links
to service_role;

revoke all privileges on sequence
  public.assessments_id_seq,
  public.assessment_responses_id_seq,
  public.resources_id_seq,
  public.resource_tags_id_seq,
  public.equipment_inventory_items_id_seq,
  public.faculty_id_seq,
  public.faculty_tags_id_seq,
  public.faculty_specialist_links_id_seq
from public, anon, authenticated, service_role;

revoke all privileges on function public.is_valid_result_track_scores(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.compact_jsonb_text(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.compact_jsonb_octet_length(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_bounded_json_object(jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_safe_relative_asset_path(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_faculty_contact_visibility(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.complete_assessment(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_assessment(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb
) to service_role;
