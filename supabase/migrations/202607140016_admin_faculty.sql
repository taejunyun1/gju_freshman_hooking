alter table public.faculty force row level security;
alter table public.faculty_tags force row level security;
alter table public.faculty_specialist_links force row level security;

create function public.admin_faculty_payload_error(
  p_faculty jsonb,
  p_tags jsonb,
  p_links jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_employment_type text;
  v_consultation_role text;
begin
  if p_faculty is null
    or pg_catalog.jsonb_typeof(p_faculty) <> 'object'
    or public.compact_jsonb_octet_length(p_faculty) > 131072
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_faculty)) <> 17
    or not p_faculty ?& array[
      'name', 'title', 'employmentType', 'consultationRole', 'office', 'phone',
      'email', 'website', 'contactVisibility', 'expertiseSummary', 'bio',
      'profileSections', 'weeklyCapacity', 'priority', 'sourceDate',
      'lastVerifiedAt', 'imagePath'
    ]
  then
    return 'FACULTY_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_faculty -> 'name') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'title') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'employmentType') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'consultationRole') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'expertiseSummary') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'bio') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'sourceDate') <> 'string'
    or pg_catalog.jsonb_typeof(p_faculty -> 'weeklyCapacity') <> 'number'
    or pg_catalog.jsonb_typeof(p_faculty -> 'priority') <> 'number'
    or pg_catalog.jsonb_typeof(p_faculty -> 'contactVisibility') <> 'object'
    or not public.is_valid_faculty_contact_visibility(p_faculty -> 'contactVisibility')
    or pg_catalog.jsonb_typeof(p_faculty -> 'profileSections') <> 'object'
    or not public.is_valid_bounded_json_object(p_faculty -> 'profileSections', 65536)
    or (p_faculty -> 'office') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'office') <> 'string'
    or (p_faculty -> 'phone') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'phone') <> 'string'
    or (p_faculty -> 'email') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'email') <> 'string'
    or (p_faculty -> 'website') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'website') <> 'string'
    or (p_faculty -> 'lastVerifiedAt') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'lastVerifiedAt') <> 'string'
    or (p_faculty -> 'imagePath') <> 'null'::jsonb and pg_catalog.jsonb_typeof(p_faculty -> 'imagePath') <> 'string'
  then
    return 'FACULTY_INVALID';
  end if;

  if (p_faculty ->> 'name') <> pg_catalog.btrim(p_faculty ->> 'name')
    or pg_catalog.char_length(p_faculty ->> 'name') not between 1 and 100
    or (p_faculty ->> 'name') ~ '[[:cntrl:]]'
    or (p_faculty ->> 'title') <> pg_catalog.btrim(p_faculty ->> 'title')
    or pg_catalog.char_length(p_faculty ->> 'title') not between 1 and 100
    or (p_faculty ->> 'title') ~ '[[:cntrl:]]'
    or (p_faculty ->> 'expertiseSummary') <> pg_catalog.btrim(p_faculty ->> 'expertiseSummary')
    or pg_catalog.char_length(p_faculty ->> 'expertiseSummary') not between 1 and 1000
    or (p_faculty ->> 'expertiseSummary') ~ '[[:cntrl:]]'
    or (p_faculty ->> 'bio') <> pg_catalog.btrim(p_faculty ->> 'bio')
    or pg_catalog.char_length(p_faculty ->> 'bio') not between 1 and 8000
    or pg_catalog.replace(p_faculty ->> 'bio', E'\n', '') ~ '[[:cntrl:]]'
    or ((p_faculty -> 'office') <> 'null'::jsonb and (
      (p_faculty ->> 'office') <> pg_catalog.btrim(p_faculty ->> 'office')
      or pg_catalog.char_length(p_faculty ->> 'office') not between 1 and 200
      or (p_faculty ->> 'office') ~ '[[:cntrl:]]'
    ))
    or ((p_faculty -> 'phone') <> 'null'::jsonb and (
      (p_faculty ->> 'phone') <> pg_catalog.btrim(p_faculty ->> 'phone')
      or pg_catalog.char_length(p_faculty ->> 'phone') not between 1 and 40
      or (p_faculty ->> 'phone') !~ '^[+0-9(). -]+$'
    ))
    or ((p_faculty -> 'email') <> 'null'::jsonb and (
      (p_faculty ->> 'email') <> pg_catalog.btrim(p_faculty ->> 'email')
      or pg_catalog.char_length(p_faculty ->> 'email') not between 3 and 254
      or (p_faculty ->> 'email') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (p_faculty ->> 'email') ~ '[[:cntrl:]]'
    ))
    or ((p_faculty -> 'website') <> 'null'::jsonb and (
      (p_faculty ->> 'website') <> pg_catalog.btrim(p_faculty ->> 'website')
      or pg_catalog.char_length(p_faculty ->> 'website') not between 8 and 500
      or (p_faculty ->> 'website') !~ '^https://[A-Za-z0-9]'
      or (p_faculty ->> 'website') ~ '[@#[:space:][:cntrl:]]'
    ))
  then
    return 'FACULTY_INVALID';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_faculty -> 'profileSections')) <> 8
    or not (p_faculty -> 'profileSections') ?& array[
      'recommendationRole', 'education', 'careers', 'teachingFields',
      'studentProjects', 'careerPaths', 'institutionProjects', 'majorWorks'
    ]
    or pg_catalog.jsonb_typeof(p_faculty -> 'profileSections' -> 'recommendationRole') <> 'string'
    or (p_faculty -> 'profileSections' ->> 'recommendationRole')
      <> pg_catalog.btrim(p_faculty -> 'profileSections' ->> 'recommendationRole')
    or pg_catalog.char_length(p_faculty -> 'profileSections' ->> 'recommendationRole') not between 1 and 1000
    or (p_faculty -> 'profileSections' ->> 'recommendationRole') ~ '[[:cntrl:]]'
    or exists (
      select 1
      from pg_catalog.jsonb_each(p_faculty -> 'profileSections') section(key, value)
      where section.key <> 'recommendationRole'
        and (
          pg_catalog.jsonb_typeof(section.value) <> 'array'
          or pg_catalog.jsonb_array_length(section.value) > 100
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(section.value) item(value)
            where pg_catalog.jsonb_typeof(item.value) <> 'string'
              or (item.value #>> '{}') <> pg_catalog.btrim(item.value #>> '{}')
              or pg_catalog.char_length(item.value #>> '{}') not between 1 and 1000
              or (item.value #>> '{}') ~ '[[:cntrl:]]'
          )
        )
    )
  then
    return 'FACULTY_INVALID';
  end if;

  v_employment_type := p_faculty ->> 'employmentType';
  v_consultation_role := p_faculty ->> 'consultationRole';
  if (v_employment_type = 'full_time' and v_consultation_role <> 'primary')
    or (v_employment_type in ('adjunct', 'practitioner') and v_consultation_role <> 'specialist')
    or v_employment_type not in ('full_time', 'adjunct', 'practitioner')
    or v_consultation_role not in ('primary', 'specialist')
  then
    return 'FACULTY_ROLE_INVALID';
  end if;

  if (p_faculty ->> 'weeklyCapacity')::numeric <> pg_catalog.trunc((p_faculty ->> 'weeklyCapacity')::numeric)
    or (p_faculty ->> 'weeklyCapacity')::numeric not between 0 and 32767
    or (p_faculty ->> 'priority')::numeric <> pg_catalog.trunc((p_faculty ->> 'priority')::numeric)
    or (p_faculty ->> 'priority')::numeric not between 0 and 32767
    or (p_faculty ->> 'sourceDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or ((p_faculty -> 'lastVerifiedAt') <> 'null'::jsonb and (
      pg_catalog.char_length(p_faculty ->> 'lastVerifiedAt') > 40
      or (p_faculty ->> 'lastVerifiedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    ))
    or ((p_faculty -> 'imagePath') <> 'null'::jsonb and not public.is_safe_relative_asset_path(p_faculty ->> 'imagePath'))
  then
    return 'FACULTY_INVALID';
  end if;

  if p_tags is null
    or pg_catalog.jsonb_typeof(p_tags) <> 'array'
    or public.compact_jsonb_octet_length(p_tags) > 65536
    or pg_catalog.jsonb_array_length(p_tags) not between 1 and 100
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_tags) tag(value)
      where pg_catalog.jsonb_typeof(tag.value) <> 'object'
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(tag.value)) <> 5
        or not tag.value ?& array['key', 'label', 'category', 'weight', 'isPrimary']
        or pg_catalog.jsonb_typeof(tag.value -> 'key') <> 'string'
        or pg_catalog.jsonb_typeof(tag.value -> 'label') <> 'string'
        or pg_catalog.jsonb_typeof(tag.value -> 'category') <> 'string'
        or pg_catalog.jsonb_typeof(tag.value -> 'weight') <> 'number'
        or pg_catalog.jsonb_typeof(tag.value -> 'isPrimary') <> 'boolean'
        or (tag.value ->> 'key') !~ '^[a-z][a-z0-9_]{0,63}$'
        or (tag.value ->> 'label') <> pg_catalog.btrim(tag.value ->> 'label')
        or pg_catalog.char_length(tag.value ->> 'label') not between 1 and 100
        or (tag.value ->> 'label') ~ '[[:cntrl:]]'
        or (tag.value ->> 'category') not in ('track', 'activity', 'result', 'career', 'specialist')
        or (tag.value ->> 'weight')::numeric <> pg_catalog.trunc((tag.value ->> 'weight')::numeric)
        or (tag.value ->> 'weight')::numeric not between 0 and 3
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_tags) tag(value)
      group by tag.value ->> 'key', tag.value ->> 'category'
      having pg_catalog.count(*) > 1
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_tags) tag(value)
      where (tag.value ->> 'isPrimary')::boolean
      group by tag.value ->> 'category'
      having pg_catalog.count(*) > 1
    )
  then
    return 'FACULTY_TAG_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_tags) tag(value)
    where tag.value ->> 'category' = 'track'
      and (tag.value ->> 'key', tag.value ->> 'label') not in (
        ('documentary', '다큐멘터리 사진'),
        ('art_photo', '예술사진'),
        ('commercial', '광고사진'),
        ('video', '영상과 기술(AI·편집·드론)')
      )
  ) then
    return 'FACULTY_TAXONOMY_INVALID';
  end if;

  if p_links is null
    or pg_catalog.jsonb_typeof(p_links) <> 'array'
    or public.compact_jsonb_octet_length(p_links) > 65536
    or pg_catalog.jsonb_array_length(p_links) > 64
    or (v_consultation_role = 'primary' and pg_catalog.jsonb_array_length(p_links) <> 0)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_links) link(value)
      where pg_catalog.jsonb_typeof(link.value) <> 'object'
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(link.value)) <> 4
        or not link.value ?& array['primaryFacultyId', 'tagKey', 'priority', 'explanationTemplate']
        or ((link.value -> 'primaryFacultyId') <> 'null'::jsonb and pg_catalog.jsonb_typeof(link.value -> 'primaryFacultyId') <> 'number')
        or pg_catalog.jsonb_typeof(link.value -> 'tagKey') <> 'string'
        or pg_catalog.jsonb_typeof(link.value -> 'priority') <> 'number'
        or pg_catalog.jsonb_typeof(link.value -> 'explanationTemplate') <> 'string'
        or ((link.value -> 'primaryFacultyId') <> 'null'::jsonb and (
          (link.value ->> 'primaryFacultyId')::numeric <> pg_catalog.trunc((link.value ->> 'primaryFacultyId')::numeric)
          or (link.value ->> 'primaryFacultyId')::numeric not between 1 and 9223372036854775807
        ))
        or (link.value ->> 'tagKey') !~ '^[a-z][a-z0-9_]{0,63}$'
        or (link.value ->> 'priority')::numeric <> pg_catalog.trunc((link.value ->> 'priority')::numeric)
        or (link.value ->> 'priority')::numeric not between 0 and 32767
        or (link.value ->> 'explanationTemplate') <> pg_catalog.btrim(link.value ->> 'explanationTemplate')
        or pg_catalog.char_length(link.value ->> 'explanationTemplate') not between 1 and 1000
        or (link.value ->> 'explanationTemplate') ~ '[[:cntrl:]]'
        or (link.value ->> 'explanationTemplate') ~ '(고정[[:space:]]*배정|배정[[:space:]]*완료|담당[[:space:]]*확정)'
        or not exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_tags) tag(value)
          where tag.value ->> 'category' = 'specialist'
            and tag.value ->> 'key' = link.value ->> 'tagKey'
        )
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_links) link(value)
      group by coalesce(link.value ->> 'primaryFacultyId', 'null'), link.value ->> 'tagKey'
      having pg_catalog.count(*) > 1
    )
  then
    return 'FACULTY_LINK_INVALID';
  end if;

  return null;
