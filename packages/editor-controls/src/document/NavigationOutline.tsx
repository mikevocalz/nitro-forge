import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import type {ReactNode} from "react";
import {Pressable,ScrollView,Text,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {ChevronGlyph,OFFICE_TOUCH_TARGET,officeKey,type OfficeKeyEvent} from "../office/office-controls.tsx";
import {headingAtBlock,headingsByPage,rowForHeading,visibleOutline,type OutlineHeading} from "./outline-model.ts";

/** A named place in the document. */
export interface OutlineBookmark {
  readonly id:string;
  readonly name:string;
  /** 0-based page, when laid out. */
  readonly page?:number;
}

/** Which list the outline shows. */
export type OutlineView="headings"|"pages"|"bookmarks";

/** Props for {@linkcode NavigationOutline}. */
export interface NavigationOutlineProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly headings:readonly OutlineHeading[];
  /** Block the caret is in; the heading above it is marked current. */
  readonly caretBlock?:number;
  /** Moves the editor to a heading. */
  readonly onJumpToHeading:(heading:OutlineHeading)=>void;
  /** Laid-out page count. The Pages view renders only with this and `onJumpToPage`. */
  readonly pageCount?:number;
  readonly onJumpToPage?:(page:number)=>void;
  /** Thumbnail for a page (the host's renderer). Without it the Pages view lists pages by their first heading. */
  readonly renderPageThumbnail?:(page:number)=>ReactNode;
  /** The Bookmarks view renders only with `onJumpToBookmark`. */
  readonly bookmarks?:readonly OutlineBookmark[];
  readonly onJumpToBookmark?:(bookmark:OutlineBookmark)=>void;
  /** Show headings down to this level (1–9); 0 shows every level. @default 0 */
  readonly showLevel?:number;
  readonly disabled?:boolean;
  className?:string;
  unstyled?:boolean;
}

type Local={view:OutlineView;collapsed:ReadonlySet<string>};

/**
 * Navigation pane for text documents (H-15): the heading outline with
 * collapse and the current section marked, a page list, and bookmarks. On web,
 * Up/Down move between headings, Left/Right collapse and expand (mirrored in
 * RTL by the platform), Enter jumps.
 */
