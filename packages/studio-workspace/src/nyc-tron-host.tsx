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
import type { StudioButtonProps, StudioCardProps, StudioMenuProps, StudioUIComponents } from './ui';

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
 * Popover and NativeDropdown are left unset (DEFER, 2026-11-05). NYC-Tron's
 * NativePopover places itself from an anchor rect and the usable regions the
 * fold owner reports, which Forge's trigger-based Popover cannot supply, and
 * its NativeDropdown takes flat options where Forge's groups carry headings.
 * No studio renders either today; `ui.tsx` throws if one is used without a
 * host component.
 */
export function nycTronStudioUI(host: NycTronHostParts): StudioUIComponents {
  const { ActionMenu, ...parts } = host;
  // NYC-Tron menus have no title row or placement; the trigger label names the menu.
  const Menu = ({ children, actions, onAction, title, triggerLabel }: StudioMenuProps) =>
    <ActionMenu trigger={children} actions={actions} onAction={onAction} accessibilityLabel={triggerLabel ?? title ?? 'Actions'} />;
  return {
    ...parts, Menu, Button, Card, SegmentedControl, TabBar, Toolbar, List, ListItem, IconButton, FieldGroup,
    Banner, Badge, EmptyState, ErrorMessage, KeyValueList, NightScope, DropZone,
  };
}
