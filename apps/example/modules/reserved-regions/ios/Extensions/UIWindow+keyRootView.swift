// The key window's root view: the coordinate space React Native's window
// dimensions describe, and the view whose reserved regions matter to layout.
import UIKit

extension UIWindow {
  @MainActor
  static var keyRootView: UIView? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?
      .rootViewController?.view
  }
}
