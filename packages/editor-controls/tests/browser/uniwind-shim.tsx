// Test-only stand-in for Uniwind's web ScopedTheme (uniwind 1.13.2
// dist/module/components/ScopedTheme/ScopedTheme.js): a `display: contents`
// element carrying the theme name as its class. theme.css scopes `.dark` and
// `.light` the way an app's Uniwind theme CSS does.
import {createElement,type ReactNode} from "react";
export function ScopedTheme({theme,children}:{theme:string;children?:ReactNode}){
  return createElement("div",{className:theme,style:{display:"contents"}},children);
}
