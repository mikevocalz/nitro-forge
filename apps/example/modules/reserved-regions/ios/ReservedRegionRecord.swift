// One reserved region as the record JS receives. The frame is in the key root
// view's coordinate space, the one React Native's window dimensions describe.
// UIKit regions carry no orientation, state, occlusionType or separating; those
// stay absent, as reserved-regions.types.ts declares.
import ExpoModulesCore

@Record
struct ReservedRegionRecord {
  var kind: String
  var x: Double
  var y: Double
  var width: Double
  var height: Double
  var margins: ReservedRegionMargins
  var active: Bool
}
