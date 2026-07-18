# Free-tier roster login hardening implementation plan

> Audit amendment for the 200-applicant deployment. Execute with subagent-driven development and strict TDD.

**Goal:** Keep the current low-cost HMAC + PostgreSQL bcrypt design while making login throttling and credential lockout effective for one annual cohort of about 200 applicants.

**Architecture boundary:** Replace only `login_roster_student_v1` in one forward migration and extend its focused pgTAP contract. Do not add queues, Durable Objects, a new authentication provider, a new database table, or a second network round trip. Public failures remain generic. HMAC, AES encryption, bcrypt cost 10, CSRF/session controls, RLS, revocations, and service-role-only execution remain unchanged.

**Capacity policy:** Admit at most 800 login attempts globally per 10-minute window and 400 attempts per IP HMAC per 10-minute window. Check global first, then IP, so a distributed attack cannot create unbounded per-IP buckets after the global ceiling. These bounds still allow 200 applicants behind one school NAT to retry once while limiting unauthenticated bcrypt work.

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

1. the RPC consumes a global `800 / 10 minutes` bucket and then an IP-HMAC `400 / 10 minutes` bucket before bcrypt;
2. a prefilled global or IP bucket returns the generic `{"kind":"failed"}` without creating a session;
3. five consecutive wrong passwords set a 30-minute lock;
4. the correct password is still rejected while `locked_until` is in the future;
5. after the lock expires, a correct password succeeds and resets `failed_attempts` / `locked_until`;
6. the function body contains one admitted-attempt `extensions.crypt` call, selecting either the real cost-10 hash or the existing dummy cost-10 hash;
7. row locking serializes concurrent failure updates, and the RPC/grants remain service-role only.

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

- call `public.consume_rate_limit('roster-login-global', 'roster-login-global', 800, interval '10 minutes')`;
- only when allowed, call `public.consume_rate_limit(pg_catalog.encode(p_ip_hmac, 'hex'), 'roster-login-ip', 400, interval '10 minutes')`;
- return the same generic `failed` result if either bucket denies the attempt;
- select the current active credential `FOR UPDATE`, including `failed_attempts` and `locked_until`;
- choose the real bcrypt hash only for a known eligible credential; otherwise choose the existing valid dummy cost-10 hash;
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

