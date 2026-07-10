package expo.modules.notificationlistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class KuripotNotificationListenerService : NotificationListenerService() {
  /** ISO-8601 UTC without java.time — project minSdk is 24, Instant needs 26. */
  private fun isoUtc(epochMillis: Long): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date(epochMillis))
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    // This runs in the app's process; any uncaught throw here kills the app.
    try {
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
        put("postedAt", isoUtc(sbn.postTime))
        // sbn.key alone repeats when an app re-posts the same id; postTime
        // disambiguates while still deduping listener-restart replays.
        put("key", "${sbn.key}#${sbn.postTime}")
      }
      NotificationBuffer.append(this, entry)
    } catch (_: Exception) {
      // Losing one notification beats crashing the host app.
    }
  }
}
