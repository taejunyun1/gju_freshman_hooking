alter table public.resources alter column source_date drop not null;
alter table public.resources force row level security;
alter table public.resource_tags force row level security;
alter table public.equipment_inventory_items force row level security;
alter table public.equipment_inventory_items
  add column updated_at timestamptz not null default pg_catalog.now();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'resource-images',
  'resource-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.create_admin_resource(
  p_admin_user_id uuid,
  p_request_id uuid,
  p_resource jsonb,
  p_tags jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource_id bigint;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_resource) <> 'object'
    or pg_catalog.jsonb_typeof(p_tags) <> 'array'
    or pg_catalog.jsonb_array_length(p_tags) < 1
    or (select count(*) from pg_catalog.jsonb_array_elements(p_tags) tag where tag.value ->> 'isPrimary' = 'true') <> 1
  then
    raise exception using errcode = 'P0001', message = 'RESOURCE_INVALID';
  end if;

  insert into public.resources(
    type, title, summary, connection_template, status, visibility, priority,
    source_date, metadata, image_path
  )
  values (
    p_resource ->> 'type',
    p_resource ->> 'title',
    p_resource ->> 'summary',
    p_resource ->> 'connectionTemplate',
    'draft',
    p_resource ->> 'visibility',
    (p_resource ->> 'priority')::smallint,
    nullif(p_resource ->> 'sourceDate', '')::date,
    p_resource -> 'metadata',
    nullif(p_resource ->> 'imagePath', '')
  )
  returning id into v_resource_id;

  insert into public.resource_tags(resource_id, tag_key, weight, is_primary)
  select
    v_resource_id,
    tag.value ->> 'key',
    (tag.value ->> 'weight')::smallint,
    (tag.value ->> 'isPrimary')::boolean
  from pg_catalog.jsonb_array_elements(p_tags) tag(value);

  return v_resource_id;
end;
$$;

create function public.update_admin_resource(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_request_id uuid,
  p_resource_id bigint,
  p_resource jsonb,
  p_tags jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.resources%rowtype;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  select * into v_current from public.resources where id = p_resource_id for update;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_current.updated_at is distinct from p_expected_updated_at then
    return '{"status":"conflict"}'::jsonb;
  end if;
  if v_current.status not in ('draft', 'archived') then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_resource) <> 'object'
    or pg_catalog.jsonb_typeof(p_tags) <> 'array'
    or pg_catalog.jsonb_array_length(p_tags) < 1
    or (select count(*) from pg_catalog.jsonb_array_elements(p_tags) tag where tag.value ->> 'isPrimary' = 'true') <> 1
  then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;

  begin
    update public.resources
    set type = p_resource ->> 'type',
        title = p_resource ->> 'title',
        summary = p_resource ->> 'summary',
        connection_template = p_resource ->> 'connectionTemplate',
        visibility = p_resource ->> 'visibility',
        priority = (p_resource ->> 'priority')::smallint,
        source_date = nullif(p_resource ->> 'sourceDate', '')::date,
        metadata = p_resource -> 'metadata',
        image_path = nullif(p_resource ->> 'imagePath', ''),
        updated_at = pg_catalog.clock_timestamp()
    where id = p_resource_id;

    delete from public.resource_tags where resource_id = p_resource_id;
    insert into public.resource_tags(resource_id, tag_key, weight, is_primary)
    select
      p_resource_id,
      tag.value ->> 'key',
      (tag.value ->> 'weight')::smallint,
      (tag.value ->> 'isPrimary')::boolean
    from pg_catalog.jsonb_array_elements(p_tags) tag(value);
  exception when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range or cardinality_violation then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end;
  return '{"status":"updated"}'::jsonb;
end;
$$;

