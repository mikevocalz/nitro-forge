package com.margelo.nitro.forgebluetooth.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Intent
import android.provider.Settings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.forgebluetooth.HybridForgeBluetoothSpec
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * First-party Android BLE central; shares no Nitro v0 code.
 * ONLY a GATT link. No Logitech Muse vendor-specific bytes, pressure or 6DoF.
 * Requires OS Bluetooth permissions requested by the React Native host first.
 *
 * Never connects to a caller-supplied arbitrary address: connect accepts
 * ONLY devices actually received from the latest foreground scan.
 */
@SuppressLint("MissingPermission")
class HybridForgeBluetooth : HybridForgeBluetoothSpec() {
  companion object : HybridForgeBluetoothSpec.Companion {
    override val isAvailable: Boolean
      get() = try {
        val context = NitroModules.applicationContext
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          context?.packageManager?.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) == true
      } catch (_: Throwable) { false }

    /** Hardware safety bound; JS scanDurationMs is capped at the same 30 s. */
    private const val MAX_SCAN_DURATION_MS = 30_000L
    private const val CONNECT_TIMEOUT_MS = 15_000L
    /** Devices kept per scan; JS shows the same count. */
    private const val MAX_DEVICES = 50
  }

  private data class Seen(val device: BluetoothDevice, val name: String, val rssi: Int)
  private val lock = Any()
  private val discovered = ConcurrentHashMap<String, Seen>()
  private val main = Handler(Looper.getMainLooper())
  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var scanAutoStop: Runnable? = null
  private var link: BluetoothGatt? = null
  private var pending: GattConnectAttempt? = null
  @Volatile private var linked = false
  @Volatile private var scanFailure: String? = null
  @Volatile private var disposed = false

  private fun context(): Context =
    NitroModules.applicationContext ?: throw IllegalStateException("React application context unavailable")
  private fun adapter(): BluetoothAdapter =
    (context().getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      ?: throw UnsupportedOperationException("No Bluetooth adapter")
  private fun permissionNeeded(scan: Boolean): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (scan) Manifest.permission.BLUETOOTH_SCAN else Manifest.permission.BLUETOOTH_CONNECT
    } else {
      if (scan) Manifest.permission.ACCESS_FINE_LOCATION else Manifest.permission.BLUETOOTH
    }
  private fun requirePermission(scan: Boolean) {
    val permission = permissionNeeded(scan)
    check(context().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
      "Bluetooth permission missing: " + permission + ". Request from user before native access."
    }
  }

  override fun openBluetoothSettings() {
    val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context().startActivity(intent)
  }

  override fun isEnabled(): Boolean {
    if (!isAvailable) return false
    requirePermission(false)
    return adapter().isEnabled
  }

  override fun startScan() {
    check(!disposed) { "ForgeBluetooth has been disposed" }
    requirePermission(true)
    requirePermission(false)
    BleScanLocationRequirement.requireSatisfied(context())
    val bt = adapter()
    check(bt.isEnabled) { "Bluetooth is disabled; turn it on in system Settings" }
    stopScan()
    discovered.clear()
    scanFailure = null
    val current = bt.bluetoothLeScanner ?: throw IllegalStateException("BLE scanner unavailable")
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        if (disposed) return
        val device = result.device
        // device.name is the cached remote name and needs BLUETOOTH_CONNECT on
        // API 31+ (checked in startScan). Devices not yet name-resolved still
        // carry the advertised local name in the scan record, which needs no
        // extra permission.
        val cachedName = try { device.name } catch (_: SecurityException) { null }
        val name = cachedName?.takeIf { it.isNotBlank() } ?: result.scanRecord?.deviceName
        if (name.isNullOrBlank()) return
        val id = device.address
        if (id.isNotBlank()) remember(id, Seen(device, name, result.rssi))
      }
      override fun onScanFailed(errorCode: Int) {
        scanFailure = "Android Bluetooth scan failed, code " + errorCode
      }
    }
    // LOW_LATENCY has no OS-side duration. If JS reloads or never calls
    // stopScan, this bounds the radio's high-duty scanning.
    val autoStop = Runnable { stopScanIfCurrent(callback) }
    synchronized(lock) {
      scanner = current
      scanCallback = callback
      scanAutoStop = autoStop
    }
    current.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
    main.postDelayed(autoStop, MAX_SCAN_DURATION_MS)
  }

  override fun stopScan() {
    stopScanIfCurrent(null)
  }

  /** Stops the active scan; with [expected], only if that scan is still the active one. */
  private fun stopScanIfCurrent(expected: ScanCallback?) {
    val previous: Pair<BluetoothLeScanner, ScanCallback>? = synchronized(lock) {
      val scannerNow = scanner
      val callbackNow = scanCallback
      if (expected != null && callbackNow !== expected) return
      scanAutoStop?.let { main.removeCallbacks(it) }
      scanAutoStop = null
      scanner = null
      scanCallback = null
      if (scannerNow != null && callbackNow != null) Pair(scannerNow, callbackNow) else null
    }
    if (previous != null) {
      try { if (context().checkSelfPermission(permissionNeeded(true)) == PackageManager.PERMISSION_GRANTED) previous.first.stopScan(previous.second) }
      catch (_: SecurityException) { /* permission revoked while scanning */ }
    }
  }

  /**
   * Keeps at most [MAX_DEVICES] devices. When full, a stronger new device
   * replaces the weakest one, so in a room with many advertisers the pen
   * held next to the phone is not dropped for arriving after the 50th.
   */
  private fun remember(id: String, seen: Seen) {
    synchronized(discovered) {
      if (discovered.containsKey(id) || discovered.size < MAX_DEVICES) {
        discovered[id] = seen
        return
      }
      val weakest = discovered.entries.minByOrNull { it.value.rssi } ?: return
      if (seen.rssi > weakest.value.rssi) {
        discovered.remove(weakest.key)
        discovered[id] = seen
      }
    }
  }

  /** Strongest signal first, so the nearest device leads the list. */
  override fun getDevicesJson(): String {
    val array = JSONArray()
    val ordered = synchronized(discovered) {
      discovered.entries.map { it.key to it.value }.sortedByDescending { it.second.rssi }
    }
    for ((id, seen) in ordered) {
      array.put(JSONObject().put("id", id).put("name", seen.name).put("rssi", seen.rssi))
    }
    return array.toString()
  }

  override fun getScanError(): String = scanFailure ?: ""

  override fun connect(deviceId: String): Promise<Boolean> {
    check(!disposed) { "ForgeBluetooth has been disposed" }
    requirePermission(false)
    val seen = discovered[deviceId]
      ?: return Promise.rejected(IllegalArgumentException("Connect only to a device returned by the last BLE scan"))
    cancelPendingConnect(IllegalStateException("BLE connect superseded by a newer connect"))
    disconnect()
    // Manual Promise: settled from BluetoothGattCallback or the timeout, both
    // of which are native callbacks that cannot be expressed as a suspend call.
    val promise = Promise<Boolean>()
    val attempt = GattConnectAttempt(promise)
    attempt.timeout = Runnable { onConnectTimeout(attempt) }
    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
          onGattConnected(attempt, gatt)
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
          onGattDisconnected(attempt, gatt, status)
        }
      }
    }
    synchronized(lock) { pending = attempt }
    try {
      val created = seen.device.connectGatt(context(), false, callback, BluetoothDevice.TRANSPORT_LE)
        ?: throw IllegalStateException("Bluetooth connectGatt returned null")
      val stillCurrent = synchronized(lock) {
        if (pending === attempt) {
          attempt.gatt = created
          link = created
          true
        } else false
      }
      if (!stillCurrent) {
        // Superseded while connectGatt ran; the attempt is already rejected.
        created.close()
        return promise
      }
      main.postDelayed(attempt.timeout, CONNECT_TIMEOUT_MS)
    } catch (error: Exception) {
      synchronized(lock) { if (pending === attempt) pending = null }
      attempt.reject(error)
    }
    return promise
  }

  private fun onGattConnected(attempt: GattConnectAttempt, gatt: BluetoothGatt) {
    val current = synchronized(lock) {
      if (pending === attempt && link === gatt) {
        pending = null
        linked = true
        true
      } else false
    }
    if (!current) return
    main.removeCallbacks(attempt.timeout)
    attempt.resolve()
  }

  private fun onGattDisconnected(attempt: GattConnectAttempt, gatt: BluetoothGatt, status: Int) {
    synchronized(lock) {
      if (link === gatt) {
        link = null
        linked = false
      }
      if (pending === attempt) pending = null
    }
    main.removeCallbacks(attempt.timeout)
    attempt.reject(IllegalStateException("Bluetooth GATT connection failed, status " + status))
    gatt.close()
  }

  private fun onConnectTimeout(attempt: GattConnectAttempt) {
    val gatt = synchronized(lock) {
      // A superseded or settled attempt no longer owns any shared state.
      if (pending !== attempt) return
      pending = null
      val own = attempt.gatt
      if (own != null && link === own) {
        link = null
        linked = false
      }
      own
    }
    attempt.reject(IllegalStateException("BLE connection timed out"))
    gatt?.close()
  }

  /** Settles an in-flight connect without touching any GATT handle; disconnect() closes the link. */
  private fun cancelPendingConnect(reason: Throwable) {
    val previous = synchronized(lock) { val current = pending; pending = null; current }
    if (previous != null) {
      main.removeCallbacks(previous.timeout)
      previous.reject(reason)
    }
  }

  override fun disconnect() {
    stopScan()
    cancelPendingConnect(IllegalStateException("BLE connect cancelled by disconnect"))
    val old = synchronized(lock) { val current = link; link = null; linked = false; current }
    if (old != null) {
      try { if (context().checkSelfPermission(permissionNeeded(false)) == PackageManager.PERMISSION_GRANTED) old.disconnect() }
      catch (_: SecurityException) {}
      old.close()
    }
  }

  override fun isConnected(): Boolean = linked && !disposed

  override fun dispose() {
    if (disposed) return
    disposed = true
    disconnect()
    discovered.clear()
    super.dispose()
  }
}
