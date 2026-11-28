// Test-only bridge: React Native Web drops `className`, while Uniwind (the
// consumer runtime) maps it to styles. RNW accepts precompiled class names as a
// `$$css` style entry, so this forwards the Tailwind classes the same way.
import {forwardRef,createElement} from "react";
import * as RNW from "react-native-web";
export * from "react-native-web";
const withClass=(Component:any)=>forwardRef((props:any,ref)=>{
  const {className,style,...rest}=props;
  if(!className)return createElement(Component,{...rest,style,ref});
  const css={$$css:true,tw:className};
  const merged=typeof style==="function"?(state:any)=>[css,style(state)]:[css,style];
  return createElement(Component,{...rest,style:merged,ref});
});
export const View=withClass(RNW.View);
export const Text=withClass(RNW.Text);
export const Pressable=withClass(RNW.Pressable);
export const TextInput=withClass(RNW.TextInput);
