import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZodError } from 'zod'
import { assessmentCatalogOptionSchema } from '../shared/schemas/assessment'
import {
  questionGroups,
  trackKeys,
  type AssessmentOption,
  type QuestionGroup,
} from '../shared/types/domain'

const EXPECTED_CATALOG_REVISION = 'sha256:c147c6dc013f7c7886ee4dbd5cd0a1a51c2e1a23295f8368bb636672c4b87819'
const EXPECTED_OPTION_KEYS = [
  'work.photo_everyday',
  'work.video_scene',
  'work.video_post',
  'work.commercial_image',
  'work.interview_life',
  'work.brand_region',
  'work.exhibition_install',
  'work.music_shortform',
  'work.photobook',
  'work.project_plan',
  'result.photo_portfolio',
  'result.exhibit_photobook',
  'result.commercial_fashion',
  'result.documentary',
  'result.brand_video',
  'result.shortform_mv',
  'result.video_showreel',
  'result.project_proposal',
  'style.solo',
  'style.team',
  'style.field',
  'style.studio',
  'style.interview',
  'style.post',
  'career.photo',
  'career.video',
  'career.planning',
  'career.explore',
] as const

const expectedGroupCounts = {
  work: 10,
  result: 8,
  style: 6,
  career: 4,
} as const satisfies Record<QuestionGroup, number>

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]),
    )
  }

  return value
}

const describeCatalogError = (error: ZodError) => {
  const issues = error.issues
  if (issues.some(issue => issue.code === 'unrecognized_keys')) {
    return 'assessment catalog contains an unknown field'
  }
  if (issues.some(issue => issue.path.includes('trackWeights'))) {
    return 'assessment catalog has an invalid track weights manifest'
  }
  if (issues.some(issue => issue.path.includes('interestTags'))) {
    return 'assessment catalog has invalid interest tags'
  }
  if (issues.some(issue => issue.path.includes('visualKey'))) {
    return 'assessment catalog has an invalid visual key'
  }
  return 'assessment catalog is invalid'
}

export const createCatalogRevision = (catalog: AssessmentOption[]) => `sha256:${createHash('sha256')
  .update(JSON.stringify(canonicalize(catalog)))
  .digest('hex')}`

export const catalogGroupCounts = (catalog: AssessmentOption[]) => Object.fromEntries(
  questionGroups.map(group => [
    group,
    catalog.filter(option => option.group === group).length,
  ]),
) as Record<QuestionGroup, number>

export const parseAssessmentCatalog = (input: unknown): AssessmentOption[] => {
  let catalog: AssessmentOption[]
  try {
    catalog = assessmentCatalogOptionSchema.array().parse(input) as AssessmentOption[]
  }
  catch (error) {
    if (error instanceof ZodError) {
      throw new Error(describeCatalogError(error), { cause: error })
    }
    throw error
  }

  const optionKeys = catalog.map(option => option.optionKey)
  if (new Set(optionKeys).size !== optionKeys.length) {
    throw new Error('assessment catalog contains a duplicate option key')
  }

  const groupSortPositions = catalog.map(option => `${option.group}:${option.sortOrder}`)
  if (new Set(groupSortPositions).size !== groupSortPositions.length) {
    throw new Error('assessment catalog contains a duplicate group sort position')
  }

  for (const option of catalog) {
    if (!option.optionKey.startsWith(`${option.group}.`)) {
      throw new Error('assessment catalog option key does not match its group prefix')
    }
    if (trackKeys.reduce((total, track) => total + option.trackWeights[track], 0) <= 0) {
      throw new Error('assessment catalog has an invalid track weights manifest')
    }
  }

  const counts = catalogGroupCounts(catalog)
  if (questionGroups.some(group => counts[group] !== expectedGroupCounts[group])) {
    throw new Error('assessment catalog manifest has invalid group counts')
  }

  const orderedKeys = catalog.map(option => option.optionKey)
  const hasWrongKeyOrder = orderedKeys.some((key, index) => key !== EXPECTED_OPTION_KEYS[index])
  const hasWrongSortOrder = questionGroups.some(group => catalog
    .filter(option => option.group === group)
    .some((option, index) => option.sortOrder !== index + 1))
  if (hasWrongKeyOrder || hasWrongSortOrder) {
    throw new Error('assessment catalog manifest has invalid option order')
  }

  if (createCatalogRevision(catalog) !== EXPECTED_CATALOG_REVISION) {
    throw new Error('assessment catalog manifest differs from the approved catalog')
  }

  return catalog
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`
const sqlJson = (value: unknown) => `${sqlString(JSON.stringify(value))}::jsonb`

const createDatabaseManifest = (catalog: AssessmentOption[]) => catalog.map(option => ({
  question_group: option.group,
  option_key: option.optionKey,
  label: option.label,
  description: option.description ?? null,
  visual_key: option.visualKey,
  track_weights: option.trackWeights,
  interest_tags: option.interestTags,
  status: option.status,
  sort_order: option.sortOrder,
}))

export const generateAssessmentSeedSql = (catalog: AssessmentOption[]) => {
  const revision = createCatalogRevision(catalog)
  const manifest = sqlJson(createDatabaseManifest(catalog))

  return `-- Generated by scripts/seed-assessment-options.ts. Do not edit.
-- Catalog revision: ${revision}
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('photo_next.assessment_options.v1', 0)
);

