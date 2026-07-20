# Login Phone Number Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Format the student login phone number progressively as `010-1234-5678` while accepting only digits and preserving the existing authentication contract.

**Architecture:** Add a browser-independent formatter under `app/utils`, cover it with direct unit tests, then bind the login input event to that formatter. Keep the display value formatted but convert it back to digits when constructing the existing login API request.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vitest, Vue Test Utils

## Global Constraints

- Apply only to the student login page.
- Keep the current blue, rounded login design unchanged.
- Remove every non-digit character from typed or pasted input.
- Limit the value to 11 digits and 13 displayed characters.
- Display the value progressively in Korean mobile format.
- Submit digits only to `/api/student/login`.
- Preserve existing labels, error messages, autocomplete behavior, PIN handling, database schemas, and authentication rules.

---

### Task 1: Login Phone Input Formatter

**Files:**
- Create: `app/utils/student-phone-input.ts`
- Create: `tests/unit/utils/StudentPhoneInput.test.ts`
- Modify: `app/pages/login.vue`
- Modify: `tests/unit/pages/StudentAccountPages.test.ts`

**Interfaces:**
- Produces: `studentPhoneDigits(value: string): string`
- Produces: `formatStudentPhoneInput(value: string): string`
- Consumes: the existing `/api/student/login` request with `{ phone, password }`

- [ ] **Step 1: Write failing formatter tests**

Create `tests/unit/utils/StudentPhoneInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatStudentPhoneInput,
  studentPhoneDigits,
} from '../../../app/utils/student-phone-input'

describe('student phone input', () => {
  it.each([
    ['', ''],
    ['010', '010'],
    ['0101', '010-1'],
    ['0101234', '010-1234'],
    ['01012345', '010-1234-5'],
    ['01012345678', '010-1234-5678'],
  ])('formats %s progressively', (input, expected) => {
    expect(formatStudentPhoneInput(input)).toBe(expected)
  })

  it('removes non-digits and truncates after eleven digits', () => {
    expect(formatStudentPhoneInput('010-12가34 5678xyz9')).toBe('010-1234-5678')
    expect(studentPhoneDigits('010-1234-5678')).toBe('01012345678')
  })
})
```

- [ ] **Step 2: Run the formatter test and verify RED**

Run:

```bash
corepack pnpm vitest run --project unit tests/unit/utils/StudentPhoneInput.test.ts
```

Expected: FAIL because `app/utils/student-phone-input.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure formatter**

Create `app/utils/student-phone-input.ts`:

```ts
export const studentPhoneDigits = (value: string): string => value.replace(/\D/gu, '').slice(0, 11)

export const formatStudentPhoneInput = (value: string): string => {
  const digits = studentPhoneDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}
```

- [ ] **Step 4: Run the formatter test and verify GREEN**

Run the Step 2 command again.

Expected: 8 tests pass.

- [ ] **Step 5: Write the failing login page contract assertions**

Update the first test in `tests/unit/pages/StudentAccountPages.test.ts` so it:

```ts
const fetch = vi.fn().mockRejectedValue(new Error('unexpected backend detail'))
vi.stubGlobal('$fetch', fetch)

await wrapper.find('input[name="phone"]').setValue('010-12가34 5678')
expect(wrapper.find('input[name="phone"]').element.value).toBe('010-1234-5678')
expect(wrapper.find('input[name="phone"]').attributes('inputmode')).toBe('numeric')
expect(wrapper.find('input[name="phone"]').attributes('maxlength')).toBe('13')

await wrapper.find('input[name="password"]').setValue('269442')
await wrapper.find('form').trigger('submit')
await flushPromises()

expect(fetch).toHaveBeenCalledWith('/api/student/login', {
  body: { phone: '01012345678', password: '269442' },
  method: 'POST',
})
```

- [ ] **Step 6: Run the page test and verify RED**

Run:

```bash
corepack pnpm vitest run --project unit tests/unit/pages/StudentAccountPages.test.ts
```

Expected: FAIL because the current field uses `inputmode="tel"`, has no 13-character limit, keeps mixed input unchanged, and submits the formatted form object directly.

- [ ] **Step 7: Bind the formatter to the login field and normalize the request**

Update `app/pages/login.vue`:

```ts
import {
  formatStudentPhoneInput,
  studentPhoneDigits,
} from '../utils/student-phone-input'

const updatePhone = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const formatted = formatStudentPhoneInput(input.value)
  form.phone = formatted
  input.value = formatted
}
```

Construct the request body explicitly:

```ts
body: {
  phone: studentPhoneDigits(form.phone),
  password: form.password,
},
```

Replace phone `v-model` with the formatted event binding and numeric attributes:

```vue
<input
  id="login-phone"
  :value="form.phone"
  name="phone"
  type="tel"
  inputmode="numeric"
  maxlength="13"
  autocomplete="tel"
  placeholder="010-0000-0000"
  required
  @input="updatePhone"
>
```

- [ ] **Step 8: Run focused GREEN verification**

Run:

```bash
corepack pnpm vitest run --project unit tests/unit/utils/StudentPhoneInput.test.ts tests/unit/pages/StudentAccountPages.test.ts
corepack pnpm typecheck
corepack pnpm lint
git diff --check
```

Expected: formatter and page tests pass; typecheck, lint, and diff-check exit 0.

- [ ] **Step 9: Commit the implementation**

```bash
git add app/utils/student-phone-input.ts app/pages/login.vue tests/unit/utils/StudentPhoneInput.test.ts tests/unit/pages/StudentAccountPages.test.ts
git commit -m "feat: 2026-07-20 로그인 전화번호 자동 형식"
```

### Release Verification

- [ ] Run the complete Vitest suite, typecheck, lint, production build, and diff-check.
- [ ] Perform task review and final whole-feature review from the implementation diff.
- [ ] Push `feature/photo-next-mvp` and deploy staging before production with the existing release controller.
- [ ] In production browser QA, type and paste mixed phone text; verify the displayed value is `010-1234-5678`, the input opens numeric mode, and an existing test account can still log in.
