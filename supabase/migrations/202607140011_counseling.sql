create table public.counseling_requests (
  id bigint generated always as identity,
  public_id uuid not null default extensions.gen_random_uuid(),
  prospect_id bigint not null,
  assessment_id bigint,
  status text not null default 'new',
  contact_method text not null,
  availability text not null,
  inquiry text,
  consent_given boolean not null,
  consented_at timestamptz not null default pg_catalog.clock_timestamp(),
  assigned_faculty_id bigint,
  assigned_at timestamptz,
  contacted_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  admin_note text,
  version integer not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint counseling_requests_pk primary key (id),
  constraint counseling_requests_public_id_unique unique (public_id),
  constraint counseling_requests_prospect_fk foreign key (prospect_id)
    references public.prospects(id) on delete cascade,
  constraint counseling_requests_assessment_fk foreign key (assessment_id)
    references public.assessments(id) on delete set null,
  constraint counseling_requests_assigned_faculty_fk foreign key (assigned_faculty_id)
    references public.faculty(id) on delete restrict,
  constraint counseling_requests_status_check check (
    status in ('new', 'assigned', 'contacted', 'completed', 'closed')
  ),
  constraint counseling_requests_contact_method_check check (
    contact_method in ('phone', 'text', 'visit')
  ),
  constraint counseling_requests_availability_check check (
    availability in ('weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend')
  ),
  constraint counseling_requests_inquiry_check check (
    inquiry is null or (
      inquiry = pg_catalog.btrim(inquiry)
      and pg_catalog.char_length(inquiry) between 1 and 200
      and inquiry !~ '[[:cntrl:]]'
    )
  ),
  constraint counseling_requests_consent_check check (consent_given),
  constraint counseling_requests_admin_note_check check (
    admin_note is null or (
      admin_note = pg_catalog.btrim(admin_note)
      and pg_catalog.char_length(admin_note) between 1 and 2000
      and admin_note !~ '[[:cntrl:]]'
    )
  ),
  constraint counseling_requests_version_check check (version >= 0),
  constraint counseling_requests_assignment_pair_check check (
    (assigned_faculty_id is null) = (assigned_at is null)
  ),
  constraint counseling_requests_state_shape_check check (
    (
      status = 'new'
      and assigned_faculty_id is null
      and assigned_at is null
      and contacted_at is null
      and completed_at is null
      and closed_at is null
    ) or (
      status = 'assigned'
      and assigned_faculty_id is not null
      and assigned_at is not null
      and contacted_at is null
      and completed_at is null
      and closed_at is null
    ) or (
      status = 'contacted'
      and assigned_faculty_id is not null
      and assigned_at is not null
      and contacted_at is not null
      and completed_at is null
      and closed_at is null
    ) or (
      status = 'completed'
      and assigned_faculty_id is not null
      and assigned_at is not null
      and contacted_at is not null
      and completed_at is not null
      and closed_at is null
    ) or (
      status = 'closed'
      and completed_at is null
      and closed_at is not null
    )
  )
);

