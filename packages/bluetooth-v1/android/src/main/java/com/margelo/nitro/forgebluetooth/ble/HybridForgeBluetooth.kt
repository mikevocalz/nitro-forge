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
import java.util.concurrent.atomic.AtomicBoolean

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
  }

  private data class Seen(val device: BluetoothDevice, val name: String, val rssi: Int)
  private val lock = Any()
  private val discovered = ConcurrentHashMap<String, Seen>()
  private val main = Handler(Looper.getMainLooper())
  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var link: BluetoothGatt? = null
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
        val name = try { device.name } catch (_: SecurityException) { null }
        if (name.isNullOrBlank()) return
        val id = device.address
        if (id.isNotBlank() && discovered.size < 50) discovered[id] = Seen(device, name, result.rssi)
      }
      override fun onScanFailed(errorCode: Int) {
        scanFailure = "Android Bluetooth scan failed, code " + errorCode
      }
    }
    synchronized(lock) {
      scanner = current
      scanCallback = callback
    }
    current.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
  }

  override fun stopScan() {
    val previous: Pair<BluetoothLeScanner, ScanCallback>? = synchronized(lock) {
      val scannerNow = scanner
      val callbackNow = scanCallback
      scanner = null
      scanCallback = null
      if (scannerNow != null && callbackNow != null) Pair(scannerNow, callbackNow) else null
    }
    if (previous != null) {
      try { if (context().checkSelfPermission(permissionNeeded(true)) == PackageManager.PERMISSION_GRANTED) previous.first.stopScan(previous.second) }
      catch (_: SecurityException) { /* permission revoked while scanning */ }
    }
  }

  override fun getDevicesJson(): String {
    val array = JSONArray()
    for ((id, seen) in discovered.entries.sortedBy { it.key }.take(50)) {
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
    stopScan()
    disconnect()
    return Promise.async { resolve, reject ->
      val settled = AtomicBoolean(false)
      val timeout = Runnable {
        if (settled.compareAndSet(false, true)) {
          linked = false
          synchronized(lock) { link?.close(); link = null }
          reject(IllegalStateException("BLE connection timed out"))
        }
      }
      val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
          if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
            if (settled.compareAndSet(false, true)) {
              main.removeCallbacks(timeout)
              linked = true
              resolve(true)
            }
          } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
            linked = false
            if (settled.compareAndSet(false, true)) {
              main.removeCallbacks(timeout)
              reject(IllegalStateException("Bluetooth GATT connection failed, status " + status))
            }
            synchronized(lock) {
              if (link === gatt) link = null
              gatt.close()
            }
          }
        }
      }
      try {
        val currentGatt = seen.device.connectGatt(context(), false, callback, BluetoothDevice.TRANSPORT_LE)
          ?: throw IllegalStateException("Bluetooth connectGatt returned null")
        synchronized(lock) { link = currentGatt }
        main.postDelayed(timeout, 15000L)
      } catch (error: Exception) {
        if (settled.compareAndSet(false, true)) reject(error)
      }
    }
  }

  override fun disconnect() {
    stopScan()
    linked = false
    val old = synchronized(lock) { val current = link; link = null; current }
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
