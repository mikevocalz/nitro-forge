package com.margelo.nitro.forgebluetooth.ble

import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.provider.Settings

/**
 * On Android 11 (API 30) and lower, BLE scans return no results while the
 * system Location setting is off, even with ACCESS_FINE_LOCATION granted.
 * From API 31, BLUETOOTH_SCAN with neverForLocation removes that coupling.
 */
internal object BleScanLocationRequirement {
  fun requireSatisfied(context: Context) {
    if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) return
    check(isLocationEnabled(context)) {
      "Location services are off. Android 11 and lower return no Bluetooth scan results until Location is turned on in system Settings."
    }
  }

  private fun isLocationEnabled(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ?: return false
      return manager.isLocationEnabled
    }
    @Suppress("DEPRECATION")
    val mode = Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF)
    @Suppress("DEPRECATION")
    return mode != Settings.Secure.LOCATION_MODE_OFF
  }
}
