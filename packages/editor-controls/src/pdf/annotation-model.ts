/**
 * Markup tools a PDF annotation toolbar can offer. `select` is the plain
 * pointer; every other tool creates one annotation subtype.
 * @see {@linkcode ANNOTATION_TOOL_INFO}
 */
export type AnnotationTool="select"|"note"|"highlight"|"underline"|"strike"|"ink"|"rectangle"|"ellipse";

/** Label, PDF subtype (ISO 32000-2 §12.5.6) and web shortcut for each {@linkcode AnnotationTool}. */
export const ANNOTATION_TOOL_INFO={
  select:{label:"Select",subtype:undefined,key:"v"},
  note:{label:"Note",subtype:"Text",key:"n"},
  highlight:{label:"Highlight",subtype:"Highlight",key:"h"},
  underline:{label:"Underline",subtype:"Underline",key:"u"},
  strike:{label:"Strikethrough",subtype:"StrikeOut",key:"s"},
  ink:{label:"Draw",subtype:"Ink",key:"d"},
  rectangle:{label:"Rectangle",subtype:"Square",key:"r"},
  ellipse:{label:"Ellipse",subtype:"Circle",key:"e"},
} as const satisfies Record<AnnotationTool,{label:string;subtype:string|undefined;key:string}>;

/** Display order of the tools. */
export const ANNOTATION_TOOL_ORDER:readonly AnnotationTool[]=["select","note","highlight","underline","strike","ink","rectangle","ellipse"];

/** The tool that creates `subtype` (case-insensitive), if any. */
export function toolForSubtype(subtype:string):AnnotationTool|undefined{
  const s=subtype.toLowerCase();
  return ANNOTATION_TOOL_ORDER.find(t=>ANNOTATION_TOOL_INFO[t].subtype?.toLowerCase()===s);
}

/** `tools` in display order, deduplicated, with `select` first when present. Throws on an unknown tool. */
export function orderTools(tools:readonly AnnotationTool[]):AnnotationTool[]{
  for(const t of tools)if(!(t in ANNOTATION_TOOL_INFO))throw new RangeError(`Unknown annotation tool "${String(t)}"`);
  return ANNOTATION_TOOL_ORDER.filter(t=>tools.includes(t));
}

/** The tool a single-letter shortcut picks among `tools`, or `undefined`. Escape returns `select` when offered. */
export function toolForKey(key:string,tools:readonly AnnotationTool[]):AnnotationTool|undefined{
  if(key==="Escape")return tools.includes("select")?"select":undefined;
  const k=key.toLowerCase();
  return tools.find(t=>ANNOTATION_TOOL_INFO[t].key===k);
}
