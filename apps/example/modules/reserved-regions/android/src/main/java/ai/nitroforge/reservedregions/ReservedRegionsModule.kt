package ai.nitroforge.reservedregions

import android.app.Activity
import androidx.window.layout.WindowInfoTracker
import com.facebook.react.bridge.LifecycleEventListener
import io.github.expo.modules.v2.Event
import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.Module
import io.github.expo.modules.v2.react.currentActivity
import io.github.expo.modules.v2.react.reactContextOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Android side of @acme/ui's useReservedRegions(), ported from nyc-mon
 * apps/mobile/modules/reserved-regions.
 *
 * Android has no "reserved region" API, so Jetpack WindowManager FoldingFeatures
 * are normalized into the kit's "division" geometry plus the posture metadata
 * WindowManager exposes: orientation, FLAT / HALF_OPENED, occlusion, separating.
 * WindowManager has no continuous hinge angle, and this module does not invent one.
 *
 * Threading: every piece of mutable state below (the collection Job, the observed
 * Activity, the lifecycle registration) is touched only on the main thread. The
 * observation hooks and query() can arrive on the JS thread, so each crosses into
 * `scope` once instead of mutating state where it lands.
 */
@ExpoModule("ReservedRegions")
class ReservedRegionsModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var collectionJob: Job? = null
  private var observedActivity: Activity? = null
  private var lifecycleRegistered = false

  /*
   * A JS listener can outlive the Activity's time in the foreground, so "someone
   * is listening" and "the host is resumed" are separate gates. Pausing collection
   * on host pause keeps WindowInfoTracker from holding a paused Activity.
   * React Native delivers these callbacks on the main thread.
   */
  private val lifecycleListener = object : LifecycleEventListener {
    override fun onHostResume() {
      if (onChanged.isObserved) {
        currentActivity?.let(::observe)
      }
    }

    override fun onHostPause() {
      pauseCollection()
    }

    override fun onHostDestroy() {
      pauseCollection()
    }
  }

  /**
   * JS subscribes with `module.addListener("changed", listener)` and receives the
   * full region list on every layout change. No listener, no collection.
   */
  @Event("changed")
  val onChanged = event<List<ReservedRegionRecord>>(
    onStartObserving = { scope.launch { startObserving() } },
    onStopObserving = { scope.launch { stopObserving() } },
  )

  /**
   * Snapshot for first render and after an Activity or configuration change.
   *
   * The kit re-queries whenever the RN window size changes. If a configuration
   * change replaced the Activity while the JS listener survived, this moves the
   * Flow to the new Activity before returning.
   */
  @JS
  suspend fun query(): List<ReservedRegionRecord> {
    val activity = currentActivity ?: return emptyList()

    withContext(Dispatchers.Main.immediate) {
      if (onChanged.isObserved) {
        observe(activity)
      }
    }

    return WindowInfoTracker
      .getOrCreate(activity)
      .windowLayoutInfo(activity)
      .first()
      .toReservedRegionRecords(activity)
  }

  override fun onDestroy() {
    scope.cancel()
    collectionJob = null
    observedActivity = null
    if (lifecycleRegistered) {
      reactContextOrNull?.removeLifecycleEventListener(lifecycleListener)
      lifecycleRegistered = false
    }
  }

  private fun startObserving() {
    val reactContext = reactContextOrNull
    if (reactContext != null && !lifecycleRegistered) {
      reactContext.addLifecycleEventListener(lifecycleListener)
      lifecycleRegistered = true
    }
    currentActivity?.let(::observe)
  }

  private fun observe(activity: Activity) {
    if (observedActivity === activity && collectionJob?.isActive == true) {
      return
    }

    collectionJob?.cancel()
    observedActivity = activity
    collectionJob = scope.launch {
      WindowInfoTracker
        .getOrCreate(activity)
        .windowLayoutInfo(activity)
        .map { it.toReservedRegionRecords(activity) }
        .distinctUntilChanged()
        .collect { onChanged.emit(it) }
    }
  }

  private fun pauseCollection() {
    collectionJob?.cancel()
    collectionJob = null
    observedActivity = null
  }

  private fun stopObserving() {
    pauseCollection()
    if (lifecycleRegistered) {
      reactContextOrNull?.removeLifecycleEventListener(lifecycleListener)
      lifecycleRegistered = false
    }
  }
}
