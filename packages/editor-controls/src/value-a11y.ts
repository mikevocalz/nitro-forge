import {Platform} from "react-native";

/** Native value semantics plus explicit ARIA for React Native Web. */
export function valueAccessibility(value:{min?:number;max?:number;now?:number;text?:string}){
  return {accessibilityValue:value,...(Platform.OS==="web"?{
    "aria-valuemin":value.min,"aria-valuemax":value.max,"aria-valuenow":value.now,"aria-valuetext":value.text,
  }:{})};
}