exception when others then
  return 'FACULTY_INVALID';
end;
$$;

create function public.update_admin_faculty(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_faculty_id bigint,
  p_request_id uuid,
  p_faculty jsonb,
  p_tags jsonb,
  p_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.faculty%rowtype;
  v_error text;
  v_last_verified_at timestamptz;
  v_source_date date;
  v_updated_at timestamptz;
  v_changed_fields jsonb;
  v_current_tags jsonb;
  v_proposed_tags jsonb;
  v_current_links jsonb;
  v_proposed_links jsonb;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if p_expected_updated_at is null or not pg_catalog.isfinite(p_expected_updated_at)
    or p_faculty_id is null or p_faculty_id < 1 or p_request_id is null
  then
    return '{"status":"validation_error","code":"FACULTY_INVALID"}'::jsonb;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(202607140016);

  select * into v_current
  from public.faculty
  where id = p_faculty_id
  FOR UPDATE;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_current.updated_at IS DISTINCT FROM p_expected_updated_at then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict', 'facultyUpdatedAt', v_current.updated_at
    );
  end if;

  v_error := public.admin_faculty_payload_error(p_faculty, p_tags, p_links);
  if v_error is not null then
    return pg_catalog.jsonb_build_object('status', 'validation_error', 'code', v_error);
  end if;

  begin
    v_source_date := (p_faculty ->> 'sourceDate')::date;
    if (p_faculty -> 'lastVerifiedAt') <> 'null'::jsonb then
      v_last_verified_at := (p_faculty ->> 'lastVerifiedAt')::timestamptz;
    end if;
  exception when others then
    return '{"status":"validation_error","code":"FACULTY_INVALID"}'::jsonb;
  end;
  if v_last_verified_at is not null and (
    not pg_catalog.isfinite(v_last_verified_at)
    or v_last_verified_at > pg_catalog.clock_timestamp()
  ) then
    return '{"status":"validation_error","code":"CONTACT_VERIFICATION_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(p_faculty -> 'contactVisibility') visibility(field, value)
    where visibility.value = 'public'
  )
    and v_current.last_verified_at is not null
    and v_last_verified_at < v_current.last_verified_at
  then
    return '{"status":"validation_error","code":"CONTACT_VERIFICATION_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(p_faculty -> 'contactVisibility') visibility(field, value)
    where visibility.value = 'public'
      and (
        v_current.contact_visibility ->> visibility.field is distinct from 'public'
        or case visibility.field
          when 'office' then v_current.office
          when 'phone' then v_current.phone
          when 'email' then v_current.email
          when 'website' then v_current.website
          else null
        end is distinct from case visibility.field
          when 'office' then p_faculty ->> 'office'
          when 'phone' then p_faculty ->> 'phone'
          when 'email' then p_faculty ->> 'email'
          when 'website' then p_faculty ->> 'website'
          else null
        end
      )
  ) and (
    v_last_verified_at is null
    or (
      v_current.last_verified_at is not null
      and v_last_verified_at <= v_current.last_verified_at
    )
  ) then
    return '{"status":"validation_error","code":"CONTACT_VERIFICATION_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(p_faculty -> 'contactVisibility') visibility(field, value)
    where visibility.value = 'public'
      and nullif(case visibility.field
        when 'office' then p_faculty ->> 'office'
        when 'phone' then p_faculty ->> 'phone'
        when 'email' then p_faculty ->> 'email'
        when 'website' then p_faculty ->> 'website'
        else null
      end, '') is null
  ) or (
    exists (
      select 1
      from pg_catalog.jsonb_each_text(p_faculty -> 'contactVisibility') visibility(field, value)
      where visibility.value = 'public'
    )
    and v_last_verified_at is null
  ) then
    return '{"status":"validation_error","code":"CONTACT_VERIFICATION_REQUIRED"}'::jsonb;
  end if;

  if v_current.status = 'active'
    and p_faculty ->> 'consultationRole' = 'primary'
    and (p_faculty ->> 'weeklyCapacity')::integer <= 0
  then
    return '{"status":"validation_error","code":"FACULTY_CAPACITY_REQUIRED"}'::jsonb;
  end if;
  if p_faculty ->> 'consultationRole' = 'specialist'
    and (p_faculty ->> 'weeklyCapacity')::integer <> 0
  then
    return '{"status":"validation_error","code":"FACULTY_CAPACITY_REQUIRED"}'::jsonb;
  end if;
  if v_current.status = 'active'
    and p_faculty ->> 'consultationRole' = 'specialist'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_tags) tag(value)
      where tag.value ->> 'category' = 'specialist'
        and (tag.value ->> 'weight')::integer > 0
    )
  then
    return '{"status":"validation_error","code":"FACULTY_SPECIALIST_TAG_REQUIRED"}'::jsonb;
  end if;

  if v_current.name = '윤태준' and (
    p_faculty ->> 'name' <> '윤태준'
    or pg_catalog.strpos(p_faculty ->> 'expertiseSummary', '예술사진') = 0
    or pg_catalog.strpos(p_faculty ->> 'expertiseSummary', '영상') = 0
    or pg_catalog.strpos(p_faculty ->> 'expertiseSummary', 'AI') = 0
    or pg_catalog.strpos(p_faculty ->> 'expertiseSummary', '기술적 이미지') = 0
    or exists (
      select required.key
      from (values ('art_photo'), ('video'), ('ai')) required(key)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_tags) tag(value)
        where tag.value ->> 'key' = required.key
          and tag.value ->> 'category' <> 'specialist'
      )
    )
  ) then
    return '{"status":"validation_error","code":"FACULTY_YOON_SCOPE_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_links) link(value)
    where link.value -> 'primaryFacultyId' <> 'null'::jsonb
      and (link.value ->> 'primaryFacultyId')::bigint = p_faculty_id
  ) then
    return '{"status":"validation_error","code":"FACULTY_LINK_INVALID"}'::jsonb;
  end if;

  perform related.id
  from public.faculty related
  where related.id in (
    select (link.value ->> 'primaryFacultyId')::bigint
    from pg_catalog.jsonb_array_elements(p_links) link(value)
    where link.value -> 'primaryFacultyId' <> 'null'::jsonb
  )
  order by related.id
  for update;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_links) link(value)
    left join public.faculty related
      on related.id = (link.value ->> 'primaryFacultyId')::bigint
    where link.value -> 'primaryFacultyId' <> 'null'::jsonb
      and (
        related.id is null
        or related.status <> 'active'
        or related.employment_type <> 'full_time'
        or related.consultation_role <> 'primary'
      )
  ) then
    return '{"status":"validation_error","code":"FACULTY_LINK_INVALID"}'::jsonb;
  end if;

  perform related.id
  from public.faculty_specialist_links link
  join public.faculty related on related.id = link.specialist_faculty_id
  where link.primary_faculty_id = p_faculty_id
  order by related.id
  for update of related;
  if exists (
    select 1
    from public.faculty_specialist_links link
    where link.primary_faculty_id = p_faculty_id
  ) and (
    p_faculty ->> 'employmentType' <> 'full_time'
    or p_faculty ->> 'consultationRole' <> 'primary'
    or v_current.status <> 'active'
  ) then
    return '{"status":"validation_error","code":"FACULTY_LINK_INVALID"}'::jsonb;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key', tag.tag_key,
        'label', tag.tag_label,
        'category', tag.category,
        'weight', tag.weight,
        'isPrimary', tag.is_primary
      ) order by tag.category, tag.tag_key
    ),
    '[]'::jsonb
  ) into v_current_tags
  from public.faculty_tags tag
  where tag.faculty_id = p_faculty_id;
  select coalesce(
    pg_catalog.jsonb_agg(tag.value order by tag.value ->> 'category', tag.value ->> 'key'),
    '[]'::jsonb
  ) into v_proposed_tags
  from pg_catalog.jsonb_array_elements(p_tags) tag(value);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'primaryFacultyId', link.primary_faculty_id,
        'tagKey', link.tag_key,
        'priority', link.priority,
        'explanationTemplate', link.explanation_template
      ) order by link.primary_faculty_id nulls first, link.tag_key
    ),
    '[]'::jsonb
  ) into v_current_links
  from public.faculty_specialist_links link
  where link.specialist_faculty_id = p_faculty_id;
  select coalesce(
    pg_catalog.jsonb_agg(
      link.value order by
        case when link.value -> 'primaryFacultyId' = 'null'::jsonb then null
          else (link.value ->> 'primaryFacultyId')::bigint end nulls first,
        link.value ->> 'tagKey'
    ),
    '[]'::jsonb
  ) into v_proposed_links
  from pg_catalog.jsonb_array_elements(p_links) link(value);

  select coalesce(pg_catalog.jsonb_agg(changed.field order by changed.ordinal), '[]'::jsonb)
  into v_changed_fields
  from (values
    (1, 'name', v_current.name is distinct from p_faculty ->> 'name'),
    (2, 'title', v_current.title is distinct from p_faculty ->> 'title'),
    (3, 'employmentType', v_current.employment_type is distinct from p_faculty ->> 'employmentType'),
    (4, 'consultationRole', v_current.consultation_role is distinct from p_faculty ->> 'consultationRole'),
    (5, 'contacts',
      pg_catalog.jsonb_build_object(
        'office', v_current.office,
        'phone', v_current.phone,
        'email', v_current.email,
        'website', v_current.website
      ) is distinct from pg_catalog.jsonb_build_object(
        'office', nullif(p_faculty ->> 'office', ''),
        'phone', nullif(p_faculty ->> 'phone', ''),
        'email', nullif(p_faculty ->> 'email', ''),
        'website', nullif(p_faculty ->> 'website', '')
      )
    ),
    (6, 'contactVisibility', v_current.contact_visibility is distinct from p_faculty -> 'contactVisibility'),
    (7, 'expertiseSummary', v_current.expertise_summary is distinct from p_faculty ->> 'expertiseSummary'),
    (8, 'bio', v_current.bio is distinct from p_faculty ->> 'bio'),
    (9, 'profileSections', v_current.profile_sections is distinct from p_faculty -> 'profileSections'),
    (10, 'weeklyCapacity', v_current.weekly_capacity is distinct from (p_faculty ->> 'weeklyCapacity')::smallint),
    (11, 'priority', v_current.priority is distinct from (p_faculty ->> 'priority')::smallint),
    (12, 'sourceDate', v_current.source_date is distinct from v_source_date),
    (13, 'lastVerifiedAt', v_current.last_verified_at is distinct from v_last_verified_at),
    (14, 'imagePath', v_current.image_path is distinct from nullif(p_faculty ->> 'imagePath', '')),
    (15, 'tags', v_current_tags is distinct from v_proposed_tags),
    (16, 'specialistLinks', v_current_links is distinct from v_proposed_links)
  ) changed(ordinal, field, is_changed)
  where changed.is_changed;

  begin
    v_updated_at := pg_catalog.clock_timestamp();
    if v_updated_at <= v_current.updated_at then
      v_updated_at := v_current.updated_at + interval '1 microsecond';
    end if;
    update public.faculty
    set name = p_faculty ->> 'name',
        title = p_faculty ->> 'title',
        employment_type = p_faculty ->> 'employmentType',
        consultation_role = p_faculty ->> 'consultationRole',
        office = nullif(p_faculty ->> 'office', ''),
        phone = nullif(p_faculty ->> 'phone', ''),
        email = nullif(p_faculty ->> 'email', ''),
        website = nullif(p_faculty ->> 'website', ''),
        contact_visibility = p_faculty -> 'contactVisibility',
        expertise_summary = p_faculty ->> 'expertiseSummary',
        bio = p_faculty ->> 'bio',
        profile_sections = p_faculty -> 'profileSections',
        weekly_capacity = (p_faculty ->> 'weeklyCapacity')::smallint,
        priority = (p_faculty ->> 'priority')::smallint,
        source_date = v_source_date,
        last_verified_at = v_last_verified_at,
        image_path = nullif(p_faculty ->> 'imagePath', ''),
        updated_at = v_updated_at
    where id = p_faculty_id;

    delete from public.faculty_specialist_links where specialist_faculty_id = p_faculty_id;
    delete from public.faculty_tags where faculty_id = p_faculty_id;

    insert into public.faculty_tags(
      faculty_id, tag_key, tag_label, category, weight, is_primary
    )
    select p_faculty_id, tag.value ->> 'key', tag.value ->> 'label',
      tag.value ->> 'category', (tag.value ->> 'weight')::smallint,
      (tag.value ->> 'isPrimary')::boolean
    from pg_catalog.jsonb_array_elements(p_tags) tag(value);

    insert into public.faculty_specialist_links(
      primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template
    )
    select case when link.value -> 'primaryFacultyId' = 'null'::jsonb then null
        else (link.value ->> 'primaryFacultyId')::bigint end,
      p_faculty_id, link.value ->> 'tagKey', (link.value ->> 'priority')::smallint,
      link.value ->> 'explanationTemplate'
    from pg_catalog.jsonb_array_elements(p_links) link(value);

    insert into public.audit_events(
      admin_user_id, action, target_type, target_id, metadata, request_id
    ) values (
      p_admin_user_id, 'faculty_updated', 'faculty', p_faculty_id::text,
      pg_catalog.jsonb_build_object(
        'changedFields', v_changed_fields,
        'committedUpdatedAt', v_updated_at
      ),
      p_request_id
    );
  exception when check_violation or not_null_violation or unique_violation
    or foreign_key_violation or invalid_text_representation
    or numeric_value_out_of_range or datetime_field_overflow then
    return '{"status":"validation_error","code":"FACULTY_INVALID"}'::jsonb;
  end;

  return pg_catalog.jsonb_build_object(
    'status', 'updated', 'facultyUpdatedAt', v_updated_at
  );
