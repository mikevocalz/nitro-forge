// SPDX-License-Identifier: AGPL-3.0-or-later
// CapCraft SpeedCurveEditor.kt-derived behavior, modified Nitro Forge 2026-11-03.
// Upstream © 2026 ArtCraft Team and CapCraft contributors; see NOTICE.md.
package com.nitroforge.capcurve

import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.Module
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@ExpoModule("ForgeCapCurve")
class ForgeCapCurveModule : Module() {
  @JS
  suspend fun meanSpeedAsync(positions: List<Double>, speeds: List<Double>): Double =
    withContext(Dispatchers.Default) { CurveMath.average(positions, speeds) }

  @JS
  suspend fun sampleSpeedsAsync(
    positions: List<Double>,
    speeds: List<Double>,
    bins: Int
  ): List<Double> =
    withContext(Dispatchers.Default) { CurveMath.sample(positions, speeds, bins) }
}

private object CurveMath {
  private fun validate(positions: List<Double>, speeds: List<Double>) {
    require(positions.size in 2..4096 && positions.size == speeds.size) {
      "Expected equal-length arrays with 2..4096 points"
    }
    require(positions.first() == 0.0 && positions.last() == 1.0) {
      "Curve must start at 0 and end at 1"
    }
    var prior = -1.0
    for (i in positions.indices) {
      val at = positions[i]
      val speed = speeds[i]
      require(at.isFinite() && at in 0.0..1.0 && at > prior &&
        speed.isFinite() && speed in 0.1..10.0) {
        "Curve has invalid or out-of-order points"
      }
      prior = at
    }
  }

  fun average(positions: List<Double>, speeds: List<Double>): Double {
    validate(positions, speeds)
    var area = 0.0
    for (index in 1 until positions.size) {
      area += (positions[index] - positions[index - 1]) *
        (speeds[index - 1] + speeds[index]) / 2.0
    }
    return area
  }

  fun sample(positions: List<Double>, speeds: List<Double>, bins: Int): List<Double> {
    validate(positions, speeds)
    require(bins in 2..4096) { "bins must be within 2..4096" }
    var segment = 0
    return List(bins) { i ->
      val at = i.toDouble() / (bins - 1)
      while (segment + 2 < positions.size && at > positions[segment + 1]) {
        segment++
      }
      val fraction = (at - positions[segment]) /
        (positions[segment + 1] - positions[segment])
      speeds[segment] +
        (speeds[segment + 1] - speeds[segment]) * fraction
    }
  }
}
