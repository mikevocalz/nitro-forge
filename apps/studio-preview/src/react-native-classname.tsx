// NYC-Tron UI styles React Native primitives through `className`, which
// Uniwind maps to styles in the Expo host. This Vite host renders through
// React Native Web, which drops `className`; RNW does accept precompiled class
// names as a `$$css` style entry, so the primitives NYC-Tron imports forward
// their Tailwind classes that way. vite.config.ts routes only NYC-Tron's
// `react-native` imports here. vite.config.ts also resolves this file's
// `react-native-web` as the app's own `react-native` import: a second copy
// (RNW's ESM entry) would run its own responder system, and no NYC-Tron drag
// would ever be granted.
import { createElement, forwardRef, type ComponentType } from 'react';
import * as RNW from 'react-native-web';
export * from 'react-native-web';

type Styled = { className?: string; style?: unknown };
type Loose = ComponentType<Record<string, unknown>>;
function withClassName<P extends Styled>(Component: ComponentType<P>) {
  const Forwarded = forwardRef<unknown, P>((props, ref) => {
    const { className, style, ...rest } = props;
    if (!className) return createElement(Component as Loose, { ...rest, style, ref });
    const css = { $$css: true, tailwind: className };
    const merged = typeof style === 'function' ? (state: unknown) => [css, (style as (s: unknown) => unknown)(state)] : [css, style];
    return createElement(Component as Loose, { ...rest, style: merged, ref });
  });
  Forwarded.displayName = `ClassName(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Forwarded;
}

export const View = withClassName(RNW.View as ComponentType<Styled>);
export const Text = withClassName(RNW.Text as ComponentType<Styled>);
export const Pressable = withClassName(RNW.Pressable as ComponentType<Styled>);
export const TextInput = withClassName(RNW.TextInput as ComponentType<Styled>);
export const ScrollView = withClassName(RNW.ScrollView as ComponentType<Styled>);
// Named here because `export *` from RNW's CommonJS entry is not visible to
// ESM importers in Vite dev. NYC-Tron draws no Image, so it needs no binding.
export const Image = RNW.Image;
export const Platform = RNW.Platform;
export const PanResponder = RNW.PanResponder;
