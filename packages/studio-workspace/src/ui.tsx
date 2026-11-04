import { createContext, forwardRef, useContext, type ForwardRefExoticComponent, type PropsWithoutRef, type ComponentRef, type ComponentType, type ReactNode } from 'react';
import type { View as NativeViewComponent, ViewProps, TextProps, PressableProps, ScrollView as NativeScrollView, ScrollViewProps, TextInput as NativeTextInput, TextInputProps, ImageProps } from 'react-native';
import type { RefAttributes } from 'react';

export type StudioViewRef = ComponentRef<typeof NativeViewComponent>;
export type StudioViewProps = ViewProps & { className?: string };
export type StudioMenuAction = { id: string; title: string; disabled?: boolean; destructive?: boolean };
export type StudioPopoverProps = {
  /** Presentation is controlled by a real host-native UI component. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  accessibleLabel: string;
  title?: string;
  /** An action menu uses Menu instead; this popover holds rich instrument content. */
  placement?: 'auto' | 'above' | 'below';
};
export type StudioMenuProps = { children: ReactNode; actions: readonly StudioMenuAction[]; onAction: (id: string) => void; title?: string; triggerLabel?: string; placement?: 'down' | 'up'; className?: string };
export type StudioSelectProps = { label: string; value: string; options: readonly { label: string; value: string }[]; onValueChange: (value: string) => void; disabled?: boolean };
/** Canonical source-owned expressive single choice, not an editor-local picker. */
export type StudioDropdownProps = {
  label: string;
  value: string;
  groups: readonly { id: string; label?: string; options: readonly {
    value: string; label: string; supportingText?: string; disabled?: boolean;
  }[] }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  testID?: string;
};
export type StudioSegmentedControlProps = {
  options: readonly { value: string; label: string }[];
  value: string; onChange: (value: string) => void;
  'aria-label': string; className?: string; segmentClassName?: string; tone?: 'royal';
};
export type StudioTabBarProps = {
  tabs: { key: string; label: string; icon: ReactNode; active?: boolean; onPress?: () => void; href?: string }[];
  semantics?: 'tabs' | 'navigation'; density?: 'navigation' | 'compact'; 'aria-label'?: string; className?: string; tone?: 'royal';
};
export type StudioButtonProps = {
  title: string; icon?: ReactNode; onPress?: () => void; disabled?: boolean; loading?: boolean;
  selected?: boolean; 'aria-label'?: string; accessibilityHint?: string;
  variant?: 'primary' | 'outline' | 'ghost'; size?: 'sm' | 'md'; tone?: 'royal' | 'carolina';
  cornerRadius?: number; className?: string;
};
export type StudioIconButtonProps = Omit<StudioButtonProps, 'title' | 'loading'> & { icon: ReactNode; 'aria-label': string };
export type StudioBannerProps = { tone: 'info' | 'danger' | 'success' | 'neutral'; title: string; description?: string; action?: ReactNode; live?: 'status' | 'alert'; className?: string };
export type StudioBadgeProps = { label: string; tone?: 'neutral'; size?: 'xs' | 'sm'; className?: string };
export type StudioEmptyStateProps = { title: string; description?: string; action?: ReactNode; icon?: ReactNode; illustration?: ReactNode; className?: string; tone?: 'royal' | 'carolina' };
export type StudioKeyValueListProps = { items: readonly { key: string; label: string; value: ReactNode; action?: ReactNode }[]; columns?: 1 | 2; surface?: 'page' | 'night'; className?: string };
export type StudioErrorMessageProps = { message?: string; surface?: 'page' | 'night'; className?: string };
export type StudioFieldGroupProps = { children?: ReactNode };
export type StudioFieldSectionProps = { title?: string; children?: ReactNode; tone?: 'royal' | 'carolina'; titleUppercase?: boolean };
export type StudioCardProps = { children?: ReactNode; surface?: 'page' | 'night'; padded?: boolean; className?: string; style?: ViewProps['style'] };
export type StudioToolbarProps = { title?: string; leading?: ReactNode; actions?: ReactNode; tone?: 'royal' | 'carolina'; density?: 'default' | 'compact'; className?: string };
export type StudioListProps = { children?: ReactNode; className?: string; tone?: 'royal' | 'carolina' };
export type StudioListItemProps = { children?: ReactNode; supportingText?: string; leading?: ReactNode; trailing?: ReactNode; onPress?: () => void; selected?: boolean; className?: string };
export type StudioDropZoneProps = { children?: ReactNode; onDrop?: (event: { assets: { file?: File; uri?: string; type: string; fileName?: string }[] }) => void; disableObjectUrl?: boolean; includeBase64?: boolean; className?: string; style?: ViewProps['style']; accept?: string };
/** Implementations are supplied by the host's source-owned semantic/native UI kit. */
export interface StudioUIComponents {
  View: ComponentType<StudioViewProps & RefAttributes<StudioViewRef>>;
  Text: ComponentType<TextProps>;
  Pressable: ComponentType<PressableProps>;
  ScrollView: ComponentType<ScrollViewProps & RefAttributes<NativeScrollView>>;
  TextInput: ComponentType<TextInputProps & RefAttributes<NativeTextInput>>;
  Image: ComponentType<ImageProps>;
  Menu: ComponentType<StudioMenuProps>;
  /** Optional until the canonical @acme/ui rich Popover is implemented. Never fall back to a fake RN modal. */
  Popover?: ComponentType<StudioPopoverProps>;
  /** Offered only when @acme/ui/NativeDropdown is available in the host. */
  NativeDropdown?: ComponentType<StudioDropdownProps>;
  Select: ComponentType<StudioSelectProps>;
  SegmentedControl: ComponentType<StudioSegmentedControlProps>;
  TabBar: ComponentType<StudioTabBarProps>;
  NightScope: ComponentType<{ children: ReactNode }>;
  DropZone: ComponentType<StudioDropZoneProps>;
  Card: ComponentType<StudioCardProps>;
  Toolbar: ComponentType<StudioToolbarProps>;
  List: ComponentType<StudioListProps>;
  ListItem: ComponentType<StudioListItemProps>;
  Button: ComponentType<StudioButtonProps>;
  IconButton: ComponentType<StudioIconButtonProps>;
  Banner: ComponentType<StudioBannerProps>;
  Badge: ComponentType<StudioBadgeProps>;
  EmptyState: ComponentType<StudioEmptyStateProps>;
  KeyValueList: ComponentType<StudioKeyValueListProps>;
  ErrorMessage: ComponentType<StudioErrorMessageProps>;
  FieldGroup: ComponentType<StudioFieldGroupProps> & { Section: ComponentType<StudioFieldSectionProps> };
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
export const View: ForwardRefExoticComponent<PropsWithoutRef<StudioViewProps> & RefAttributes<StudioViewRef>> = forwardRef<StudioViewRef, StudioViewProps>((props, ref) => { const C = useComponents().View; return <C {...props} ref={ref} />; });
export const Text = (props: TextProps) => { const C = useComponents().Text; return <C {...props} />; };
export const Pressable = (props: PressableProps) => { const C = useComponents().Pressable; return <C {...props} />; };
export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>((props, ref) => { const C = useComponents().ScrollView; return <C {...props} ref={ref} />; });
export const TextInput: ForwardRefExoticComponent<PropsWithoutRef<TextInputProps> & RefAttributes<NativeTextInput>> = forwardRef<NativeTextInput, TextInputProps>((props, ref) => { const C = useComponents().TextInput; return <C {...props} ref={ref} />; });
export const Image = (props: ImageProps) => { const C = useComponents().Image; return <C {...props} />; };
export const Menu = (props: StudioMenuProps) => { const C = useComponents().Menu; return <C {...props} />; };
/** Rich floating tool surface. Host must supply the same canonical @acme/ui source on native and web. */
export const Popover = (props: StudioPopoverProps) => {
  const C = useComponents().Popover;
  if (!C) throw new Error('Forge Popover requires a source-owned @acme/ui Popover host adapter. No generic popup is substituted.');
  return <C {...props} />;
};
/** Grouped single-select native UI is supplied exclusively by @acme/ui. */
export const NativeDropdown = (props: StudioDropdownProps) => {
  const C = useComponents().NativeDropdown;
  if (!C) throw new Error('Forge NativeDropdown requires source-owned @acme/ui/NativeDropdown (Expo SDK 58.0.26+).');
  return <C {...props} />;
};
export const Select = (props: StudioSelectProps) => { const C = useComponents().Select; return <C {...props} />; };

export const SegmentedControl = (props: StudioSegmentedControlProps) => { const C = useComponents().SegmentedControl; return <C {...props} />; };
export const TabBar = (props: StudioTabBarProps) => { const C = useComponents().TabBar; return <C {...props} />; };

export const Button = (props: StudioButtonProps) => { const C = useComponents().Button; return <C {...props} />; };
export const IconButton = (props: StudioIconButtonProps) => { const C = useComponents().IconButton; return <C {...props} />; };
export const Banner = (props: StudioBannerProps) => { const C = useComponents().Banner; return <C {...props} />; };
export const Badge = (props: StudioBadgeProps) => { const C = useComponents().Badge; return <C {...props} />; };
export const EmptyState = (props: StudioEmptyStateProps) => { const C = useComponents().EmptyState; return <C {...props} />; };
export const KeyValueList = (props: StudioKeyValueListProps) => { const C = useComponents().KeyValueList; return <C {...props} />; };
export const ErrorMessage = (props: StudioErrorMessageProps) => { const C = useComponents().ErrorMessage; return <C {...props} />; };
export const FieldGroup = Object.assign(
  (props: StudioFieldGroupProps) => { const C = useComponents().FieldGroup; return <C {...props} />; },
  { Section: (props: StudioFieldSectionProps) => { const C = useComponents().FieldGroup.Section; return <C {...props} />; } },
);

export const Card = (props: StudioCardProps) => { const C = useComponents().Card; return <C {...props} />; };
export const Toolbar = (props: StudioToolbarProps) => { const C = useComponents().Toolbar; return <C {...props} />; };
export const List = (props: StudioListProps) => { const C = useComponents().List; return <C {...props} />; };
export const ListItem = (props: StudioListItemProps) => { const C = useComponents().ListItem; return <C {...props} />; };

export const DropZone = (props: StudioDropZoneProps) => { const C = useComponents().DropZone; return <C {...props} />; };

export const NightScope = ({ children }: { children: ReactNode }) => { const C = useComponents().NightScope; return <C>{children}</C>; };
