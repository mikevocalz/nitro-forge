import type { ReactNode } from 'react';
import type { PressableProps } from 'react-native';
import type { ForgeIconOptions } from './index.js';

/** Host-owned Rive adapter inputs. No Rive runtime is bundled by this package. */
export interface ForgeIconRiveInputs {
  name: string;
  selected: boolean;
  disabled: boolean;
  loading: boolean;
  pressed: boolean;
  hovered: boolean;
  status: NonNullable<ForgeIconOptions['status']>;
  color: string;
  size: number;
  reducedMotion: boolean;
  artboard: 'ForgeIcon';
  stateMachine: 'ForgeIconStates';
}
export interface ForgeIconProps extends ForgeIconOptions {
  /** Authored glyph name or category/name. Unknown artwork renders nothing. */
  name: string;
  /** Color behind paths, used for knockout details. */
  surfaceColor?: string;
  testID?: string;
  renderRive?: (inputs: ForgeIconRiveInputs) => ReactNode;
}
export interface ForgeIconButtonProps extends ForgeIconProps {
  /** Required accessible button name; blank labels are rejected. */
  label: string;
  onPress?: PressableProps['onPress'];
}
export function ForgeIcon(props: ForgeIconProps): ReactNode;
export function ForgeIconButton(props: ForgeIconButtonProps): ReactNode;
