# Claude Code Prompts for the Kanban Board

Copy-paste these into Claude Code from inside the repo. They assume the board
lives at `docs/kanban/KANBAN.md` and your `CLAUDE.md` contains the snippet from
the README (that snippet is what makes the short versions work).

## One-time setup

> Correct the backfilled Kanban dates: for every task in docs/kanban/KANBAN.md
> whose Log says "backfilled", use git log to find the real first and last
> commit dates for that feature and update Created/Updated, noting the
> correction in each task's Log.

## Daily driving

**Work the fixes queue (your main use case):**
> Read docs/kanban/KANBAN.md and follow its CLAUDE CODE PROTOCOL. Implement
> the Fixes list: todo tasks only, P0 first then P1, P2, P3. For each task,
> set it in-progress, check off checklist items as you complete them, log
> your work with timestamps, and mark it done only after verifying.

**Work one specific task:**
> Read docs/kanban/KANBAN.md and implement FIX-001 per its checklist,
> following the board protocol for status, timestamps, and logging.

**Work the features queue:**
> Read docs/kanban/KANBAN.md and implement the Features list tasks that are
> status todo, in priority order. Skip blocked tasks and tell me why they're
> blocked.

**Timebox it:**
> Read docs/kanban/KANBAN.md and work through as many todo Fixes as you can.
> Stop after the highest-priority two tasks are done and verified; leave the
> board accurately updated either way.

## Board management (no coding)

> What's on the Kanban? Summarize by list: what's in progress, what's
> blocked and why, and what's next by priority.

> Add to the Fixes list on docs/kanban/KANBAN.md: [describe the bug].
> Priority P1. Follow the board's task template and ID sequence.

> Mark FEAT-017 done on the Kanban — I verified it manually. Update the
> checklist, timestamps, and log.

> Archive all done tasks older than 30 days per the board protocol.

## Guardrails built into the board (why these prompts are safe)

- The protocol block in KANBAN.md tells Claude Code to never start `blocked`
  tasks, never touch the **Futures** list, never delete tasks, and always
  stamp real Chicago time on changes.
- "Implement the fixes" with no other context defaults to: Fixes list →
  status todo → P0→P3 → oldest first. That's the deterministic queue order.

## Optional: UI/UX Pro Max pass (community skill)

If you install the ui-ux-pro-max skill in Claude Code, run:

> Use the ui-ux-pro-max skill to audit and improve docs/kanban/board.html.
> Keep the purple + black dark theme and the existing markdown parser and
> data contract (it must still parse KANBAN.md unchanged), preserve WCAG AA
> contrast (all current text/badge pairs are ≥4.5:1), and focus on mobile
> touch ergonomics, desktop layout polish, and cross-browser compatibility.
