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
 */
export async function notifyPostedDues(summary: PostedSummary): Promise<void> {
  if (summary.posted.length === 0) return;

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;

  const content =
    summary.posted.length === 1
      ? {
          title: 'Recurring expense posted',
          body: `${summary.posted[0].name} — ${formatPeso(summary.posted[0].amount)}`,
        }
      : {
          title: `${summary.posted.length} recurring expenses posted`,
          body: summary.posted
            .map((p) => `${p.name} ${formatPeso(p.amount)}`)
            .join(', '),
        };

  await Notifications.scheduleNotificationAsync({ content, trigger: null });
}
