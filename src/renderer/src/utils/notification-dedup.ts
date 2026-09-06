/**
 * Deduplication utility for the `notification` browser event.
 *
 * The Socket.IO transport delivers notifications over the auto-reconnecting
 * events connection. On reconnect the browser-client re-subscribes, and in rare
 * scenarios (server failover, duplicate broadcast) the same notification may be
 * delivered more than once. The notification contract carries a stable `id`
 * (plus `timestamp`), which this utility uses to suppress redeliveries
 * within a bounded window, so each notification sound/alert plays once.
 *
 * Notifications without an `id` (produced by older servers) are never
 * considered duplicates to preserve backward compatibility.
 */

const DEFAULT_DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_TRACKED_IDS = 200;

export type NotificationDedupInput = unknown;

export interface NotificationDeduplicator {
  /**
   * Returns true if a notification with the same `id` was already seen within
   * the dedup window. Records the id on first sight.
   *
   * Parameter is `unknown` because callers feed raw, untrusted wire data; unknown,
   * malformed, or nullish payloads are never duplicates and must
   * never throw — a throw here would abort dispatch to the notification
   * listeners in the socket 'event' callback.
   */
  isDuplicate: (notification: NotificationDedupInput) => boolean;
}

export const createNotificationDeduplicator = (
  windowMs: number = DEFAULT_DEDUP_WINDOW_MS,
  maxTrackedIds: number = DEFAULT_MAX_TRACKED_IDS,
): NotificationDeduplicator => {
  const seen = new Map<string, number>();

  const evictExpired = (now: number) => {
    for (const [id, timestamp] of seen) {
      if (now - timestamp > windowMs) {
        seen.delete(id);
      }
    }
  };

  return {
    isDuplicate: (notification: unknown): boolean => {
      // Never throw on malformed payloads: the caller feeds raw wire data, and a
      // throw inside the socket 'event' callback would abort dispatch to the
      // remaining notification listeners.
      if (!notification || typeof notification !== 'object') {
        return false;
      }

      const id = (notification as { id?: unknown }).id;
      if (typeof id !== 'string' || !id) {
        // Backward compatibility: notifications without a stable id are always fresh
        return false;
      }

      const now = Date.now();
      evictExpired(now);

      if (seen.has(id)) {
        return true;
      }

      seen.set(id, now);
      if (seen.size > maxTrackedIds) {
        const oldestId = seen.keys().next().value;
        if (oldestId !== undefined) {
          seen.delete(oldestId);
        }
      }

      return false;
    },
  };
};
