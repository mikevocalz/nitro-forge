import {Apple,Android,type HybridObject} from 'nitro-core';
export * from '#nitro/ForgeMediaCache';
/** Native bounded LRU for derived waveform/frame/thumbnail bytes. Keys must include source revision and options. */
@Apple({language:'c++',implementation:{include:'<NitroForgeV1/HybridForgeMediaCache.hpp>',className:'HybridForgeMediaCache'}})
@Android({language:'c++',implementation:{include:'<NitroForgeV1/HybridForgeMediaCache.hpp>',className:'HybridForgeMediaCache'}})
export declare class ForgeMediaCache extends HybridObject {
 /** Current payload bytes; key/container overhead is bounded separately by 4096 entries. */
 readonly byteSize:number;
 /** Returns an owned copy and marks the entry most recently used; undefined is a normal miss. */
 get(key:string):Promise<ArrayBuffer|undefined>;
 /** Copies input before queueing and evicts oldest entries to satisfy capacity. Oversized values reject. */
 put(key:string,bytes:ArrayBuffer):Promise<void>;
 remove(key:string):Promise<boolean>;
 clear():Promise<void>;
 /** Drops cached bytes and rejects future operations. */
 close():Promise<void>;
}
