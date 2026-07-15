create index prospects_active_last_active_idx
  on public.prospects(last_active_at desc, id desc)
  where status = 'active';

create index assessments_admin_prospect_primary_track_completed_idx
  on public.assessments(
    prospect_id,
    ((result_snapshot #>> '{rankedTracks,0}')),
    completed_at desc,
    id desc
  )
  where status = 'completed';

create index counseling_requests_admin_prospect_status_created_idx
  on public.counseling_requests(prospect_id, status, created_at desc, id desc);

create function public.record_student_sensitive_access(
  p_student_id bigint,
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
  v_student public.prospects%rowtype;
begin
  if p_action is distinct from 'admin_phone_revealed' then
    raise exception using errcode = '22023', message = 'invalid student sensitive access action';
  end if;

  if p_admin_user_id is null or p_audit_request_id is null or not exists (
    select 1
    from public.admin_users admin_user
    where admin_user.id = p_admin_user_id
      and admin_user.is_active
  ) then
    raise exception using errcode = '22023', message = 'active student administrator is required';
  end if;

  select student.*
  into v_student
  from public.prospects student
  where student.id = p_student_id
    and student.status = 'active';

  if not found then
    raise exception using errcode = 'P0002', message = 'active student not found';
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
    p_action,
    'prospect',
    v_student.id::text,
    '{}'::jsonb,
    p_audit_request_id
  );

  insert into public.events (
    prospect_id,
    anonymous_id,
    event_name,
    path,
    properties
  ) values (
    v_student.id,
    extensions.gen_random_uuid(),
    'admin_phone_revealed',
    '/api/admin/students/' || v_student.id::text || '/reveal-phone',
    pg_catalog.jsonb_build_object(
      'student_id', v_student.id,
      'request_id', p_audit_request_id
    )
  );

  return true;
end;
$$;

revoke all privileges on function public.record_student_sensitive_access(
  bigint,
  text,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.record_student_sensitive_access(
  bigint,
  text,
  uuid,
  uuid
) to service_role;
