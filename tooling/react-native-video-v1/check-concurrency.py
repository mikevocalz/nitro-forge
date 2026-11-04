#!/usr/bin/env python3
"""Portable source-contract regressions for the bounded Swift concurrency patch.

These checks and their mutation tests validate source structure, NOT Swift
typechecking, runtime thread safety, or Apple SDK compatibility. Run the native
build and Thread Sanitizer before enabling playback.

Usage: python3 video-concurrency-check.py /path/to/packages/react-native-video
"""

from pathlib import Path
import re
import sys


def uncomment(source):
    return re.sub(r"//[^\n]*|/\*.*?\*/", "", source, flags=re.S)


def body(source, marker):
    """Extract one balanced Swift brace body (these targets contain no brace strings)."""
    start = source.index("{", source.index(marker))
    depth = 0
    for end in range(start, len(source)):
        depth += (source[end] == "{") - (source[end] == "}")
        if depth == 0:
            return source[start + 1:end]
    raise AssertionError(f"Unbalanced body for {marker}")


def compact(source):
    return re.sub(r"\s+", " ", source).strip()


def check_registry(source):
    source = uncomment(source)
    assert "@unchecked Sendable" not in source, "Plugin callbacks are not proven Sendable"
    assert "nonisolated(unsafe)" not in source, "Do not suppress singleton diagnostics"
    assert "private let lock = NSLock()" in source
    assert "private var plugins:" in source
    locking = compact(body(source, "private func withLock<T>"))
    assert locking == "lock.lock() defer { lock.unlock() } return operation()"
    assert compact(body(source, "private func snapshot()")) == "withLock { Array(plugins.values) }"

    for method, old, operation in [
        ("register", "previous", "plugins.updateValue(plugin, forKey: id)"),
        ("unregister", "removed", "plugins.removeValue(forKey: id)"),
    ]:
        implementation = body(source, f"public func {method}(")
        assert compact(body(implementation, "withLock")) == operation
        assert f"let {old} = withLock" in implementation
        assert implementation.index("let id = plugin.id") < implementation.index("withLock")
        assert implementation.index(f"withExtendedLifetime({old})") > implementation.index("withLock")

    # All dictionary access sites are accounted for: no unlocked lookups/iterators.
    accesses = re.findall(r"\bplugins\s*([.\[])", source)
    assert accesses == [".", ".", "."], "Unexpected registry access outside guarded operations"
    assert "hasPlugin(" not in source, "Do not split membership check from mutation"

    for method in [
        "getDrmManager", "overrideSource", "notifyPlayerCreated",
        "notifyPlayerDestroyed", "notifyVideoViewCreated", "notifyVideoViewDestroyed",
    ]:
        implementation = body(source, f"func {method}(")
        assert "for plugin in snapshot() {" in implementation, method
        assert "withLock" not in implementation, f"Callback or await under lock: {method}"
    assert source.count("for plugin in snapshot() {") == 6
    assert "await plugin.overrideSource(source: overriddenSource)" in source


def check_callbacks(source):
    source = uncomment(source)
    handler = source.split("playbackPositionTarget =", 1)[1].split("togglePlayPauseTarget =", 1)[0]
    assert handler.index("let positionTime =") < handler.index("runOnMainThreadSync")
    dispatched = body(handler, "runOnMainThreadSync")
    assert not re.search(r"\bevent\b", dispatched), "Do not send MPRemoteCommandEvent across queues"
    assert "CMTime(seconds: positionTime," in dispatched

    artwork = body(source, "Task { [weak self, weak player, weak currentItem]")
    main = body(artwork, "await MainActor.run")
    assert "UIImage(data: data)" in main
    assert "MPMediaItemArtwork(boundsSize: image.size)" in main
    assert "UIImage(data: data)" not in artwork.split("await MainActor.run", 1)[0]
    assert "MPMediaItemArtwork(" not in artwork.split("await MainActor.run", 1)[0]
    assert "guard let self, let player, let currentItem," in main
    assert "self.currentPlayer === player" in main
    assert "self.currentPlayer?.currentItem === currentItem" in main
    assert main.index("self.currentPlayer === player") < main.index("UIImage(data: data)")


def rejected(check, original, old, new, label):
    assert old in original, f"Invalid mutation fixture: {label}"
    mutated = original.replace(old, new, 1)
    try:
        check(mutated)
    except (AssertionError, ValueError):
        return
    raise AssertionError(f"Regression escaped the source checks: {label}")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1]).resolve()
    registry = (root / "ios/core/Plugins/PluginsRegistry.swift").read_text()
    callbacks = (root / "ios/core/NowPlayingInfoCenterManager.swift").read_text()
    check_registry(registry)
    check_callbacks(callbacks)
    print("PASS: lock-protected membership, six callback snapshots, unlocked getters and disposal.")
    print("PASS: scalar remote-position capture and main-actor artwork construction.")

    mutations = [
        (check_callbacks, callbacks, "guard let self, let player, let currentItem,", "guard let self,", "nil weak references pass identity after cleanup"),
        (check_registry, registry, "lock.lock()", "", "missing lock acquisition"),
        (check_registry, registry, "defer { lock.unlock() }", "", "missing deferred unlock"),
        (check_registry, registry, "withLock { plugins.updateValue(plugin, forKey: id) }", "plugins.updateValue(plugin, forKey: id)", "unlocked registration"),
        (check_registry, registry, "withLock { plugins.removeValue(forKey: id) }", "plugins.removeValue(forKey: id)", "unlocked removal"),
        (check_registry, registry, "withLock { Array(plugins.values) }", "Array(plugins.values)", "unlocked snapshot"),
        (check_registry, registry, "for plugin in snapshot() {", "for plugin in plugins.values {", "live callback iteration"),
        (check_registry, registry, "forKey: id) }", "forKey: plugin.id) }", "user getter inside lock"),
        (check_registry, registry, "withExtendedLifetime(previous) {}", "", "replaced plugin release under lock"),
        (check_registry, registry, "withExtendedLifetime(removed) {}", "", "removed plugin release under lock"),
        (check_registry, registry, "public final class PluginsRegistry {", "public final class PluginsRegistry: @unchecked Sendable {", "unproven Sendable conformance"),
        (check_callbacks, callbacks, "CMTime(seconds: positionTime,", "CMTime(seconds: event.positionTime,", "event object captured by dispatch"),
        (check_callbacks, callbacks, "self.currentPlayer === player", "true", "stale-player artwork overwrite"),
        (check_callbacks, callbacks, "self.currentPlayer?.currentItem === currentItem", "true", "stale-item artwork overwrite"),
        (check_callbacks, callbacks, "await MainActor.run {", "let leakedImage = UIImage(data: data)\n      await MainActor.run {", "UIKit image crosses actor boundary"),
    ]
    for args in mutations:
        rejected(*args)
    print(f"PASS: all {len(mutations)} deliberate regression mutations were detected.")
    print("SOURCE CHECKS ONLY. All three singleton isolation diagnostics and native Swift/Xcode validation remain open.")


if __name__ == "__main__":
    main()
