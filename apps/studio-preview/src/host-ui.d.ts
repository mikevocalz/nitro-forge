/** Host-owned peer contract. Runtime resolves to nyc-mon/packages/ui/studio-controls. */
declare module '@acme/ui/studio-controls' {
  export const studioControls: import('@nitro-forge/studio-workspace/ui').StudioUIComponents;
}
declare module '@acme/ui/html' {
  import type { ComponentType, ComponentProps } from 'react';
  export const Page: ComponentType<ComponentProps<'div'>>;
  export const Main: ComponentType<ComponentProps<'main'>>;
  export const Header: ComponentType<ComponentProps<'header'>>;
  export const Footer: ComponentType<ComponentProps<'footer'>>;
  export const Section: ComponentType<ComponentProps<'section'>>;
  export const Nav: ComponentType<ComponentProps<'nav'>>;
  export const Text: ComponentType<ComponentProps<'span'>>;
  export const Heading: ComponentType<ComponentProps<'h1'> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }>;
  export const Paragraph: ComponentType<ComponentProps<'p'>>;
  export const Link: ComponentType<ComponentProps<'a'>>;
  export const Input: ComponentType<ComponentProps<'input'>>;
}

declare module '@acme/ui/studio-controls/web' {
  import type { ComponentType } from 'react';
  export const studioControls: import('@nitro-forge/studio-workspace/ui').StudioUIComponents;
  export const FilePicker: ComponentType<{ label: string; className?: string; accept?: string; multiple?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; testID?: string }>;
}
