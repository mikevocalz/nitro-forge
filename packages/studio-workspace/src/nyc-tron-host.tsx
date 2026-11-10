import type { ComponentType, ReactNode } from 'react';
import { Button as TronButton } from '@nyc-tron/ui/components/Button';
import { Card as TronCard } from '@nyc-tron/ui/components/Card';
import { SegmentedControl } from '@nyc-tron/ui/components/SegmentedControl';
import { TabBar } from '@nyc-tron/ui/components/TabBar';
import { Toolbar } from '@nyc-tron/ui/components/Toolbar';
import { List, ListItem } from '@nyc-tron/ui/components/List';
import { IconButton } from '@nyc-tron/ui/components/IconButton';
import { FieldGroup } from '@nyc-tron/ui/components/FieldGroup';
import { Banner } from '@nyc-tron/ui/components/feedback/Banner';
import { Badge } from '@nyc-tron/ui/components/feedback/Badge';
import { EmptyState } from '@nyc-tron/ui/components/feedback/EmptyState';
import { ErrorMessage } from '@nyc-tron/ui/components/feedback/ErrorMessage';
import { KeyValueList } from '@nyc-tron/ui/components/content/KeyValueList';
import { NightScope } from '@nyc-tron/ui/components/theme/NightScope';
import { DropZone } from '@nyc-tron/ui/components/files/DropZone';
import type { PopoverProps } from '@nyc-tron/ui/components/overlays/AnchoredPopover';
import type { SelectProps } from '@nyc-tron/ui/components/Select';
import type { StudioButtonProps, StudioCardProps, StudioMenuProps, StudioPopoverProps, StudioDropdownProps, StudioUIComponents } from './ui';
import { studioDropdownGroups } from './nyc-tron-options';

/**
 * The action menu a host passes in: `@nyc-tron/expo-controls/NativeActionMenu`
 * (SwiftUI/Compose menu on iOS and Android, a focus-trapped list on web).
 * Typed by shape so this package does not depend on Expo.
 */
export type HostActionMenu = ComponentType<{
  trigger: ReactNode;
  actions: StudioMenuProps['actions'];
  onAction: (id: string) => void;
  accessibilityLabel: string;
}>;

/** What only the host can supply: the platform primitives, the platform
 * Select and action menu, and optionally a token scope. */
export type NycTronHostParts = Pick<StudioUIComponents, 'View' | 'Text' | 'Pressable' | 'ScrollView' | 'TextInput' | 'Image' | 'Select' | 'TokenScope'> & {
  ActionMenu: HostActionMenu;
  NativePopover: ComponentType<PopoverProps>;
  GroupedSelect: ComponentType<SelectProps>;
};

/** Forge's `outline` is NYC-Tron's bordered `secondary`. `tone` is ignored:
 * colour comes from the theme tokens. */
function Button({ variant, tone: _tone, cornerRadius, selected, ...props }: StudioButtonProps) {
  return <TronButton {...props} {...(variant === undefined ? {} : { variant: variant === 'outline' ? 'secondary' as const : variant })}
    {...(selected === undefined ? {} : { accessibilityState: { selected } })}
    {...(cornerRadius === undefined ? {} : { style: { borderRadius: cornerRadius } })} />;
}

/** `surface="night"` keeps a dark card on a light page through NightScope. */
function Card({ surface, ...props }: StudioCardProps) {
  const card = <TronCard {...props} surface="raised" />;
  return surface === 'night' ? <NightScope>{card}</NightScope> : card;
}

/**
 * The Studio UI contract on NYC-Tron UI (rule #38: Forge imports NYC-Tron).
 *
 * Alpha.3 supplies trigger measurement and grouped choices. Grouped Select
 * delegates to the native dropdown where supported and retains disabled
 * choices through NYC-Tron's canonical Select implementation.
 */
export function nycTronStudioUI(host: NycTronHostParts): StudioUIComponents {
  const { ActionMenu, NativePopover, GroupedSelect, ...parts } = host;
  // NYC-Tron menus have no title row or placement; the trigger label names the menu.
  const Menu = ({ children, actions, onAction, title, triggerLabel }: StudioMenuProps) =>
    <ActionMenu trigger={children} actions={actions} onAction={onAction} accessibilityLabel={triggerLabel ?? title ?? 'Actions'} />;
  // Placement is chosen by NYC-Tron's measured usable region. The optional
  // Studio preference cannot override clipping or native presentation.
  const Popover = ({ accessibleLabel, title, placement: _placement, ...props }: StudioPopoverProps) =>
    <NativePopover {...props} accessibilityLabel={title ? `${accessibleLabel}: ${title}` : accessibleLabel} />;
  const NativeDropdown = ({ groups, ...props }: StudioDropdownProps) =>
    <GroupedSelect {...props} groups={studioDropdownGroups(groups)} />;
  return {
    ...parts, Menu, Popover, NativeDropdown, Button, Card, SegmentedControl, TabBar, Toolbar, List, ListItem, IconButton, FieldGroup,
    Banner, Badge, EmptyState, ErrorMessage, KeyValueList, NightScope, DropZone,
  };
}
