import * as Notifications from 'expo-notifications';
import { formatPeso } from './money';
import { PostedSummary } from './recurringEngine';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Tell the user which recurring/installment dues the catch-up engine just
 * posted. One detailed notification for a single item, one summary otherwise.
 *
 * Dues the fallback chain could NOT pay are deliberately not notified here:
 * this runs on every cold open, and a due stays unpaid across all of them, so
 * a notification would fire again and again for the same bill. Those live on
 * the recurring tab instead, where the warning persists until the due posts.
 */
export async function notifyPostedDues(summary: PostedSummary): Promise<void> {
  if (summary.posted.length === 0) return;

  // A posting that came from somewhere other than the rule's own bucket is
  // worth saying out loud, and unlike a skip it is said exactly once.
  const fellBackOn = new Map(summary.fellBack.map((f) => [`${f.name}|${f.date}`, f.bucketName]));

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;

  const [first] = summary.posted;
  const firstFallback = fellBackOn.get(`${first.name}|${first.date}`);
  const content =
    summary.posted.length === 1
      ? {
          title: 'Recurring expense posted',
          body:
            `${first.name} — ${formatPeso(first.amount)}` +
            (firstFallback ? ` · paid from ${firstFallback}` : ''),
        }
      : {
          title: `${summary.posted.length} recurring expenses posted`,
          body: summary.posted
            .map((p) => `${p.name} ${formatPeso(p.amount)}`)
            .join(', '),
        };

  await Notifications.scheduleNotificationAsync({ content, trigger: null });
}
