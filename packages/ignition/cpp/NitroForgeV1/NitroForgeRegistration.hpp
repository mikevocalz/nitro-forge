#pragma once

namespace nitroforge::native {

/**
 * Registers the generated Forge classes once for this process.
 * Call before evaluating an app bundle, after the host has installed its single
 * matching Nitro runtime and real JavaScript dispatcher. This does not install
 * a runtime, dispatcher, UI toolkit, or another copy of Nitro core.
 */
void registerNitroForgeClasses();

} // namespace nitroforge::native
