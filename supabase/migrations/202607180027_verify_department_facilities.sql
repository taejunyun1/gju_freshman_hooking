create function public.activate_verified_department_facilities()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid;
  v_resource public.resources%rowtype;
  v_outcome jsonb;
  v_metadata_updated integer := 0;
  v_resources_published integer := 0;
begin
  if (select count(*) from public.resources
      where metadata ->> 'seedKey' = any (array[
        'facility:studio_a_horizon', 'facility:studio_b',
        'facility:darkroom', 'facility:computer_lab'
      ]::text[])) <> 4
  then
    raise exception using errcode = 'P0001', message = 'DEPARTMENT_FACILITY_SEED_INVALID';
  end if;

  select admin_user.id into v_admin_user_id
  from public.admin_users admin_user
  where admin_user.role = 'admin' and admin_user.is_active
  order by admin_user.created_at, admin_user.id
  limit 1;
  if v_admin_user_id is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  update public.resources resource
  set metadata = (resource.metadata - 'operation_note' - 'last_verified_at')
        || pg_catalog.jsonb_build_object(
          'operationNote', case resource.metadata ->> 'seedKey'
            when 'facility:computer_lab' then
              '2020년형 iMac 및 RTX 4080급 그래픽카드 탑재 워크스테이션이 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
            else '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
          end,
          'location_label', '사진영상미디어학과',
          'lastVerifiedAt', '2026-07-18T16:28:30+09:00'
        ),
      updated_at = pg_catalog.clock_timestamp()
  where resource.metadata ->> 'seedKey' = any (array[
      'facility:studio_a_horizon', 'facility:studio_b',
      'facility:darkroom', 'facility:computer_lab'
    ]::text[])
    and (
      resource.type <> 'facility'
      or resource.visibility <> 'public'
      or resource.metadata ->> 'operationNote' is distinct from case resource.metadata ->> 'seedKey'
        when 'facility:computer_lab' then
          '2020년형 iMac 및 RTX 4080급 그래픽카드 탑재 워크스테이션이 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
        else '시설 존재가 확인되었습니다. 실제 이용은 학과에 문의해야 합니다.'
      end
      or resource.metadata ->> 'location_label' is distinct from '사진영상미디어학과'
      or resource.metadata ->> 'lastVerifiedAt' is distinct from '2026-07-18T16:28:30+09:00'
      or resource.metadata ? 'operation_note'
      or resource.metadata ? 'last_verified_at'
    );
  get diagnostics v_metadata_updated = row_count;

  if exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' = any (array[
      'facility:studio_a_horizon', 'facility:studio_b',
      'facility:darkroom', 'facility:computer_lab'
    ]::text[])
      and (type <> 'facility' or visibility <> 'public')
  ) then
    raise exception using errcode = 'P0001', message = 'DEPARTMENT_FACILITY_SEED_INVALID';
  end if;

  for v_resource in
    select * from public.resources
    where metadata ->> 'seedKey' = any (array[
      'facility:studio_a_horizon', 'facility:studio_b',
      'facility:darkroom', 'facility:computer_lab'
    ]::text[])
    order by id
  loop
    if v_resource.status = 'active' then
      continue;
    end if;
    if v_resource.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'DEPARTMENT_FACILITY_STATUS_INVALID';
    end if;
    v_outcome := public.transition_admin_resource(
      v_admin_user_id, v_resource.updated_at, pg_catalog.gen_random_uuid(), v_resource.id, 'active'
    );
    if v_outcome ->> 'status' <> 'updated' then
      raise exception using errcode = 'P0001', message = 'DEPARTMENT_FACILITY_ACTIVATION_FAILED';
    end if;
    v_resources_published := v_resources_published + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', case when v_metadata_updated + v_resources_published > 0
      then 'updated' else 'already_activated' end,
    'metadataUpdated', v_metadata_updated,
    'resourcesPublished', v_resources_published
  );
end;
$$;

revoke all on function public.activate_verified_department_facilities()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_department_facilities() to service_role;

do $$
declare
  v_outcome jsonb;
begin
  if exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' = any (array[
      'facility:studio_a_horizon', 'facility:studio_b',
      'facility:darkroom', 'facility:computer_lab'
    ]::text[])
  ) then
    v_outcome := public.activate_verified_department_facilities();
    if v_outcome ->> 'status' not in ('updated', 'already_activated') then
      raise exception using errcode = 'P0001', message = 'DEPARTMENT_FACILITY_MIGRATION_FAILED';
    end if;
  end if;
end;
$$;
