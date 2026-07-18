# Free-tier roster login hardening implementation plan

> Audit amendment for the 200-applicant deployment. Execute with subagent-driven development and strict TDD.

**Goal:** Keep the current low-cost HMAC + PostgreSQL bcrypt design while making login throttling and credential lockout effective for one annual cohort of about 200 applicants.

**Architecture boundary:** Replace only `login_roster_student_v1` in one forward migration and extend its focused pgTAP contract. Do not add queues, Durable Objects, a new authentication provider, a new database table, or a second network round trip. Public failures remain generic. HMAC, AES encryption, bcrypt cost 10, CSRF/session controls, RLS, revocations, and service-role-only execution remain unchanged.

**Capacity policy:** Bound admitted login attempts to 1,024 globally and 512 per IP HMAC per 10-minute window. Split each bound across four deterministic shards selected from the Worker-generated session-token hash: 256 attempts per global shard and 128 attempts per IP shard. Check global first, then IP. The client cannot choose the shard because the Worker creates the token, while four rows avoid retaining one counter-row lock through all 200 bcrypt operations. The 128-per-shard IP headroom makes 400 randomly distributed same-NAT attempts practically admissible instead of requiring an impossible exact 100/100/100/100 split, while the bounded bcrypt budget remains small for a ten-minute window.

---

### Task 1: Atomic rate limit, credential lock, and single-bcrypt path

**Files:**
- Create: `supabase/migrations/202607180024_roster_login_free_tier_hardening.sql`
- Modify: `supabase/tests/admission_roster_auth.test.sql`

**Interfaces:**
- Consumes: existing `public.consume_rate_limit`, HMAC bytea inputs, bcrypt hashes, admission-cycle and student-session tables
- Produces: the same `login_roster_student_v1(...) -> jsonb` signature and the same public `failed` / `authenticated` result shapes

- [ ] **Step 1: Add failing pgTAP contracts before the migration**

Add focused fixtures and assertions that prove:

1. the RPC derives one of four shards from the Worker-generated token hash, then consumes a global `256 per shard / 10 minutes` bucket and an IP-HMAC `128 per shard / 10 minutes` bucket before bcrypt (bounded totals 1,024 and 512 with statistical headroom for 400 same-NAT attempts);
2. a prefilled global or IP bucket returns the generic `{"kind":"failed"}` without creating a session;
3. five consecutive wrong passwords set a 30-minute lock;
4. the correct password is still rejected while `locked_until` is in the future;
5. after the lock expires, a correct password succeeds and resets `failed_attempts` / `locked_until`;
6. the function body contains one admitted-attempt `extensions.crypt` call, selecting either the real cost-10 hash or a fixed, locally verified `$2a$10$` pgcrypto Blowfish hash;
7. the dummy comparison returns a 60-character `$2a$10$` result rather than falling back to the 13-character DES path;
8. concurrent failure calls use different limiter shards so the limiter cannot be mistaken for credential serialization; separately require the exact `FOR UPDATE OF c` function contract and service-role-only grants. Do not claim that atomic `failed_attempts + 1` alone behaviorally proves the prior select lock.

Preseed the existing `rate_limit_buckets` row immediately below a limit when testing a boundary instead of executing hundreds of bcrypt calls. Use the same fixed-window calculation and `extensions.digest(p_key, 'sha256')` contract as `consume_rate_limit`.

- [ ] **Step 2: Run the focused pgTAP file and verify RED**

Run after a clean local reset of the current baseline:

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/admission_roster_auth.test.sql
```

Expected: existing eight tests pass; new behavioral throttling/lock tests fail against the old RPC.

- [ ] **Step 3: Implement one forward migration**

Use `create or replace function` with the exact existing signature. Inside the existing validation boundary:

- derive `v_rate_shard := pg_catalog.get_byte(p_token_hash, 0) % 4`;
- call `public.consume_rate_limit('roster-login-global:' || v_rate_shard, 'roster-login-global', 256, interval '10 minutes')`;
- only when allowed, call `public.consume_rate_limit(pg_catalog.encode(p_ip_hmac, 'hex') || ':' || v_rate_shard, 'roster-login-ip', 128, interval '10 minutes')`;
- return the same generic `failed` result if either bucket denies the attempt;
- select the current active credential `FOR UPDATE`, including `failed_attempts` and `locked_until`;
- choose the real bcrypt hash only for a known eligible credential; otherwise choose a fixed valid pgcrypto `$2a$10$` dummy hash whose 60-character bcrypt behavior is locked by test;
- execute exactly one bcrypt comparison for every rate-admitted attempt;
- reject unknown, version-mismatched, wrong-password, and currently locked credentials with the same `failed` result;
- increment consecutive failures and set `locked_until = v_now + interval '30 minutes'` on the fifth failure;
- do not extend an already-active lock;
- reset failures and create the existing session only after a valid, unlocked comparison;
- repeat the existing revoke/grant statements so only `service_role` can execute the function.

Do not change the Worker adapter or add an edge-only limiter; the existing single RPC remains the authoritative and cheapest read/write path.

- [ ] **Step 4: Verify focused SQL, full SQL, and roster adapter regressions**

```bash
corepack pnpm exec supabase db reset --local
corepack pnpm exec supabase test db --local supabase/tests/admission_roster_auth.test.sql
corepack pnpm exec supabase test db --local
corepack pnpm exec vitest run --project integration tests/integration/identity/roster-login.test.ts
git diff --check
```

Expected: all focused/full pgTAP and roster adapter tests pass; no schema drift outside the one function definition.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607180024_roster_login_free_tier_hardening.sql supabase/tests/admission_roster_auth.test.sql
git commit -m "security: 2026-07-18 무료 티어 학생 로그인 제한 보완"
```
