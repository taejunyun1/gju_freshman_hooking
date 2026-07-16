create table public.assessment_narrative_generations (
  id bigint generated always as identity primary key,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  assessment_id bigint unique references public.assessments(id) on delete cascade,
  idempotency_key uuid not null,
  input_hash text not null check (input_hash ~ '^sha256:[a-f0-9]{64}$'),
  state text not null check (state in ('claimed', 'terminal')),
  source text check (source in ('openai', 'deterministic')),
  claim_token uuid not null default extensions.gen_random_uuid(),
  fallback_narrative jsonb not null check (
    public.is_valid_bounded_json_object(fallback_narrative, 4096)
  ),
  narrative jsonb check (
    narrative is null or public.is_valid_bounded_json_object(narrative, 4096)
  ),
  model_budget_reserved boolean not null default false,
  external_attempted_at timestamptz,
  expires_at timestamptz not null,
  failure_code text check (failure_code in (
    'missing_config',
    'minor_policy',
    'input_ineligible',
    'budget_exhausted',
    'timeout',
    'provider_error',
    'incomplete',
    'refusal',
    'invalid_output',
    'stale_claim'
  )),
  ineligibility_reason text check (
    ineligibility_reason is null
    or ineligibility_reason in ('unsafe_fact', 'insufficient_facts')
  ),
  model text check (model is null or pg_catalog.char_length(model) between 1 and 80),
  provider_response_id text check (
    provider_response_id is null
    or provider_response_id ~ '^resp_[A-Za-z0-9_-]{1,120}$'
  ),
  input_tokens integer check (input_tokens is null or input_tokens between 0 and 100000),
  output_tokens integer check (output_tokens is null or output_tokens between 0 and 512),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  unique (prospect_id, idempotency_key),
  check (
    (failure_code = 'input_ineligible' and ineligibility_reason is not null)
    or
    (failure_code is distinct from 'input_ineligible' and ineligibility_reason is null)
  ),
  check (
    (
      state = 'claimed'
      and narrative is null
      and source is null
      and finished_at is null
      and failure_code is null
      and ineligibility_reason is null
    )
    or
    (
      state = 'terminal'
      and narrative is not null
      and source is not null
      and finished_at is not null
    )
  ),
  check (expires_at = created_at + interval '12 seconds')
);

create index assessment_narrative_generations_budget_idx
  on public.assessment_narrative_generations(created_at)
  where model_budget_reserved;

create index assessment_narrative_generations_prospect_budget_idx
  on public.assessment_narrative_generations(prospect_id, created_at)
  where model_budget_reserved;

alter table public.assessments
  add constraint assessments_id_prospect_unique unique (id, prospect_id);

create table public.career_narrative_reports (
  id bigint generated always as identity primary key,
  assessment_id bigint not null,
  prospect_id bigint not null references public.prospects(id) on delete cascade,
  category text not null check (category in ('inaccurate', 'unsafe', 'confusing')),
  status text not null default 'open' check (
    status in ('open', 'resolved_inaccurate', 'resolved_unsafe', 'resolved_copy', 'dismissed')
  ),
  resolved_by_admin_id uuid references public.admin_users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  resolved_at timestamptz,
  unique (assessment_id, prospect_id),
  constraint career_narrative_reports_assessment_owner_fk
    foreign key (assessment_id, prospect_id)
    references public.assessments(id, prospect_id)
    on delete cascade,
  check (
    (status = 'open' and resolved_by_admin_id is null and resolved_at is null)
    or
    (status <> 'open' and resolved_by_admin_id is not null and resolved_at is not null)
  )
);

create index career_narrative_reports_open_queue_idx
  on public.career_narrative_reports(
    (case when category = 'unsafe' then 0 else 1 end),
    created_at,
    id
  )
  where status = 'open';

alter table public.assessment_narrative_generations enable row level security;
alter table public.career_narrative_reports enable row level security;

