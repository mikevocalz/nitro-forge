import {View} from 'react-native';
import {AssetPresetGallery,type AssetPresetGalleryProps,type AssetPreset} from '../inputs/AssetPresetGallery.tsx';
import {PropertyInspector,type InspectorProperty} from '../inputs/PropertyInspector.tsx';
export interface PresentationPreset extends AssetPreset {kind:'theme'|'template'}
export interface ThemeAndTemplateGalleryProps extends Omit<AssetPresetGalleryProps,'label'|'items'> {
 presets:readonly PresentationPreset[];
 /** Actual theme roles, font options and document color IDs; unavailable resources must be admitted by the host. */
 themeFields:readonly InspectorProperty[];onThemeFieldCommit:(id:string,value:string|number|boolean,signal?:AbortSignal)=>unknown;
}
export function ThemeAndTemplateGallery({presets,themeFields,onThemeFieldCommit,...props}:ThemeAndTemplateGalleryProps){return <View style={{gap:12}}><AssetPresetGallery {...props} label="Slide themes and templates" items={presets.map(p=>({...p,description:p.kind+' · '+p.description}))}/><PropertyInspector scope={props.scope??'slide-theme'} revision={props.revision??0} disabledReason={props.disabledReason} unstyled={props.unstyled} label="Theme colors and fonts" fields={themeFields} onCommit={onThemeFieldCommit}/></View>;}
