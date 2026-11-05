#pragma once

#include <winrt/Microsoft.ReactNative.h>

namespace nitroforge::windows {

// Call once from the host's existing IReactPackageProvider::CreatePackage.
void RegisterForgeWindows(winrt::Microsoft::ReactNative::IReactPackageBuilder const& builder) noexcept;

} // namespace nitroforge::windows
