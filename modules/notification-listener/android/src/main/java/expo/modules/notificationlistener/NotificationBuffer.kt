package expo.modules.notificationlistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Bridge between the always-on listener service and the RN app.
 * - Watched packages persist in SharedPreferences (survive app death).
 * - Captured notifications append to a JSON-lines file; the app drains it
 *   on foreground. Appends and drains synchronize on this object.
 */
object NotificationBuffer {
  private const val PREFS = "kuripot_notification_listener"
  private const val KEY_WATCHED = "watched_packages"
  private const val KEY_LAST_SEEN = "last_seen_at_millis"
  private const val BUFFER_FILE = "notification_buffer.jsonl"

  /** Set by the module while the RN app is alive, for live ingest. */
  @Volatile var onCaptured: ((String) -> Unit)? = null

  /* ------------------------------------------------------------------
   * Liveness
   *
   * `Settings.Secure.enabled_notification_listeners` still names this package
   * after Android silently unbinds the service (which it does on every APK
   * update — see CLAUDE.md), so that setting says only that permission was
   * granted, never that anything is listening. These two signals say the rest:
   *
   *  - `isConnected` — the service is bound to *this* process right now. Only
   *    ever set from the service's own connect/disconnect callbacks, so a
   *    `true` is proof. It starts `false` in every new process and the bind
   *    can land a moment after the JS does, so a `false` means "not yet",
   *    not "never" — the UI has to treat it as such.
   *  - `lastSeenAtMillis` — the last time the service saw *any* notification.
   *    Survives process death, so it is the evidence that outlives a restart.
   * ------------------------------------------------------------------ */

  @Volatile private var connected = false

  val isConnected: Boolean get() = connected

  fun onServiceConnected() {
    connected = true
  }

  fun onServiceDisconnected() {
    connected = false
  }

  /** Throttle: this fires for every notification on the device, watched or not. */
  private const val HEARTBEAT_THROTTLE_MS = 60_000L

  @Volatile private var lastHeartbeatWrite = 0L

  fun markAlive(context: Context, atMillis: Long) {
    connected = true // a delivered notification is proof, whatever the callbacks did
    if (atMillis - lastHeartbeatWrite < HEARTBEAT_THROTTLE_MS) return
    lastHeartbeatWrite = atMillis
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putLong(KEY_LAST_SEEN, atMillis)
        .apply()
    } catch (_: Exception) {
      // A missed heartbeat only costs the UI a hint; never let it reach the service.
    }
  }

  /** Epoch millis of the last notification seen, or 0 when none ever was. */
  fun lastSeenAtMillis(context: Context): Long =
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_SEEN, 0L)
    } catch (_: Exception) {
      0L
    }

  fun setWatchedPackages(context: Context, packages: List<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putStringSet(KEY_WATCHED, packages.toSet())
      .apply()
  }

  fun isWatched(context: Context, packageName: String): Boolean {
    val watched = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getStringSet(KEY_WATCHED, emptySet()) ?: emptySet()
    return watched.contains(packageName)
  }

  private fun bufferFile(context: Context) = File(context.filesDir, BUFFER_FILE)

  /** Cap so an app never drained can't grow the buffer unboundedly. */
  private const val MAX_BUFFER_BYTES = 512L * 1024

  @Synchronized
  fun append(context: Context, entry: JSONObject) {
    try {
      val file = bufferFile(context)
      if (file.length() < MAX_BUFFER_BYTES) {
        file.appendText(entry.toString() + "\n")
      }
    } catch (_: Exception) {
      // Disk trouble — drop the line; the live event below may still land.
    }
    onCaptured?.invoke(entry.toString())
  }

  /** Read all buffered entries and clear the file. Returns a JSON array string. */
  @Synchronized
  fun drain(context: Context): String {
    val file = bufferFile(context)
    if (!file.exists()) return "[]"
    val array = JSONArray()
    file.readLines().forEach { line ->
      if (line.isNotBlank()) {
        try {
          array.put(JSONObject(line))
        } catch (_: Exception) {
          // corrupt line — drop it rather than wedge the whole drain
        }
      }
    }
    file.delete()
    return array.toString()
  }
}
