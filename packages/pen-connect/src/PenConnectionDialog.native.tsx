import { useStore } from "zustand";
import type { ReactElement, ReactNode } from "react";
import { DevicePairingDialog } from "@nyc-tron/ui/components/forge/devices/DevicePairingDialog";
import type { PenConnectionController } from "./controller";
import { penArtPhase, toPairingState, type PenConnectionArtPhase } from "./pairing-state";

/**
 * Props for {@linkcode PenConnectionDialog}. The dialog UI is NYC-Tron's
 * `DevicePairingDialog`; this component only binds it to a
 * {@linkcode PenConnectionController}.
 */
export interface PenConnectionDialogProps {
  readonly visible: boolean;
  readonly controller: PenConnectionController;
  /** Called after the dialog cancels (before a verified pen) or finishes. */
  readonly onClose: () => void;
  /** @default "Connect your pen" */
  readonly title?: string;
  /** Opens system Bluetooth settings; offered for permission and radio-off errors. */
  readonly onOpenBluetoothSettings?: () => void;
  /**
   * Status art, e.g. the compiled Rive artboards. `connected` plays only for a
   * verified pen; an unverified Bluetooth link gets `linked`.
   */
  readonly renderAnimation?: (phase: PenConnectionArtPhase) => ReactNode;
}

/**
 * Pen pairing dialog. Closing a verified pen is not a disconnect. Before
 * verification, every close is a cancel, because NYC-Tron labels that button
 * "Cancel and close".
 */
export function PenConnectionDialog({
  visible, controller, onClose, title = "Connect your pen", onOpenBluetoothSettings, renderAnimation,
}: PenConnectionDialogProps): ReactElement {
  const state = useStore(controller.state, (s) => s);
  const cancel = () => {
    void controller.cancel();
    onClose();
  };
  return (
    <DevicePairingDialog
      visible={visible}
      state={toPairingState(state)}
      title={title}
      deviceNoun="pen"
      onScan={() => void (state.kind === "found" ? controller.rescan() : controller.begin())}
      onSelect={(id) => void controller.connect(id)}
      onCancel={cancel}
      onRetry={() => void controller.begin()}
      onDone={onClose}
      {...(onOpenBluetoothSettings ? { onOpenSettings: onOpenBluetoothSettings } : {})}
      {...(renderAnimation ? { renderStatusArt: () => renderAnimation(penArtPhase(state)) } : {})}
    />
  );
}
