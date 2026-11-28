import {View} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";

/** Transport glyphs drawn from views (no icon dependency) so they take the text token in both themes and in forced colors. */
export type TransportGlyph="play"|"pause"|"stop"|"start"|"end"|"previous-frame"|"next-frame";

const triangle=(dir:"right"|"left",size:number,cls:string)=>
  <View {...{className:cls}} style={{width:0,height:0,borderTopWidth:size/2,borderBottomWidth:size/2,
    borderTopColor:"transparent",borderBottomColor:"transparent",
    ...(dir==="right"?{borderLeftWidth:size*0.85}:{borderRightWidth:size*0.85})}}/>;
const bar=(w:number,h:number,cls:string)=><View {...{className:cls}} style={{width:w,height:h}}/>;

/**
 * One transport glyph, 16 units tall. `styled` false leaves the ink to the
 * app's classes on the parent. Triangles are drawn with borders: the
 * transparent sides are geometry, not color.
 */
export function Glyph({name,styled=true}:{name:TransportGlyph;styled?:boolean}){
  const fill=joinClasses(styled&&"bg-text");
  const left=joinClasses(styled&&"border-l-text");
  const right=joinClasses(styled&&"border-r-text");
  const row={flexDirection:"row" as const,alignItems:"center" as const,gap:1,direction:"ltr" as const};
  switch(name){
    case "play":return triangle("right",16,left);
    case "pause":return <View style={{...row,gap:4}}>{bar(4,15,fill)}{bar(4,15,fill)}</View>;
    case "stop":return bar(13,13,fill);
    case "start":return <View style={row}>{bar(2,14,fill)}{triangle("left",14,right)}</View>;
    case "end":return <View style={row}>{triangle("right",14,left)}{bar(2,14,fill)}</View>;
    case "previous-frame":return <View style={row}>{triangle("left",12,right)}{bar(2,12,fill)}</View>;
    case "next-frame":return <View style={row}>{bar(2,12,fill)}{triangle("right",12,left)}</View>;
  }
}
