import {expect,it} from 'vitest';
import {base64ToBytes,bytesToBase64} from '../src/base64';

it('decodes padded and unpadded text vectors without changing bytes',()=>{
 for(const [text,encoded] of [['',''],['f','Zg=='],['fo','Zm8='],['foo','Zm9v'],['foob','Zm9vYg=='],['fooba','Zm9vYmE='],['foobar','Zm9vYmFy']]){
  expect([...base64ToBytes(encoded!)]).toEqual([...Buffer.from(text!)]);
  expect([...base64ToBytes(encoded!.replace(/=+$/,''))]).toEqual([...Buffer.from(text!)]);
 }
});

it('matches an independent byte encoder for every byte and nonzero-offset subviews',()=>{
 const storage=Uint8Array.from({length:1026},(_,index)=>index%256);
 for(let length=0;length<=1024;length++){
  const input=storage.subarray(1,length+1);
  const encoded=Buffer.from(input).toString('base64');
  expect(bytesToBase64(input)).toBe(encoded);
  expect(base64ToBytes(encoded)).toEqual(input);
 }
});

it('rejects non-ASCII lookalikes, malformed padding and nonzero unused bits',()=>{
 for(const input of ['ĀĀĀĀĀĀ==','😀AA==','ＡＡ==','\u0100AAA','A','A===','====','AA=','AA===','AA==AA==','AA=A','Zg===','Zh==','Zm9=','Zh','Zm9','AA\nA','AA A','AA-_']){
  expect(()=>base64ToBytes(input),JSON.stringify(input)).toThrow(/base64/);
 }
});
