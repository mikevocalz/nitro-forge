import {useRef} from 'react';
import {View} from 'react-native';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import {Select} from '@nyc-tron/ui/components/Select';
import {MotionNodeGraphDemo} from './MotionNodeGraphDemo';
import {MotionExpressionDemo} from './MotionExpressionDemo';
import {MotionEffectsDemo} from './MotionEffectsDemo';
import {MotionPathDemo} from './MotionPathDemo';
import {CompositionTreeDemo} from './CompositionTreeDemo';
import {MotionSettingsDemo} from './MotionSettingsDemo';
import {MotionTimelineDemo} from './MotionTimelineDemo';
import {MotionCurvesDemo} from './MotionCurvesDemo';
import {MotionQueueDemo} from './MotionQueueDemo';
const sections=['Scene','Queue','Curves','Timeline','Layers','Path','Effects','Expression','Graph'] as const;
const makeStore=()=>createStore(()=>({section:'Scene' as typeof sections[number]}));
export function MotionWorkbenchDemo(){const local=useRef<ReturnType<typeof makeStore>|null>(null);local.current??=makeStore();const store=local.current,section=useStore(store,s=>s.section);return <View style={{flex:1,gap:8}}><Select testID="motion-component" label="Motion component" value={section} options={sections.map(value=>({value,label:value}))} onValueChange={section=>{if(sections.includes(section as typeof sections[number]))store.setState({section:section as typeof sections[number]});}}/>{section==='Scene'?<MotionSettingsDemo/>:section==='Queue'?<MotionQueueDemo/>:section==='Curves'?<MotionCurvesDemo/>:section==='Timeline'?<MotionTimelineDemo/>:section==='Layers'?<CompositionTreeDemo/>:section==='Path'?<MotionPathDemo/>:section==='Effects'?<MotionEffectsDemo/>:section==='Expression'?<MotionExpressionDemo/>:<MotionNodeGraphDemo/>}</View>;}
