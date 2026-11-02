import type { SystemSpatialPenPort } from "./types";

/** Apple Vision Pro's documented pairing: no app-owned BLE scan or GATT. */
export const visionOSMusePort: SystemSpatialPenPort = {
  mode: "system-spatial",
  deviceName: "Logitech Muse",
  pairingInstructions: [
    "Hold the Muse top and primary button for three seconds until the indicator blinks.",
    "Open Apple Vision Pro Settings, then Bluetooth.",
    "Choose Logitech Muse and complete the system pairing prompt.",
    "Return to the drawing app. Native Muse tracking will confirm readiness.",
  ],
};
