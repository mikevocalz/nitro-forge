package com.margelo.nitro.forgebluetooth.ble

import android.bluetooth.BluetoothGatt
import com.margelo.nitro.core.Promise
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One connect(deviceId) call. Owns its Promise, its timeout and the GATT
 * handle that call created, so a stale timeout or callback can only ever act
 * on its own handle, never on a newer connect's link.
 */
internal class GattConnectAttempt(private val promise: Promise<Boolean>) {
  private val settled = AtomicBoolean(false)

  /** Assigned under the owner's lock once connectGatt returns. */
  var gatt: BluetoothGatt? = null

  /** Posted on the main Handler; removed when the attempt settles. */
  lateinit var timeout: Runnable

  /** Resolves once. Returns false if the attempt was already settled. */
  fun resolve(): Boolean {
    if (!settled.compareAndSet(false, true)) return false
    promise.resolve(true)
    return true
  }

  /** Rejects once. Returns false if the attempt was already settled. */
  fun reject(error: Throwable): Boolean {
    if (!settled.compareAndSet(false, true)) return false
    promise.reject(error)
    return true
  }
}
