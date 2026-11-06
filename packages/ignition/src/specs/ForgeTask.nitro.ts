import {Apple,Android,type HybridObject} from 'nitro-core';
import type {ForgeBinaryCommandResult} from '../contracts';
export * from '#nitro/ForgeTask';

/** Native-owned running command. Cancel is cooperative; result settles once. */
@Apple({language:'c++',implementation:{include:'<NitroForgeV1/HybridForgeTask.hpp>',className:'HybridForgeTask'}})
@Android({language:'c++',implementation:{include:'<NitroForgeV1/HybridForgeTask.hpp>',className:'HybridForgeTask'}})
export declare class ForgeTask extends HybridObject {
 /** Monotonic 0..1 checkpoint progress; not an estimate between checkpoints. */
 readonly progress:number;
 /** Requests cancellation at the next safe checkpoint, without waiting for the document queue. */
 cancel():void;
 /** Resolves to authoritative output or rejects with the engine error/cancelled code. */
 result():Promise<ForgeBinaryCommandResult>;
}
