create function public.is_valid_export_filter_snapshot(p_filter jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_value text;
begin
  if pg_catalog.jsonb_typeof(p_filter) <> 'object'
    or pg_catalog.octet_length(p_filter::text) > 2048
    or not public.is_sanitized_metadata(p_filter)
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_filter) key_name
      where key_name not in (
        'query', 'stage', 'region', 'school', 'track', 'campaignId',
        'counselingStatus', 'dateFrom', 'dateTo'
      )
    )
  then
    return false;
  end if;

  if p_filter ? 'query' then
    if pg_catalog.jsonb_typeof(p_filter -> 'query') <> 'string' then
      return false;
    end if;
    v_value := p_filter ->> 'query';
    if v_value <> pg_catalog.btrim(v_value)
      or pg_catalog.char_length(v_value) not between 1 and 100
      or v_value ~ '[[:cntrl:]]'
      or pg_catalog.regexp_replace(v_value, '[^0-9]', '', 'g')
        ~ '(010[0-9]{7,8}|8210[0-9]{7,8})'
    then
      return false;
    end if;
  end if;

  if p_filter ? 'school' then
    if pg_catalog.jsonb_typeof(p_filter -> 'school') <> 'string' then
      return false;
    end if;
    v_value := p_filter ->> 'school';
    if v_value <> pg_catalog.btrim(v_value)
      or pg_catalog.char_length(v_value) not between 1 and 40
      or v_value ~ '[[:cntrl:]]'
      or pg_catalog.regexp_replace(v_value, '[^0-9]', '', 'g')
        ~ '(010[0-9]{7,8}|8210[0-9]{7,8})'
    then
      return false;
    end if;
  end if;

  if p_filter ? 'stage' and (
    pg_catalog.jsonb_typeof(p_filter -> 'stage') <> 'string'
    or p_filter ->> 'stage' not in ('high1', 'high2', 'high3', 'graduate', 'ged', 'other')
  ) then
    return false;
  end if;

  if p_filter ? 'region' and (
    pg_catalog.jsonb_typeof(p_filter -> 'region') <> 'string'
    or p_filter ->> 'region' not in (
      'gwangju', 'jeonbuk', 'capital', 'chungcheong', 'gyeongsang',
      'gangwon_jeju', 'overseas', 'other'
    )
  ) then
    return false;
  end if;

  if p_filter ? 'track' and (
    pg_catalog.jsonb_typeof(p_filter -> 'track') <> 'string'
    or p_filter ->> 'track' not in ('documentary', 'art_photo', 'commercial', 'video')
  ) then
    return false;
  end if;

  if p_filter ? 'campaignId' and (
    pg_catalog.jsonb_typeof(p_filter -> 'campaignId') <> 'number'
    or (p_filter ->> 'campaignId') !~ '^[1-9][0-9]{0,15}$'
    or (p_filter ->> 'campaignId')::numeric > 9007199254740991
  ) then
    return false;
  end if;

  if p_filter ? 'counselingStatus' and (
    pg_catalog.jsonb_typeof(p_filter -> 'counselingStatus') <> 'string'
    or p_filter ->> 'counselingStatus' not in ('new', 'assigned', 'contacted', 'completed', 'closed')
  ) then
    return false;
  end if;

  if p_filter ? 'dateFrom' and (
    pg_catalog.jsonb_typeof(p_filter -> 'dateFrom') <> 'string'
    or p_filter ->> 'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or not pg_catalog.pg_input_is_valid(p_filter ->> 'dateFrom', 'date')
  ) then
    return false;
  end if;

  if p_filter ? 'dateTo' and (
    pg_catalog.jsonb_typeof(p_filter -> 'dateTo') <> 'string'
    or p_filter ->> 'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or not pg_catalog.pg_input_is_valid(p_filter ->> 'dateTo', 'date')
  ) then
    return false;
  end if;

  if p_filter ? 'dateFrom' and p_filter ? 'dateTo'
    and p_filter ->> 'dateTo' < p_filter ->> 'dateFrom'
  then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

create table public.campaigns (
  id bigint generated always as identity,
  code text not null,
  name text not null,
  channel text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  sent_count integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint campaigns_pk primary key (id),
  constraint campaigns_code_unique unique (code),
  constraint campaigns_code_check check (
    pg_catalog.char_length(code) between 3 and 60
    and code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint campaigns_name_check check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 100
    and name !~ '[[:cntrl:]]'
  ),
  constraint campaigns_channel_check check (
    channel in ('sms', 'qr', 'social', 'kakao', 'direct', 'other')
  ),
  constraint campaigns_status_check check (status in ('draft', 'active', 'archived')),
  constraint campaigns_dates_check check (
    starts_at is null or ends_at is null or ends_at > starts_at
  ),
  constraint campaigns_sent_count_check check (sent_count between 0 and 2147483647),
  constraint campaigns_updated_check check (updated_at >= created_at)
);

create index campaigns_status_created_idx
  on public.campaigns(status, created_at desc, id desc);

create function public.enforce_immutable_campaign_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception using errcode = 'P0001', message = 'CAMPAIGN_CODE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger campaigns_immutable_code_trigger
before update on public.campaigns
for each row execute function public.enforce_immutable_campaign_code();

alter table public.assessments
  add constraint assessments_campaign_fk foreign key (campaign_id)
    references public.campaigns(id) on delete restrict not valid;

