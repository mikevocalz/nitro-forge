/**
 * Transport-agnostic pairing states for `DevicePairingDialog`. The app's
 * Bluetooth, USB or network controller owns discovery and connection and maps
 * its own state onto this union. No radio code lives here.
 */

/** A device found during a scan. */
export interface PairingDevice {
  /** Stable id passed back to `onSelect`. */
  readonly id: string;
  /** Name shown to the user. */
  readonly name: string;
  /** Secondary line, e.g. model or "Paired before". */
  readonly detail?: string;
  /** Received signal strength in dBm, when the transport reports one. */
  readonly signalDbm?: number;
}

/** Why pairing failed. Each code gets its own copy and recovery action. */
export type PairingErrorCode = "permission-denied" | "radio-off" | "connection-failed" | "unknown";

/**
 * State shown by `DevicePairingDialog`.
 *
 * - `system-pairing`: the operating system owns pairing (for example visionOS
 *   accessories pair in Settings). `steps` are the host's instructions, shown
 *   in order. The dialog cannot see progress, so it shows no spinner; the
 *   host moves on to `awaiting-input`, `connected` or `error` when the OS
 *   reports back. `message` replaces the default body.
 * - `awaiting-input`: the transport link is up but the app has not yet seen
 *   input from the device (for a pen, a stroke or tap). It never reads as
 *   connected. `message` replaces the default body.
 */
export type PairingState =
  | { readonly kind: "idle" }
  | { readonly kind: "scanning"; readonly devices?: readonly PairingDevice[] }
  | { readonly kind: "found"; readonly devices: readonly PairingDevice[] }
  | { readonly kind: "system-pairing"; readonly steps: readonly string[]; readonly message?: string }
  | { readonly kind: "connecting"; readonly device: PairingDevice }
  | { readonly kind: "awaiting-input"; readonly device: PairingDevice; readonly message?: string }
  | { readonly kind: "connected"; readonly device: PairingDevice }
  | { readonly kind: "error"; readonly code: PairingErrorCode; readonly message?: string };

/**
 * Callback a dialog button calls. `cancel` stops the running search or
 * connection attempt (`onStopSearch`); it never closes the dialog.
 */
export type PairingAction = "scan" | "rescan" | "cancel" | "retry" | "open-settings" | "done";

/** Text and actions for one {@linkcode PairingState}. */
export interface PairingPresentation {
  readonly body: string;
  readonly primary?: { readonly kind: PairingAction; readonly label: string };
  readonly secondary?: { readonly kind: PairingAction; readonly label: string };
  readonly isBusy: boolean;
  readonly isProblem: boolean;
  /** Devices to list, possibly empty. `undefined` hides the list. */
  readonly devices?: readonly PairingDevice[];
  /** Ordered host instructions for `system-pairing`. `undefined` hides the list. */
  readonly steps?: readonly string[];
  /**
   * True while a device link exists (`awaiting-input`, `connected`). Closing
   * then must not disconnect, so the dialog routes close to `onClose`/`onDone`
   * and never to the stop or legacy cancel callback.
   */
  readonly isLinked: boolean;
}

/** Spoken signal quality for a dBm reading. */
export function signalLabel(signalDbm: number): string {
  if (!Number.isFinite(signalDbm)) throw new RangeError("signalDbm must be finite");
  if (signalDbm >= -60) return "Strong signal";
  if (signalDbm >= -75) return "Fair signal";
  return "Weak signal";
}

/**
 * Maps a state to copy and actions.
 * @param deviceNoun Lowercase noun for the device class, e.g. "pen" or "headset".
 * @param canOpenSettings Pass true when the app supplied an open-settings handler.
 */
export function presentPairing(state: PairingState, deviceNoun: string, canOpenSettings: boolean): PairingPresentation {
  const settings = canOpenSettings
    ? { kind: "open-settings" as const, label: "Open Settings" } : undefined;
  const unlinked = { isLinked: false } as const;
  switch (state.kind) {
    case "idle":
      return { body: "Turn on your " + deviceNoun + " and put it in pairing mode, then search.", primary: { kind: "scan", label: "Search for devices" }, isBusy: false, isProblem: false, ...unlinked };
    case "scanning":
      return {
        body: "Searching for nearby devices…",
        secondary: { kind: "cancel", label: "Stop searching" },
        isBusy: true, isProblem: false, ...unlinked,
        ...(state.devices?.length ? { devices: state.devices } : {}),
      };
    case "found":
      return state.devices.length
        ? { body: "Choose your " + deviceNoun + ".", secondary: { kind: "rescan", label: "Search again" }, isBusy: false, isProblem: false, devices: state.devices, ...unlinked }
        : { body: "No " + deviceNoun + " found. Check that it is on, charged and in pairing mode.", primary: { kind: "rescan", label: "Search again" }, isBusy: false, isProblem: false, devices: [], ...unlinked };
    case "system-pairing":
      return {
        body: state.message ?? "Finish pairing your " + deviceNoun + " in Settings. This window updates when it's done.",
        ...(settings ? { primary: settings } : {}),
        isBusy: false, isProblem: false, ...unlinked,
        ...(state.steps.length ? { steps: state.steps } : {}),
      };
    case "connecting":
      return { body: "Connecting to " + state.device.name + "…", secondary: { kind: "cancel", label: "Cancel" }, isBusy: true, isProblem: false, ...unlinked };
    case "awaiting-input":
      // Deliberately no "connected" wording: the link is up, input is not proven.
      return {
        body: state.message ?? "Linked to " + state.device.name + ". Use your " + deviceNoun + " once so this app can check it's working.",
        isBusy: true, isProblem: false, isLinked: true,
      };
    case "connected":
      return { body: "Connected to " + state.device.name + ".", primary: { kind: "done", label: "Done" }, isBusy: false, isProblem: false, isLinked: true };
    case "error":
      switch (state.code) {
        case "permission-denied":
          return {
            body: state.message ?? "Nearby device access is off. Allow it in Settings to find your " + deviceNoun + ".",
            primary: settings ?? { kind: "retry", label: "Ask again" },
            ...(settings ? { secondary: { kind: "retry" as const, label: "Ask again" } } : {}),
            isBusy: false, isProblem: true, ...unlinked,
          };
        case "radio-off":
          return {
            body: state.message ?? "Bluetooth is off. Turn it on, then try again.",
            primary: { kind: "retry", label: "Try again" },
            ...(settings ? { secondary: settings } : {}),
            isBusy: false, isProblem: true, ...unlinked,
          };
        case "connection-failed":
          return { body: state.message ?? "Couldn't connect. Move the " + deviceNoun + " closer and try again.", primary: { kind: "retry", label: "Try again" }, isBusy: false, isProblem: true, ...unlinked };
        case "unknown":
          return { body: state.message ?? "Something went wrong while pairing.", primary: { kind: "retry", label: "Try again" }, isBusy: false, isProblem: true, ...unlinked };
      }
  }
}
