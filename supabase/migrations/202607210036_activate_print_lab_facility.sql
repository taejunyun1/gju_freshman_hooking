create function public.activate_verified_print_lab_facility()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid;
  v_resource public.resources%rowtype;
  v_archive jsonb;
  v_archive_status text;
  v_source_url text;
  v_source_page_title text;
  v_source_last_edited text;
  v_source_last_edited_date date;
  v_track_evidence jsonb;
  v_outcome jsonb;
  v_metadata_updated integer := 0;
  v_resource_published integer := 0;
begin
  if (select count(*) from public.resources
      where metadata ->> 'seedKey' = 'archive:facility:print_lab') <> 1 then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_SEED_INVALID';
  end if;

  select * into strict v_resource
  from public.resources
  where metadata ->> 'seedKey' = 'archive:facility:print_lab';

  if v_resource.type <> 'facility' or v_resource.visibility <> 'public' then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_SEED_INVALID';
  end if;

  if v_resource.status not in ('draft', 'active') then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_STATUS_INVALID';
  end if;

  if v_resource.metadata -> 'supportingEvidence' is distinct from 'true'::jsonb then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_EVIDENCE_INVALID';
  end if;

  v_archive := v_resource.metadata -> 'archive';
  if pg_catalog.jsonb_typeof(v_archive) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_ARCHIVE_INVALID';
  end if;

  v_archive_status := v_archive ->> 'evidenceStatus';
  v_source_url := v_archive ->> 'sourceUrl';
  v_source_page_title := v_archive ->> 'sourcePageTitle';
  v_source_last_edited := v_archive ->> 'sourceLastEditedDate';
  v_track_evidence := v_archive -> 'trackEvidence';

  if pg_catalog.jsonb_typeof(v_archive -> 'sourceUrl') is distinct from 'string'
    or v_source_url <> pg_catalog.btrim(v_source_url)
    or pg_catalog.char_length(v_source_url) not between 1 and 2048
    or v_source_url !~ '^https://[^[:space:]]+$'
    or v_source_url ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(v_archive -> 'sourcePageTitle') is distinct from 'string'
    or v_source_page_title <> pg_catalog.btrim(v_source_page_title)
    or pg_catalog.char_length(v_source_page_title) not between 1 and 200
    or v_source_page_title ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(v_archive -> 'sourceLastEditedDate') is distinct from 'string'
    or v_source_last_edited !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.jsonb_typeof(v_track_evidence) is distinct from 'array'
    or pg_catalog.jsonb_array_length(v_track_evidence) not between 1 and 30
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_track_evidence) evidence(value)
      where pg_catalog.jsonb_typeof(evidence.value) is distinct from 'string'
        or (evidence.value #>> '{}') <> pg_catalog.btrim(evidence.value #>> '{}')
        or pg_catalog.char_length(evidence.value #>> '{}') not between 1 and 100
        or (evidence.value #>> '{}') ~ '[[:cntrl:]]'
    )
  then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_ARCHIVE_INVALID';
  end if;

  begin
    v_source_last_edited_date := v_source_last_edited::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_ARCHIVE_INVALID';
  end;
  if pg_catalog.to_char(v_source_last_edited_date, 'YYYY-MM-DD') <> v_source_last_edited then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_ARCHIVE_INVALID';
  end if;

  if (v_resource.status = 'draft' and v_archive_status is distinct from 'verify_required')
    or (v_resource.status = 'active' and v_archive_status is distinct from 'snapshot')
  then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_ARCHIVE_INVALID';
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
          'operationNote', '대형 프린터를 활용한 사진·포트폴리오·전시 출력 시설입니다. 실제 이용은 학과에 문의해야 합니다.',
          'location_label', '사진영상미디어학과 프린트랩',
          'lastVerifiedAt', '2026-07-21T12:20:00+09:00',
          'archive', v_archive || pg_catalog.jsonb_build_object('evidenceStatus', 'snapshot')
        ),
      updated_at = pg_catalog.clock_timestamp()
  where resource.metadata ->> 'seedKey' = 'archive:facility:print_lab'
    and (
      resource.metadata ->> 'operationNote' is distinct from
        '대형 프린터를 활용한 사진·포트폴리오·전시 출력 시설입니다. 실제 이용은 학과에 문의해야 합니다.'
      or resource.metadata ->> 'location_label' is distinct from '사진영상미디어학과 프린트랩'
      or resource.metadata ->> 'lastVerifiedAt' is distinct from '2026-07-21T12:20:00+09:00'
      or resource.metadata -> 'archive' ->> 'evidenceStatus' is distinct from 'snapshot'
      or resource.metadata ? 'operation_note'
      or resource.metadata ? 'last_verified_at'
    );
  get diagnostics v_metadata_updated = row_count;

  select * into strict v_resource
  from public.resources
  where metadata ->> 'seedKey' = 'archive:facility:print_lab';

  if v_resource.status = 'draft' then
    v_outcome := public.transition_admin_resource(
      v_admin_user_id, v_resource.updated_at, pg_catalog.gen_random_uuid(), v_resource.id, 'active'
    );
    if v_outcome ->> 'status' <> 'updated' then
      raise exception using errcode = 'P0001', message = 'PRINT_LAB_ACTIVATION_FAILED';
    end if;
    v_resource_published := 1;
  elsif v_resource.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'PRINT_LAB_STATUS_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', case when v_metadata_updated + v_resource_published > 0
      then 'updated' else 'already_activated' end,
    'metadataUpdated', v_metadata_updated,
    'resourcesPublished', v_resource_published
  );
end;
$$;

revoke all on function public.activate_verified_print_lab_facility()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_print_lab_facility() to service_role;

do $$
begin
  if exists (
    select 1 from public.resources
    where metadata ->> 'seedKey' = 'archive:facility:print_lab'
  ) and exists (
    select 1 from public.admin_users where role = 'admin' and is_active
  ) then
    perform public.activate_verified_print_lab_facility();
  end if;
end;
$$;
