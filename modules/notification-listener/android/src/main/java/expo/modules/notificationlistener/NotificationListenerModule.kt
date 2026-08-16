package expo.modules.notificationlistener

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class NotificationListenerModule : Module() {
  private fun enabledInSettings(context: Context): Boolean {
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      "enabled_notification_listeners",
    ) ?: ""
    return enabled.contains(context.packageName)
  }

  /**
   * Serialized rather than returned as a map: every other value this module
   * hands to JS is a String or a List<Map<String, String>>, and a status object
   * mixes booleans with a nullable number. `drainBuffer` already sets the
   * precedent, and JSON keeps the shape out of the converter's way entirely.
   */
  private fun statusJson(enabled: Boolean, connected: Boolean, lastSeenAtMillis: Long): String =
    JSONObject()
      .put("enabledInSettings", enabled)
      .put("connected", connected)
      .put("lastSeenAtMillis", lastSeenAtMillis)
      .toString()

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")
    Events("onNotificationCaptured")

    OnCreate {
      NotificationBuffer.onCaptured = { json ->
        sendEvent("onNotificationCaptured", mapOf("entry" to json))
      }
    }

    OnDestroy {
      NotificationBuffer.onCaptured = null
    }

    /**
     * Whether the user granted notification access. NOT whether anything is
     * listening: Android keeps this setting populated after it unbinds the
     * service on an APK update, which is exactly how the feature ends up dead
     * while the settings screen still says it is on. Use `getListenerStatus`
     * to know if it is running.
     */
    Function("isPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      enabledInSettings(context)
    }

    /** Permission, live bind state and the last-seen heartbeat, as JSON. */
    Function("getListenerStatus") {
      val context = appContext.reactContext
        ?: return@Function statusJson(enabled = false, connected = false, lastSeenAtMillis = 0L)
      statusJson(
        enabled = enabledInSettings(context),
        connected = NotificationBuffer.isConnected,
        lastSeenAtMillis = NotificationBuffer.lastSeenAtMillis(context),
      )
    }

    /**
     * Asks the system to bind the listener again. This is the documented cure
     * for the unbind an APK update causes (`requestRebind`, API 24+), and it
     * is a no-op when the user never granted access. Nothing here can confirm
     * the bind — `getListenerStatus` reports whether it landed.
     */
    Function("requestRebind") {
      appContext.reactContext?.let { context ->
        try {
          NotificationListenerService.requestRebind(
            ComponentName(context, KuripotNotificationListenerService::class.java),
          )
        } catch (_: Exception) {
          // Best-effort: a refused rebind leaves the UI's own advice standing.
        }
      }
    }

    Function("openSettings") {
      // No bare return@Function in these DSL lambdas — their inferred return
      // type is not Unit, so a valueless return fails to compile.
      appContext.reactContext?.let { context ->
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    Function("setWatchedPackages") { packages: List<String> ->
      appContext.reactContext?.let { context ->
        NotificationBuffer.setWatchedPackages(context, packages)
      }
    }

    Function("drainBuffer") {
      val context = appContext.reactContext ?: return@Function "[]"
      NotificationBuffer.drain(context)
    }

    Function("getLaunchableApps") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, String>>()
      val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val pm = context.packageManager
      pm.queryIntentActivities(intent, 0)
        .map {
          mapOf(
            "label" to it.loadLabel(pm).toString(),
            "packageName" to it.activityInfo.packageName,
          )
        }
        .distinctBy { it["packageName"] }
        .sortedBy { it["label"]?.lowercase() }
    }
  }
}
