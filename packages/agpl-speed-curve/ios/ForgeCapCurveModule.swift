// SPDX-License-Identifier: AGPL-3.0-or-later
// CapCraft SpeedCurveEditor.kt-derived behavior, modified Nitro Forge 2026-11-03.
// Upstream © 2026 ArtCraft Team and CapCraft contributors; see ../NOTICE.md.
import Foundation
import ExpoModulesCore

@ExpoModule("ForgeCapCurve")
public class ForgeCapCurveModule: Module {
  @JS(.concurrent)
  func meanSpeedAsync(_ positions: [Double], speeds: [Double]) async throws -> Double {
    try CurveMath.average(positions, speeds)
  }

  @JS(.concurrent)
  func sampleSpeedsAsync(_ positions: [Double], speeds: [Double], bins: Int) async throws -> [Double] {
    try CurveMath.sample(positions, speeds, bins)
  }
}

private enum CurveMath {
  enum Problem: Error {
    case malformed
    case invalidBins
  }

  static func validate(_ positions: [Double], _ speeds: [Double]) throws {
    guard positions.count >= 2, positions.count <= 4096,
          positions.count == speeds.count,
          positions.first == 0, positions.last == 1 else {
      throw Problem.malformed
    }
    var prior = -1.0
    for index in positions.indices {
      let at = positions[index]
      let speed = speeds[index]
      guard at.isFinite, at >= 0, at <= 1, at > prior,
            speed.isFinite, speed >= 0.1, speed <= 10 else {
        throw Problem.malformed
      }
      prior = at
    }
  }

  static func average(_ positions: [Double], _ speeds: [Double]) throws -> Double {
    try validate(positions, speeds)
    var area = 0.0
    for index in 1..<positions.count {
      area += (positions[index] - positions[index - 1]) *
        (speeds[index - 1] + speeds[index]) / 2.0
    }
    return area
  }

  static func sample(_ positions: [Double], _ speeds: [Double], _ bins: Int) throws -> [Double] {
    try validate(positions, speeds)
    guard bins >= 2 && bins <= 4096 else { throw Problem.invalidBins }
    var segment = 0
    return (0..<bins).map { i in
      let at = Double(i) / Double(bins - 1)
      while segment + 2 < positions.count && at > positions[segment + 1] {
        segment += 1
      }
      let fraction = (at - positions[segment]) /
        (positions[segment + 1] - positions[segment])
      return speeds[segment] + (speeds[segment + 1] - speeds[segment]) * fraction
    }
  }
}
