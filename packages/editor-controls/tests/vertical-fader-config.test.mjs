import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from '@typescript/typescript6';
import * as audioPreview from '../src/audio/audio-preview-owner.ts';
import * as level from '../src/audio/level.ts';
import {audioTargetSize} from '../src/audio/audio-chrome.ts';
import * as exactOptional from '../src/exact-optional.ts';
import * as designTokens from '../src/tokens.ts';

test('vertical fader uses compatible RNGH axis activation and failure thresholds',()=>{
  let pan;
  const element=(type,props)=>({type,props});
  const mocks={
    react:{useRef:value=>({current:value}),useLayoutEffect:()=>{}},
    'react/jsx-runtime':{jsx:element,jsxs:element},
    'react-native':{Text:'Text',TextInput:'TextInput',View:'View'},
    'react-native-gesture-handler':{
      GestureDetector:'GestureDetector',
      usePanGesture:config=>{
        // RNGH 3 rejects minDistance combined with any axis offset.
        assert.ok(config.minDistance===undefined||[config.activeOffsetX,config.activeOffsetY,config.failOffsetX,config.failOffsetY].every(v=>v===undefined));
        pan=config;return config;
      },
      useTapGesture:config=>config,useCompetingGestures:(...gestures)=>gestures,
    },
    'zustand/vanilla':{createStore:init=>{let state=init();return {getState:()=>state,setState:next=>{state={...state,...next};}};}},
    zustand:{useStore:(store,selector)=>selector(store.getState())},
    './audio-preview-owner.ts':audioPreview,'./audio-chrome.ts':{audioTargetSize},'./level.ts':level,'../exact-optional.ts':exactOptional,'../tokens.ts':designTokens,
    '@nyc-tron/ui/components/Button':{Button:'Button'},'@nyc-tron/ui/components/feedback/ErrorMessage':{ErrorMessage:'ErrorMessage'},
    '../inputs/useScopedControl.ts':{controlIdentity:(...parts)=>parts,useScopedControl:(_owner,props)=>({pending:false,current:()=>props,run:()=>{}})},
  };
  const code=ts.transpileModule(readFileSync(new URL('../src/audio/LevelFader.vertical.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  const exports={};
  runInNewContext(code,{exports,require:name=>{assert.ok(name in mocks,`Unexpected import ${name}`);return mocks[name];}});
  exports.NativeVerticalFader({value:0.5,label:'Bass',onCommit:()=>{}});
  assert.deepEqual(Array.from(pan.activeOffsetY),[-4,4]);
  assert.deepEqual(Array.from(pan.failOffsetX),[-8,8]);
  assert.equal(pan.maxPointers,1);
});

test('queued old vertical callbacks cannot clear a replacement source preview or commit',()=>{
 const refs=[],effects=[];let cursor=0,pan,tap,blocked=false;
 const element=(type,props)=>({type,props}),mocks={
  react:{useRef:value=>refs[cursor++]??={current:value},useLayoutEffect:fn=>effects.push(fn)},
  'react/jsx-runtime':{jsx:element,jsxs:element},'react-native':{Text:'Text',TextInput:'TextInput',View:'View'},
  'react-native-gesture-handler':{GestureDetector:'GestureDetector',usePanGesture:config=>{pan=config;return config;},useTapGesture:config=>{tap=config;return config;},useCompetingGestures:(...v)=>v},
  'zustand/vanilla':{createStore:init=>{let state=init();return{getState:()=>state,setState:patch=>{state={...state,...patch};}};}},zustand:{useStore:(store,selector)=>selector(store.getState())},
  './audio-preview-owner.ts':audioPreview,'./audio-chrome.ts':{audioTargetSize},'./level.ts':level,'../exact-optional.ts':exactOptional,'../tokens.ts':designTokens,'@nyc-tron/ui/components/Button':{Button:'Button'},'@nyc-tron/ui/components/feedback/ErrorMessage':{ErrorMessage:'ErrorMessage'},
  '../inputs/useScopedControl.ts':{controlIdentity:(...parts)=>parts,useScopedControl:(_owner,props)=>({pending:false,current:()=>blocked?null:props,run:(_id,fn)=>{assert.equal(blocked,false,'blocked callbacks cannot reach host write');return Promise.resolve(fn(props));}})},
 };
 const code=ts.transpileModule(readFileSync(new URL('../src/audio/LevelFader.vertical.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};runInNewContext(code,{exports,require:name=>{assert.ok(name in mocks,`Unexpected import ${name}`);return mocks[name];}});
 let cleanups=[];const render=props=>{cursor=0;effects.length=0;const tree=exports.NativeVerticalFader(props);for(const cleanup of cleanups)cleanup?.();cleanups=effects.map(fn=>fn());return tree;};
 const oldPreview=[],newPreview=[],oldCommits=[],newCommits=[];
 const oldTree=render({scope:'old',value:0.5,label:'Bass',onPreview:v=>oldPreview.push(v),onCommit:v=>oldCommits.push(v)}),oldPan=pan,oldTap=tap;
 oldPan.onActivate({translationY:-10});assert.equal(oldPreview.length,1);
 const newTree=render({scope:'new',value:0.2,label:'Bass',onPreview:v=>newPreview.push(v),onCommit:v=>newCommits.push(v)});
 const newPan=pan;newPan.onActivate({translationY:-20});const newLive=newPreview.at(-1);assert.ok(newLive>0.2);
 oldPan.onDeactivate({translationY:-30,canceled:false});oldPan.onFinalize({canceled:true});oldTap.onBegin();oldTap.onActivate();
 // Old numeric/key/reset callbacks also must not alter the newer store before admission.
 const walk=(node,visit)=>{if(!node||typeof node!=='object')return;visit(node);for(const child of [node.props?.children].flat(Infinity))walk(child,visit);};
 let oldInput,newInput;walk(oldTree,node=>{if(node.type==='TextInput')oldInput=node;});walk(newTree,node=>{if(node.type==='TextInput')newInput=node;});newInput.props.onChangeText('0');oldInput.props.onSubmitEditing();
 blocked=true;tap.onBegin();tap.onActivate();newInput.props.onChangeText('3');newInput.props.onSubmitEditing();newPan.onActivate({translationY:-60});newPan.onUpdate({translationY:-60});newPan.onDeactivate({translationY:-60,canceled:false});newPan.onFinalize({canceled:true});walk(newTree,node=>{node.props?.onKeyDown?.({key:'Home',preventDefault(){}});if(node.props?.title==='Reset unity'||node.props?.title==='Fine off')node.props.onPress();});blocked=false;tap.onActivate();
 walk(oldTree,node=>{node.props?.onKeyDown?.({key:'Home',preventDefault(){}});if(node.props?.title==='Reset unity')node.props.onPress();});
 assert.deepEqual(oldCommits,[]);assert.deepEqual(newCommits,[]);assert.deepEqual(newPreview,[newLive]);
 newPan.onDeactivate({translationY:-20,canceled:false});assert.equal(newCommits.length,1);assert.ok(Math.abs(newCommits[0]-newLive)<1e-12);assert.equal(newPreview.at(-1),newLive);newInput.props.onSubmitEditing();assert.equal(newCommits.length,2);assert.equal(newCommits[1],1);
 let armed=false,replacementPan,replacementLive;const abandoned=[],replacement=[];
 render({scope:'restore-old',value:0.5,label:'Bass',onCommit:v=>{abandoned.push(v);return false;},onPreview:v=>{if(armed&&v===0.5){armed=false;render({scope:'restore-new',value:0.2,label:'Bass',onCommit:v=>replacement.push(v),onPreview:v=>{replacementLive=v;}});replacementPan=pan;replacementPan.onActivate({translationY:-20});}}});
 const beforeReplacement=pan;beforeReplacement.onActivate({translationY:-10});armed=true;beforeReplacement.onDeactivate({translationY:-10,canceled:false});
 const sharedStore=refs.map(v=>v.current).find(v=>v?.getState&&'fine' in v.getState());
 assert.equal(abandoned.length,1);assert.ok(replacementLive>0.2);assert.equal(sharedStore.getState().preview,replacementLive,'old commit must not clear reentrant replacement preview');
 replacementPan.onDeactivate({translationY:-20,canceled:false});assert.equal(replacement.length,1);
});
