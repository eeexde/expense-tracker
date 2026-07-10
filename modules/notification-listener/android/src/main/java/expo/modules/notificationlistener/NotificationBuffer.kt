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
  private const val BUFFER_FILE = "notification_buffer.jsonl"

  /** Set by the module while the RN app is alive, for live ingest. */
  @Volatile var onCaptured: ((String) -> Unit)? = null

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
