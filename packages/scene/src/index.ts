import {DocumentHandle,type EngineHost} from '@nitro-forge/ignition';

/** Right-handed world, +Y up. Rotation is euler degrees [x,y,z] composed R = Rz·Ry·Rx; local matrix is T·R·S and world is the parent-chain product (root parent id 0). */
export interface SceneTransform{translation:[number,number,number];rotation_deg:[number,number,number];scale:[number,number,number]}
export type SceneNodeKind='group'|'layer'|'mesh'|'camera'|'light';
export interface SceneCameraParams{type:'perspective'|'orthographic';fov_y_degrees?:number;half_height?:number;near?:number;far?:number}
/** Linear-space RGB 0..=1. Directional `direction` is the local vector the light travels (normalized at write); `range` is point-light only. */
export interface SceneLightParams{type:'ambient'|'directional'|'point';color?:SceneColor;intensity?:number;direction?:[number,number,number];range?:number}
export interface SceneNode{id:number;kind:SceneNodeKind;name:string;parent:number;transform:SceneTransform;visible:boolean;mesh?:number;camera?:SceneCameraParams;light?:SceneLightParams}
/** `#RRGGBB`/`#RRGGBBAA` or linear [r,g,b(,a)] in 0..=1; converted to linear at write. */
export type SceneColor=string|readonly[number,number,number]|readonly[number,number,number,number];
/** PBR-state material: semantic channels stored verbatim; shading is the host rasterizer's admitted Phong approximation, not PBR. `texture` is a host-side asset name — pixels never enter engine state. */
export interface SceneMaterial{id:number;name:string;color:[number,number,number];metallic:number;roughness:number;specular:[number,number,number];emission:[number,number,number];texture?:string;texture_filter:'nearest'|'bilinear';double_sided:boolean}
/** Custom geometry: canonical base64 of little-endian f32 triples (xyz) / u32 indices. `material` references an existing material; there is no implicit default. */
export interface SceneMesh{id:number;name:string;material:number;positions_b64:string;normals_b64?:string;uvs_b64?:string;indices_b64?:string}
export interface SceneState{kind:'scene';schema:1;name:string;revision:number;next_id:number;nodes:Record<string,SceneNode>;meshes:Record<string,SceneMesh>;materials:Record<string,SceneMaterial>}

export interface SceneBounds{min:[number,number,number];max:[number,number,number]}
export interface ScenePickHit{node_id:number;mesh_id:number;triangle:number;distance:number;point:[number,number,number];normal:[number,number,number]}
export interface ScenePickResult{hit:ScenePickHit|null;triangles_tested:number}
/** Host-side texture payloads: name → {width,height,bytes_b64} RGBA8. Passed through to scene-render unchanged; every material texture reference must resolve here. */
export type SceneTextures=Record<string,{width:number;height:number;bytes_b64:string}>;
export interface SceneRenderRequest{width:number;height:number;format?:'raw'|'png';camera_node?:number;camera?:unknown;textures?:SceneTextures;background?:SceneColor}
/** The canonical scene-render description. The engine never rasterizes — submit this object unchanged to the scene-render service. */
export type SceneRenderDescription=Record<string,unknown>&{width:number;height:number;format:string;camera:unknown;lights:unknown[];materials:unknown[];textures:Record<string,unknown>;meshes:unknown[]};

export type ScenePrimitiveKind='box'|'plane'|'sphere'|'cylinder'|'torus';
export interface ScenePrimitiveParams{kind:ScenePrimitiveKind;size?:[number,number,number];width?:number;depth?:number;width_segments?:number;depth_segments?:number;radius?:number;height?:number;latitude_segments?:number;longitude_segments?:number;radial_segments?:number;major_radius?:number;minor_radius?:number;major_segments?:number;minor_segments?:number;material?:number;name?:string}
/** Material write shape: color channels accept `#RRGGBB[AA]` or linear floats; stored state always reports linear `[r,g,b]` triples. */
export type SceneMaterialInput=Partial<Omit<SceneMaterial,'id'|'color'|'specular'|'emission'>>&{color?:SceneColor;specular?:SceneColor;emission?:SceneColor};

