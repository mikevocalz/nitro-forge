import test from "node:test";
import assert from "node:assert/strict";
import {validatePatchGraph,getPortAnchor,cubicGraphPoints,compatiblePorts,GRAPH_PORT_ROW_HEIGHT} from "../src/graph/model.ts";
const nodes=[
 {id:"source",title:"Mic",x:0,y:50,inputs:[],outputs:[{id:"out",label:"PCM",dataType:"audio"}]},
 {id:"effect",title:"Filter",x:320,y:50,inputs:[{id:"in",label:"PCM",dataType:"audio"}],outputs:[{id:"out",label:"PCM",dataType:"audio"}]},
];
test("graph validates real directional typed endpoints and port anchors",()=>{
 const e=[{id:"patch",from:{nodeId:"source",portId:"out"},to:{nodeId:"effect",portId:"in"}}];
 assert.doesNotThrow(()=>validatePatchGraph(nodes,e));
 assert.equal(GRAPH_PORT_ROW_HEIGHT,44,"ports must be 44pt touch targets");
 assert.deepEqual(getPortAnchor(nodes[0],"out","output"),{x:194,y:116});
 assert.deepEqual(getPortAnchor(nodes[1],"in","input"),{x:326,y:116});
 assert.throws(()=>validatePatchGraph(nodes,[{...e[0],to:{nodeId:"effect",portId:"out"}}]),/Invalid/);
 assert.throws(()=>validatePatchGraph([...nodes,nodes[0]],e),/Invalid/);
 assert.equal(compatiblePorts({nodeId:"a",portId:"o",dataType:"audio"},{nodeId:"b",portId:"i",dataType:"audio"}),true);
 assert.equal(compatiblePorts({nodeId:"a",portId:"o",dataType:"audio"},{nodeId:"b",portId:"i",dataType:"video"}),false);
});
test("cubic graph wire math starts and ends exactly, bounds work",()=>{
 const a={x:20,y:40},b={x:300,y:60};
 const p=cubicGraphPoints(a,b,16);
 assert.deepEqual(p[0],a);
 assert.deepEqual(p[p.length-1],b);
 assert.equal(p.length,17);
 assert.throws(()=>cubicGraphPoints(a,b,100),/curve/);
});
