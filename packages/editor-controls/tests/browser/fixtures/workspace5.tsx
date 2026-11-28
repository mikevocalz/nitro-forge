// The color dialog and presenter ink half of NYC-Tron UI's workspace5 page
// (the workspace host, presets and file transfer stayed in Tron's lane).
import {AppRegistry,Text,View,ScrollView} from 'react-native';
import {create} from 'zustand';
import {Button} from '@nyc-tron/ui/components/Button';
import {ColorPickerDialog} from '../../../src/color/ColorPickerDialog.tsx';
import {PresenterInkOverlay} from '../../../src/slides/PresenterInkOverlay.tsx';
import {PresenterInkStrip} from '../../../src/slides/PresenterInkStrip.tsx';
import type {PresenterInkMode,PresenterInkStroke} from '../../../src/slides/presenter-ink-model.ts';
type State={colorOpen:boolean;original:{h:number;s:number;v:number;alpha:number};draft:{h:number;s:number;v:number;alpha:number};ink:PresenterInkMode;strokes:PresenterInkStroke[];log:string[]};
const useDoc=create<State>(()=>({colorOpen:false,original:{h:210,s:0.6,v:0.8,alpha:1},draft:{h:210,s:0.6,v:0.8,alpha:1},ink:'pen',strokes:[],log:[]}));
const log=(v:string)=>useDoc.setState(s=>({log:[...s.log,v]}));
function App(){const s=useDoc();return <ScrollView contentContainerStyle={{padding:12,gap:16}} style={{flex:1}}>
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button title="Pick color" onPress={()=>useDoc.setState({colorOpen:true,draft:s.original})}/></View>
 <PresenterInkStrip mode={s.ink} onModeChange={ink=>useDoc.setState({ink})} strokeCount={s.strokes.length} onClear={()=>{useDoc.setState({strokes:[]});log('clear ink');}}/>
 <View testID="slide" style={{height:220,borderWidth:1}} className="border-border bg-surface-sunken"><Text>Presentation slide</Text><PresenterInkOverlay testID="ink-overlay" mode={s.ink} color="royalblue" size="m" strokes={s.strokes} onStrokeCommit={stroke=>{useDoc.setState(x=>({strokes:[...x.strokes,stroke]}));log('stroke '+stroke.points.length);}} onRemoveStrokes={ids=>{useDoc.setState(x=>({strokes:x.strokes.filter(p=>!ids.includes(p.id))}));log('erase '+ids.length);}} onModeChange={ink=>useDoc.setState({ink})}/></View>
 <Text testID="stroke-count">Strokes {s.strokes.length}</Text><Text testID="log">{s.log.join('\n')}</Text>
 <ColorPickerDialog visible={s.colorOpen} original={s.original} value={s.draft} onValueChange={draft=>useDoc.setState({draft})} onPreview={()=>log('preview')} onCommit={original=>{useDoc.setState({original,colorOpen:false});log('commit color');}} onCancel={()=>{useDoc.setState({colorOpen:false});log('cancel color');}}/>
 </ScrollView>;}
const q=new URLSearchParams(location.search);document.documentElement.dataset.theme=q.get('theme')??'light';document.documentElement.dir=q.get('dir')??'ltr';document.body.style.margin='0';AppRegistry.registerComponent('workspace5',()=>App);AppRegistry.runApplication('workspace5',{rootTag:document.getElementById('root')});