/** Scene document (engine kind `scene`, tag 11): owns document state only — the scene graph, mesh geometry, PBR-state materials, cameras and lights. Rendering stays host-side through the scene-render service; `renderFrame` emits the canonical description, it never produces pixels. */
export class SceneDocument{
 private constructor(private readonly document:DocumentHandle){}
 static async open(host:EngineHost,name=''){return new SceneDocument(await DocumentHandle.openInitialized(host,'scene',doc=>doc.apply('new',{name})));}
 static async openSnapshot(host:EngineHost,bytes:Uint8Array){return new SceneDocument(await DocumentHandle.openSnapshot(host,'scene',bytes));}
 get handle(){return this.document;}
 describe(){return this.document.apply<SceneState>('describe',{});}
 /** kind mesh requires `mesh` (an existing mesh id); camera requires `camera` params; light requires `light` params. Transform fields may be flat or nested under `transform`. */
 addNode(options:{kind:SceneNodeKind;mesh?:number;camera?:SceneCameraParams;light?:SceneLightParams}&Partial<Pick<SceneNode,'name'|'parent'|'visible'>>&Partial<SceneTransform>){return this.document.apply<{node_id:number}>('addNode',options);}
 /** `parent` reparents (0 = root); reparenting that would create a cycle rejects atomically. `removeNode` deletes the whole subtree. */
 updateNode(id:number,patch:Partial<Pick<SceneNode,'name'|'visible'|'parent'>>){return this.document.apply<{ok:boolean}>('updateNode',{...patch,id});}
 /** Partial TRS patch; flat keys or a nested `transform` object, merged onto current values. */
 setTransform(id:number,patch:Partial<SceneTransform>|{transform:Partial<SceneTransform>}){const flat:Record<string,unknown>={id};for(const[k,v]of Object.entries(patch))if(k==='transform')flat.transform=v;else flat[k]=v;return this.document.apply<{ok:boolean}>('setTransform',flat);}
 removeNode(id:number){return this.document.apply<{ok:boolean}>('removeNode',{id});}
 /** Deep-copies the node's subtree under the same parent with fresh ids; `name` renames only the duplicated root. */
 duplicateNode(id:number,name?:string){return this.document.apply<{node_id:number;count:number}>('duplicateNode',{id,...(name===undefined?{}:{name})});}
 addMaterial(patch:SceneMaterialInput={}){return this.document.apply<{material_id:number}>('addMaterial',patch);}
 updateMaterial(id:number,patch:SceneMaterialInput){return this.document.apply<{ok:boolean}>('updateMaterial',{...patch,id});}
 /** Rejects while any mesh still references the material (validation is whole-document). */
 removeMaterial(id:number){return this.document.apply<{ok:boolean}>('removeMaterial',{id});}
 /** `positions_b64` is required and any supplied geometry key replaces the whole attribute set. Omitted `material` takes the lowest-id material on add. */
 addMesh(patch:{positions_b64:string;normals_b64?:string;uvs_b64?:string;indices_b64?:string}&Partial<Pick<SceneMesh,'name'|'material'>>){return this.document.apply<{mesh_id:number}>('addMesh',patch);}
 updateMesh(id:number,patch:{positions_b64?:string;normals_b64?:string|null;uvs_b64?:string|null;indices_b64?:string|null}&Partial<Pick<SceneMesh,'name'|'material'>>){return this.document.apply<{ok:boolean}>('updateMesh',{...patch,id});}
 removeMesh(id:number){return this.document.apply<{ok:boolean}>('removeMesh',{id});}
 /** Reassigns which material a mesh uses; both ids must exist. */
 setMaterial(mesh:number,material:number){return this.document.apply<{ok:boolean}>('setMaterial',{mesh,material});}
 /** Deterministic in-engine primitive (box/plane/sphere/cylinder/torus) as a new mesh; see packages/scene/rust/src/primitives.rs for parameters and bounds. */
 addMeshPrimitive(options:ScenePrimitiveParams){return this.document.apply<{mesh_id:number}>('addMeshPrimitive',options);}
 /** World-space AABB over every visible mesh vertex; `{bounds:null}` when nothing visible renders. */
 bounds(){return this.document.apply<{bounds:SceneBounds|null}>('bounds',{});}
 /** Nearest ray→triangle hit over visible mesh geometry, both faces; world-space point and face normal. */
 pick(origin:[number,number,number],direction:[number,number,number]){return this.document.apply<ScenePickResult>('pick',{origin,direction});}
 /** Canonical scene-render description (world-space meshes, re-indexed materials, resolved camera/lights). The host submits it unchanged to scene-render; texture pixel payloads pass through via `textures`. */
 renderFrame(request:SceneRenderRequest){return this.document.apply<SceneRenderDescription>('renderFrame',request);}
 save(){return this.document.snapshot();}undo(){return this.document.undo();}redo(){return this.document.redo();}close(){return this.document.close();}
}
