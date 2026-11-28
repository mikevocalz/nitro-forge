/**
 * J/K/L shuttle (D-09). L plays forward and each further press climbs the
 * ladder; J does the same in reverse; K stops. Pressing the other direction
 * while shuttling first steps back down the current direction's ladder,
 * through pause, so speed changes in steps rather than jumping from 8x
 * forward to 1x reverse.
 */
export const DEFAULT_SHUTTLE_LADDER=[1,2,4,8] as const;

export function assertLadder(ladder:readonly number[]):void{
  if(!ladder.length||ladder.some((r,i)=>!Number.isFinite(r)||r<=0||(i>0&&r<=ladder[i-1]!)))
    throw new RangeError("Shuttle rates must be positive and ascending");
}

/**
 * The rate after a J, K or L press. Without reverse support J only slows
 * forward playback, a rung at a time, down to stopped.
 */
export function shuttleRate(rate:number,key:"j"|"k"|"l",ladder:readonly number[]=DEFAULT_SHUTTLE_LADDER,supportsReverse=false):number{
  assertLadder(ladder);
  if(key==="k")return 0;
  const dir=key==="l"?1:-1;
  if(dir===-1&&!supportsReverse)return rate>0?stepDown(rate,ladder):0;
  if(rate===0)return dir*ladder[0]!;
  if(Math.sign(rate)===dir){
    const i=ladder.findIndex(r=>r>Math.abs(rate)+1e-9);
    return dir*(i<0?ladder[ladder.length-1]!:ladder[i]!);
  }
  const down=stepDown(Math.abs(rate),ladder);
  return down===0?0:Math.sign(rate)*down;
}

/** One rung down; below the first rung is 0. */
function stepDown(speed:number,ladder:readonly number[]):number{
  let below=0;
  for(const r of ladder)if(r<speed-1e-9)below=r;
  return below;
}

/** "Stopped", "2x" or "Reverse 4x". */
export function shuttleLabel(rate:number):string{
  if(!Number.isFinite(rate))throw new RangeError("Rate must be finite");
  if(rate===0)return "Stopped";
  const x=Math.abs(rate).toFixed(2).replace(/\.?0+$/,"")+"x";
  return rate<0?"Reverse "+x:x;
}