create function public.claim_assessment_narrative_generation(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_input_hash text,
  p_fallback_narrative jsonb,
  p_model_gate text,
  p_daily_cap integer,
  p_prospect_cap integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_utc_day date;
  v_utc_start timestamptz;
  v_locked_prospect_id bigint;
  v_generation public.assessment_narrative_generations%rowtype;
  v_failure_code text;
  v_ineligibility_reason text;
  v_global_count bigint;
  v_prospect_count bigint;
begin
  if p_idempotency_key is null
    or p_input_hash is null
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_fallback_narrative is null
    or not public.is_valid_bounded_json_object(p_fallback_narrative, 4096)
    or p_model_gate is null
    or p_model_gate not in (
      'enabled',
      'missing_config',
      'minor_policy',
      'input_ineligible:unsafe_fact',
      'input_ineligible:insufficient_facts'
    )
    or p_daily_cap is null
    or p_daily_cap not between 1 and 10000
    or p_prospect_cap is null
    or p_prospect_cap not between 1 and 50
  then
    raise exception using
      errcode = '22023',
      message = 'invalid narrative generation claim';
  end if;

  select prospect.id
  into v_locked_prospect_id
  from public.prospects prospect
  where prospect.id = p_prospect_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'prospect not found';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select generation.*
  into v_generation
  from public.assessment_narrative_generations generation
  where generation.prospect_id = p_prospect_id
    and generation.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_generation.input_hash <> p_input_hash then
      return pg_catalog.jsonb_build_object(
        'kind', 'conflict',
        'id', v_generation.id
      );
    end if;

    if v_generation.state = 'claimed' and v_now >= v_generation.expires_at then
      update public.assessment_narrative_generations generation
      set
        state = 'terminal',
        source = 'deterministic',
        narrative = generation.fallback_narrative,
        failure_code = 'stale_claim',
        finished_at = v_now
      where generation.id = v_generation.id
      returning generation.* into v_generation;
    end if;

    if v_generation.state = 'terminal' then
      return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'kind', 'terminal',
        'id', v_generation.id,
        'expiresAt', v_generation.expires_at,
        'source', v_generation.source,
        'narrative', v_generation.narrative,
        'failureCode', v_generation.failure_code
      ));
    end if;

    return pg_catalog.jsonb_build_object(
      'kind', 'waiting',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at
    );
  end if;

  v_utc_day := (v_now at time zone 'UTC')::date;
  v_utc_start := v_utc_day::timestamp at time zone 'UTC';

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('career-narrative:' || v_utc_day::text, 0)
  );

  if p_model_gate <> 'enabled' then
    if p_model_gate = 'missing_config' then
      v_failure_code := 'missing_config';
    elsif p_model_gate = 'minor_policy' then
      v_failure_code := 'minor_policy';
    else
      v_failure_code := 'input_ineligible';
      v_ineligibility_reason := pg_catalog.substr(
        p_model_gate,
        pg_catalog.char_length('input_ineligible:') + 1
      );
    end if;

    insert into public.assessment_narrative_generations (
      prospect_id,
      idempotency_key,
      input_hash,
      state,
      source,
      fallback_narrative,
      narrative,
      model_budget_reserved,
      expires_at,
      failure_code,
      ineligibility_reason,
      created_at,
      finished_at
    ) values (
      p_prospect_id,
      p_idempotency_key,
      p_input_hash,
      'terminal',
      'deterministic',
      p_fallback_narrative,
      p_fallback_narrative,
      false,
      v_now + interval '12 seconds',
      v_failure_code,
      v_ineligibility_reason,
      v_now,
      v_now
    )
    returning * into v_generation;

    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'kind', 'terminal',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at,
      'source', v_generation.source,
      'narrative', v_generation.narrative,
      'failureCode', v_generation.failure_code
    ));
  end if;

  select pg_catalog.count(*)
  into v_global_count
  from public.assessment_narrative_generations generation
  where generation.model_budget_reserved
    and generation.created_at >= v_utc_start
    and generation.created_at < v_utc_start + interval '1 day';

  select pg_catalog.count(*)
  into v_prospect_count
  from public.assessment_narrative_generations generation
  where generation.prospect_id = p_prospect_id
    and generation.model_budget_reserved
    and generation.created_at >= v_now - interval '24 hours'
    and generation.created_at <= v_now;

  if v_global_count >= p_daily_cap or v_prospect_count >= p_prospect_cap then
    insert into public.assessment_narrative_generations (
      prospect_id,
      idempotency_key,
      input_hash,
      state,
      source,
      fallback_narrative,
      narrative,
      model_budget_reserved,
      expires_at,
      failure_code,
      created_at,
      finished_at
    ) values (
      p_prospect_id,
      p_idempotency_key,
      p_input_hash,
      'terminal',
      'deterministic',
      p_fallback_narrative,
      p_fallback_narrative,
      false,
      v_now + interval '12 seconds',
      'budget_exhausted',
      v_now,
      v_now
    )
    returning * into v_generation;

    return pg_catalog.jsonb_build_object(
      'kind', 'terminal',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at,
      'source', v_generation.source,
      'narrative', v_generation.narrative,
      'failureCode', v_generation.failure_code
    );
  end if;

  insert into public.assessment_narrative_generations (
    prospect_id,
    idempotency_key,
    input_hash,
    state,
    fallback_narrative,
    model_budget_reserved,
    expires_at,
    created_at
  ) values (
    p_prospect_id,
    p_idempotency_key,
    p_input_hash,
    'claimed',
    p_fallback_narrative,
    true,
    v_now + interval '12 seconds',
    v_now
  )
  returning * into v_generation;

  return pg_catalog.jsonb_build_object(
    'kind', 'owner',
    'id', v_generation.id,
    'claimToken', v_generation.claim_token,
    'expiresAt', v_generation.expires_at
  );
