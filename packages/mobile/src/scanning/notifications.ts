// Scan progress notifications (expo-notifications).
//
// One notification slot ("picly-scan") that is updated in place while a scan
// runs, then finalized with the result. Updates are throttled to ~1/sec so a
// long scan does not spam the notification center. Everything degrades
// gracefully: if permission is denied the scan simply runs without
// notifications.
//
// NOTE (Android): re-scheduling with the same identifier does NOT replace a
// notification that is already presented — it silently does nothing visible.
// The reliable "update in place" pattern is dismiss(id) -> schedule(id),
// which is what updateScanNotification does. All native calls are serialized
// through a promise chain so dismiss/schedule can never interleave.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const SCAN_NOTIF_ID = 'picly-scan-progress';

let initialized = false;
let enabled = false;
let active = false;
let lastUpdateAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const STAGE_LABELS: Record<string, string> = {
  decoding: 'Decoding photo',
  detecting: 'Detecting faces',
  embedding: 'Embedding faces',
  clustering: 'Grouping people',
};

/** Serialize native notification calls so dismiss + schedule never interleave. */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Ensure the handler, Android channel and permission are ready. Returns true when notifications can be used. */
export async function initScanNotifications(): Promise<boolean> {
  if (initialized) return enabled;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    // No `sound` here: the channel manager validates that a sound file with
    // that name exists in the app, otherwise it logs "Custom sound ... not
    // found" and the channel ends up silent anyway.
    await Notifications.setNotificationChannelAsync('picly-scan', {
      name: 'Scan progress',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: undefined,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    enabled = true;
  } else if (current.canAskAgain) {
    const req = await Notifications.requestPermissionsAsync();
    enabled = req.granted;
  }

  initialized = true;
  return enabled;
}

/** Post the initial "scanning…" notification. No-op when permission is denied. */
export async function startScanNotification(title: string): Promise<void> {
  if (!(await initScanNotifications()) || !enabled) return;
  await queued(async () => {
    if (active) {
      await Notifications.dismissNotificationAsync(SCAN_NOTIF_ID).catch(() => {});
    }
    await Notifications.scheduleNotificationAsync({
      identifier: SCAN_NOTIF_ID,
      content: { title, body: 'Getting ready…' },
      trigger: null,
    });
  });
  active = true;
  lastUpdateAt = 0;
}

/** Update the progress body in place (throttled). No-op when no notification is active. */
export async function updateScanNotification(opts: {
  processed: number;
  total: number;
  stage: string;
  faces: number;
}): Promise<void> {
  if (!active || !enabled) return;
  const now = Date.now();
  if (now - lastUpdateAt < 1000) return;
  lastUpdateAt = now;

  const pct = opts.total > 0 ? Math.round((opts.processed / opts.total) * 100) : 0;
  const stage = STAGE_LABELS[opts.stage] ?? 'Processing';
  await queued(async () => {
    await Notifications.dismissNotificationAsync(SCAN_NOTIF_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: SCAN_NOTIF_ID,
      content: {
        title: 'Scanning photos…',
        body: `${stage} · ${pct}% · ${opts.processed}/${opts.total} photos · ${opts.faces} faces`,
      },
      trigger: null,
    });
  });
}

/** Finalize with the scan result. */
export async function finishScanNotification(opts: {
  faces: number;
  photos: number;
  cancelled?: boolean;
  failed?: boolean;
}): Promise<void> {
  if (!active || !enabled) return;
  const title = opts.failed
    ? 'Scan failed'
    : opts.cancelled
      ? 'Scan cancelled'
      : 'Scan complete';
  const body = opts.failed
    ? 'Something went wrong while scanning your photos.'
    : opts.cancelled
      ? 'Your scan was stopped.'
      : `${opts.faces} faces found in ${opts.photos} photos`;
  await queued(async () => {
    await Notifications.dismissNotificationAsync(SCAN_NOTIF_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: SCAN_NOTIF_ID,
      content: { title, body },
      trigger: null,
    });
  });
  active = false;
}

/** Remove the notification (used when the user manually cancels mid-scan). */
export async function dismissScanNotification(): Promise<void> {
  if (!active) return;
  await queued(() => Notifications.dismissNotificationAsync(SCAN_NOTIF_ID).catch(() => {}));
  active = false;
}
