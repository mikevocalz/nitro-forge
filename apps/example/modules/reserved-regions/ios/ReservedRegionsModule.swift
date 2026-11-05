// iOS side of @acme/ui's useReservedRegions(), ported from nyc-mon
// apps/mobile/modules/reserved-regions.
//
// iOS 27.1 exposes where a fold divides the window and where the camera
// occludes it as `UIView.reservedRegions(kind:options:)`. UIKit publishes no
// change notification for them, so this is a query and nothing more; the kit
// re-queries when the window resizes, which every fold and unfold does, and
// does not subscribe to "changed" on iOS.
//
// SDK gate: SDKs before 27.1 do not declare UIView.ReservedRegion, and an
// @available check cannot rescue a compile-time reference to a missing type.
// `canImport(UIKit, _version:)` reads the SDK's UIKit module version (27.1 ships
// 9127.0.85), so the gate works the same under CocoaPods and SwiftPM. nyc-mon
// gates through a podspec xcconfig, which Expo's SwiftPM plugin never reads.
import ExpoModulesCore
import UIKit

@ExpoModule("ReservedRegions")
public final class ReservedRegionsModule: Module {
  // Main actor because UIKit views are read here. Inactive regions are kept on
  // purpose: a flat device reports its fold at zero width but still says where
  // it runs, which a layout wants before the next fold.
  @JS
  @MainActor
  func query() async -> [ReservedRegionRecord] {
#if canImport(UIKit, _version: 9127.0.85)
    guard #available(iOS 27.1, *), let view = UIWindow.keyRootView else { return [] }
    let regions =
      view.reservedRegions(kind: .division, options: [.includeInactive])
      + view.reservedRegions(kind: .occlusion, options: [.includeInactive])
    return regions.map { ReservedRegionRecord(region: $0) }
#else
    return []
#endif
  }
}