end;
$function$;

create function public.mark_assessment_narrative_attempted(
  p_generation_id bigint,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated bigint;
begin
  if p_generation_id is null or p_claim_token is null then
    return false;
  end if;

  update public.assessment_narrative_generations generation
  set external_attempted_at = pg_catalog.clock_timestamp()
  where generation.id = p_generation_id
    and generation.claim_token = p_claim_token
    and generation.state = 'claimed'
    and generation.external_attempted_at is null
    and pg_catalog.clock_timestamp() < generation.expires_at;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

create function public.finish_assessment_narrative_generation(
  p_generation_id bigint,
  p_claim_token uuid,
  p_narrative jsonb,
  p_source text,
  p_failure_code text,
  p_model text,
  p_provider_response_id text,
  p_input_tokens integer,
  p_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_generation public.assessment_narrative_generations%rowtype;
begin
  if p_generation_id is null or p_claim_token is null then
    return pg_catalog.jsonb_build_object('kind', 'conflict');
  end if;

  select generation.*
  into v_generation
  from public.assessment_narrative_generations generation
  where generation.id = p_generation_id
  for update;

  if not found or v_generation.claim_token <> p_claim_token then
    return pg_catalog.jsonb_build_object('kind', 'conflict');
  end if;

  if v_generation.state = 'terminal' then
    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'kind', 'terminal',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at,
      'source', v_generation.source,
      'narrative', v_generation.narrative,
      'failureCode', v_generation.failure_code
    ));
  end if;

  if v_now >= v_generation.expires_at then
    update public.assessment_narrative_generations generation
    set
      state = 'terminal',
      source = 'deterministic',
      narrative = generation.fallback_narrative,
      failure_code = 'stale_claim',
      finished_at = v_now
    where generation.id = v_generation.id
    returning generation.* into v_generation;

    return pg_catalog.jsonb_build_object(
      'kind', 'terminal',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at,
      'source', v_generation.source,
      'narrative', v_generation.narrative,
      'failureCode', v_generation.failure_code
    );
  end if;

  if v_generation.external_attempted_at is null
    or p_narrative is null
    or not public.is_valid_bounded_json_object(p_narrative, 4096)
    or p_source is null
    or p_source not in ('openai', 'deterministic')
    or (
      p_source = 'openai'
      and (
        p_failure_code is not null
        or p_model is null
        or pg_catalog.char_length(p_model) not between 1 and 80
      )
    )
    or (
      p_source = 'deterministic'
      and (
        p_failure_code is null
        or p_failure_code not in (
          'timeout',
          'provider_error',
          'incomplete',
          'refusal',
          'invalid_output'
        )
        or p_narrative <> v_generation.fallback_narrative
      )
    )
    or (
      p_provider_response_id is not null
      and p_provider_response_id !~ '^resp_[A-Za-z0-9_-]{1,120}$'
    )
    or (p_input_tokens is not null and p_input_tokens not between 0 and 100000)
    or (p_output_tokens is not null and p_output_tokens not between 0 and 512)
  then
    raise exception using
      errcode = '22023',
      message = 'invalid narrative generation result';
  end if;

  update public.assessment_narrative_generations generation
  set
    state = 'terminal',
    source = p_source,
    narrative = p_narrative,
    failure_code = p_failure_code,
    model = p_model,
    provider_response_id = p_provider_response_id,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    finished_at = v_now
  where generation.id = v_generation.id
    and generation.state = 'claimed'
  returning generation.* into v_generation;

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'kind', 'terminal',
    'id', v_generation.id,
    'expiresAt', v_generation.expires_at,
    'source', v_generation.source,
    'narrative', v_generation.narrative,
    'failureCode', v_generation.failure_code
  ));
