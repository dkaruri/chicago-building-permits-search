# Chicago Permit Search — Kanban Board

<!-- kanban-board: v1 | timezone: America/Chicago | ids: FIX|FEAT|FUT -->

<!--
═══════════════════════════════════════════════════════════════════
CLAUDE CODE PROTOCOL — READ THIS BEFORE TOUCHING THE BOARD
═══════════════════════════════════════════════════════════════════

This file is the single source of truth for project tasks. It is both
human-readable (renders on GitHub, mobile and desktop) and machine-readable.
Follow these rules exactly so the format stays parseable.

STRUCTURE
  • Lists are `## ` headings. The blockquote (`> `) directly under a list
    heading is that list's purpose — do not remove it.
  • Tasks are `### <ID> · <Title>` headings. IDs are FIX-###, FEAT-###,
    or FUT-### (zero-padded, unique, never reused — even after deletion).
  • Task metadata is a bullet block of `- **Key:** value` lines.
  • An optional free-text description follows the metadata.
  • `**Checklist:**` introduces `- [ ]` / `- [x]` subtask items.
  • `**Log:**` introduces dated activity entries.

METADATA FIELDS (keep this order)
  - **Priority:** P0-Critical | P1-High | P2-Medium | P3-Low
  - **Status:** todo | in-progress | blocked | done
  - **Created:** YYYY-MM-DD HH:MM CT
  - **Updated:** YYYY-MM-DD HH:MM CT
  - **Due:** YYYY-MM-DD            (optional)
  - **Assignee:** name             (optional)
  - **Tags:** comma, separated     (optional; project/topic labels)

SELECTING WORK ("Read from my Kanban and implement the fixes")
  1. Default scope is the **Fixes** list unless the user names another list
     or a specific task ID.
  2. Filter to Status: todo (never start blocked tasks; ask about them).
  3. Sort by Priority: P0 first, then P1, P2, P3. Break ties by oldest
     Created date.
  4. NEVER implement anything from **Futures** — that list is an idea
     parking lot, out of scope for the current project, and is only edited
     when the user explicitly asks.

WHILE WORKING ON A TASK
  1. Set Status to in-progress and refresh Updated
     (use: TZ=America/Chicago date '+%Y-%m-%d %H:%M CT').
  2. Check off checklist items (`- [ ]` → `- [x]`) as you complete them.
     You may append newly discovered subtasks to the checklist.
  3. Append one line to the task's Log for every status change or
     significant event: `- YYYY-MM-DD HH:MM CT — <what happened> (Claude Code)`.
  4. When every checklist item is checked and the work is verified, set
     Status to done and refresh Updated. If you cannot finish, set Status
     to blocked and log why.

ADDING TASKS
  Copy the template at the bottom of this file. Assign the next unused ID
  for that list. Always fill Created and Updated with the real current
  Chicago time — never guess or backdate.

NEVER
  • Reorder or rename lists, or edit their purpose blockquotes.
  • Delete tasks (mark done, or move the heading + body to the Archive
    section at the bottom).
  • Change the metadata key names, priority values, or status values.
═══════════════════════════════════════════════════════════════════
-->

