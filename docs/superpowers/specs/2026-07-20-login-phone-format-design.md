# Login Phone Number Formatting Design

## Goal

Make the PHOTO:NEXT student login phone field accept number input naturally while displaying a familiar Korean mobile number format.

## Scope

- Apply only to the student login page.
- Keep the current blue, rounded login design unchanged.
- Do not change password reset, roster management, database schemas, or authentication rules.

## Interaction

- Open a numeric keyboard on supported mobile devices.
- Remove every non-digit character from typed or pasted input.
- Limit the value to 11 digits.
- Format progressively:
  - `010`
  - `010-1`
  - `010-1234`
  - `010-1234-5`
  - `010-1234-5678`
- Keep `010-0000-0000` as the example placeholder.
- Set the visible input limit to 13 characters including hyphens.
- Submit digits only to the existing login API so the server contract and authentication behavior remain unchanged.

## Implementation Boundary

- Add one small, pure formatter with no network or browser dependencies.
- Bind the login input event to the formatter and keep the formatted value in the form state.
- Strip formatting once when creating the login request body.
- Preserve existing labels, error messages, autocomplete behavior, and PIN handling.

## Validation

- Unit test progressive formatting, non-digit removal, paste-like mixed strings, and 11-digit truncation.
- Page test numeric input mode, 13-character limit, formatted display, and digits-only API submission.
- Run the focused tests first, then the full test suite, typecheck, lint, and production build.
- Verify the deployed login page in a browser at desktop and mobile widths.

## Non-goals

- No three-field segmented phone control.
- No blur-only formatting.
- No changes to student credentials or stored phone data.
