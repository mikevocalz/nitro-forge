import type { ViewProps } from "react-native";
import type { FrameRate } from "./timebase.ts";

/** Props shared by every {@linkcode NativeSeekBarProps} variant. */
export interface NativeSeekBarBaseProps extends Omit<ViewProps,"children"> {
  /** Stable media/document identity; change revision when replacing the source. */
  readonly scope?:string;readonly revision?:string|number;
  /** The player's reported frame. The thumb and timecode show it except mid-drag. */
  readonly frame:number;
  readonly durationFrames:number;
  readonly frameRate:FrameRate;
  /**
   * Called with each new frame while the thumb is dragged, for a fast or
   * approximate seek. A repeated frame is not reported twice. Step buttons
   * and screen-reader steps do not call it; they commit directly.
   */
  readonly onPreview?:(frame:number)=>void;
  /**
   * Frames moved by one press of a step button.
   * @default 1
   */
  readonly stepFrames?:number;
  /** @default false */
  readonly dropFrameTimecode?:boolean;
  /** @default false */
  readonly disabled?:boolean;
  className?:string;
  /** Drops the library recipe from the wrapper and timecode; the native Expo Slider keeps OS behavior. */
  unstyled?:boolean;
}

/** Commit callbacks for `NativeSeekBar`: `onCommit`, or the deprecated `onSeek`. */
export type NativeSeekBarCommitProps =
  | {
    /**
     * Called once per completed drag when the finger or pointer is released,
     * once per step button press, and once per screen-reader or keyboard step.
     * Not called when the frame is unchanged.
     *
     * When both `onCommit` and `onSeek` are passed, only `onCommit` is called.
     */
    readonly onCommit:(frame:number)=>void;
    /** @deprecated Use `onCommit`. Ignored when `onCommit` is passed. */
    readonly onSeek?:(frame:number)=>void;
  }
  | {
    readonly onCommit?:undefined;
    /**
     * @deprecated Use `onCommit`. Kept as an alias with the same timing: once
     * per release or step, never on drag ticks. Before this change it fired on
     * every slider tick.
     */
    readonly onSeek:(frame:number)=>void;
  };

/** Props for `NativeSeekBar`. Pass `onCommit` (or the deprecated `onSeek`). */
export type NativeSeekBarProps=NativeSeekBarBaseProps&NativeSeekBarCommitProps;
