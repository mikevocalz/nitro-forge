import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { useStatusAnnouncement } from "@nyc-tron/ui/components/feedback/announce";
import {
  presentPairing, signalLabel, type PairingAction, type PairingDevice, type PairingState,
} from "./pairing-model.ts";
import { controlTokens, tokens } from "../tokens.ts";

/**
 * Coarse phase handed to {@linkcode DevicePairingDialogProps.renderStatusArt}.
 * `system-pairing` and `awaiting-input` map to `connecting`: only a verified
 * link may show `connected` art. The second argument carries the full state
 * for hosts that draw those two differently.
 */
export type PairingArtPhase = "idle" | "searching" | "connecting" | "connected" | "error";

/** Props for {@linkcode DevicePairingDialog}. */
export interface DevicePairingDialogProps {
  readonly visible: boolean;
  /** Pairing phase, mapped by the app from its own transport controller. */
  readonly state: PairingState;
  /** Start (or restart) discovery. */
  readonly onScan: () => void;
  /**
   * The user picked a device. Rows are tappable while a scan is still
   * running, so stop discovery before connecting.
   */
  readonly onSelect: (deviceId: string) => void;
  /**
   * Stop the running search or connection attempt. The dialog stays open;
   * move the state back to `idle`, `found` or `error`. Called by "Stop
   * searching" and by "Cancel" while connecting. Falls back to `onCancel`;
   * with neither, those buttons are disabled.
   */
  readonly onStopSearch?: () => void;
  /**
   * Close the dialog. Called by the close button and the system back gesture
   * in every state except `connected`, which calls `onDone`. While
   * `awaiting-input` the device is linked: treat this as closing the window,
   * not disconnecting. Falls back to `onCancel` for unlinked states and to
   * `onDone` for linked ones.
   */
  readonly onClose?: () => void;
  /**
   * @deprecated Pass `onStopSearch` and `onClose`. Still works: it stops a
   * search and closes an unlinked dialog. It is never called to close a
   * linked (`awaiting-input` or `connected`) dialog, so closing cannot
   * disconnect.
   */
  readonly onCancel?: () => void;
  /** Retry after an error. */
  readonly onRetry: () => void;
  /**
   * Close after a successful connection. Closing a connected dialog is not a
   * disconnect, so it never calls `onCancel`.
   */
  readonly onDone: () => void;
  /** Open system settings for permission or radio errors and `system-pairing`. */
  readonly onOpenSettings?: () => void;
  /**
   * Shown above the guidance while `idle`, before the user starts a search.
   * Say what the button will do, e.g. that the app will ask for Bluetooth
   * access, or that this platform pairs in system Settings.
   */
  readonly intro?: string;
  /** @default "Connect a device" */
  readonly title?: string;
  /** Lowercase noun used in copy, e.g. "pen" or "controller". @default "device" */
  readonly deviceNoun?: string;
  /**
   * Status illustration, e.g. a Rive state machine. Show `connected` only for
   * a verified link: the app decides what verified means.
   */
  readonly renderStatusArt?: (phase: PairingArtPhase, state: PairingState) => ReactNode;
  className?: string;
  unstyled?: boolean;
  testID?: string;
}

function artPhase(state: PairingState): PairingArtPhase {
  switch (state.kind) {
    case "idle": return "idle";
    case "scanning": return "searching";
    case "found": return "idle";
    case "system-pairing": return "connecting";
    case "connecting": return "connecting";
    case "awaiting-input": return "connecting";
    case "connected": return "connected";
    case "error": return "error";
  }
}

function DeviceRow({ device, disabled, onPress, styled }: {
  readonly device: PairingDevice; readonly disabled: boolean; readonly onPress: () => void; readonly styled: boolean;
}) {
  const secondary = [device.detail, device.signalDbm === undefined ? undefined : signalLabel(device.signalDbm)]
    .filter(Boolean).join(" · ");
  return <Pressable
    accessibilityRole="button"
    // Detail and signal are content, so they go in the label; hints can be
    // turned off and are skipped by quick navigation.
    accessibilityLabel={"Connect to " + device.name + (secondary ? ", " + secondary : "")}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    {...{ className: joinClasses("min-h-14 justify-center px-3 py-2",
      styled && "rounded-control border border-border bg-surface-sunken active:opacity-80 focus-visible:ring-2 focus-visible:ring-focus",
      disabled && "opacity-50") }}
  >
    <Text {...{ className: joinClasses(styled && "font-semibold text-text") }}>{device.name}</Text>
    {secondary ? <Text {...{ className: joinClasses(styled && "text-sm text-text-muted") }}>{secondary}</Text> : null}
  </Pressable>;
}

