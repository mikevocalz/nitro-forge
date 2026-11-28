import test from 'node:test';
import assert from 'node:assert/strict';
import {ARTBOARD_MAX,artboardColumns,artboardDropIndex,artboardKeyAction,newArtboardOp,validateArtboards} from '../src/layers/artboard-model.ts';
const board={id:'a',name:'Page',x:0,y:0,w:300,h:200,revision:0};
test('artboard metadata and thumbnail versions reject unrenderable values',()=>{validateArtboards([board]);for(const change of [{id:' '},{name:'x'.repeat(513)},{revision:-1},{revision:.5},{x:1e308,w:1e308}])assert.throws(()=>validateArtboards([{...board,...change}]));});
test('adding at the render limit or beyond representable coordinates is rejected before a host request',()=>{assert.throws(()=>newArtboardOp(Array.from({length:ARTBOARD_MAX},(_,i)=>({...board,id:String(i)}))),/limit/);assert.throws(()=>newArtboardOp([{...board,x:1e30}]),/representable/);assert.equal(newArtboardOp([board]).x,400);});
test('drop, key and grid metrics never return NaN or unbounded columns',()=>{assert.equal(artboardColumns(1e30),ARTBOARD_MAX);assert.throws(()=>artboardColumns(300,-1));for(const columns of [NaN,Infinity,0,1.5]){assert.throws(()=>artboardDropIndex({from:0,dx:0,dy:0,count:3,columns,cellWidth:100,cellHeight:100}));assert.throws(()=>artboardKeyAction('ArrowDown',{index:0,count:3,columns,layout:'grid'}));}});
