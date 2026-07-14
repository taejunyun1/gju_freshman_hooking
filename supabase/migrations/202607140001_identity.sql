create extension if not exists pgcrypto with schema extensions;

create function public.is_sanitized_json_value(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  item record;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      for item in select * from pg_catalog.jsonb_each(p_value)
      loop
        if item.key ~* 'phone|password|token|cookie|authorization|secret' then
          return false;
        end if;

        if not public.is_sanitized_json_value(item.value) then
          return false;
        end if;
      end loop;
    when 'array' then
      for item in select * from pg_catalog.jsonb_array_elements(p_value)
      loop
        if not public.is_sanitized_json_value(item.value) then
          return false;
        end if;
      end loop;
  end case;

  return true;
end;
$$;

create function public.is_sanitized_metadata(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and pg_catalog.octet_length(p_value::text) <= 4096
    and public.is_sanitized_json_value(p_value);
$$;

create table public.prospects (
  id bigint generated always as identity primary key,
  nickname text not null unique,
  phone_hmac bytea not null unique check (octet_length(phone_hmac) = 32),
  phone_ciphertext bytea not null check (octet_length(phone_ciphertext) >= 16),
  phone_iv bytea not null check (octet_length(phone_iv) = 12),
  school_name text not null check (char_length(school_name) between 1 and 40),
  applicant_stage text not null check (applicant_stage in ('high1', 'high2', 'high3', 'graduate', 'ged', 'other')),
  region text not null check (region in ('gwangju', 'jeonbuk', 'capital', 'chungcheong', 'gyeongsang', 'gangwon_jeju', 'overseas', 'other')),
  status text not null default 'active' check (status in ('active', 'deleted')),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_credentials (
  prospect_id bigint primary key references public.prospects(id) on delete cascade,
  password_hash bytea not null check (octet_length(password_hash) = 32),
  password_salt bytea not null check (octet_length(password_salt) >= 16),
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_sessions (
  id bigint generated always as identity primary key,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (idle_expires_at <= expires_at)
);

create unique index student_sessions_active_token_idx
  on public.student_sessions(token_hash)
  where revoked_at is null;

create index student_sessions_prospect_expiry_idx
  on public.student_sessions(prospect_id, expires_at)
  where revoked_at is null;

create table public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credential_recovery_requests (
  id bigint generated always as identity primary key,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'verified', 'consumed', 'expired')),
  code_hash bytea check (code_hash is null or octet_length(code_hash) = 32),
  requested_at timestamptz not null default now(),
  verified_by_admin_id uuid references public.admin_users(id) on delete set null,
  verified_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  check (expires_at > requested_at)
);

create index credential_recovery_requests_prospect_requested_idx
  on public.credential_recovery_requests(prospect_id, requested_at desc);

create index credential_recovery_requests_verified_by_admin_idx
  on public.credential_recovery_requests(verified_by_admin_id)
  where verified_by_admin_id is not null;

create table public.rate_limit_buckets (
  id bigint generated always as identity primary key,
  key_hash bytea not null check (octet_length(key_hash) = 32),
  route text not null check (char_length(route) between 1 and 160),
  window_started_at timestamptz not null,
  count integer not null default 0 check (count >= 0),
  expires_at timestamptz not null,
  unique (key_hash, route, window_started_at),
  check (expires_at > window_started_at)
);

create index rate_limit_buckets_expires_at_idx
  on public.rate_limit_buckets(expires_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_]*$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_]*$'),
  target_id text not null check (char_length(target_id) between 1 and 128),
  metadata jsonb not null default '{}'::jsonb check (public.is_sanitized_metadata(metadata)),
  request_id uuid not null,
  created_at timestamptz not null default now()
);

create index audit_events_admin_user_created_idx
  on public.audit_events(admin_user_id, created_at desc);

create index audit_events_action_created_idx
  on public.audit_events(action, created_at desc);

