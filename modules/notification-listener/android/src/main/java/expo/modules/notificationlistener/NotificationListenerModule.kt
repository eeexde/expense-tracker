package expo.modules.notificationlistener

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerModule : Module() {
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

    Function("isPermissionGranted") {
      val context = appContext.reactContext ?: return@Function false
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners",
      ) ?: ""
      enabled.contains(context.packageName)
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