export function NavigationOutline({scope='NavigationOutline',revision=0,...props}:NavigationOutlineProps){
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <NavigationOutlineBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
  onJumpToHeading={(...args:Parameters<NavigationOutlineProps['onJumpToHeading']>)=>guard.run('onJumpToHeading',h=>h.onJumpToHeading(...args))}
  onJumpToPage={props.onJumpToPage?(...args:Parameters<NonNullable<NavigationOutlineProps['onJumpToPage']>>)=>guard.run('onJumpToPage',h=>h.onJumpToPage?.(...args)):undefined}
  onJumpToBookmark={props.onJumpToBookmark?(...args:Parameters<NonNullable<NavigationOutlineProps['onJumpToBookmark']>>)=>guard.run('onJumpToBookmark',h=>h.onJumpToBookmark?.(...args)):undefined}
 />;
}
function NavigationOutlineBody({actionError,disabledReason,disabled=false,
  headings,caretBlock,onJumpToHeading,pageCount,onJumpToPage,renderPageThumbnail,bookmarks,onJumpToBookmark,showLevel=0,
  className,unstyled=false,...rest
}:NavigationOutlineProps&{actionError?:string|null}){
  const styled=!unstyled;
  const [local,store]=useLocalStore<Local>(()=>({view:"headings",collapsed:new Set()}));
  const rows=visibleOutline(headings,local.collapsed,showLevel);
  const currentHeading=caretBlock===undefined?-1:headingAtBlock(headings,caretBlock);
  const currentRow=rowForHeading(rows,currentHeading);
  const views:OutlineView[]=["headings",...(pageCount&&onJumpToPage?["pages" as const]:[]),...(onJumpToBookmark?["bookmarks" as const]:[])];
  const view=views.includes(local.view)?local.view:"headings";
  const toggle=(id:string)=>store.set(s=>{
    const next=new Set(s.collapsed);
    if(next.has(id))next.delete(id);else next.add(id);
    return {...s,collapsed:next};
  });
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  const rowClass=(on:boolean)=>joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus",styled&&on&&"bg-accent/10");
  return <View {...rest} accessibilityLabel="Navigation" {...{role:"navigation",className:joinClasses("min-w-0",className)}}
    style={[{gap:8},rest.style as object]}>
    {views.length>1?<View accessibilityRole="tablist" style={{flexDirection:"row",gap:4}}>
      {views.map(v=><Pressable key={v} accessibilityRole="tab" accessibilityState={{selected:view===v}}
        onPress={()=>store.set(s=>({...s,view:v}))}
        {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(view===v?"border-accent bg-accent/10":"border-transparent"))}}
        style={{minHeight:OFFICE_TOUCH_TARGET,paddingHorizontal:12,justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text text-sm")}} style={{fontWeight:view===v?"600":"400"}}>
          {v==="headings"?"Headings":v==="pages"?"Pages":"Bookmarks"}
        </Text>
      </Pressable>)}
    </View>:null}
    <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:2}}>
      {view==="headings"?(rows.length===0
        ?<Text {...{className:muted}}>No headings yet. Apply a heading style to a paragraph and it appears here.</Text>
        :rows.map((row,r)=>{
          const on=r===currentRow;
          const h=row.heading;
          const onKeyDown=(e:OfficeKeyEvent)=>{
            const {key}=officeKey(e);
            const go=(k:number)=>{const t=rows[k];if(t)onJumpToHeading(t.heading);};
            if(key==="ArrowDown")go(r+1);
            else if(key==="ArrowUp")go(r-1);
            else if(key==="ArrowLeft"&&row.hasChildren&&!row.collapsed)toggle(h.id);
            else if(key==="ArrowRight"&&row.collapsed)toggle(h.id);
            else return;
            (e as unknown as {preventDefault?:()=>void}).preventDefault?.();
          };
          return <View key={h.id} style={{flexDirection:"row",alignItems:"center",paddingStart:row.depth*16}}>
            {row.hasChildren?<Pressable accessibilityRole="button" accessibilityLabel={(row.collapsed?"Expand ":"Collapse ")+h.text}
              accessibilityState={{expanded:!row.collapsed}} onPress={()=>toggle(h.id)}
              {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
              style={{width:OFFICE_TOUCH_TARGET,height:OFFICE_TOUCH_TARGET,alignItems:"center",justifyContent:"center"}}>
              <ChevronGlyph styled={styled} open={!row.collapsed}/>
            </Pressable>:<View style={{width:OFFICE_TOUCH_TARGET}}/>}
            <Pressable accessibilityRole="link" accessibilityLabel={"Heading "+h.level+", "+h.text}
              accessibilityState={{selected:on}} onPress={()=>onJumpToHeading(h)} {...{onKeyDown,"aria-current":on?"location":undefined}}
              {...{className:rowClass(on)}}
              style={{flex:1,minWidth:0,minHeight:OFFICE_TOUCH_TARGET,flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:8}}>
              <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text")}}
                style={{flex:1,fontWeight:h.level===1?"700":on?"600":"400",fontSize:h.level===1?16:15}}>{h.text||"Untitled heading"}</Text>
              {h.page!==undefined?<Text {...{className:muted}} style={{fontVariant:["tabular-nums"]}}>{h.page+1}</Text>:null}
            </Pressable>
          </View>;
        }))
      :view==="pages"?headingsByPage(headings,pageCount??0).map((h,page)=><Pressable key={page} accessibilityRole="link"
          accessibilityLabel={"Page "+(page+1)+(h?", "+h.text:"")} onPress={()=>onJumpToPage!(page)} {...{className:rowClass(false)}}
          style={{minHeight:OFFICE_TOUCH_TARGET,flexDirection:"row",alignItems:"center",gap:10,padding:6}}>
          {renderPageThumbnail?<View pointerEvents="none" {...{"aria-hidden":true,className:joinClasses(styled&&"border border-border bg-surface-raised")}}
            style={{width:48,height:64,overflow:"hidden"}}>{renderPageThumbnail(page)}</View>:null}
          <Text {...{className:joinClasses(styled&&"text-text")}} style={{fontVariant:["tabular-nums"],minWidth:56}}>{"Page "+(page+1)}</Text>
          <Text numberOfLines={1} {...{className:muted}} style={{flex:1}}>{h?.text??""}</Text>
        </Pressable>)
      :(bookmarks??[]).length===0?<Text {...{className:muted}}>No bookmarks in this document.</Text>
      :(bookmarks??[]).map(b=><Pressable key={b.id} accessibilityRole="link" accessibilityLabel={"Bookmark "+b.name}
          onPress={()=>onJumpToBookmark!(b)} {...{className:rowClass(false)}}
          style={{minHeight:OFFICE_TOUCH_TARGET,flexDirection:"row",alignItems:"center",gap:8,paddingHorizontal:8}}>
          <Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text")}} style={{flex:1}}>{b.name}</Text>
          {b.page!==undefined?<Text {...{className:muted}}>{"Page "+(b.page+1)}</Text>:null}
        </Pressable>)}
    </ScrollView>
  <ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/></View>;
}
