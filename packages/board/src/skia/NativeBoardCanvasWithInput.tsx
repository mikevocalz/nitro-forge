import { View } from "react-native";
import type { ReactElement } from "react";
import { NativeBoardCanvas, type NativeBoardCanvasProps } from "./NativeBoardCanvas";
import type { NativeBoardPointerRouter } from "./pointer-input";

/**
 * Native pointer input for 2D phone/iPad/tablet. The surface is a React
 * Native view, NOT a WebView or DOM canvas. Source data remains QuickDraw.
 *
 * XR/Muse inputs must use the XR BoardInputRouter instead of nesting this
 * pointer owner inside a Viro panel; otherwise one stroke may be sent twice.
 */
export function NativeBoardCanvasWithInput(
  { pointer, ...props }: NativeBoardCanvasProps & {
    readonly pointer: NativeBoardPointerRouter;
  },
): ReactElement {
  return (
    <View
      style={{ width: props.width, height: props.height }}
      onPointerDown={(e) => pointer.handle("down", e.nativeEvent)}
      onPointerMove={(e) => pointer.handle("move", e.nativeEvent)}
      onPointerUp={(e) => pointer.handle("up", e.nativeEvent)}
      onPointerCancel={(e) => pointer.handle("cancel", e.nativeEvent)}
      onPointerLeave={(e) => pointer.handle("leave", e.nativeEvent)}
    >
      <NativeBoardCanvas {...props} />
    </View>
  );
}