function StepList({ steps, styled }: { readonly steps: readonly string[]; readonly styled: boolean }) {
  return <View accessibilityRole="list" {...{ className: "gap-2" }}>
    {steps.map((step, i) => <View
      key={i}
      accessible
      accessibilityLabel={"Step " + (i + 1) + " of " + steps.length + ": " + step}
      {...{ className: "flex-row gap-2" }}
    >
      <Text {...{ className: joinClasses(styled && "font-semibold text-text-muted") }} style={{ fontVariant: ["tabular-nums"] }}>{(i + 1) + "."}</Text>
      <Text {...{ className: joinClasses("flex-1 text-start", styled && "text-text") }}>{step}</Text>
    </View>)}
  </View>;
}

/**
 * Transport-agnostic pairing dialog over a controlled {@linkcode PairingState}.
 * Every state has copy and a recovery path: no device found offers a new
 * search, permission and radio errors offer Settings when `onOpenSettings`
 * is set, and every error offers retry. No Bluetooth or network code here.
 */
export function DevicePairingDialog(props: DevicePairingDialogProps) {
  const {
    visible, state, onScan, onSelect, onRetry, onDone, onOpenSettings, intro,
    title = "Connect a device", deviceNoun = "device", renderStatusArt,
    className, unstyled = false, testID,
  } = props;
  const styled = !unstyled;
  const view = presentPairing(state, deviceNoun, onOpenSettings !== undefined);
  useStatusAnnouncement(view.body);
  const stop = props.onStopSearch ?? props.onCancel;
  // A linked device is never closed through a stop/cancel callback: legacy
  // hosts' onCancel may disconnect, so linked states fall back to onDone.
  const close = state.kind === "connected" ? onDone
    : view.isLinked ? props.onClose ?? onDone
    : props.onClose ?? props.onCancel ?? onDone;
  const closeLabel = view.isLinked || props.onClose ? "Close" : "Cancel and close";
  const handlers: Record<PairingAction, (() => void) | undefined> = {
    scan: onScan, rescan: onScan, cancel: stop, retry: onRetry, "open-settings": onOpenSettings, done: onDone,
  };
  const art = renderStatusArt?.(artPhase(state), state);
  const showIntro = intro !== undefined && intro !== "" && state.kind === "idle";
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.spacing.fixedGroup }}>
      <View pointerEvents="none" {...{ className: "bg-black" }} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: tokens.opacity.scrim }} />
      <View
        accessibilityViewIsModal
        {...(testID ? { testID } : {})}
        {...{ className: joinClasses("w-full gap-4 p-5", styled && "rounded-control border border-border bg-surface-raised", className) }}
        style={{ maxWidth: tokens.spacing.off480, maxHeight: "90%" }}
      >
        <View {...{ className: "flex-row items-center gap-3" }}>
          <Text accessibilityRole="header" {...{ className: joinClasses("flex-1 text-start", styled && "text-lg font-semibold text-text") }}>{title}</Text>
          <Button
            title="Close"
            variant="ghost"
            accessibilityLabel={closeLabel}
            onPress={close}
            {...(testID ? { testID: testID + "-close" } : {})}
          />
        </View>
        {art !== undefined && art !== null ? <View
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          {...{ className: "items-center justify-center" }} style={{ minHeight: tokens.spacing.off96 }}
        >{art}</View> : view.isBusy ? <ActivityIndicator accessibilityElementsHidden importantForAccessibility="no" size="large" /> : null}
        {showIntro ? <Text
          {...(testID ? { testID: testID + "-intro" } : {})}
          {...{ className: joinClasses("text-start", styled && "text-text-muted") }}
        >{intro}</Text> : null}
        <Text
          accessibilityLiveRegion="polite"
          {...{ className: joinClasses("text-start", styled && (view.isProblem ? "text-danger" : "text-text")) }}
        >{view.body}</Text>
        {view.steps ? <StepList steps={view.steps} styled={styled} /> : null}
        {view.devices && view.devices.length ? <ScrollView
          accessibilityLabel={"Found " + view.devices.length + (view.devices.length === 1 ? " device" : " devices")}
          style={{ maxHeight: controlTokens.extent.preview }}
          contentContainerStyle={{ gap: tokens.spacing.fixedElement }}
        >{view.devices.map(device => <DeviceRow
          key={device.id}
          device={device}
          styled={styled}
          disabled={state.kind !== "found" && state.kind !== "scanning"}
          onPress={() => onSelect(device.id)}
        />)}</ScrollView> : null}
        {view.primary || view.secondary ? <View {...{ className: "gap-2" }}>
          {view.primary ? <Button
            title={view.primary.label}
            disabled={handlers[view.primary.kind] === undefined}
            onPress={handlers[view.primary.kind]}
            {...(testID ? { testID: testID + "-primary" } : {})}
          /> : null}
          {view.secondary ? <Button
            title={view.secondary.label}
            variant="secondary"
            disabled={handlers[view.secondary.kind] === undefined}
            onPress={handlers[view.secondary.kind]}
            {...(testID ? { testID: testID + "-secondary" } : {})}
          /> : null}
        </View> : null}
      </View>
    </View>
  </Modal>;
}
