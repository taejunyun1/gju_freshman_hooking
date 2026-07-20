-- Keep the public API generic while giving the Worker a safe, non-PII database
-- error category when a protected roster write is rejected.

do $$
declare
  v_definition text;
  v_before text := E'exception when others then\n  return pg_catalog.jsonb_build_object(''kind'',''validation_error'');\nend $function$';
  v_after text := E'exception when others then\n  return pg_catalog.jsonb_build_object(''kind'',''validation_error'',''diagnosticCode'',SQLSTATE);\nend $function$';
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_applicant_roster_v1(uuid,integer,uuid,bytea,uuid,jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'roster apply diagnostic migration requires the expected exception handler';
  end if;

  execute pg_catalog.replace(v_definition, v_before, v_after);
end $$;
