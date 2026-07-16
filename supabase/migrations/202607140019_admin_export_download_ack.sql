create function public.record_admin_export_downloaded(
  p_job_id bigint,
  p_admin_id uuid
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
  v_job := public.require_owned_admin_export_job(p_job_id, p_admin_id, array['completed']);
  if v_job.downloaded_at is null then
    update public.export_jobs export_job
    set downloaded_at = pg_catalog.clock_timestamp()
    where export_job.id = v_job.id
      and export_job.created_by_admin_id = p_admin_id
      and export_job.status = 'completed'
      and export_job.downloaded_at is null;
  end if;
  return true;
end;
$$;

revoke all privileges on function public.record_admin_export_downloaded(bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.record_admin_export_downloaded(bigint,uuid)
  to service_role;