lock table public.assessment_options in share row exclusive mode;

do $seed$
declare
  v_manifest constant jsonb := ${manifest};
begin
  if not exists (select 1 from public.assessment_options) then
    insert into public.assessment_options (
      question_group,
      option_key,
      label,
      description,
      visual_key,
      track_weights,
      interest_tags,
      status,
      sort_order
    )
    select
      question_group,
      option_key,
      label,
      description,
      visual_key,
      track_weights,
      interest_tags,
      status,
      sort_order
    from pg_catalog.jsonb_to_recordset(v_manifest) as expected (
      question_group text,
      option_key text,
      label text,
      description text,
      visual_key text,
      track_weights jsonb,
      interest_tags jsonb,
      status text,
      sort_order smallint
    )
    order by pg_catalog.array_position(array['work', 'result', 'style', 'career'], question_group), sort_order;
  elsif exists (
    select 1
    from pg_catalog.jsonb_to_recordset(v_manifest) as expected (
      question_group text,
      option_key text,
      label text,
      description text,
      visual_key text,
      track_weights jsonb,
      interest_tags jsonb,
      status text,
      sort_order smallint
    )
    full outer join (
      select
        question_group,
        option_key,
        label,
        description,
        visual_key,
        track_weights,
        interest_tags,
        status,
        sort_order
      from public.assessment_options
      where status = 'active'
    ) as active using (option_key)
    where expected.option_key is null
      or active.option_key is null
      or expected.question_group is distinct from active.question_group
      or expected.label is distinct from active.label
      or expected.description is distinct from active.description
      or expected.visual_key is distinct from active.visual_key
      or expected.track_weights is distinct from active.track_weights
      or expected.interest_tags is distinct from active.interest_tags
      or expected.status is distinct from active.status
      or expected.sort_order is distinct from active.sort_order
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'assessment catalog manifest drift';
  end if;
end
$seed$;

commit;
`
}

const rootSeedSql = '\\ir seed/assessment-options.sql\n\\ir seed/content-2026.sql\n'

export const writeOrCheckAssessmentSeed = (mode: '--write' | '--check', cwd = process.cwd()) => {
  const jsonPath = resolve(cwd, 'supabase/seed/assessment-options.json')
  const generatedPath = resolve(cwd, 'supabase/seed/assessment-options.sql')
  const rootSeedPath = resolve(cwd, 'supabase/seed.sql')
  const catalog = parseAssessmentCatalog(JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown)
  const generatedSql = generateAssessmentSeedSql(catalog)

  if (mode === '--write') {
    mkdirSync(resolve(cwd, 'supabase/seed'), { recursive: true })
    writeFileSync(generatedPath, generatedSql)
    writeFileSync(rootSeedPath, rootSeedSql)
    return createCatalogRevision(catalog)
  }

  if (!existsSync(generatedPath) || readFileSync(generatedPath, 'utf8') !== generatedSql) {
    throw new Error('generated assessment seed is stale; run with --write')
  }
  if (!existsSync(rootSeedPath) || readFileSync(rootSeedPath, 'utf8') !== rootSeedSql) {
    throw new Error('root Supabase seed include is stale; run with --write')
  }

  return createCatalogRevision(catalog)
}

const isDirectExecution = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  const mode = process.argv[2]
  if (mode !== '--write' && mode !== '--check') {
    console.error('Usage: pnpm exec tsx scripts/seed-assessment-options.ts --write|--check')
    process.exitCode = 1
  }
  else {
    try {
      const revision = writeOrCheckAssessmentSeed(mode)
      console.info(`assessment catalog ${mode === '--write' ? 'written' : 'verified'} (${revision})`)
    }
    catch (error) {
      console.error(error instanceof Error ? error.message : 'assessment catalog validation failed')
      process.exitCode = 1
    }
  }
}
