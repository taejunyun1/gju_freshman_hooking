import fs from 'node:fs/promises'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error('Usage: generate-project-catalog-migration.mjs <catalog.json> <migration.sql>')
}

const catalog = JSON.parse(await fs.readFile(inputPath, 'utf8'))
if (!Array.isArray(catalog) || catalog.length !== 43) {
  throw new Error('The project catalog must contain the 43 non-cancelled records.')
}
if (catalog.some(row => row.cancelled || String(row.title).includes('사진단오제'))) {
  throw new Error('Cancelled project rows must not enter the service migration.')
}

const catalogJson = JSON.stringify(catalog).replaceAll('$project_catalog$', '$project_catalog _$')
const migration = `-- Generated from supabase/seed/project-catalog-2026.json.
-- The 2026 operating catalogue is intentionally small: one resource row plus tags per project.

do $project_catalog_migration$
declare
  v_item jsonb;
  v_resource_id bigint;
  v_metadata jsonb;
begin
  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements($project_catalog$${catalogJson}$project_catalog$::jsonb) item(value)
  loop
    if coalesce((v_item ->> 'cancelled')::boolean, false) then
      continue;
    end if;

    v_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'seedKey', 'project_catalog:' || (v_item ->> 'key'),
      'catalogKey', v_item ->> 'key',
      'projectYear', (v_item ->> 'year')::integer,
      'displayTier', v_item ->> 'displayTier',
      'displayKind', v_item ->> 'displayKind',
      'periodLabel', v_item ->> 'periodLabel',
      'statusLabel', v_item ->> 'statusLabel',
      'programGroup', v_item ->> 'programGroup',
      'semester', v_item ->> 'semester',
      'category', v_item ->> 'category',
      'activities', v_item ->> 'activities',
      'outcomes', v_item ->> 'outcomes',
      'locations', v_item ->> 'locations',
      'faculty', v_item -> 'faculty',
      'sourcePageTitle', v_item ->> 'sourcePageTitle',
      'sourceUrl', v_item ->> 'sourceUrl',
      'sourceCheckedAt', v_item ->> 'sourceCheckedAt',
      'verificationNote', v_item ->> 'verificationNote'
    ));

    update public.resources
    set type = 'project',
        title = v_item ->> 'title',
        summary = v_item ->> 'summary',
        connection_template = coalesce(
          v_item ->> 'connectionText',
          '선택한 관심사를 학과 프로젝트 경험으로 연결합니다.'
        ),
        status = 'active',
        visibility = 'public',
        priority = (v_item ->> 'priority')::smallint,
        source_date = coalesce((v_item ->> 'sourceCheckedAt')::date, current_date),
        metadata = v_metadata,
        image_path = null,
        updated_at = pg_catalog.clock_timestamp()
    where metadata ->> 'seedKey' = 'project_catalog:' || (v_item ->> 'key')
    returning id into v_resource_id;

    if not found then
      insert into public.resources(
        type, title, summary, connection_template, status, visibility, priority,
        source_date, metadata, image_path
      ) values (
        'project',
        v_item ->> 'title',
        v_item ->> 'summary',
        coalesce(v_item ->> 'connectionText', '선택한 관심사를 학과 프로젝트 경험으로 연결합니다.'),
        'active',
        'public',
        (v_item ->> 'priority')::smallint,
        coalesce((v_item ->> 'sourceCheckedAt')::date, current_date),
        v_metadata,
        null
      ) returning id into v_resource_id;
    end if;

    delete from public.resource_tags where resource_id = v_resource_id;
    insert into public.resource_tags(resource_id, tag_key, weight, is_primary)
    select
      v_resource_id,
      tag_key,
      max(weight)::smallint,
      bool_or(is_primary)
    from (
      select v_item ->> 'primaryTrack' as tag_key, 3 as weight, true as is_primary
      union all
      select secondary.value, 2, false
      from pg_catalog.jsonb_array_elements_text(
        coalesce(v_item -> 'secondaryTracks', '[]'::jsonb)
      ) secondary(value)
      union all
      select interest.value, 2, false
      from pg_catalog.jsonb_array_elements_text(
        coalesce(v_item -> 'tags', '[]'::jsonb)
      ) interest(value)
    ) tags
    group by tag_key;
  end loop;
end;
$project_catalog_migration$;
`

await fs.writeFile(outputPath, migration, 'utf8')
console.log(JSON.stringify({ outputPath, records: catalog.length }, null, 2))
