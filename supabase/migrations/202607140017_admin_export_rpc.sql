create function public.is_admin_export_prospect_base_match(
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
    );
$$;

create function public.is_admin_export_assessment_match(
  p_assessment_id bigint,
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
  select exists (
    select 1
    from public.assessments assessment
    where assessment.id = p_assessment_id
      and assessment.status = 'completed'
      and assessment.created_at <= p_cutoff
      and assessment.completed_at <= p_cutoff
      and public.is_admin_export_prospect_base_match(assessment.prospect_id, p_filter, p_cutoff)
      and (not (p_filter ? 'track') or assessment.result_snapshot #>> '{rankedTracks,0}' = p_filter ->> 'track')
      and (not (p_filter ? 'campaignId') or assessment.campaign_id = (p_filter ->> 'campaignId')::bigint)
      and (not (p_filter ? 'dateFrom') or assessment.completed_at >=
        ((p_filter ->> 'dateFrom')::date::timestamp at time zone 'Asia/Seoul'))
      and (not (p_filter ? 'dateTo') or assessment.completed_at <
        (((p_filter ->> 'dateTo')::date + 1)::timestamp at time zone 'Asia/Seoul'))
      and (not (p_filter ? 'counselingStatus') or exists (
        select 1 from public.counseling_requests request
        where request.prospect_id = assessment.prospect_id
          and request.created_at <= p_cutoff
          and request.status = p_filter ->> 'counselingStatus'
      ))
  );
$$;

create function public.is_admin_export_counseling_match(
  p_request_id bigint,
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
  select exists (
    select 1
    from public.counseling_requests request
    where request.id = p_request_id
      and request.created_at <= p_cutoff
      and public.is_admin_export_prospect_base_match(request.prospect_id, p_filter, p_cutoff)
      and (not (p_filter ? 'counselingStatus') or request.status = p_filter ->> 'counselingStatus')
      and (
        not (p_filter ?| array['track', 'campaignId', 'dateFrom', 'dateTo'])
        or exists (
          select 1
          from public.assessments assessment
          where assessment.prospect_id = request.prospect_id
            and assessment.status = 'completed'
            and assessment.created_at <= p_cutoff
            and assessment.completed_at <= p_cutoff
            and (not (p_filter ? 'track') or assessment.result_snapshot #>> '{rankedTracks,0}' = p_filter ->> 'track')
            and (not (p_filter ? 'campaignId') or assessment.campaign_id = (p_filter ->> 'campaignId')::bigint)
            and (not (p_filter ? 'dateFrom') or assessment.completed_at >=
              ((p_filter ->> 'dateFrom')::date::timestamp at time zone 'Asia/Seoul'))
            and (not (p_filter ? 'dateTo') or assessment.completed_at <
              (((p_filter ->> 'dateTo')::date + 1)::timestamp at time zone 'Asia/Seoul'))
        )
      )
  );
$$;

create function public.is_admin_export_student_match(
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
  select public.is_admin_export_prospect_base_match(p_prospect_id, p_filter, p_cutoff)
    and (
      not (p_filter ?| array['track', 'campaignId', 'dateFrom', 'dateTo'])
      or exists (
        select 1 from public.assessments assessment
        where assessment.prospect_id = p_prospect_id
          and public.is_admin_export_assessment_match(assessment.id, p_filter - 'counselingStatus', p_cutoff)
      )
    )
    and (
      not (p_filter ? 'counselingStatus')
      or exists (
        select 1 from public.counseling_requests request
        where request.prospect_id = p_prospect_id
          and public.is_admin_export_counseling_match(
            request.id,
            p_filter - 'track' - 'campaignId' - 'dateFrom' - 'dateTo',
            p_cutoff
          )
      )
    );
$$;

create function public.require_owned_admin_export_job(
  p_job_id bigint,
  p_admin_id uuid,
  p_allowed_statuses text[]
)
returns public.export_jobs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  if p_job_id is null or p_admin_id is null or p_allowed_statuses is null
    or not exists (
      select 1 from public.admin_users admin_user
      where admin_user.id = p_admin_id and admin_user.role = 'admin' and admin_user.is_active
    )
  then
    raise exception using errcode = '22023', message = 'EXPORT_ACTIVE_ADMIN_REQUIRED';
  end if;

  select export_job.* into v_job
  from public.export_jobs export_job
  where export_job.id = p_job_id
    and export_job.created_by_admin_id = p_admin_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'EXPORT_JOB_NOT_FOUND';
  end if;
  if not (v_job.status = any(p_allowed_statuses)) then
    raise exception using errcode = 'P0001', message = 'EXPORT_JOB_STATUS_INVALID';
  end if;
  return v_job;
end;
$$;

create function public.admin_export_counts(p_job_id bigint, p_admin_id uuid)
returns table(student_count integer, assessment_count integer, counseling_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['created', 'fetching']);
  return query
  select
    (select pg_catalog.count(*)::integer
     from public.prospects prospect
     where public.is_admin_export_student_match(prospect.id, v_job.filter_snapshot, v_job.created_at)),
    (select pg_catalog.count(*)::integer
     from public.assessments assessment
     where assessment.created_at <= v_job.created_at
       and assessment.completed_at <= v_job.created_at
       and public.is_admin_export_assessment_match(assessment.id, v_job.filter_snapshot, v_job.created_at)),
    (select pg_catalog.count(*)::integer
     from public.counseling_requests request
     where request.created_at <= v_job.created_at
       and public.is_admin_export_counseling_match(request.id, v_job.filter_snapshot, v_job.created_at));
end;
$$;

create function public.validate_admin_export_page(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id bigint
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_limit is distinct from 1000
    or (p_cursor_created_at is null) <> (p_cursor_id is null)
    or (p_cursor_id is not null and p_cursor_id <= 0)
  then
    raise exception using errcode = '22023', message = 'EXPORT_PAGE_INVALID';
  end if;
  return true;
end;
$$;

create function public.admin_export_student_rows(
  p_job_id bigint,
  p_admin_id uuid,
  p_cursor_created_at timestamptz,
  p_cursor_id bigint,
  p_limit integer
)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  perform public.validate_admin_export_page(p_limit, p_cursor_created_at, p_cursor_id);
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['fetching']);
  return query
  select pg_catalog.jsonb_build_object(
    'id', prospect.id,
    'created_at', pg_catalog.to_char(prospect.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'nickname', prospect.nickname,
    'phone_ciphertext', E'\\x' || pg_catalog.encode(prospect.phone_ciphertext, 'hex'),
    'phone_iv', E'\\x' || pg_catalog.encode(prospect.phone_iv, 'hex'),
    'school_name', prospect.school_name,
    'applicant_stage', prospect.applicant_stage,
    'region', prospect.region,
    'total_participation', (
      select pg_catalog.count(*)::integer from public.assessments assessment_count
      where assessment_count.prospect_id = prospect.id
        and assessment_count.status = 'completed'
        and assessment_count.created_at <= v_job.created_at
        and assessment_count.completed_at <= v_job.created_at
    ),
    'latest_result_at', case when latest_assessment.completed_at is null then null else
      pg_catalog.to_char(latest_assessment.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'latest_result_snapshot', latest_assessment.result_snapshot,
    'assigned_faculty', latest_counseling.assigned_faculty,
    'counseling_status', latest_counseling.status
  )
  from public.prospects prospect
  left join lateral (
    select assessment.completed_at, assessment.result_snapshot
    from public.assessments assessment
    where assessment.prospect_id = prospect.id
      and assessment.status = 'completed'
      and assessment.created_at <= v_job.created_at
      and assessment.completed_at <= v_job.created_at
    order by assessment.completed_at desc, assessment.id desc
    limit 1
  ) latest_assessment on true
  left join lateral (
    select request.status, faculty.name as assigned_faculty
    from public.counseling_requests request
    left join public.faculty faculty on faculty.id = request.assigned_faculty_id
    where request.prospect_id = prospect.id and request.created_at <= v_job.created_at
    order by request.created_at desc, request.id desc
    limit 1
  ) latest_counseling on true
  where public.is_admin_export_student_match(prospect.id, v_job.filter_snapshot, v_job.created_at)
    and (p_cursor_created_at is null or
      (prospect.created_at, prospect.id) < (p_cursor_created_at, p_cursor_id))
  order by prospect.created_at desc, prospect.id desc
  limit p_limit;
end;
$$;

create function public.admin_export_assessment_rows(
  p_job_id bigint,
  p_admin_id uuid,
  p_cursor_created_at timestamptz,
  p_cursor_id bigint,
  p_limit integer
)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  perform public.validate_admin_export_page(p_limit, p_cursor_created_at, p_cursor_id);
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['fetching']);
  return query
  select pg_catalog.jsonb_build_object(
    'id', assessment.id,
    'created_at', pg_catalog.to_char(assessment.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'completed_at', pg_catalog.to_char(assessment.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'result_snapshot', assessment.result_snapshot,
    'sequence', (
      select pg_catalog.count(*)::integer
      from public.assessments history
      where history.prospect_id = assessment.prospect_id
        and history.status = 'completed'
        and history.created_at <= v_job.created_at
        and history.completed_at <= v_job.created_at
        and (history.created_at, history.id) <= (assessment.created_at, assessment.id)
    ),
    'prospect', pg_catalog.jsonb_build_object(
      'id', prospect.id,
      'nickname', prospect.nickname
    )
  )
  from public.assessments assessment
  join public.prospects prospect on prospect.id = assessment.prospect_id
  where assessment.created_at <= v_job.created_at
    and assessment.completed_at <= v_job.created_at
    and public.is_admin_export_assessment_match(assessment.id, v_job.filter_snapshot, v_job.created_at)
    and (p_cursor_created_at is null or
      (assessment.created_at, assessment.id) < (p_cursor_created_at, p_cursor_id))
  order by assessment.created_at desc, assessment.id desc
  limit p_limit;
end;
$$;

create function public.admin_export_counseling_rows(
  p_job_id bigint,
  p_admin_id uuid,
  p_cursor_created_at timestamptz,
  p_cursor_id bigint,
  p_limit integer
)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  perform public.validate_admin_export_page(p_limit, p_cursor_created_at, p_cursor_id);
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['fetching']);
  return query
  select pg_catalog.jsonb_build_object(
    'id', request.id,
    'created_at', pg_catalog.to_char(request.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'contact_method', request.contact_method,
    'availability', request.availability,
    'inquiry', request.inquiry,
    'status', request.status,
    'contacted_at', case when request.contacted_at is null then null else
      pg_catalog.to_char(request.contacted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'completed_at', case when request.completed_at is null then null else
      pg_catalog.to_char(request.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'admin_note', request.admin_note,
    'prospect', pg_catalog.jsonb_build_object('nickname', prospect.nickname),
    'assigned_faculty', case when assigned_faculty.id is null then null else
      pg_catalog.jsonb_build_object('name', assigned_faculty.name) end,
    'recommendations', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'role', recommendation.role,
          'rank', recommendation.rank,
          'faculty_name_snapshot', recommendation.faculty_name_snapshot
        ) order by
          case recommendation.role when 'primary' then 1 when 'backup' then 2 else 3 end,
          recommendation.rank
      ), '[]'::jsonb)
      from public.counseling_faculty_recommendations recommendation
      where recommendation.counseling_request_id = request.id
    )
  )
  from public.counseling_requests request
  join public.prospects prospect on prospect.id = request.prospect_id
  left join public.faculty assigned_faculty on assigned_faculty.id = request.assigned_faculty_id
  where request.created_at <= v_job.created_at
    and public.is_admin_export_counseling_match(request.id, v_job.filter_snapshot, v_job.created_at)
    and (p_cursor_created_at is null or
      (request.created_at, request.id) < (p_cursor_created_at, p_cursor_id))
  order by request.created_at desc, request.id desc
  limit p_limit;
end;
$$;

create function public.record_admin_export_created(
  p_job_id bigint,
  p_admin_id uuid,
  p_audit_request_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.export_jobs%rowtype;
begin
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['created']);
  if p_audit_request_id is null then
    raise exception using errcode = '22023', message = 'EXPORT_AUDIT_REQUEST_REQUIRED';
  end if;
  if exists (
    select 1 from public.audit_events audit
    where audit.action = 'admin_export_created'
      and audit.target_type = 'export_job'
      and audit.target_id = v_job.id::text
  ) then
    raise exception using errcode = 'P0001', message = 'EXPORT_AUDIT_ALREADY_RECORDED';
  end if;

  insert into public.audit_events(admin_user_id, action, target_type, target_id, metadata, request_id)
  values (
    p_admin_id,
    'admin_export_created',
    'export_job',
    v_job.id::text,
    pg_catalog.jsonb_build_object(
      'filter_snapshot', v_job.filter_snapshot,
      'created_at', v_job.created_at
    ),
    p_audit_request_id
  );
  insert into public.events(anonymous_id, event_name, path, properties)
  values (
    extensions.gen_random_uuid(),
    'admin_export_created',
    '/api/admin/export',
    pg_catalog.jsonb_build_object('job_id', v_job.id)
  );
  return true;
end;
$$;

create unique index audit_events_admin_export_job_once_idx
  on public.audit_events(target_id)
  where action = 'admin_export_created' and target_type = 'export_job';

revoke all privileges on function public.is_admin_export_prospect_base_match(bigint,jsonb,timestamptz) from public, anon, authenticated, service_role;
revoke all privileges on function public.is_admin_export_assessment_match(bigint,jsonb,timestamptz) from public, anon, authenticated, service_role;
revoke all privileges on function public.is_admin_export_counseling_match(bigint,jsonb,timestamptz) from public, anon, authenticated, service_role;
revoke all privileges on function public.is_admin_export_student_match(bigint,jsonb,timestamptz) from public, anon, authenticated, service_role;
revoke all privileges on function public.require_owned_admin_export_job(bigint,uuid,text[]) from public, anon, authenticated, service_role;
revoke all privileges on function public.validate_admin_export_page(integer,timestamptz,bigint) from public, anon, authenticated, service_role;
revoke all privileges on function public.admin_export_counts(bigint,uuid) from public, anon, authenticated;
revoke all privileges on function public.admin_export_student_rows(bigint,uuid,timestamptz,bigint,integer) from public, anon, authenticated;
revoke all privileges on function public.admin_export_assessment_rows(bigint,uuid,timestamptz,bigint,integer) from public, anon, authenticated;
revoke all privileges on function public.admin_export_counseling_rows(bigint,uuid,timestamptz,bigint,integer) from public, anon, authenticated;
revoke all privileges on function public.record_admin_export_created(bigint,uuid,uuid) from public, anon, authenticated;
grant execute on function public.admin_export_counts(bigint,uuid) to service_role;
grant execute on function public.admin_export_student_rows(bigint,uuid,timestamptz,bigint,integer) to service_role;
grant execute on function public.admin_export_assessment_rows(bigint,uuid,timestamptz,bigint,integer) to service_role;
grant execute on function public.admin_export_counseling_rows(bigint,uuid,timestamptz,bigint,integer) to service_role;
grant execute on function public.record_admin_export_created(bigint,uuid,uuid) to service_role;
