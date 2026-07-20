create or replace function public.is_valid_export_filter_snapshot(p_filter jsonb)
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
        'counselingStatus', 'exportSegment', 'assignedFaculty', 'dateFrom', 'dateTo'
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

  if p_filter ? 'exportSegment' and (
    pg_catalog.jsonb_typeof(p_filter -> 'exportSegment') <> 'string'
    or p_filter ->> 'exportSegment' not in (
      'counseling_requested', 'completed_without_counseling', 'not_completed'
    )
  ) then
    return false;
  end if;

  if p_filter ? 'assignedFaculty' and not (
    (pg_catalog.jsonb_typeof(p_filter -> 'assignedFaculty') = 'number'
      and (p_filter ->> 'assignedFaculty') ~ '^[1-9][0-9]{0,15}$'
      and (p_filter ->> 'assignedFaculty')::numeric <= 9007199254740991)
    or (pg_catalog.jsonb_typeof(p_filter -> 'assignedFaculty') = 'string'
      and p_filter ->> 'assignedFaculty' = 'unassigned')
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

create or replace function public.is_admin_export_prospect_base_match(
  p_prospect_id bigint,
  p_filter jsonb,
  p_cutoff timestamptz
)
returns boolean
language sql
stable
strict
security definer
set search_path = ''
as $$
  select public.is_valid_export_filter_snapshot(p_filter)
    and exists (
      select 1
      from public.prospects prospect
      where prospect.id = p_prospect_id
        and prospect.status = 'active'
        and prospect.created_at <= p_cutoff
        and (not (p_filter ? 'query') or (
          pg_catalog.strpos(pg_catalog.lower(prospect.nickname), pg_catalog.lower(p_filter ->> 'query')) > 0
          or pg_catalog.strpos(pg_catalog.lower(prospect.school_name), pg_catalog.lower(p_filter ->> 'query')) > 0
        ))
        and (not (p_filter ? 'stage') or prospect.applicant_stage = p_filter ->> 'stage')
        and (not (p_filter ? 'region') or prospect.region = p_filter ->> 'region')
        and (not (p_filter ? 'school') or
          pg_catalog.strpos(pg_catalog.lower(prospect.school_name), pg_catalog.lower(p_filter ->> 'school')) > 0)
        and (
          not (p_filter ? 'exportSegment')
          or (
            p_filter ->> 'exportSegment' = 'counseling_requested'
            and exists (
              select 1 from public.counseling_requests request
              where request.prospect_id = prospect.id and request.created_at <= p_cutoff
            )
          )
          or (
            p_filter ->> 'exportSegment' = 'completed_without_counseling'
            and exists (
              select 1 from public.assessments assessment
              where assessment.prospect_id = prospect.id
                and assessment.status = 'completed'
                and assessment.created_at <= p_cutoff
                and assessment.completed_at <= p_cutoff
            )
            and not exists (
              select 1 from public.counseling_requests request
              where request.prospect_id = prospect.id and request.created_at <= p_cutoff
            )
          )
          or (
            p_filter ->> 'exportSegment' = 'not_completed'
            and not exists (
              select 1 from public.assessments assessment
              where assessment.prospect_id = prospect.id
                and assessment.status = 'completed'
                and assessment.created_at <= p_cutoff
                and assessment.completed_at <= p_cutoff
            )
          )
        )
        and (
          not (p_filter ? 'assignedFaculty')
          or exists (
            select 1
            from lateral (
              select request.assigned_faculty_id
              from public.counseling_requests request
              where request.prospect_id = prospect.id and request.created_at <= p_cutoff
              order by request.created_at desc, request.id desc
              limit 1
            ) latest_request
            where (
              pg_catalog.jsonb_typeof(p_filter -> 'assignedFaculty') = 'number'
              and latest_request.assigned_faculty_id = (p_filter ->> 'assignedFaculty')::bigint
            ) or (
              p_filter ->> 'assignedFaculty' = 'unassigned'
              and latest_request.assigned_faculty_id is null
            )
          )
        )
    );
$$;