create function public.transition_admin_resource(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_request_id uuid,
  p_resource_id bigint,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.resources%rowtype;
  v_consent_at text;
  v_consent_timestamp timestamptz;
  v_location text;
  v_note text;
  v_activities jsonb;
  v_verified_at text;
  v_verified_timestamp timestamptz;
  v_verified_quantity integer;
  v_transition_updated_at timestamptz;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if p_expected_updated_at is null
    or not pg_catalog.isfinite(p_expected_updated_at)
    or p_status is null
    or p_status not in ('active', 'archived')
  then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;
  select * into v_current from public.resources where id = p_resource_id for update;
  if not found then
    return '{"status":"not_found"}'::jsonb;
  end if;
  if v_current.updated_at <> p_expected_updated_at then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'resourceUpdatedAt', v_current.updated_at
    );
  end if;

  if p_status = 'active' then
    if v_current.source_date is null then
      return '{"status":"validation_error","code":"RESOURCE_SOURCE_REQUIRED"}'::jsonb;
    end if;
    if (select count(*) from public.resource_tags where resource_id = p_resource_id and is_primary) <> 1 then
      return '{"status":"validation_error","code":"RESOURCE_PRIMARY_TAG_REQUIRED"}'::jsonb;
    end if;
    if v_current.type = 'course' then
      if pg_catalog.jsonb_typeof(v_current.metadata -> 'academic_year') <> 'number'
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'grade_year') <> 'number'
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'credits') <> 'number'
      then
        return '{"status":"validation_error","code":"COURSE_METADATA_REQUIRED"}'::jsonb;
      end if;
      if (v_current.metadata ->> 'academic_year')::numeric <> pg_catalog.trunc((v_current.metadata ->> 'academic_year')::numeric)
        or (v_current.metadata ->> 'academic_year')::numeric not between 2000 and 2100
        or (v_current.metadata ->> 'grade_year')::numeric <> pg_catalog.trunc((v_current.metadata ->> 'grade_year')::numeric)
        or (v_current.metadata ->> 'grade_year')::numeric not between 1 and 4
        or (v_current.metadata ->> 'credits')::numeric <> pg_catalog.trunc((v_current.metadata ->> 'credits')::numeric)
        or (v_current.metadata ->> 'credits')::numeric not between 0 and 30
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'term') <> 'string'
        or (v_current.metadata ->> 'term') <> pg_catalog.btrim(v_current.metadata ->> 'term')
        or pg_catalog.char_length(v_current.metadata ->> 'term') not between 1 and 40
        or (v_current.metadata ->> 'term') ~ '[[:cntrl:]]'
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'goal') <> 'string'
        or (v_current.metadata ->> 'goal') <> pg_catalog.btrim(v_current.metadata ->> 'goal')
        or pg_catalog.char_length(v_current.metadata ->> 'goal') not between 1 and 1000
        or (v_current.metadata ->> 'goal') ~ '[[:cntrl:]]'
      then
        return '{"status":"validation_error","code":"COURSE_METADATA_REQUIRED"}'::jsonb;
      end if;
    end if;
    if v_current.type = 'student_work' then
      v_consent_at := v_current.metadata ->> 'consent_at';
      if pg_catalog.jsonb_typeof(v_current.metadata -> 'consent_at') <> 'string'
        or v_consent_at <> pg_catalog.btrim(v_consent_at)
        or pg_catalog.char_length(v_consent_at) not between 1 and 40
        or v_consent_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then
        return '{"status":"validation_error","code":"WORK_CONSENT_REQUIRED"}'::jsonb;
      end if;
      begin
        v_consent_timestamp := v_consent_at::timestamptz;
      exception when others then
        return '{"status":"validation_error","code":"WORK_CONSENT_REQUIRED"}'::jsonb;
      end;
      if not pg_catalog.isfinite(v_consent_timestamp) or v_consent_timestamp > pg_catalog.clock_timestamp() then
        return '{"status":"validation_error","code":"WORK_CONSENT_REQUIRED"}'::jsonb;
      end if;
      if v_current.image_path is null
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'image_alt') <> 'string'
        or (v_current.metadata ->> 'image_alt') <> pg_catalog.btrim(v_current.metadata ->> 'image_alt')
        or pg_catalog.char_length(v_current.metadata ->> 'image_alt') not between 1 and 200
        or (v_current.metadata ->> 'image_alt') ~ '[[:cntrl:]]'
      then
        return '{"status":"validation_error","code":"WORK_MEDIA_REQUIRED"}'::jsonb;
      end if;
      if pg_catalog.jsonb_typeof(v_current.metadata -> 'related_course') <> 'string'
        or (v_current.metadata ->> 'related_course') <> pg_catalog.btrim(v_current.metadata ->> 'related_course')
        or pg_catalog.char_length(v_current.metadata ->> 'related_course') not between 1 and 200
        or (v_current.metadata ->> 'related_course') ~ '[[:cntrl:]]'
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'related_year') <> 'number'
        or (v_current.metadata ->> 'related_year')::numeric <> pg_catalog.trunc((v_current.metadata ->> 'related_year')::numeric)
        or (v_current.metadata ->> 'related_year')::numeric not between 1 and 4
        or pg_catalog.jsonb_typeof(v_current.metadata -> 'related_track') <> 'string'
        or (v_current.metadata ->> 'related_track') !~ '^[a-z][a-z0-9_]{0,63}$'
      then
        return '{"status":"validation_error","code":"WORK_RELATION_REQUIRED"}'::jsonb;
      end if;
    end if;
    if v_current.type = 'equipment' then
      select count(*)::integer into v_verified_quantity
      from public.equipment_inventory_items
      where equipment_resource_id = p_resource_id and data_quality_status = 'verified';
      if v_verified_quantity = 0 then
        return '{"status":"validation_error","code":"EQUIPMENT_INVENTORY_UNVERIFIED"}'::jsonb;
      end if;
      v_current.metadata := (v_current.metadata - 'confirmed_quantity' - 'confirmedQuantity')
        || pg_catalog.jsonb_build_object('confirmedQuantity', v_verified_quantity);
    end if;
    if v_current.type = 'facility' then
      v_location := v_current.metadata ->> 'location_label';
      v_note := coalesce(v_current.metadata ->> 'operation_note', v_current.metadata ->> 'operationNote');
      v_activities := v_current.metadata -> 'activities';
      v_verified_at := coalesce(v_current.metadata ->> 'last_verified_at', v_current.metadata ->> 'lastVerifiedAt');
      if pg_catalog.jsonb_typeof(v_current.metadata -> 'location_label') <> 'string'
        or v_location <> pg_catalog.btrim(v_location)
        or pg_catalog.char_length(v_location) not between 1 and 120
        or v_location ~ '[[:cntrl:]]'
        or v_note is null or v_note <> pg_catalog.btrim(v_note)
        or pg_catalog.char_length(v_note) not between 1 and 1000
        or v_note ~ '[[:cntrl:]]'
        or pg_catalog.jsonb_typeof(v_activities) <> 'array'
        or pg_catalog.jsonb_array_length(v_activities) not between 1 and 30
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(v_activities) activity(value)
          where pg_catalog.jsonb_typeof(activity.value) <> 'string'
            or (activity.value #>> '{}') <> pg_catalog.btrim(activity.value #>> '{}')
            or pg_catalog.char_length(activity.value #>> '{}') not between 1 and 200
            or (activity.value #>> '{}') ~ '[[:cntrl:]]'
        )
        or v_verified_at is null
        or v_verified_at <> pg_catalog.btrim(v_verified_at)
        or pg_catalog.char_length(v_verified_at) not between 1 and 40
        or v_verified_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then
        return '{"status":"validation_error","code":"FACILITY_OPERATION_UNVERIFIED"}'::jsonb;
      end if;
      begin
        v_verified_timestamp := v_verified_at::timestamptz;
      exception when others then
        return '{"status":"validation_error","code":"FACILITY_OPERATION_UNVERIFIED"}'::jsonb;
      end;
      if not pg_catalog.isfinite(v_verified_timestamp) or v_verified_timestamp > pg_catalog.clock_timestamp() then
        return '{"status":"validation_error","code":"FACILITY_OPERATION_UNVERIFIED"}'::jsonb;
      end if;
    end if;
  end if;

  update public.resources
  set status = p_status,
      metadata = case when v_current.type = 'equipment' and p_status = 'active'
        then v_current.metadata else metadata end,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_resource_id
  returning updated_at into v_transition_updated_at;

  insert into public.audit_events(
    admin_user_id, action, target_type, target_id, metadata, request_id
  ) values (
    p_admin_user_id,
    case when p_status = 'active' then 'resource_published' else 'resource_archived' end,
    'resource',
    p_resource_id::text,
    pg_catalog.jsonb_build_object('changedFields', pg_catalog.jsonb_build_array('status')),
    p_request_id
  );
  return pg_catalog.jsonb_build_object(
    'status', 'updated',
    'resourceUpdatedAt', v_transition_updated_at
  );
end;
$$;

create function public.attach_admin_resource_image(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_image_path text,
  p_request_id uuid,
  p_resource_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.resources%rowtype;
  v_committed_at timestamptz;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if p_image_path is null
    or pg_catalog.char_length(p_image_path) not between 1 and 512
    or p_image_path !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_image_path ~ '(^|/)\.{1,2}(/|$)'
  then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;
  select * into v_current from public.resources where id = p_resource_id for update;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_current.updated_at is distinct from p_expected_updated_at then
    return '{"status":"conflict"}'::jsonb;
  end if;
  if v_current.status not in ('draft', 'archived') then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;
  update public.resources
  set image_path = p_image_path, updated_at = pg_catalog.clock_timestamp()
  where id = p_resource_id
  returning updated_at into v_committed_at;
  return pg_catalog.jsonb_build_object(
    'status', 'committed',
    'resourceId', p_resource_id,
    'previousImagePath', v_current.image_path,
    'committedUpdatedAt', v_committed_at
  );
end;
$$;

create function public.update_admin_resource_inventory(
  p_admin_user_id uuid,
  p_expected_updated_at timestamptz,
  p_inventory_resource_id bigint,
  p_inventory_item_id bigint,
  p_request_id uuid,
  p_update jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.resources%rowtype;
  v_current public.equipment_inventory_items%rowtype;
  v_previous_code text;
  v_note text;
  v_verified_quantity integer;
  v_resource_updated_at timestamptz;
begin
  if not exists (
    select 1 from public.admin_users
    where id = p_admin_user_id and role = 'admin' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_update) <> 'object'
    or not p_update ?& array[
      'inventoryCode', 'locationKey', 'accessMode', 'availabilityState', 'note', 'dataQualityStatus'
    ]
    or (select count(*) from pg_catalog.jsonb_object_keys(p_update)) <> 6
    or pg_catalog.jsonb_typeof(p_update -> 'inventoryCode') <> 'string'
    or (p_update ->> 'inventoryCode') <> pg_catalog.btrim(p_update ->> 'inventoryCode')
    or pg_catalog.char_length(p_update ->> 'inventoryCode') not between 1 and 100
    or (p_update ->> 'inventoryCode') ~ '[[:cntrl:]]'
    or pg_catalog.jsonb_typeof(p_update -> 'locationKey') <> 'string'
    or p_update ->> 'locationKey' not in ('department_equipment_room', 'fantasy_lab')
    or pg_catalog.jsonb_typeof(p_update -> 'accessMode') <> 'string'
    or p_update ->> 'accessMode' not in ('reservation', 'inquiry')
    or pg_catalog.jsonb_typeof(p_update -> 'availabilityState') <> 'string'
    or p_update ->> 'availabilityState' not in ('available', 'unavailable', 'unknown')
    or pg_catalog.jsonb_typeof(p_update -> 'dataQualityStatus') <> 'string'
    or p_update ->> 'dataQualityStatus' not in ('verified', 'duplicate_code', 'unidentified', 'quantity_check')
    or pg_catalog.jsonb_typeof(p_update -> 'note') not in ('null', 'string')
  then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;
  v_note := p_update ->> 'note';
  if v_note is not null and (
    v_note <> pg_catalog.btrim(v_note)
    or pg_catalog.char_length(v_note) not between 1 and 1000
    or v_note ~ '[[:cntrl:]]'
  ) then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;

  select * into v_parent
  from public.resources
  where id = p_inventory_resource_id
  for update;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_parent.type <> 'equipment' then
    return '{"status":"validation_error","code":"RESOURCE_INVALID"}'::jsonb;
  end if;

  select * into v_current
  from public.equipment_inventory_items
  where id = p_inventory_item_id and equipment_resource_id = p_inventory_resource_id
  for update;
  if not found then return '{"status":"not_found"}'::jsonb; end if;
  if v_current.updated_at is distinct from p_expected_updated_at then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'current', pg_catalog.to_jsonb(v_current));
  end if;

  v_previous_code := v_current.inventory_code;
  begin
    update public.equipment_inventory_items
    set inventory_code = p_update ->> 'inventoryCode',
        location_key = p_update ->> 'locationKey',
        access_mode = p_update ->> 'accessMode',
        availability_state = p_update ->> 'availabilityState',
        note = v_note,
        data_quality_status = p_update ->> 'dataQualityStatus',
        updated_at = pg_catalog.clock_timestamp()
    where id = p_inventory_item_id
    returning * into v_current;

    select count(*)::integer into v_verified_quantity
    from public.equipment_inventory_items
    where equipment_resource_id = p_inventory_resource_id
      and data_quality_status = 'verified';
    if v_parent.status = 'active' and v_verified_quantity = 0 then
      raise exception using errcode = 'P0001', message = 'EQUIPMENT_INVENTORY_UNVERIFIED';
    end if;

    update public.resources
    set metadata = (metadata - 'confirmed_quantity' - 'confirmedQuantity')
        || pg_catalog.jsonb_build_object('confirmedQuantity', v_verified_quantity),
        updated_at = pg_catalog.clock_timestamp()
    where id = p_inventory_resource_id
    returning updated_at into v_resource_updated_at;

    if v_previous_code is distinct from v_current.inventory_code then
      insert into public.audit_events(
        admin_user_id, action, target_type, target_id, metadata, request_id
      ) values (
        p_admin_user_id,
        'equipment_inventory_code_changed',
        'equipment_inventory_item',
        p_inventory_item_id::text,
        pg_catalog.jsonb_build_object(
          'previousCode', v_previous_code,
          'newCode', v_current.inventory_code,
          'itemId', p_inventory_item_id,
          'resourceId', p_inventory_resource_id
        ),
        p_request_id
      );
    end if;
  exception when raise_exception then
    if sqlerrm = 'EQUIPMENT_INVENTORY_UNVERIFIED' then
      return '{"status":"validation_error","code":"EQUIPMENT_INVENTORY_UNVERIFIED"}'::jsonb;
    end if;
    raise;
  end;

  return pg_catalog.jsonb_build_object(
    'status', 'updated',
    'item', pg_catalog.to_jsonb(v_current),
    'resourceUpdatedAt', v_resource_updated_at
  );
end;
$$;

revoke all privileges on function public.create_admin_resource(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.update_admin_resource(uuid, timestamptz, uuid, bigint, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.transition_admin_resource(uuid, timestamptz, uuid, bigint, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.attach_admin_resource_image(uuid, timestamptz, text, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.update_admin_resource_inventory(uuid, timestamptz, bigint, bigint, uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.create_admin_resource(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.update_admin_resource(uuid, timestamptz, uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.transition_admin_resource(uuid, timestamptz, uuid, bigint, text) to service_role;
grant execute on function public.attach_admin_resource_image(uuid, timestamptz, text, uuid, bigint) to service_role;
grant execute on function public.update_admin_resource_inventory(uuid, timestamptz, bigint, bigint, uuid, jsonb) to service_role;
