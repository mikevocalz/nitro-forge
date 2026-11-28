import {Select} from '@nyc-tron/ui/components/Select';
import {ErrorMessage} from '@nyc-tron/ui/components/feedback/ErrorMessage';
import {controlIdentity,useScopedControl,type ScopedControlProps} from '../inputs/useScopedControl.ts';
import {Pressable,SectionList,Text,TextInput,View,type ViewProps} from "react-native";
import {joinClasses} from "@nyc-tron/ui/components/styles";
import {Button} from "@nyc-tron/ui/components/Button";
import {useLocalStore} from "@nyc-tron/ui/components/useLocalStore";
import {OFFICE_TOUCH_TARGET,ToolButton} from "../office/office-controls.tsx";
import {groupThreads,resolveReply,threadCounts,threadLabel,type CommentEntry,type CommentFilter,type CommentThread} from "./comments-model.ts";

/** Props for {@linkcode CommentsThreadPanel}. Each action renders only when its callback is passed. */
export interface CommentsThreadPanelProps extends Omit<ViewProps,"children">,ScopedControlProps {
  readonly threads:readonly CommentThread[];
  readonly groupBy?:'page'|'none';
  readonly describeLocation?:(thread:CommentThread)=>string;
  readonly selectedId?:string;
  readonly disabled?:boolean;
  readonly mentions?:readonly {id:string;label:string}[];
  /** Shows the thread's page and anchor. */
  readonly onSelect:(id:string)=>void;
  /** Adds a reply. Rejecting keeps the draft so nothing typed is lost. */
  readonly onReply?:(threadId:string,body:string,mentions?:readonly string[])=>void|Promise<unknown>;
  readonly onResolvedChange?:(threadId:string,resolved:boolean)=>void|Promise<unknown>;
  readonly onDelete?:(threadId:string)=>void|Promise<unknown>;
  /** The filter row renders only when `onResolvedChange` is passed (otherwise nothing is ever resolved). */
  readonly filter?:CommentFilter;
  readonly onFilterChange?:(filter:CommentFilter)=>void;
  /** Read failed: shown instead of the list. "No comments" is only said after a successful read. */
  readonly error?:string;
  readonly onRetry?:()=>void;
  /** @default "Comments" */
  readonly label?:string;
  className?:string;
  unstyled?:boolean;
}

type Local={drafts:Record<string,string>;failed:Record<string,string>;busy:Record<string,boolean>;mentions:Record<string,readonly string[]>};

/**
 * PDF comment threads (K-07), grouped by page: author, time, body, replies,
 * and reply / resolve / delete when the host can save them. A failed reply
 * keeps its draft and shows the error under the field.
 */