end;
$function$;

create function public.read_assessment_narrative_generation(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_input_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_generation public.assessment_narrative_generations%rowtype;
begin
  if p_prospect_id is null
    or p_idempotency_key is null
    or p_input_hash is null
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid narrative generation read';
  end if;

  select generation.*
  into v_generation
  from public.assessment_narrative_generations generation
  where generation.prospect_id = p_prospect_id
    and generation.idempotency_key = p_idempotency_key
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'missing');
  end if;

  if v_generation.input_hash <> p_input_hash then
    return pg_catalog.jsonb_build_object(
      'kind', 'conflict',
      'id', v_generation.id
    );
  end if;

  if v_generation.state = 'claimed' and v_now >= v_generation.expires_at then
    update public.assessment_narrative_generations generation
    set
      state = 'terminal',
      source = 'deterministic',
      narrative = generation.fallback_narrative,
      failure_code = 'stale_claim',
      finished_at = v_now
    where generation.id = v_generation.id
    returning generation.* into v_generation;
  end if;

  if v_generation.state = 'terminal' then
    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'kind', 'terminal',
      'id', v_generation.id,
      'expiresAt', v_generation.expires_at,
      'source', v_generation.source,
      'narrative', v_generation.narrative,
      'failureCode', v_generation.failure_code
    ));
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', 'waiting',
    'id', v_generation.id,
    'expiresAt', v_generation.expires_at
  );
end;
$function$;