create table public.counseling_faculty_recommendations (
  id bigint generated always as identity,
  counseling_request_id bigint not null,
  faculty_id bigint not null,
  role text not null,
  rank smallint not null,
  score_snapshot numeric(5,2),
  faculty_name_snapshot text not null,
  faculty_title_snapshot text not null,
  expertise_snapshot text not null,
  reason_snapshot text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint counseling_faculty_recommendations_pk primary key (id),
  constraint counseling_faculty_recommendations_request_role_rank_unique
    unique (counseling_request_id, role, rank),
  constraint counseling_faculty_recommendations_request_faculty_unique
    unique (counseling_request_id, faculty_id),
  constraint counseling_faculty_recommendations_request_fk foreign key (counseling_request_id)
    references public.counseling_requests(id) on delete cascade,
  constraint counseling_faculty_recommendations_faculty_fk foreign key (faculty_id)
    references public.faculty(id) on delete restrict,
  constraint counseling_faculty_recommendations_role_rank_check check (
    (role in ('primary', 'backup') and rank = 1)
    or (role = 'specialist' and rank between 1 and 2)
  ),
  constraint counseling_faculty_recommendations_score_check check (
    score_snapshot is null or score_snapshot between 0 and 100
  ),
  constraint counseling_faculty_recommendations_name_check check (
    faculty_name_snapshot = pg_catalog.btrim(faculty_name_snapshot)
    and pg_catalog.char_length(faculty_name_snapshot) between 1 and 100
  ),
  constraint counseling_faculty_recommendations_title_check check (
    faculty_title_snapshot = pg_catalog.btrim(faculty_title_snapshot)
    and pg_catalog.char_length(faculty_title_snapshot) between 1 and 100
  ),
  constraint counseling_faculty_recommendations_expertise_check check (
    expertise_snapshot = pg_catalog.btrim(expertise_snapshot)
    and pg_catalog.char_length(expertise_snapshot) between 1 and 1000
  ),
  constraint counseling_faculty_recommendations_reason_check check (
    reason_snapshot = pg_catalog.btrim(reason_snapshot)
    and pg_catalog.char_length(reason_snapshot) between 1 and 1000
  )
);

create unique index counseling_requests_one_open_per_prospect_idx
  on public.counseling_requests(prospect_id)
  where status in ('new', 'assigned', 'contacted');

create index counseling_requests_prospect_idx
  on public.counseling_requests(prospect_id);

create index counseling_requests_assessment_idx
  on public.counseling_requests(assessment_id)
  where assessment_id is not null;

create index counseling_requests_queue_idx
  on public.counseling_requests(status, created_at desc, id desc);

create index counseling_requests_assigned_faculty_idx
  on public.counseling_requests(assigned_faculty_id, created_at desc)
  where assigned_faculty_id is not null;

create index counseling_faculty_recommendations_faculty_idx
  on public.counseling_faculty_recommendations(faculty_id, role);