alter table public.events
  add constraint events_campaign_fk foreign key (campaign_id)
    references public.campaigns(id) on delete restrict not valid;

alter table public.assessments validate constraint assessments_campaign_fk;
alter table public.events validate constraint events_campaign_fk;

create index assessments_campaign_created_idx
  on public.assessments(campaign_id, completed_at desc, id desc)
  where campaign_id is not null;

create table public.export_jobs (
  id bigint generated always as identity,
  created_by_admin_id uuid not null,
  filter_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'created',
  student_row_count integer not null default 0,
  participation_row_count integer not null default 0,
  counseling_row_count integer not null default 0,
  error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  downloaded_at timestamptz,
  constraint export_jobs_pk primary key (id),
  constraint export_jobs_created_by_admin_fk foreign key (created_by_admin_id)
    references public.admin_users(id) on delete restrict,
  constraint export_jobs_filter_check check (
    public.is_valid_export_filter_snapshot(filter_snapshot)
  ),
  constraint export_jobs_status_check check (
    status in ('created', 'fetching', 'completed', 'failed')
  ),
  constraint export_jobs_row_counts_check check (
    student_row_count between 0 and 30000
    and participation_row_count between 0 and 30000
    and counseling_row_count between 0 and 30000
  ),
  constraint export_jobs_error_code_check check (
    error_code is null or error_code in (
      'EXPORT_AUTHORIZATION_FAILED',
      'EXPORT_DOWNLOAD_FAILED',
      'EXPORT_FETCH_FAILED',
      'EXPORT_FILTER_REQUIRED',
      'EXPORT_INTERNAL_ERROR',
      'EXPORT_REAUTH_REQUIRED',
      'EXPORT_ROW_LIMIT_EXCEEDED',
      'EXPORT_SESSION_EXPIRED',
      'EXPORT_WORKBOOK_FAILED'
    )
  ),
  constraint export_jobs_lifecycle_check check (
    (
      status in ('created', 'fetching')
      and completed_at is null
      and downloaded_at is null
      and error_code is null
    )
    or (
      status = 'completed'
      and completed_at is not null
      and completed_at >= created_at
      and error_code is null
      and (downloaded_at is null or downloaded_at >= completed_at)
    )
    or (
      status = 'failed'
      and completed_at is not null
      and completed_at >= created_at
      and downloaded_at is null
      and error_code is not null
    )
  )
);

create index export_jobs_creator_created_idx
  on public.export_jobs(created_by_admin_id, created_at desc, id desc);

create index export_jobs_status_created_idx
  on public.export_jobs(status, created_at desc, id desc);

create function public.guard_export_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.admin_users admin_user
      where admin_user.id = new.created_by_admin_id
        and admin_user.role = 'admin'
        and admin_user.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'EXPORT_ACTIVE_ADMIN_REQUIRED';
    end if;
    if new.status <> 'created' then
      raise exception using errcode = 'P0001', message = 'EXPORT_INITIAL_STATUS_INVALID';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception using errcode = 'P0001', message = 'EXPORT_ID_IMMUTABLE';
  end if;
  if new.created_by_admin_id is distinct from old.created_by_admin_id then
    raise exception using errcode = 'P0001', message = 'EXPORT_CREATOR_IMMUTABLE';
  end if;
  if new.filter_snapshot is distinct from old.filter_snapshot then
    raise exception using errcode = 'P0001', message = 'EXPORT_FILTER_SNAPSHOT_IMMUTABLE';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'EXPORT_CREATED_AT_IMMUTABLE';
  end if;

  if old.status in ('completed', 'failed') then
    if new.status is distinct from old.status
      or new.student_row_count is distinct from old.student_row_count
      or new.participation_row_count is distinct from old.participation_row_count
      or new.counseling_row_count is distinct from old.counseling_row_count
      or new.completed_at is distinct from old.completed_at
      or new.error_code is distinct from old.error_code
      or (old.status = 'failed' and new.downloaded_at is distinct from old.downloaded_at)
    then
      raise exception using errcode = 'P0001', message = 'EXPORT_TERMINAL_AUDIT_IMMUTABLE';
    end if;
    if old.downloaded_at is not null and new.downloaded_at is distinct from old.downloaded_at then
      raise exception using errcode = 'P0001', message = 'EXPORT_DOWNLOAD_TIMESTAMP_IMMUTABLE';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'created' and new.status in ('fetching', 'failed'))
    or (old.status = 'fetching' and new.status in ('completed', 'failed'))
  ) then
    raise exception using errcode = 'P0001', message = 'EXPORT_STATUS_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

create trigger export_jobs_guard_trigger
before insert or update on public.export_jobs
for each row execute function public.guard_export_job();

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
alter table public.export_jobs enable row level security;
alter table public.export_jobs force row level security;

revoke all privileges on table public.campaigns, public.export_jobs
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.campaigns, public.export_jobs
  to service_role;

revoke all privileges on sequence public.campaigns_id_seq, public.export_jobs_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.campaigns_id_seq, public.export_jobs_id_seq
  to service_role;

revoke all privileges on function public.enforce_immutable_campaign_code()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.guard_export_job()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.is_valid_export_filter_snapshot(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_valid_export_filter_snapshot(jsonb) to service_role;
