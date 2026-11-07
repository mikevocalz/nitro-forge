/** React Native Web ships no types. Declared narrowly: the primitives
 * src/react-native-classname.tsx wraps and its shared input adapters. */
declare module 'react-native-web' {
  import type { ComponentType } from 'react';
  export const View: ComponentType<object>;
  export const Text: ComponentType<object>;
  export const Pressable: ComponentType<object>;
  export const TextInput: ComponentType<object>;
  export const ScrollView: ComponentType<object>;
  export const Image: ComponentType<object>;
  export const Platform: typeof import('react-native').Platform;
  export const PanResponder: typeof import('react-native').PanResponder;
}