create function public.create_counseling_request(
  p_prospect_id bigint,
  p_assessment_id bigint,
  p_contact_method text,
  p_availability text,
  p_inquiry text,
  p_consent_given boolean
)
returns table(
  counseling_request_id bigint,
  public_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id bigint;
  v_assessment public.assessments%rowtype;
  v_existing public.counseling_requests%rowtype;
  v_created public.counseling_requests%rowtype;
  v_faculty jsonb;
  v_primary jsonb;
  v_backup jsonb;
  v_specialists jsonb;
  v_specialist jsonb;
begin
  if p_contact_method is null or p_contact_method not in ('phone', 'text', 'visit') then
    raise exception using errcode = '22023', message = 'invalid counseling contact method';
  end if;

  if p_availability is null
    or p_availability not in ('weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend')
  then
    raise exception using errcode = '22023', message = 'invalid counseling availability';
  end if;

  if p_consent_given is distinct from true then
    raise exception using errcode = '23514', message = 'counseling consent is required';
  end if;

  if p_inquiry is not null and (
    p_inquiry <> pg_catalog.btrim(p_inquiry)
    or pg_catalog.char_length(p_inquiry) not between 1 and 200
    or p_inquiry ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'invalid counseling inquiry';
  end if;

  select prospect.id
  into v_prospect_id
  from public.prospects prospect
  where prospect.id = p_prospect_id
    and prospect.status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'prospect not found';
  end if;

  select assessment.*
  into v_assessment
  from public.assessments assessment
  where assessment.id = p_assessment_id
    and assessment.prospect_id = v_prospect_id
    and assessment.status = 'completed'
  for key share;

  if not found then
    raise exception using errcode = 'P0002', message = 'assessment not found';
  end if;

  select request.*
  into v_existing
  from public.counseling_requests request
  where request.prospect_id = v_prospect_id
    and request.status in ('new', 'assigned', 'contacted')
  for update;

  if found then
    return query select v_existing.id, v_existing.public_id, false;
    return;
  end if;

  v_faculty := v_assessment.result_snapshot -> 'faculty';
  if pg_catalog.jsonb_typeof(v_faculty) <> 'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_faculty)) <> 3
    or not v_faculty ?& array['primary', 'backup', 'specialists']
  then
    raise exception using errcode = '22023', message = 'invalid counseling faculty snapshot';
  end if;

  v_primary := v_faculty -> 'primary';
  v_backup := v_faculty -> 'backup';
  v_specialists := v_faculty -> 'specialists';

  if pg_catalog.jsonb_typeof(v_primary) <> 'object'
    or pg_catalog.jsonb_typeof(v_backup) <> 'object'
    or pg_catalog.jsonb_typeof(v_specialists) <> 'array'
    or pg_catalog.jsonb_array_length(v_specialists) > 2
  then
    raise exception using errcode = '22023', message = 'invalid counseling faculty snapshot';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_primary)) <> 7
    or not v_primary ?& array['role', 'id', 'name', 'title', 'expertise', 'reason', 'publicContacts']
    or v_primary ->> 'role' <> 'primary'
    or pg_catalog.jsonb_typeof(v_primary -> 'id') <> 'number'
    or v_primary ->> 'id' !~ '^[1-9][0-9]*$'
    or pg_catalog.jsonb_typeof(v_primary -> 'name') <> 'string'
    or pg_catalog.jsonb_typeof(v_primary -> 'title') <> 'string'
    or pg_catalog.jsonb_typeof(v_primary -> 'expertise') <> 'string'
    or pg_catalog.jsonb_typeof(v_primary -> 'reason') <> 'string'
    or pg_catalog.jsonb_typeof(v_primary -> 'publicContacts') <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid primary faculty snapshot';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_backup)) <> 7
    or not v_backup ?& array['role', 'id', 'name', 'title', 'expertise', 'reason', 'publicContacts']
    or v_backup ->> 'role' <> 'backup'
    or pg_catalog.jsonb_typeof(v_backup -> 'id') <> 'number'
    or v_backup ->> 'id' !~ '^[1-9][0-9]*$'
    or pg_catalog.jsonb_typeof(v_backup -> 'name') <> 'string'
    or pg_catalog.jsonb_typeof(v_backup -> 'title') <> 'string'
    or pg_catalog.jsonb_typeof(v_backup -> 'expertise') <> 'string'
    or pg_catalog.jsonb_typeof(v_backup -> 'reason') <> 'string'
    or pg_catalog.jsonb_typeof(v_backup -> 'publicContacts') <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid backup faculty snapshot';
  end if;

  for v_specialist in
    select specialist.value
    from pg_catalog.jsonb_array_elements(v_specialists) specialist(value)
  loop
    if pg_catalog.jsonb_typeof(v_specialist) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_specialist)) <> 7
      or not v_specialist ?& array['role', 'id', 'name', 'title', 'expertise', 'reason', 'publicContacts']
      or v_specialist ->> 'role' <> 'specialist'
      or pg_catalog.jsonb_typeof(v_specialist -> 'id') <> 'number'
      or v_specialist ->> 'id' !~ '^[1-9][0-9]*$'
      or pg_catalog.jsonb_typeof(v_specialist -> 'name') <> 'string'
      or pg_catalog.jsonb_typeof(v_specialist -> 'title') <> 'string'
      or pg_catalog.jsonb_typeof(v_specialist -> 'expertise') <> 'string'
      or pg_catalog.jsonb_typeof(v_specialist -> 'reason') <> 'string'
      or pg_catalog.jsonb_typeof(v_specialist -> 'publicContacts') <> 'object'
    then
      raise exception using errcode = '22023', message = 'invalid specialist faculty snapshot';
    end if;
  end loop;

  insert into public.counseling_requests (
    prospect_id,
    assessment_id,
    contact_method,
    availability,
    inquiry,
    consent_given
  ) values (
    v_prospect_id,
    v_assessment.id,
    p_contact_method,
    p_availability,
    p_inquiry,
    p_consent_given
  )
  returning * into v_created;

  insert into public.counseling_faculty_recommendations (
    counseling_request_id,
    faculty_id,
    role,
    rank,
    score_snapshot,
    faculty_name_snapshot,
    faculty_title_snapshot,
    expertise_snapshot,
    reason_snapshot
  ) values
  (
    v_created.id,
    (v_primary ->> 'id')::bigint,
    'primary',
    1,
    null,
    v_primary ->> 'name',
    v_primary ->> 'title',
    v_primary ->> 'expertise',
    v_primary ->> 'reason'
  ),
  (
    v_created.id,
    (v_backup ->> 'id')::bigint,
    'backup',
    1,
    null,
    v_backup ->> 'name',
    v_backup ->> 'title',
    v_backup ->> 'expertise',
    v_backup ->> 'reason'
  );

  insert into public.counseling_faculty_recommendations (
    counseling_request_id,
    faculty_id,
    role,
    rank,
    score_snapshot,
    faculty_name_snapshot,
    faculty_title_snapshot,
    expertise_snapshot,
    reason_snapshot
  )
  select
    v_created.id,
    (specialist.value ->> 'id')::bigint,
    'specialist',
    specialist.position::smallint,
    null,
    specialist.value ->> 'name',
    specialist.value ->> 'title',
    specialist.value ->> 'expertise',
    specialist.value ->> 'reason'
  from pg_catalog.jsonb_array_elements(v_specialists) with ordinality specialist(value, position);

  update public.prospects prospect
  set last_active_at = pg_catalog.clock_timestamp()
  where prospect.id = v_prospect_id;

  return query select v_created.id, v_created.public_id, true;
