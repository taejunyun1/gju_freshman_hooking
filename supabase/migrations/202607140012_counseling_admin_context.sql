alter table public.counseling_requests
  add column assessment_public_id_snapshot uuid,
  add column campaign_id_snapshot bigint,
  add column primary_track_snapshot text,
  add column secondary_track_snapshot text,
  add column selected_work_labels_snapshot text[],
  add column selected_career_labels_snapshot text[];

create function public.set_counseling_context_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment public.assessments%rowtype;
  v_ranked_tracks jsonb;
  v_selected_interests jsonb;
  v_work_labels text[];
  v_career_labels text[];
begin
  if tg_op = 'UPDATE' and old.assessment_public_id_snapshot is not null then
    if row(
      new.assessment_public_id_snapshot,
      new.campaign_id_snapshot,
      new.primary_track_snapshot,
      new.secondary_track_snapshot,
      new.selected_work_labels_snapshot,
      new.selected_career_labels_snapshot
    ) is distinct from row(
      old.assessment_public_id_snapshot,
      old.campaign_id_snapshot,
      old.primary_track_snapshot,
      old.secondary_track_snapshot,
      old.selected_work_labels_snapshot,
      old.selected_career_labels_snapshot
    ) then
      raise exception using errcode = '23514', message = 'counseling context snapshot is immutable';
    end if;
    return new;
  end if;

  if new.assessment_id is null then
    raise exception using errcode = '23514', message = 'counseling assessment context is required';
  end if;

  select assessment.*
  into v_assessment
  from public.assessments assessment
  where assessment.id = new.assessment_id
    and assessment.prospect_id = new.prospect_id
    and assessment.status = 'completed'
  for key share;

  if not found then
    raise exception using errcode = 'P0002', message = 'assessment not found';
  end if;

  v_ranked_tracks := v_assessment.result_snapshot -> 'rankedTracks';
  if pg_catalog.jsonb_typeof(v_ranked_tracks) <> 'array'
    or pg_catalog.jsonb_array_length(v_ranked_tracks) <> 4
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_ranked_tracks) item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or item.value #>> '{}' not in ('documentary', 'art_photo', 'commercial', 'video')
    )
    or (
      select pg_catalog.count(distinct item.value #>> '{}')
      from pg_catalog.jsonb_array_elements(v_ranked_tracks) item(value)
    ) <> 4
  then
    raise exception using errcode = '22023', message = 'invalid counseling ranked track snapshot';
  end if;

  v_selected_interests := v_assessment.result_snapshot -> 'selectedInterests';
  if pg_catalog.jsonb_typeof(v_selected_interests) <> 'array'
    or pg_catalog.jsonb_array_length(v_selected_interests) not between 4 and 11
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_selected_interests) item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item.value)) <> 3
        or not item.value ?& array['group', 'key', 'label']
        or pg_catalog.jsonb_typeof(item.value -> 'group') <> 'string'
        or pg_catalog.jsonb_typeof(item.value -> 'key') <> 'string'
        or pg_catalog.jsonb_typeof(item.value -> 'label') <> 'string'
        or item.value ->> 'group' not in ('work', 'result', 'style', 'career')
        or (item.value ->> 'key') !~ ('^' || (item.value ->> 'group') || '\.[a-z][a-z0-9_]*$')
        or item.value ->> 'label' <> pg_catalog.btrim(item.value ->> 'label')
        or pg_catalog.char_length(item.value ->> 'label') not between 1 and 200
        or item.value ->> 'label' ~ '[[:cntrl:]]'
    )
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_selected_interests) item(value) where item.value ->> 'group' = 'work') not between 1 and 4
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_selected_interests) item(value) where item.value ->> 'group' = 'result') not between 1 and 3
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_selected_interests) item(value) where item.value ->> 'group' = 'style') not between 1 and 2
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_selected_interests) item(value) where item.value ->> 'group' = 'career') not between 1 and 2
  then
    raise exception using errcode = '22023', message = 'invalid counseling selected interest snapshot';
  end if;

  select pg_catalog.array_agg(item.value ->> 'label' order by item.position)
  into v_work_labels
  from pg_catalog.jsonb_array_elements(v_selected_interests) with ordinality item(value, position)
  where item.value ->> 'group' = 'work';

  select pg_catalog.array_agg(item.value ->> 'label' order by item.position)
  into v_career_labels
  from pg_catalog.jsonb_array_elements(v_selected_interests) with ordinality item(value, position)
  where item.value ->> 'group' = 'career';

  new.assessment_public_id_snapshot := v_assessment.public_id;
  new.campaign_id_snapshot := v_assessment.campaign_id;
  new.primary_track_snapshot := v_ranked_tracks ->> 0;
  new.secondary_track_snapshot := v_ranked_tracks ->> 1;
  new.selected_work_labels_snapshot := v_work_labels;
  new.selected_career_labels_snapshot := v_career_labels;
  return new;
end;
$$;

create trigger counseling_requests_context_snapshot_trigger
before insert or update on public.counseling_requests
for each row execute function public.set_counseling_context_snapshot();

update public.counseling_requests
set assessment_id = assessment_id
where assessment_public_id_snapshot is null;