create function public.complete_assessment_internal_v2(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_campaign_id bigint,
  p_track_scores jsonb,
  p_environment_score numeric,
  p_result_snapshot jsonb,
  p_responses jsonb,
  p_narrative_generation_id bigint,
  p_allow_legacy_without_narrative boolean
)
returns table(
  assessment_id bigint,
  public_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked_prospect_id bigint;
  v_generation public.assessment_narrative_generations%rowtype;
  v_assessment_id bigint;
  v_public_id uuid;
  v_existing_snapshot jsonb;
  v_completed_at timestamptz;
  v_response jsonb;
  v_linked bigint;
begin
  if p_allow_legacy_without_narrative is null then
    raise exception using
      errcode = '22023',
      message = 'completion mode is required';
  end if;

  select prospect.id
  into v_locked_prospect_id
  from public.prospects prospect
  where prospect.id = p_prospect_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'prospect not found';
  end if;

  if not p_allow_legacy_without_narrative then
    if p_narrative_generation_id is null then
      raise exception using
        errcode = '22023',
        message = 'narrative generation required';
    end if;

    select generation.*
    into v_generation
    from public.assessment_narrative_generations generation
    where generation.id = p_narrative_generation_id
    for update;

    if not found
      or v_generation.prospect_id <> p_prospect_id
      or v_generation.idempotency_key <> p_idempotency_key
      or v_generation.state <> 'terminal'
      or not (p_result_snapshot ? 'careerNarrative')
      or v_generation.narrative is distinct from p_result_snapshot -> 'careerNarrative'
    then
      raise exception using
        errcode = '23505',
        message = 'narrative generation conflict';
    end if;
  elsif p_narrative_generation_id is not null then
    raise exception using
      errcode = '22023',
      message = 'legacy completion cannot link a narrative';
  end if;

  select assessment.id, assessment.public_id, assessment.result_snapshot
  into v_assessment_id, v_public_id, v_existing_snapshot
  from public.assessments assessment
  where assessment.prospect_id = p_prospect_id
    and assessment.idempotency_key = p_idempotency_key
  for update;

  if found then
    if not p_allow_legacy_without_narrative then
      if v_existing_snapshot ? 'careerNarrative' then
        if v_existing_snapshot -> 'careerNarrative'
            is distinct from p_result_snapshot -> 'careerNarrative'
          or v_existing_snapshot -> 'careerNarrative'
            is distinct from v_generation.narrative
        then
          raise exception using
            errcode = '23505',
            message = 'narrative snapshot conflict';
        end if;

        if v_generation.assessment_id is null then
          update public.assessment_narrative_generations generation
          set assessment_id = v_assessment_id
          where generation.id = v_generation.id
            and generation.assessment_id is null;
          get diagnostics v_linked = row_count;

          if v_linked <> 1 then
            raise exception using
              errcode = '23505',
              message = 'narrative assessment link conflict';
          end if;
        elsif v_generation.assessment_id <> v_assessment_id then
          raise exception using
            errcode = '23505',
            message = 'narrative assessment link conflict';
        end if;
      end if;
    end if;

    return query select v_assessment_id, v_public_id, false;
    return;
  end if;

  if not p_allow_legacy_without_narrative and v_generation.assessment_id is not null then
    raise exception using
      errcode = '23505',
      message = 'narrative assessment link conflict';
  end if;

  v_completed_at := pg_catalog.clock_timestamp();

  if p_responses is null
    or pg_catalog.jsonb_typeof(p_responses) <> 'array'
    or pg_catalog.jsonb_array_length(p_responses) not between 4 and 11
  then
    raise exception using
      errcode = '22023',
      message = 'responses must be an array containing 4 to 11 entries';
  end if;

  for v_response in
    select response.value
    from pg_catalog.jsonb_array_elements(p_responses) as response(value)
  loop
    if pg_catalog.jsonb_typeof(v_response) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_response)) <> 5
      or not v_response ?& array[
        'question_group',
        'option_key',
        'option_label_snapshot',
        'weight_snapshot',
        'free_text'
      ]
      or pg_catalog.jsonb_typeof(v_response -> 'question_group') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'option_key') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'option_label_snapshot') <> 'string'
      or pg_catalog.jsonb_typeof(v_response -> 'weight_snapshot') <> 'object'
      or pg_catalog.jsonb_typeof(v_response -> 'free_text') not in ('string', 'null')
    then
      raise exception using
        errcode = '22023',
        message = 'response entries must contain the exact snapshot fields';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_responses) as response(value)
    group by
      response.value ->> 'question_group',
      response.value ->> 'option_key'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'response identities must be unique';
  end if;

  insert into public.assessments (
    prospect_id,
    campaign_id,
    idempotency_key,
    track_scores,
    environment_score,
    result_snapshot,
    completed_at,
    created_at
  ) values (
    p_prospect_id,
    p_campaign_id,
    p_idempotency_key,
    p_track_scores,
    p_environment_score,
    p_result_snapshot,
    v_completed_at,
    v_completed_at
  )
  returning id, assessments.public_id
  into v_assessment_id, v_public_id;

  insert into public.assessment_responses (
    assessment_id,
    question_group,
    option_key,
    option_label_snapshot,
    weight_snapshot,
    free_text
  )
  select
    v_assessment_id,
    response.value ->> 'question_group',
    response.value ->> 'option_key',
    response.value ->> 'option_label_snapshot',
    response.value -> 'weight_snapshot',
    case
      when pg_catalog.jsonb_typeof(response.value -> 'free_text') = 'null' then null
      else response.value ->> 'free_text'
    end
  from pg_catalog.jsonb_array_elements(p_responses) as response(value);

  if not p_allow_legacy_without_narrative then
    update public.assessment_narrative_generations generation
    set assessment_id = v_assessment_id
    where generation.id = v_generation.id
      and generation.assessment_id is null;
    get diagnostics v_linked = row_count;

    if v_linked <> 1 then
      raise exception using
        errcode = '23505',
        message = 'narrative assessment link conflict';
    end if;
  end if;

  update public.prospects prospect
  set last_active_at = pg_catalog.clock_timestamp()
  where prospect.id = v_locked_prospect_id;

  delete from public.assessments assessment
  where assessment.prospect_id = p_prospect_id
    and not exists (
      select 1
      from public.career_narrative_reports report
      where report.assessment_id = assessment.id
    )
    and assessment.id in (
      select retained.id
      from public.assessments retained
      where retained.prospect_id = p_prospect_id
      order by retained.completed_at desc, retained.id desc
      offset 3
    );

  return query select v_assessment_id, v_public_id, true;
