// AUTO-EXTRACTED from docs/list.html.

export function coalesceTicks(queue) {
  const seen = new Map();
  for (const [key, on] of queue) seen.set(key, on);
  return [...seen.entries()].map(([key, on]) => [key, on]);
}
