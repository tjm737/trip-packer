/*
 * Offline mutation queue.
 *
 * `post()` in storage.ts retries once and then gives up, so a change made with
 * no network was lost — with an error toast the user could do nothing about.
 * This holds those writes and replays them once connectivity returns.
 *
 * Ordering matters and is preserved strictly: the ops are not independent
 * (create a trip, then add a reservation to it), so replaying out of order
 * would apply them against state that does not exist yet. The queue is FIFO
 * and drained one at a time, stopping at the first op that fails for a reason
 * that is not connectivity — a 4xx will never succeed on retry, and skipping
 * past it could apply later ops to a state it was meant to create.
 *
 * Persisted so a reload (or the OS killing the tab) does not drop queued work.
 */

const QUEUE_KEY = "trip-packer:offline-queue:v1";

export type QueuedOp = {
  id: string;
  /** The exact request body that would have been POSTed to /api/mutate. */
  body: unknown;
  /** Human label for the offline banner, e.g. "Add reservation". */
  label: string;
  queuedAt: number;
};

function read(): QueuedOp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOp[]) : [];
  } catch {
    return [];
  }
}

function write(ops: QueuedOp[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    /* quota / disabled storage — see offlineCache.ts */
  }
}

export function listQueuedOps(): QueuedOp[] {
  return read();
}

export function queuedOpCount(): number {
  return read().length;
}

export function enqueueOp(body: unknown, label: string): QueuedOp {
  const op: QueuedOp = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11) + Date.now().toString(36),
    body,
    label,
    queuedAt: Date.now(),
  };
  write([...read(), op]);
  return op;
}

export function removeQueuedOp(id: string): void {
  write(read().filter((op) => op.id !== id));
}

export function clearQueue(): void {
  write([]);
}