export function CommentsThreadPanel({scope='comments',revision=0,...props}:CommentsThreadPanelProps){
 if(props.threads.length>4096||new Set(props.threads.map(t=>t.id)).size!==props.threads.length||props.threads.some(t=>!t.id.trim()||t.id.length>256||t.body.length>65536||t.replies.length>1024||t.replies.some(r=>r.body.length>65536))||(props.mentions?.length??0)>256)throw new RangeError('Invalid comment roster');
 const owner=JSON.stringify([...controlIdentity(scope,revision),props.disabled,props.disabledReason]),guard=useScopedControl(owner,props,!!props.disabled||props.disabledReason!==undefined);
 return <CommentsThreadPanelBody key={owner} {...props} actionError={guard.error} disabled={!!props.disabled||props.disabledReason!==undefined||guard.pending}
 onSelect={id=>{const h=guard.current();if(h?.threads.some(t=>t.id===id))h.onSelect(id);}} onFilterChange={props.onFilterChange?f=>guard.current()?.onFilterChange?.(f):undefined}
 onReply={props.onReply?async(id,body,mentions)=>{const ok=await guard.run('reply',h=>{if(!h.threads.some(t=>t.id===id&&!t.resolved))throw new Error('This comment thread is unavailable');return h.onReply?.(id,body,mentions?.filter(id=>h.mentions?.some(m=>m.id===id)));});if(ok!==true)throw new Error('The reply was not saved. Your draft is retained.');}:undefined}
 onResolvedChange={props.onResolvedChange?(id,resolved)=>guard.run('resolve',h=>h.onResolvedChange?.(id,resolved)):undefined}
 onDelete={props.onDelete?id=>guard.run('delete',h=>h.onDelete?.(id)):undefined} onRetry={props.onRetry?()=>guard.run('retry',h=>h.onRetry?.()):undefined}/>;
}
function CommentsThreadPanelBody({actionError,disabledReason,disabled=false,mentions=[],groupBy='page',describeLocation,

  threads,selectedId,onSelect,onReply,onResolvedChange,onDelete,filter="all",onFilterChange,error,onRetry,label="Comments",
  className,unstyled=false,...rest
}:CommentsThreadPanelProps&{actionError?:string|null}){
  const styled=!unstyled;
  const [local,store]=useLocalStore<Local>(()=>({drafts:{},failed:{},busy:{},mentions:{}}));
  const canFilter=onResolvedChange!==undefined&&onFilterChange!==undefined;
  const grouped=groupThreads(threads,canFilter?filter:'all'),groups=groupBy==='none'?[{page:0,threads:grouped.flatMap(g=>g.threads)}].filter(g=>g.threads.length>0):grouped;
  const counts=threadCounts(threads);
  const text=joinClasses(styled&&"text-text");
  const muted=joinClasses(styled&&"text-text-muted text-sm");
  const send=async(id:string)=>{
    const body=resolveReply(local.drafts[id]??"");
    if(!body||!onReply||disabled||local.busy[id])return;
    store.set(s=>({...s,busy:{...s.busy,[id]:true},failed:{...s.failed,[id]:""}}));
    try{
      await onReply(id,body,(local.mentions[id]??[]).filter(id=>{const person=mentions.find(m=>m.id===id);return person&&body.includes('@'+person.label);}));
      store.set(s=>({...s,drafts:{...s.drafts,[id]:""},busy:{...s.busy,[id]:false}}));
    }catch(e){
      store.set(s=>({...s,busy:{...s.busy,[id]:false},failed:{...s.failed,[id]:e instanceof Error?e.message:"The reply was not saved."}}));
    }
  };
  return <View {...rest} accessibilityLabel={label} {...{role:"region",className:joinClasses("min-w-0",className)}}
    style={[{gap:10},rest.style as object]}>
    <ErrorMessage message={actionError??disabledReason} unstyled={unstyled}/>
    {canFilter?<View accessibilityRole="radiogroup" accessibilityLabel="Show comments" style={{flexDirection:"row",gap:4,flexWrap:"wrap"}}>
      {(["open","resolved","all"] as const).map(f=><Pressable key={f} accessibilityRole="radio" accessibilityState={{checked:filter===f}}
        onPress={()=>onFilterChange!(f)}
        {...{className:joinClasses(styled&&"rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
          styled&&(filter===f?"border-accent bg-accent/10":"border-border"))}}
        style={{minHeight:OFFICE_TOUCH_TARGET,paddingHorizontal:12,justifyContent:"center"}}>
        <Text {...{className:joinClasses(styled&&"text-text text-sm")}}>{(f==="open"?"Open":f==="resolved"?"Resolved":"All")+" ("+counts[f]+")"}</Text>
      </Pressable>)}
    </View>:null}
    {error?<View style={{gap:8,alignItems:"flex-start"}}>
      <Text accessibilityLiveRegion="polite" {...{className:text}}>{error}</Text>
      {onRetry?<Button title="Load comments again" variant="secondary" size="sm" onPress={onRetry}/>:null}
    </View>
    :groups.length===0?<Text {...{className:muted}}>
      {threads.length===0?"No comments in this document.":filter==="resolved"?"No resolved comments.":"No open comments."}
    </Text>
    :<SectionList style={{flexShrink:1}} sections={groups.map(g=>({page:g.page,data:g.threads}))} keyExtractor={t=>t.id} keyboardShouldPersistTaps="handled" stickySectionHeadersEnabled={false}
      renderSectionHeader={({section:g})=>groupBy==='page'?<Text accessibilityRole="header" {...{className:joinClasses(styled&&'text-text text-sm font-semibold')}}>{'Page '+(g.page+1)}</Text>:null}
      renderItem={({item:t})=>{
          const on=t.id===selectedId;
          const draft=local.drafts[t.id]??"";
          const failed=local.failed[t.id];
          const busy=local.busy[t.id]===true||disabled;
          return <View key={t.id}
            {...{className:joinClasses(styled&&"rounded-card border",styled&&(on?"border-accent bg-surface-raised":"border-border bg-surface-raised"))}}
            style={{padding:10,gap:8,marginBottom:8,opacity:t.resolved?0.7:1}}>
            <Pressable accessibilityRole="button" accessibilityLabel={describeLocation?describeLocation(t)+', '+threadLabel(t).replace(/^Page [0-9]+, /,''):threadLabel(t)} accessibilityState={{selected:on}}
              accessibilityHint="Shows this comment on its page" onPress={()=>onSelect(t.id)}
              {...{className:joinClasses(styled&&"rounded-control focus-visible:ring-2 focus-visible:ring-focus")}}
              style={{minHeight:OFFICE_TOUCH_TARGET,gap:2,justifyContent:"center"}}>
              {describeLocation?<Text {...{className:muted}}>{describeLocation(t)}</Text>:null}<Entry entry={t} styled={styled}/>
            </Pressable>
            {t.replies.length?<View {...{className:joinClasses(styled&&"border-border")}} style={{gap:8,borderStartWidth:1,paddingStart:10}}>
              {t.replies.map(r=><Entry key={r.id} entry={r} styled={styled}/>)}
            </View>:null}
            {onReply&&!t.resolved?<View style={{gap:6}}>{mentions.length?<Select label="Mention collaborator" value="none" options={[{value:'none',label:'Mention someone',disabled:true},...mentions.map(m=>({value:m.id,label:m.label}))]} disabled={busy} unstyled={unstyled} onValueChange={id=>{const person=mentions.find(m=>m.id===id);if(!person)return;store.set(s=>({...s,drafts:{...s.drafts,[t.id]:(s.drafts[t.id]??'')+' @'+person.label+' '},mentions:{...s.mentions,[t.id]:[...new Set([...(s.mentions[t.id]??[]),id])]}}));}}/>:null}
              <View style={{flexDirection:"row",gap:6,alignItems:"center"}}>
                <TextInput value={draft} placeholder="Write a reply" accessibilityLabel={"Reply to "+(t.author??"comment on page "+(t.page+1))}
                  maxLength={65536} editable={!busy&&!disabled} onChangeText={v=>store.set(s=>({...s,drafts:{...s.drafts,[t.id]:v}}))}
                  onSubmitEditing={()=>void send(t.id)} returnKeyType="send"
                  {...{className:joinClasses(styled&&"rounded-control border border-border bg-surface-sunken text-text px-3 focus:border-focus")}}
                  style={{flex:1,minWidth:0,minHeight:OFFICE_TOUCH_TARGET}}/>
                <Button title="Reply" size="sm" variant="secondary" loading={busy} disabled={!resolveReply(draft)} onPress={()=>void send(t.id)}/>
              </View>
              {failed?<Text accessibilityLiveRegion="assertive" {...{className:joinClasses(styled&&"text-danger text-sm")}}>{failed}</Text>:null}
            </View>:null}
            {onResolvedChange||onDelete?<View style={{flexDirection:"row",gap:6,flexWrap:"wrap"}}>
              {onResolvedChange&&t.resolved!==undefined?<ToolButton label={t.resolved?"Reopen":"Resolve"} styled={styled}
                onPress={()=>void onResolvedChange(t.id,!t.resolved)}/>:null}
              {onDelete?<ToolButton label="Delete" styled={styled} accessibilityLabel={"Delete comment on page "+(t.page+1)}
                onPress={()=>void onDelete(t.id)}/>:null}
            </View>:null}
          </View>;
        }}/> }
  </View>;
}

function Entry({entry,styled}:{entry:CommentEntry;styled:boolean}){
  const meta=[entry.author,entry.timeLabel].filter(Boolean).join(", ");
  return <View style={{gap:2}}>
    {meta?<Text numberOfLines={1} {...{className:joinClasses(styled&&"text-text-muted text-sm")}} style={{fontWeight:"600"}}>{meta}</Text>:null}
    <Text selectable {...{className:joinClasses(styled&&"text-text")}} style={{lineHeight:21}}>
      {entry.body||"No note text"}
    </Text>
  </View>;
}
