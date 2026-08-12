// AUTO-EXTRACTED from docs/list.html by the Task 5 verification step.
// Do not hand-edit; re-run the extraction if list.html changes.
const userListLimit = 220;

export function migrateUserLists(raw, legacy) {
  const capped = value => Array.from(new Set(
    String(value || "").split("|").map(v => v.trim()).filter(Boolean)
  )).slice(0, userListLimit);
  const fresh = () => ({
    lastUsed: "local_1",
    lists: { local_1: { name: "My Permit List", permits: capped(legacy), focal: null, sharedId: null } },
  });
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!data || typeof data !== "object" || !data.lists || typeof data.lists !== "object") return fresh();
  const ids = Object.keys(data.lists);
  if (!ids.length) return fresh();
  return {
    lastUsed: data.lists[data.lastUsed] ? data.lastUsed : ids[0],
    lists: data.lists,
  };
}
