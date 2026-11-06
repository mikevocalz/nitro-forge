import type {WorkspaceSession,WorkspaceState} from './workspace';
/** Parses opaque persisted layouts using the consuming UI's actual validator. */
export function workspaceUiView<L>(session:WorkspaceSession,parseLayout:(value:unknown)=>L){
 const s=session.state;
 return {activeModeId:s.activeModeId,...(s.activePresetId?{activeId:s.activePresetId}:{}),
  layouts:Object.fromEntries(Object.entries(s.layouts).map(([id,value])=>[id,parseLayout(value)])),
  presets:s.presets.map(p=>({id:p.id,name:p.name,builtIn:p.builtIn,modified:p.id===s.activePresetId&&JSON.stringify(s.layouts[p.modeId])!==JSON.stringify(p.layout)}))};
}
/** Binds the host/preset controls to one session; layout persistence never edits the engine document. */
export function workspaceUiBindings(session:WorkspaceSession,onChanged:(state:WorkspaceState)=>void){
 const publish=(state:WorkspaceState)=>{onChanged(state);};
 return {
  onModeChange:(id:string)=>publish(session.setMode(id)),onLayoutChange:(id:string,layout:unknown)=>publish(session.setLayout(id,layout)),
  onSelect:(id:string)=>publish(session.selectPreset(id)),onSaveAs:(name:string)=>publish(session.saveAsPreset(name).state),
  onRename:(id:string,name:string)=>publish(session.renamePreset(id,name)),onDuplicate:(id:string)=>publish(session.duplicatePreset(id).state),
  onDelete:(id:string)=>{const r=session.deletePreset(id);publish(r.state);return r;},
  onReset:(id:string)=>publish(session.resetPreset(id)),
 };
}
