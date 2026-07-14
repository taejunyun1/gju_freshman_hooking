create or replace function public.is_sanitized_json_value(p_value jsonb)
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
    when 'string' then null;
    when 'number' then null;
    when 'boolean' then null;
    when 'null' then null;
    else return false;
  end case;

  return true;
end;
$$;

revoke all privileges on table public.events from service_role;
grant select, insert, update, delete on table public.events to service_role;

revoke all privileges on sequence public.events_id_seq from service_role;
grant usage, select on sequence public.events_id_seq to service_role;