create table public.events (
  id bigint generated always as identity primary key,
  prospect_id bigint references public.prospects(id) on delete set null,
  anonymous_id uuid not null default extensions.gen_random_uuid(),
  campaign_id bigint,
  event_name text not null check (event_name in (
    'landing_viewed',
    'registration_started',
    'registration_completed',
    'login_succeeded',
    'login_failed',
    'assessment_started',
    'assessment_step_completed',
    'assessment_completed',
    'result_viewed',
    'resource_opened',
    'counseling_requested',
    'admin_phone_revealed',
    'admin_export_created'
  )),
  path text not null check (char_length(path) between 1 and 2048 and path like '/%' and path !~ '[?#]'),
  properties jsonb not null default '{}'::jsonb check (public.is_sanitized_metadata(properties)),
  created_at timestamptz not null default now()
);

create index events_prospect_created_idx
  on public.events(prospect_id, created_at desc)
  where prospect_id is not null;

create index events_event_name_created_idx
  on public.events(event_name, created_at desc);

create index events_campaign_created_idx
  on public.events(campaign_id, created_at desc);

alter table public.prospects enable row level security;
alter table public.student_credentials enable row level security;
alter table public.student_sessions enable row level security;
alter table public.admin_users enable row level security;
alter table public.credential_recovery_requests enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.audit_events enable row level security;
alter table public.events enable row level security;

revoke all privileges on table
  public.prospects,
  public.student_credentials,
  public.student_sessions,
  public.admin_users,
  public.credential_recovery_requests,
  public.rate_limit_buckets,
  public.audit_events,
  public.events
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.prospects,
  public.student_credentials,
  public.student_sessions,
  public.admin_users,
  public.credential_recovery_requests,
  public.rate_limit_buckets,
  public.audit_events,
  public.events
to service_role;

revoke all privileges on sequence
  public.prospects_id_seq,
  public.student_sessions_id_seq,
  public.credential_recovery_requests_id_seq,
  public.rate_limit_buckets_id_seq,
  public.audit_events_id_seq,
  public.events_id_seq
from public, anon, authenticated;

grant usage, select on sequence
  public.prospects_id_seq,
  public.student_sessions_id_seq,
  public.credential_recovery_requests_id_seq,
  public.rate_limit_buckets_id_seq,
  public.audit_events_id_seq,
  public.events_id_seq
to service_role;

revoke all privileges on function public.is_sanitized_json_value(jsonb) from public, anon, authenticated;
revoke all privileges on function public.is_sanitized_metadata(jsonb) from public, anon, authenticated;
grant execute on function public.is_sanitized_json_value(jsonb) to service_role;
grant execute on function public.is_sanitized_metadata(jsonb) to service_role;

create function public.consume_rate_limit(
  p_key text,
  p_route text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_key is null or char_length(p_key) = 0 then
    raise exception 'rate limit key must not be empty';
  end if;

  if p_route is null or char_length(p_route) not between 1 and 160 then
    raise exception 'rate limit route must contain between 1 and 160 characters';
  end if;

  if p_limit < 1 then
    raise exception 'rate limit must be positive';
  end if;

  if p_window is null or extract(epoch from p_window) <= 0 then
    raise exception 'rate limit window must be positive';
  end if;

  with rate_window as (
    select
      extensions.digest(p_key, 'sha256') as key_hash,
      clock_timestamp() as now_at,
      extract(epoch from p_window) as window_seconds
  ), upsert as (
    insert into public.rate_limit_buckets as bucket (
      key_hash,
      route,
      window_started_at,
      count,
      expires_at
    )
    select
      rate_window.key_hash,
      p_route,
      to_timestamp(
        floor(extract(epoch from rate_window.now_at) / rate_window.window_seconds)
        * rate_window.window_seconds
      ),
      1,
      to_timestamp(
        floor(extract(epoch from rate_window.now_at) / rate_window.window_seconds)
        * rate_window.window_seconds
      ) + p_window
    from rate_window
    on conflict (key_hash, route, window_started_at) do update
      set count = bucket.count + 1,
          expires_at = excluded.expires_at
    returning count
  )
  select count <= p_limit into v_allowed from upsert;

  return v_allowed;
end;
$$;

revoke all privileges on function public.consume_rate_limit(text, text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, interval)
  to service_role;
