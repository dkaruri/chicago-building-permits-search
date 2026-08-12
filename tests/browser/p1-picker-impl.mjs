// AUTO-EXTRACTED from docs/list.html.
const userListLimit = 220;

export function listCapacity(list, incoming) {
  const room = Math.max(0, userListLimit - ((list && list.permits ? list.permits.length : 0)));
  const willAdd = Math.min(room, incoming);
  return { room, fits: willAdd >= incoming, willAdd };
}
