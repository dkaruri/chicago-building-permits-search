# Kanban Board — Setup & Usage

A file-based Kanban board for [dkaruri/chicago-building-permits-search](https://github.com/dkaruri/chicago-building-permits-search) that both humans and **Claude Code** can read and update.

- **`KANBAN.md`** — the board itself. Single source of truth. Human-readable on GitHub (mobile + desktop) and machine-readable by Claude Code.
- **`board.html`** — the visual board (columns, priority colors, checklist progress bars, task modals). Read-only; it just renders `KANBAN.md`.
- **`CLAUDE_CODE_PROMPTS.md`** — copy-paste prompts for driving Claude Code from the board.
- **`README.md`** — this file.

## 1. Where it lives

This folder is `docs/kanban/`, and GitHub Pages serves the `docs/` folder — so the live board is at:

**https://dkaruri.github.io/chicago-building-permits-search/kanban/board.html**

The raw board at `docs/kanban/KANBAN.md` also renders on github.com and in the GitHub mobile app.

## 2. Teach Claude Code about it

Add this to the `CLAUDE.md` at the root of your repo (create the file if it doesn't exist):

```markdown
## Kanban board

Project tasks live in `docs/kanban/KANBAN.md`. Before implementing anything
from the board, read that file — it contains a CLAUDE CODE PROTOCOL comment
block with the exact rules for selecting tasks (priority order, which lists
are in scope) and for updating statuses, checklists, timestamps, and logs.
Always follow that protocol and keep the file's format intact.
```

**Recommended first Claude Code prompt** (fixes the backfilled dates):

> The Kanban board at docs/kanban/KANBAN.md has backfilled done tasks whose
> Created/Updated dates are placeholders. Use git log to find the real first
> and last commit dates for each of those features and correct the dates,
> noting the correction in each task's Log.

Then prompts like these just work:

- *"Read from my Kanban and implement the fixes"* → works through the **Fixes** list, `todo` items, P0 → P3 order, checking off checklist items and updating timestamps as it goes.
- *"Implement FIX-002 from the Kanban"* → does exactly that task.
- *"Add a task to Features: export results to CSV, P2, due Friday"* → appends a properly formatted card.
- *"What's on the board? Anything blocked?"* → summarizes without changing anything.

**Futures is protected:** the protocol tells Claude Code to never implement from that list unless you explicitly ask.

See `CLAUDE_CODE_PROMPTS.md` for the full prompt collection.

## 3. Share with coworkers

The board is shared through the repo itself. Since your repo is **public**, anyone with the link can *view* the board (both the markdown and the live board.html) — viewing needs no invite at all. To let specific coworkers *edit* it: GitHub → repo **Settings → Collaborators → Add people** and invite them by username or email. Only invited collaborators (and you) can push changes; if you ever need the board itself private, it would have to move to a private repo.

Anyone with access can view `KANBAN.md` rendered on github.com or the GitHub mobile app, and edit it from either (the pencil icon works on mobile too). Checklists render as real checkboxes on GitHub — though note that on the *rendered* view they're display-only; ticking one means editing the file (one tap on mobile) or letting Claude Code do it.

## 4. Mobile & desktop access

- **Any device, best view:** https://dkaruri.github.io/chicago-building-permits-search/kanban/board.html — responsive (three columns on desktop, stacked lists on a phone) with search, status filters, and sorting (active-first, **by priority**, or recently updated). Bookmark it / add to home screen.
- **Trello-style interactions:** tap a list header to collapse/expand that list; tap any card to open it full-screen (bottom sheet on mobile) with its complete checklist, dates, tags, and activity log. Every task has its own shareable URL (`board.html#FIX-001`) — "Copy task link" in the card puts it on your clipboard, and "Copy Claude Code prompt" gives you a ready-made instruction to implement exactly that task.
- **Adding tasks from the site:** the **＋ Add task** button generates a protocol-perfect card (next free ID, real Chicago timestamps). Save it either by sending the "Claude prompt" version to Claude / Claude Code, or by copying the markdown and pasting it into KANBAN.md via the GitHub editor button.
- **Desktop:** open `docs/kanban/KANBAN.md` on github.com or in your editor.
- **Mobile fallback:** the GitHub app (iOS/Android) renders `KANBAN.md` nicely — priorities, dates, checkboxes and all.

## 5. Editing via Claude

In a Claude chat, ask things like *"mark FIX-001 in progress"* or *"add a P1 fix: …"* — with the GitHub connector enabled, Claude can commit board updates directly. Claude Code on your computer edits the repo copy directly. The **repo copy is the single source of truth**.

## 6. The format at a glance

Three lists (plus an Archive), each with a purpose description:

| List | Purpose | ID prefix |
|------|---------|-----------|
| 🔧 Fixes | Bugs/repairs on the current project (Chicago Permit Search) — Claude Code's default queue | `FIX-###` |
| ✨ Features | New features for the existing project | `FEAT-###` |
| 🔭 Futures | Ideas beyond the current project — never auto-implemented | `FUT-###` |

Each task card records: **Priority** (`P0-Critical` / `P1-High` / `P2-Medium` / `P3-Low`), **Status** (`todo` / `in-progress` / `blocked` / `done`), **Created** and **Updated** timestamps (Chicago time), optional **Due** date, **Assignee**, and **Tags**, a description, a **Checklist** of subtasks (checkable by you or by Claude Code), and a **Log** of dated activity entries so you can see who did what, when.

The full editing rules live in the comment block at the top of `KANBAN.md` — humans are welcome to read them too, but mainly they keep Claude Code disciplined.