create function public.is_valid_counseling_label_snapshot(
  p_labels text[],
  p_minimum integer,
  p_maximum integer
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_label text;
begin
  if pg_catalog.cardinality(p_labels) not between p_minimum and p_maximum then
    return false;
  end if;

  foreach v_label in array p_labels
  loop
    if v_label is null
      or v_label <> pg_catalog.btrim(v_label)
      or pg_catalog.char_length(v_label) not between 1 and 200
      or v_label ~ '[[:cntrl:]]'
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.counseling_requests
  alter column assessment_public_id_snapshot set not null,
  alter column primary_track_snapshot set not null,
  alter column secondary_track_snapshot set not null,
  alter column selected_work_labels_snapshot set not null,
  alter column selected_career_labels_snapshot set not null,
  add constraint counseling_requests_campaign_snapshot_check check (
    campaign_id_snapshot is null or campaign_id_snapshot > 0
  ),
  add constraint counseling_requests_track_snapshot_check check (
    primary_track_snapshot in ('documentary', 'art_photo', 'commercial', 'video')
    and secondary_track_snapshot in ('documentary', 'art_photo', 'commercial', 'video')
    and primary_track_snapshot <> secondary_track_snapshot
  ),
  add constraint counseling_requests_work_labels_snapshot_check check (
    public.is_valid_counseling_label_snapshot(selected_work_labels_snapshot, 1, 4)
  ),
  add constraint counseling_requests_career_labels_snapshot_check check (
    public.is_valid_counseling_label_snapshot(selected_career_labels_snapshot, 1, 2)
  );

create index counseling_requests_primary_track_idx
  on public.counseling_requests(primary_track_snapshot, created_at desc, id desc);

create index counseling_requests_campaign_idx
  on public.counseling_requests(campaign_id_snapshot, created_at desc, id desc)
  where campaign_id_snapshot is not null;

create function public.admin_transition_counseling_request(
  p_request_id bigint,
  p_expected_version integer,
  p_to_status text,
  p_assigned_faculty_id bigint,
  p_admin_user_id uuid,
  p_audit_request_id uuid
)
returns table(
  counseling_request_id bigint,
  status text,
  version integer,
  assigned_faculty_id bigint,
  assigned_at timestamptz,
  contacted_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_status text;
  v_updated record;
begin
  if p_admin_user_id is null or p_audit_request_id is null or not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.is_active
  ) then
    raise exception using errcode = '22023', message = 'active counseling administrator is required';
  end if;

  select request.status
  into v_from_status
  from public.counseling_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  select transition.*
  into v_updated
  from public.transition_counseling_request(
    p_request_id,
    p_expected_version,
    p_to_status,
    p_assigned_faculty_id,
    null
  ) transition;

  insert into public.audit_events (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id
  ) values (
    p_admin_user_id,
    case when p_to_status = 'assigned' then 'counseling_assigned' else 'counseling_transitioned' end,
    'counseling_request',
    (select public_id::text from public.counseling_requests where id = p_request_id),
    case
      when p_to_status = 'assigned' then pg_catalog.jsonb_build_object(
        'from', v_from_status,
        'to', p_to_status,
        'assigned_faculty_id', p_assigned_faculty_id
      )
      else pg_catalog.jsonb_build_object('from', v_from_status, 'to', p_to_status)
    end,
    p_audit_request_id
  );

  return query select
    v_updated.counseling_request_id,
    v_updated.status,
    v_updated.version,
    v_updated.assigned_faculty_id,
    v_updated.assigned_at,
    v_updated.contacted_at,
    v_updated.completed_at,
    v_updated.closed_at,
    v_updated.updated_at;
end;
$$;

create function public.record_counseling_sensitive_access(
  p_request_id bigint,
  p_action text,
  p_admin_user_id uuid,
  p_audit_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.counseling_requests%rowtype;
begin
  if p_action is null or p_action not in ('phone_reveal', 'summary') then
    raise exception using errcode = '22023', message = 'invalid counseling sensitive access action';
  end if;

  if p_admin_user_id is null or p_audit_request_id is null or not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.is_active
  ) then
    raise exception using errcode = '22023', message = 'active counseling administrator is required';
  end if;

  select request.*
  into v_request
  from public.counseling_requests request
  where request.id = p_request_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  insert into public.audit_events (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id
  ) values (
    p_admin_user_id,
    case when p_action = 'phone_reveal' then 'admin_phone_revealed' else 'counseling_summary_created' end,
    'counseling_request',
    v_request.public_id::text,
    '{}'::jsonb,
    p_audit_request_id
  );

  if p_action = 'phone_reveal' then
    insert into public.events (
      prospect_id,
      anonymous_id,
      event_name,
      path,
      properties
    ) values (
      v_request.prospect_id,
      extensions.gen_random_uuid(),
      'admin_phone_revealed',
      '/api/admin/counseling/' || v_request.public_id::text || '/reveal-phone',
      pg_catalog.jsonb_build_object(
        'counseling_request_id', v_request.id,
        'request_id', p_audit_request_id
      )
    );
  end if;

  return true;
end;
$$;

revoke all privileges on function public.set_counseling_context_snapshot()
from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_counseling_label_snapshot(text[], integer, integer)
from public, anon, authenticated;

revoke all privileges on function public.transition_counseling_request(
  bigint, integer, text, bigint, text
) from service_role;

revoke all privileges on function public.admin_transition_counseling_request(
  bigint, integer, text, bigint, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all privileges on function public.record_counseling_sensitive_access(
  bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.admin_transition_counseling_request(
  bigint, integer, text, bigint, uuid, uuid
) to service_role;
grant execute on function public.record_counseling_sensitive_access(
  bigint, text, uuid, uuid
) to service_role;
