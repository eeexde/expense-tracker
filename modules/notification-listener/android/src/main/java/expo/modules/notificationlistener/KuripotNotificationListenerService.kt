package expo.modules.notificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.time.Instant

class KuripotNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.isOngoing) return // media players, foreground services
    val pkg = sbn.packageName ?: return
    if (!NotificationBuffer.isWatched(this, pkg)) return

    val extras = sbn.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
      ?: return

    val entry = JSONObject().apply {
      put("packageName", pkg)
      put("title", title ?: JSONObject.NULL)
      put("text", text)
      put("postedAt", Instant.ofEpochMilli(sbn.postTime).toString())
      // sbn.key alone repeats when an app re-posts the same id; postTime
      // disambiguates while still deduping listener-restart replays.
      put("key", "${sbn.key}#${sbn.postTime}")
    }
    NotificationBuffer.append(this, entry)
  }
}
