create table public.admission_cycles (
  id uuid primary key,
  year integer not null unique check (year between 2020 and 2200),
  status text not null check (status in ('current', 'archived')),
  roster_version integer not null default 0 check (roster_version >= 0),
  password_key_version integer not null check (password_key_version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  archived_at timestamptz
);

create unique index admission_cycles_one_current_idx
  on public.admission_cycles ((status))
  where status = 'current';

alter table public.admission_cycles enable row level security;

revoke all privileges on table public.admission_cycles
  from public, anon, authenticated;

alter table public.prospects
  add column admission_cycle_id uuid references public.admission_cycles(id),
  add column name_hmac bytea check (
    name_hmac is null or pg_catalog.octet_length(name_hmac) = 32
  ),
  add column name_ciphertext bytea check (
    name_ciphertext is null or pg_catalog.octet_length(name_ciphertext) >= 16
  ),
  add column name_iv bytea check (
    name_iv is null or pg_catalog.octet_length(name_iv) = 12
  ),
  add column is_test boolean not null default false;

alter table public.prospects
  drop constraint prospects_status_check,
  add constraint prospects_status_check
    check (status in ('active', 'inactive', 'deleted'));

alter table public.student_credentials
  add column password_bcrypt text check (
    password_bcrypt is null
    or password_bcrypt ~ '^\$2[ab]\$10\$[./A-Za-z0-9]{53}$'
  ),
  add column password_generation integer check (
    password_generation is null
    or password_generation between 1 and 2147483647
  );

insert into public.admission_cycles (
  id,
  year,
  status,
  roster_version,
  password_key_version,
  archived_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  2025,
  'archived',
  0,
  1,
  pg_catalog.clock_timestamp()
);

update public.prospects
set admission_cycle_id = '00000000-0000-4000-8000-000000000001'
where admission_cycle_id is null;

update public.student_sessions
set revoked_at = pg_catalog.clock_timestamp()
where revoked_at is null;
