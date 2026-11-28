import {View,Pressable,Text,type ViewProps} from 'react-native';
import {Select} from '@nyc-tron/ui/components/Select';
import {SegmentedControl} from '@nyc-tron/ui/components/SegmentedControl';
import {joinClasses} from '@nyc-tron/ui/components/styles';
import {validatePhotoRating,type PhotoRating} from './photo-adjustments.ts';
export type {PhotoRating} from './photo-adjustments.ts';
export interface RatingAndFlagControlProps extends Omit<ViewProps,'children'> {readonly value:PhotoRating;readonly onCommit:(value:PhotoRating)=>void;readonly disabled?:boolean;readonly unstyled?:boolean}
/** Independent star, named color-label and mutually exclusive pick/reject fields. */
export function RatingAndFlagControl({value,onCommit,disabled=false,unstyled=false,...props}:RatingAndFlagControlProps){
 validatePhotoRating(value);const set=(change:Partial<PhotoRating>)=>{if(disabled)return;const next={...value,...change};validatePhotoRating(next);if(JSON.stringify(next)!==JSON.stringify(value))onCommit(next);};
 return <View {...props} style={[{gap:8},props.style]}>
  <View accessibilityRole="radiogroup" accessibilityLabel="Photo star rating" style={{flexDirection:'row',flexWrap:'wrap',gap:4}}>{([0,1,2,3,4,5] as const).map(stars=><Pressable key={stars} accessibilityRole="radio" accessibilityLabel={stars===0?'Unrated':`${stars} stars`} accessibilityState={{checked:value.stars===stars,disabled}} aria-checked={value.stars===stars} disabled={disabled} onPress={()=>set({stars})} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Text {...{className:joinClasses(!unstyled&&'text-text')}}>{stars===0?'None':String(stars)}</Text></Pressable>)}</View>
  <Select label="Photo color label" value={value.label} options={(['none','red','yellow','green','blue','purple'] as const).map(value=>({value,label:value}))} disabled={disabled} unstyled={unstyled} onValueChange={label=>set({label:label as PhotoRating['label']})}/>
  <SegmentedControl aria-label="Photo flag" value={value.flag} options={[{value:'none',label:'Unflagged'},{value:'pick',label:'Pick'},{value:'reject',label:'Reject'}]} disabled={disabled} unstyled={unstyled} onChange={flag=>set({flag})}/>
 </View>;
}