end;
$function$;

create or replace function public.complete_assessment(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_campaign_id bigint,
  p_track_scores jsonb,
  p_environment_score numeric,
  p_result_snapshot jsonb,
  p_responses jsonb
)
returns table(
  assessment_id bigint,
  public_id uuid,
  created boolean
)
language sql
security definer
set search_path = ''
as $function$
  select completion.assessment_id, completion.public_id, completion.created
  from public.complete_assessment_internal_v2(
    p_prospect_id,
    p_idempotency_key,
    p_campaign_id,
    p_track_scores,
    p_environment_score,
    p_result_snapshot,
    p_responses,
    null,
    true
  ) completion;
$function$;

create function public.complete_assessment_with_narrative(
  p_prospect_id bigint,
  p_idempotency_key uuid,
  p_campaign_id bigint,
  p_track_scores jsonb,
  p_environment_score numeric,
  p_result_snapshot jsonb,
  p_responses jsonb,
  p_narrative_generation_id bigint
)
returns table(
  assessment_id bigint,
  public_id uuid,
  created boolean
)
language sql
security definer
set search_path = ''
as $function$
  select completion.assessment_id, completion.public_id, completion.created
  from public.complete_assessment_internal_v2(
    p_prospect_id,
    p_idempotency_key,
    p_campaign_id,
    p_track_scores,
    p_environment_score,
    p_result_snapshot,
    p_responses,
    p_narrative_generation_id,
    false
  ) completion;
$function$;

revoke all privileges on table
  public.assessment_narrative_generations,
  public.career_narrative_reports
from public, anon, authenticated, service_role;

revoke all privileges on sequence
  public.assessment_narrative_generations_id_seq,
  public.career_narrative_reports_id_seq
from public, anon, authenticated, service_role;

grant select, insert on table public.career_narrative_reports to service_role;
grant usage, select on sequence public.career_narrative_reports_id_seq to service_role;

revoke all privileges on function public.claim_assessment_narrative_generation(
  bigint, uuid, text, jsonb, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all privileges on function public.mark_assessment_narrative_attempted(
  bigint, uuid
) from public, anon, authenticated, service_role;
revoke all privileges on function public.finish_assessment_narrative_generation(
  bigint, uuid, jsonb, text, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all privileges on function public.read_assessment_narrative_generation(
  bigint, uuid, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.complete_assessment_internal_v2(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb, bigint, boolean
) from public, anon, authenticated, service_role;
revoke all privileges on function public.complete_assessment(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all privileges on function public.complete_assessment_with_narrative(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.claim_assessment_narrative_generation(
  bigint, uuid, text, jsonb, text, integer, integer
) to service_role;
grant execute on function public.mark_assessment_narrative_attempted(
  bigint, uuid
) to service_role;
grant execute on function public.finish_assessment_narrative_generation(
  bigint, uuid, jsonb, text, text, text, text, integer, integer
) to service_role;
grant execute on function public.read_assessment_narrative_generation(
  bigint, uuid, text
) to service_role;
grant execute on function public.complete_assessment(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb
) to service_role;
grant execute on function public.complete_assessment_with_narrative(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb, bigint
) to service_role;

comment on function public.complete_assessment(
  bigint, uuid, bigint, jsonb, numeric, jsonb, jsonb
) is 'Temporary rolling-deploy compatibility wrapper. Remove in a later numbered migration only after Cloudflare confirms no old deployment serves traffic.';