end;
$$;

create function public.transition_counseling_request(
  p_request_id bigint,
  p_expected_version integer,
  p_to_status text,
  p_assigned_faculty_id bigint,
  p_admin_note text
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
  v_request public.counseling_requests%rowtype;
  v_updated public.counseling_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_faculty_id bigint;
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = '22023', message = 'invalid counseling version';
  end if;

  if p_admin_note is not null and (
    p_admin_note <> pg_catalog.btrim(p_admin_note)
    or pg_catalog.char_length(p_admin_note) not between 1 and 2000
    or p_admin_note ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'invalid counseling admin note';
  end if;

  select request.*
  into v_request
  from public.counseling_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  if v_request.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'COUNSELING_VERSION_CONFLICT';
  end if;

  if p_to_status is null or not (
    (v_request.status = 'new' and p_to_status in ('assigned', 'closed'))
    or (v_request.status = 'assigned' and p_to_status in ('contacted', 'closed'))
    or (v_request.status = 'contacted' and p_to_status in ('completed', 'closed'))
  ) then
    raise exception using errcode = 'P0001', message = 'COUNSELING_TRANSITION_INVALID';
  end if;

  if p_to_status = 'assigned' then
    if p_assigned_faculty_id is null then
      raise exception using errcode = '22023', message = 'active assigned faculty is required';
    end if;

    select faculty.id
    into v_faculty_id
    from public.faculty faculty
    where faculty.id = p_assigned_faculty_id
      and faculty.status = 'active'
    for key share;

    if not found then
      raise exception using errcode = '22023', message = 'active assigned faculty is required';
    end if;
  else
    v_faculty_id := v_request.assigned_faculty_id;
  end if;

  update public.counseling_requests request
  set
    status = p_to_status,
    assigned_faculty_id = case when p_to_status = 'assigned' then v_faculty_id else request.assigned_faculty_id end,
    assigned_at = case when p_to_status = 'assigned' then v_now else request.assigned_at end,
    contacted_at = case when p_to_status = 'contacted' then v_now else request.contacted_at end,
    completed_at = case when p_to_status = 'completed' then v_now else request.completed_at end,
    closed_at = case when p_to_status = 'closed' then v_now else request.closed_at end,
    admin_note = case when p_admin_note is not null then p_admin_note else request.admin_note end,
    version = request.version + 1,
    updated_at = v_now
  where request.id = v_request.id
  returning * into v_updated;

  return query select
    v_updated.id,
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

create function public.reopen_counseling_request(
  p_request_id bigint,
  p_expected_version integer,
  p_reason text,
  p_admin_user_id uuid,
  p_audit_request_id uuid
)
returns table(
  counseling_request_id bigint,
  status text,
  version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prospect_id bigint;
  v_request public.counseling_requests%rowtype;
  v_updated public.counseling_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = '22023', message = 'invalid counseling version';
  end if;

  if p_reason is null
    or pg_catalog.btrim(p_reason) = ''
    or p_reason <> pg_catalog.btrim(p_reason)
    or pg_catalog.char_length(p_reason) > 1000
    or p_reason ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'COUNSELING_REOPEN_REASON_REQUIRED';
  end if;

  if p_admin_user_id is null or p_audit_request_id is null or not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.is_active
  ) then
    raise exception using errcode = '22023', message = 'active counseling administrator is required';
  end if;

  select request.prospect_id
  into v_prospect_id
  from public.counseling_requests request
  where request.id = p_request_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  perform prospect.id
  from public.prospects prospect
  where prospect.id = v_prospect_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  select request.*
  into v_request
  from public.counseling_requests request
  where request.id = p_request_id
    and request.prospect_id = v_prospect_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'counseling request not found';
  end if;

  if v_request.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'COUNSELING_VERSION_CONFLICT';
  end if;

  if v_request.status not in ('completed', 'closed') then
    raise exception using errcode = 'P0001', message = 'COUNSELING_TRANSITION_INVALID';
  end if;

  perform request.id
  from public.counseling_requests request
  where request.prospect_id = v_prospect_id
    and request.id <> v_request.id
    and request.status in ('new', 'assigned', 'contacted')
  order by request.id
  limit 1;

  if found then
    raise exception using errcode = 'P0001', message = 'COUNSELING_OPEN_REQUEST_EXISTS';
  end if;

  update public.counseling_requests request
  set
    status = 'new',
    assigned_faculty_id = null,
    assigned_at = null,
    contacted_at = null,
    completed_at = null,
    closed_at = null,
    version = request.version + 1,
    updated_at = v_now
  where request.id = v_request.id
  returning * into v_updated;

  insert into public.audit_events (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id,
    created_at
  ) values (
    p_admin_user_id,
    'counseling_reopened',
    'counseling_request',
    v_request.id::text,
    pg_catalog.jsonb_build_object('reason', p_reason),
    p_audit_request_id,
    v_now
  );

  return query select v_updated.id, v_updated.status, v_updated.version, v_updated.updated_at;
end;
$$;

alter table public.counseling_requests enable row level security;
alter table public.counseling_faculty_recommendations enable row level security;

revoke all privileges on table
  public.counseling_requests,
  public.counseling_faculty_recommendations
from public, anon, authenticated, service_role;

grant select on table
  public.counseling_requests,
  public.counseling_faculty_recommendations
to service_role;

revoke all privileges on sequence
  public.counseling_requests_id_seq,
  public.counseling_faculty_recommendations_id_seq
from public, anon, authenticated, service_role;

revoke all privileges on function public.create_counseling_request(
  bigint, bigint, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all privileges on function public.transition_counseling_request(
  bigint, integer, text, bigint, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.reopen_counseling_request(
  bigint, integer, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.create_counseling_request(
  bigint, bigint, text, text, text, boolean
) to service_role;
grant execute on function public.transition_counseling_request(
  bigint, integer, text, bigint, text
) to service_role;
grant execute on function public.reopen_counseling_request(
  bigint, integer, text, uuid, uuid
) to service_role;
