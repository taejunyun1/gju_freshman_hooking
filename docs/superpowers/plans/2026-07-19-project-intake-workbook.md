# Project Intake Workbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a simple Korean `.xlsx` template for entering recent, ongoing, recurring, and confirmed upcoming department projects.

**Architecture:** Produce one standalone workbook with a primary input sheet and two small reference sheets. Keep one project per row, use dropdowns for bounded values, and retain only the fields approved in the design spec.

**Tech Stack:** Codex bundled spreadsheet runtime, XLSX, spreadsheet render/inspection tools

## Global Constraints

- The workbook has exactly three sheets: `프로젝트_입력`, `작성_가이드`, `태그_목록`.
- One project occupies one row in `프로젝트_입력`.
- Multiple tags and professor names use semicolons.
- No database, application code, or existing production data is changed.
- The workbook stays simple: one example row, compact guidance, and no macros.

---

### Task 1: Create and verify the project intake workbook

**Files:**
- Create: `outputs/2026-07-19-photo-next-project-intake/photo-next-project-intake-template.xlsx`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-19-project-intake-workbook-design.md`
- Produces: a user-editable XLSX workbook with validated status, type, track, date, URL, and priority fields

- [ ] **Step 1: Load the spreadsheet runtime and create the workbook**

Create the three approved sheets, use the 21 approved columns in `프로젝트_입력`, freeze the header row, enable filters, and add one clearly marked example project row.

- [ ] **Step 2: Add bounded input guidance**

Add dropdown validation for `구분`, `진행상태`, and `대표트랙`; apply date formatting to date columns; apply integer validation to `우선순위`; and show required columns with a light blue header treatment.

- [ ] **Step 3: Add concise reference sheets**

In `작성_가이드`, document the five status mappings and the distinction between event dates and `출처확인일`. In `태그_목록`, include the four track values and every current assessment interest tag from `supabase/seed/assessment-options.json` with short Korean meanings.

- [ ] **Step 4: Verify workbook structure and rendering**

Open the saved workbook with the bundled spreadsheet library, confirm exactly three sheets and the expected headers, check that the example row and validations survive reload, scan for formula errors, and render the sheets for visual inspection.

- [ ] **Step 5: Commit the artifact**

```bash
git add -f outputs/2026-07-19-photo-next-project-intake/photo-next-project-intake-template.xlsx
git commit -m "docs: 2026-07-19 프로젝트 입력 엑셀 템플릿"
```
