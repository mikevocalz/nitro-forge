import { createContext, forwardRef, useContext, type ComponentType, type ReactNode } from 'react';
import type { View as NativeView, ViewProps, TextProps, PressableProps, ScrollView as NativeScrollView, ScrollViewProps, TextInput as NativeTextInput, TextInputProps, ImageProps } from 'react-native';
import type { RefAttributes } from 'react';

export type StudioMenuAction = { id: string; title: string; disabled?: boolean; destructive?: boolean };
export type StudioMenuProps = { children: ReactNode; actions: readonly StudioMenuAction[]; onAction: (id: string) => void; title?: string; triggerLabel?: string; placement?: 'down' | 'up'; className?: string };
export type StudioSelectProps = { label: string; value: string; options: readonly { label: string; value: string }[]; onValueChange: (value: string) => void; disabled?: boolean };
/** Implementations are supplied by the host's source-owned semantic/native UI kit. */
export interface StudioUIComponents {
  View: ComponentType<ViewProps & RefAttributes<NativeView>>;
  Text: ComponentType<TextProps>;
  Pressable: ComponentType<PressableProps>;
  ScrollView: ComponentType<ScrollViewProps & RefAttributes<NativeScrollView>>;
  TextInput: ComponentType<TextInputProps & RefAttributes<NativeTextInput>>;
  Image: ComponentType<ImageProps>;
  Menu: ComponentType<StudioMenuProps>;
  Select: ComponentType<StudioSelectProps>;
}
const Context = createContext<StudioUIComponents | null>(null);
export function StudioUIProvider({ components, children }: { components: StudioUIComponents; children: ReactNode }) {
  return <Context.Provider value={components}>{children}</Context.Provider>;
}
function useComponents() {
  const components = useContext(Context);
  if (!components) throw new Error('Studio requires StudioUIProvider with your application UI components. No substitute UI is installed.');
  return components;
}
export const View = forwardRef<NativeView, ViewProps>((props, ref) => { const C = useComponents().View; return <C {...props} ref={ref} />; });
export const Text = (props: TextProps) => { const C = useComponents().Text; return <C {...props} />; };
export const Pressable = (props: PressableProps) => { const C = useComponents().Pressable; return <C {...props} />; };
export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>((props, ref) => { const C = useComponents().ScrollView; return <C {...props} ref={ref} />; });
export const TextInput = forwardRef<NativeTextInput, TextInputProps>((props, ref) => { const C = useComponents().TextInput; return <C {...props} ref={ref} />; });
export const Image = (props: ImageProps) => { const C = useComponents().Image; return <C {...props} />; };
export const Menu = (props: StudioMenuProps) => { const C = useComponents().Menu; return <C {...props} />; };
export const Select = (props: StudioSelectProps) => { const C = useComponents().Select; return <C {...props} />; };