end;
$$;

create function public.publish_admin_faculty(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_faculty_id bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.faculty%rowtype;
  v_updated_at timestamptz;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if p_expected_updated_at is null or not pg_catalog.isfinite(p_expected_updated_at)
    or p_faculty_id is null or p_faculty_id < 1 or p_request_id is null
  then
    return '{"status":"validation_error","code":"FACULTY_INVALID"}'::jsonb;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(202607140016);

  select * into v_current
  from public.faculty
  where id = p_faculty_id
  FOR UPDATE;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_current.updated_at IS DISTINCT FROM p_expected_updated_at then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict', 'facultyUpdatedAt', v_current.updated_at
    );
  end if;

  if v_current.status not in ('draft', 'archived') then
    return '{"status":"validation_error","code":"FACULTY_STATUS_INVALID"}'::jsonb;
  end if;

  if (v_current.employment_type = 'full_time' and v_current.consultation_role <> 'primary')
    or (v_current.employment_type in ('adjunct', 'practitioner') and v_current.consultation_role <> 'specialist')
  then
    return '{"status":"validation_error","code":"FACULTY_ROLE_INVALID"}'::jsonb;
  end if;
  if v_current.consultation_role = 'primary' and v_current.weekly_capacity <= 0 then
    return '{"status":"validation_error","code":"FACULTY_CAPACITY_REQUIRED"}'::jsonb;
  end if;
  if v_current.consultation_role = 'specialist' and not exists (
    select 1 from public.faculty_tags
    where faculty_id = p_faculty_id and category = 'specialist' and weight > 0
  ) then
    return '{"status":"validation_error","code":"FACULTY_SPECIALIST_TAG_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_each_text(v_current.contact_visibility) visibility(field, value)
    where visibility.value = 'public'
      and case visibility.field
        when 'office' then v_current.office
        when 'phone' then v_current.phone
        when 'email' then v_current.email
        when 'website' then v_current.website
        else null
      end is null
  )
    or (
      exists (
        select 1 from pg_catalog.jsonb_each_text(v_current.contact_visibility) visibility(field, value)
        where visibility.value = 'public'
      )
      and (
        v_current.last_verified_at is null
        or not pg_catalog.isfinite(v_current.last_verified_at)
        or v_current.last_verified_at > pg_catalog.clock_timestamp()
      )
    )
  then
    return '{"status":"validation_error","code":"CONTACT_VERIFICATION_REQUIRED"}'::jsonb;
  end if;

  if exists (
    select 1 from public.faculty_tags
    where faculty_id = p_faculty_id and is_primary
    group by category having pg_catalog.count(*) > 1
  ) then
    return '{"status":"validation_error","code":"FACULTY_TAG_INVALID"}'::jsonb;
  end if;
  if exists (
    select 1 from public.faculty_tags
    where faculty_id = p_faculty_id and category = 'track'
      and (tag_key, tag_label) not in (
        ('documentary', '다큐멘터리 사진'),
        ('art_photo', '예술사진'),
        ('commercial', '광고사진'),
        ('video', '영상과 기술(AI·편집·드론)')
      )
  ) then
    return '{"status":"validation_error","code":"FACULTY_TAXONOMY_INVALID"}'::jsonb;
  end if;

  if v_current.consultation_role = 'specialist' then
    perform related.id
    from public.faculty_specialist_links link
    join public.faculty related on related.id = link.primary_faculty_id
    where link.specialist_faculty_id = p_faculty_id
    order by related.id
    for update of related;

    if exists (
      select 1
      from public.faculty_specialist_links link
      left join public.faculty related on related.id = link.primary_faculty_id
      where link.specialist_faculty_id = p_faculty_id
        and (
          not exists (
            select 1 from public.faculty_tags tag
            where tag.faculty_id = p_faculty_id
              and tag.category = 'specialist'
              and tag.tag_key = link.tag_key
          )
          or (link.primary_faculty_id is not null and (
            related.id is null or related.status <> 'active'
            or related.employment_type <> 'full_time'
            or related.consultation_role <> 'primary'
          ))
        )
    ) then
      return '{"status":"validation_error","code":"FACULTY_LINK_INVALID"}'::jsonb;
    end if;
  elsif exists (
    select 1 from public.faculty_specialist_links where specialist_faculty_id = p_faculty_id
  ) then
    return '{"status":"validation_error","code":"FACULTY_LINK_INVALID"}'::jsonb;
  end if;

  if v_current.name = '윤태준' and (
    pg_catalog.strpos(v_current.expertise_summary, '예술사진') = 0
    or pg_catalog.strpos(v_current.expertise_summary, '영상') = 0
    or pg_catalog.strpos(v_current.expertise_summary, 'AI') = 0
    or pg_catalog.strpos(v_current.expertise_summary, '기술적 이미지') = 0
    or exists (
      select required.key
      from (values ('art_photo'), ('video'), ('ai')) required(key)
      where not exists (
        select 1 from public.faculty_tags tag
        where tag.faculty_id = p_faculty_id
          and tag.tag_key = required.key and tag.category <> 'specialist'
      )
    )
  ) then
    return '{"status":"validation_error","code":"FACULTY_YOON_SCOPE_REQUIRED"}'::jsonb;
  end if;

  v_updated_at := pg_catalog.clock_timestamp();
  if v_updated_at <= v_current.updated_at then
    v_updated_at := v_current.updated_at + interval '1 microsecond';
  end if;
  update public.faculty
  set status = 'active', updated_at = v_updated_at
  where id = p_faculty_id;

  insert into public.audit_events(
    admin_user_id, action, target_type, target_id, metadata, request_id
  ) values (
    p_admin_user_id, 'faculty_published', 'faculty', p_faculty_id::text,
    pg_catalog.jsonb_build_object(
      'changedFields', pg_catalog.jsonb_build_array('status'),
      'committedUpdatedAt', v_updated_at
    ),
    p_request_id
  );

  return pg_catalog.jsonb_build_object(
    'status', 'updated', 'facultyUpdatedAt', v_updated_at
  );
end;
$$;

revoke all on function public.admin_faculty_payload_error(jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_admin_faculty(uuid, timestamptz, bigint, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_admin_faculty(uuid, timestamptz, bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.update_admin_faculty(uuid, timestamptz, bigint, uuid, jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.publish_admin_faculty(uuid, timestamptz, bigint, uuid)
  to service_role;