**Board owner:** Divyam · **Repo:** [dkaruri/chicago-building-permits-search](https://github.com/dkaruri/chicago-building-permits-search) · **Timezone:** America/Chicago (CT) · **Format:** v1

> ℹ️ Tasks whose Log says *backfilled* were completed before this board existed; their Created/Updated dates are the backfill date, not the true completion date. Ask Claude Code to *"correct the backfilled Kanban dates from git history"* to replace them with real first/last commit dates for each feature.

**Priority legend:** `P0-Critical` drop everything · `P1-High` next up · `P2-Medium` normal queue · `P3-Low` when time allows

**Status legend:** `todo` → `in-progress` → `done`, with `blocked` for anything stuck (note the blocker in the Log).

---

## 🔧 Fixes

> **Purpose:** Things to fix on current projects — currently the Chicago Permit Search tool. Bugs, regressions, broken behavior, and cleanup on what already exists. This is Claude Code's default work queue.

### FIX-001 · General bug and compatibility fixes

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Sweep the tool for general bugs and browser/device compatibility issues.

**Checklist:**
- [ ] Audit console errors across all pages (Search Directory, Permit Map, My Permit List)
- [ ] Test on Chrome, Safari, Firefox, and mobile browsers
- [ ] Fix issues found and note each in this task's Log
- [ ] Verify no regressions in search, map, and list flows

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FIX-002 · UI cleanup and mobile accessibility

- **Priority:** P3-Low
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

General UI polish plus accessibility on small screens.

**Checklist:**
- [ ] Audit layout and overflow on phone-sized viewports
- [ ] Improve touch target sizes and contrast
- [ ] Add ARIA labels / semantic markup where missing
- [ ] Verify with Lighthouse accessibility pass

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

---

## ✨ Features

> **Purpose:** New features and ideas to be added to the existing Chicago Permit Search tool. Enhancements that extend the current project rather than repair it.

### FEAT-021 · Add permit value range to Search and Map Search

- **Priority:** P1-High
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Filter/search by permit (reported cost) value range in both the Search tool and the Map Search tool.

**Checklist:**
- [ ] Add value-range input to Search filters
- [ ] Add value-range filter to Map Search
- [ ] Ensure indexes expose reported cost efficiently
- [ ] Verify results match range on both tools

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-017 · Address search for permits

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Search permits directly by street address.

**Checklist:**
- [ ] Add address input to search UI
- [ ] Match against permit address data (handle partial/fuzzy matches)
- [ ] Show matching permits with links to detail
- [ ] Verify against known addresses

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-018 · Search tool scope expansion and parity with Map Search tool

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Bring the Search tool's filters/data scope up to parity with what the Map Search tool offers, and expand scope where the two diverge.

**Checklist:**
- [ ] Inventory filters/data available in each tool
- [ ] Close the gaps in the Search tool
- [ ] Verify both tools return consistent results for the same query

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-019 · Map tool icons based on permit type

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:28 CT
- **Tags:** Chicago Permit Search Tool

Map markers should display a different icon depending on the permit type of the underlying permit.

**Checklist:**
- [ ] Enumerate permit types present in the dataset
- [ ] Design one distinct icon per permit type (plus a fallback for rare/unknown types)
- [ ] Implement icon selection on Map Search markers
- [ ] Add a map legend mapping icons to permit types
- [ ] Verify legibility at all zoom levels and on mobile

**Log:**
- 2026-07-27 10:09 CT — created; blocked pending spec of what icons are based on (Claude)
- 2026-07-27 10:28 CT — unblocked: Divyam confirmed icons are based on permit type; status → todo (Claude)

### FEAT-020 · Map tool compatibility fixes

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Resolve browser/device compatibility issues specific to the Map Search tool.

**Checklist:**
- [ ] Test map rendering and interactions across browsers and mobile
- [ ] Fix issues found and log them here
- [ ] Verify month filter and markers behave consistently

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-022 · Historical map of a General Contractor's work

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

From a GC's profile, view a map of their past permits/projects over time.

**Checklist:**
- [ ] Aggregate permits per GC with locations and dates
- [ ] Map view (reuse MapLibre) filtered to one GC, with time dimension
- [ ] Link from contractor profile
- [ ] Verify with a high-volume GC

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-023 · Display lenders on projects and their associated GCs

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Tags:** Chicago Permit Search Tool

Surface lender information on projects and connect lenders to the GCs they work with.

**Checklist:**
- [ ] Identify data source for lender info
- [ ] Show lender on permit/project detail
- [ ] Cross-reference lenders ↔ GCs
- [ ] Verify sample projects

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FEAT-001 · Build searchable directory of permits, contractors, and subs

- **Priority:** P1-High
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Search interface over the Chicago Building Permits dataset with type filters (General Contractors / Open Subs / Open Permits), ward filter, and sorting by open jobs, total jobs, average processing days, latest issue date, and reported cost.

**Checklist:**
- [x] Search UI with type + ward filters
- [x] Sort options wired to index data
- [x] Deployed to GitHub Pages

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-002 · Interactive permit map (MapLibre)

- **Priority:** P1-High
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Geographic visualization of permits with month filtering.

**Checklist:**
- [x] MapLibre map page
- [x] Month filter

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-003 · My Permit List with routing and exports

- **Priority:** P1-High
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Saved-permit tracking with OSRM driving-time estimates between saved permits and export to Google Maps links, KML, and CSV.

**Checklist:**
- [x] Save/track permits
- [x] OSRM route estimates
- [x] Google Maps / KML / CSV exports

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-004 · Contractor profiles

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Profiles showing public contact fields, open job counts, average processing days, work specializations, and licensing information.

**Checklist:**
- [x] Profile pages with workload metrics
- [x] Specialization + licensing data

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-005 · Data pipeline: DuckDB ingest + JSON indexes

- **Priority:** P1-High
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Scripts download the dataset into a local DuckDB database and generate compact JSON indexes for efficient client-side search.

**Checklist:**
- [x] DuckDB ingestion scripts
- [x] Compact JSON index generation

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-006 · Automated daily data refresh (GitHub Actions)

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 09:45 CT
- **Updated:** 2026-07-27 09:45 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Daily scheduled workflow pulls the latest records from the Socrata API and city contractor registries, then rebuilds the published indexes.

**Checklist:**
- [x] Scheduled workflow
- [x] Socrata + registry pulls
- [x] Auto-publish refreshed indexes

**Log:**
- 2026-07-27 09:45 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-007 · Read from permit to see type of permit

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-008 · Add visited checkmark to permits in permit list

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-009 · Add log walkthrough for chatting to owner / GCs / open subs

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Guided log walkthrough for recording conversations with the owner and/or general contractors and/or open subs.

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-010 · Add permit to permit list via address

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-011 · Add photos to permit

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-012 · Add open subs who aren't included under a permit

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-013 · Show building type (4-unit, apartment, etc.)

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Provide whether a house is a 4-unit, apartment, etc.

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-014 · Add Title under the GC

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-015 · Checkbox in log walkthrough for new build/remodel

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

### FEAT-016 · Remember last-viewed list on the list site

- **Priority:** P2-Medium
- **Status:** done
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT
- **Assignee:** Divyam
- **Tags:** Chicago Permit Search Tool

Remember what list you were last on when returning to the list site.

**Log:**
- 2026-07-27 10:09 CT — backfilled: completed prior to board creation; refine dates from git history (Claude)

---

## 🔭 Futures

> **Purpose:** Ideas outside the scope of the current project — things that may or may not become future projects or add-ons. Not actionable now. Claude Code must never implement from this list unless explicitly instructed.

### FUT-001 · Fill in forms for buy offers based on base price and other factors

- **Priority:** P1-High
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT

Auto-fill buy-offer forms using base price among other factors.

**Checklist:**
- [ ] Define the offer form(s) and required fields
- [ ] Decide pricing inputs (base price, comps, other factors)
- [ ] Prototype form fill

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FUT-003 · Research Regrid.com data for the Search Tool

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT

Evaluate Regrid.com parcel data and how it could enrich the Search Tool.

**Checklist:**
- [ ] Review Regrid data coverage for Chicago and licensing/cost
- [ ] Identify fields that would enrich permits/parcels
- [ ] Write up findings

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

### FUT-002 · Research Polyscan for the Search Tool

- **Priority:** P3-Low
- **Status:** todo
- **Created:** 2026-07-27 10:09 CT
- **Updated:** 2026-07-27 10:09 CT

Investigate Polyscan and whether it can be used with the Search Tool.

**Checklist:**
- [ ] Establish what Polyscan offers and access model
- [ ] Assess fit with the Search Tool
- [ ] Write up findings

**Log:**
- 2026-07-27 10:09 CT — created (Divyam)

---

## 🗄️ Archive

> **Purpose:** Completed or retired tasks moved here to keep the active lists short. Preserve full task bodies when archiving.

*Empty.*

---

<!-- TASK TEMPLATE — copy below this line, replace ALL-CAPS placeholders ─────

### FIX-001 · SHORT IMPERATIVE TITLE

- **Priority:** P2-Medium
- **Status:** todo
- **Created:** YYYY-MM-DD HH:MM CT
- **Updated:** YYYY-MM-DD HH:MM CT
- **Due:** YYYY-MM-DD
- **Assignee:** NAME
- **Tags:** Chicago Permit Search Tool

One or two sentences of context: what is wrong or wanted, where it lives
in the codebase, and how to know it is finished.

**Checklist:**
- [ ] First concrete step
- [ ] Second concrete step
- [ ] Verify / test the change

**Log:**
- YYYY-MM-DD HH:MM CT — created (Divyam)

──────────────────────────────────────────────────────────────────────── -->
