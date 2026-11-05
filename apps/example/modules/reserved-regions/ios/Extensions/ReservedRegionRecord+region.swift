// UIView.ReservedRegion -> the JS record. Same SDK gate as the module.
import UIKit

#if canImport(UIKit, _version: 9127.0.85)
@available(iOS 27.1, *)
extension ReservedRegionRecord {
  init(region: UIView.ReservedRegion) {
    self.init(
      kind: region.kind == .division ? "division" : "occlusion",
      x: region.frame.origin.x,
      y: region.frame.origin.y,
      width: region.frame.size.width,
      height: region.frame.size.height,
      margins: ReservedRegionMargins(insets: region.margins),
      active: region.isActive
    )
  }
}
#endif
