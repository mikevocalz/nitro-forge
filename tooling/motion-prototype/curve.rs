//! Standalone scalar prototype, not a registered engine or renderer.
#[derive(Clone, Copy)]
pub struct Point { pub time: f64, pub value: f64 }
#[derive(Clone, Copy)]
pub enum Interpolation { Hold, Linear, Bezier }
#[derive(Clone, Copy)]
pub struct Key { pub at: Point, pub interpolation: Interpolation, pub incoming: Option<Point>, pub outgoing: Option<Point> }
fn cubic(a:f64,b:f64,c:f64,d:f64,u:f64)->f64 {
    let v=1.0-u;
    v*v*v*a+3.0*v*v*u*b+3.0*v*u*u*c+u*u*u*d
}
/// Validate the complete bounded curve before sampling; no mutation or clamping.
pub fn evaluate(keys:&[Key],base:f64,time:f64,duration:f64,minimum:f64,maximum:f64)->Result<f64,&'static str> {
    if ![base,time,duration,minimum,maximum].iter().all(|v|v.is_finite()) || minimum>=maximum || base<minimum || base>maximum || duration<=0.0 || duration>604800.0 || time<0.0 || time>duration || keys.len()>10000 { return Err("curve budget or bounds"); }
    for (i,key) in keys.iter().enumerate() {
        let p=key.at;
        if !p.time.is_finite() || !p.value.is_finite() || p.time<0.0 || p.time>duration || p.value<minimum || p.value>maximum || i>0 && p.time-keys[i-1].at.time<1e-6 { return Err("key bounds or separation"); }
        for (handle,lo,hi) in [(key.incoming,if i>0 {keys[i-1].at.time} else {0.0},p.time),(key.outgoing,p.time,keys.get(i+1).map_or(duration,|next|next.at.time))] {
            if let Some(h)=handle { if !h.time.is_finite() || !h.value.is_finite() || h.time<lo || h.time>hi || h.value<minimum || h.value>maximum { return Err("handle bounds"); } }
        }
    }
    let Some(first)=keys.first() else { return Ok(base) };
    if time<=first.at.time { return Ok(first.at.value) }
    for pair in keys.windows(2) {
        let (a,b)=(pair[0],pair[1]);
        if time==b.at.time { return Ok(b.at.value) }
        if time<b.at.time {
            return Ok(match a.interpolation {
                Interpolation::Hold=>a.at.value,
                Interpolation::Linear=>a.at.value+(b.at.value-a.at.value)*(time-a.at.time)/(b.at.time-a.at.time),
                Interpolation::Bezier=>{
                    let dt=b.at.time-a.at.time; let dv=b.at.value-a.at.value;
                    let c=a.outgoing.unwrap_or(Point{time:a.at.time+dt/3.0,value:a.at.value+dv/3.0});
                    let d=b.incoming.unwrap_or(Point{time:b.at.time-dt/3.0,value:b.at.value-dv/3.0});
                    let (mut lo,mut hi)=(0.0,1.0);
                    for _ in 0..64 {let u=(lo+hi)/2.0;if cubic(a.at.time,c.time,d.time,b.at.time,u)<time {lo=u} else {hi=u}}
                    cubic(a.at.value,c.value,d.value,b.at.value,(lo+hi)/2.0)
                }
            });
        }
    }
    Ok(keys.last().unwrap().at.value)
}
#[cfg(test)] mod tests {
 use super::*;
 fn key(time:f64,value:f64,interpolation:Interpolation)->Key { Key{at:Point{time,value},interpolation,incoming:None,outgoing:None} }
 fn sample(keys:&[Key],t:f64)->f64 { evaluate(keys,7.0,t,2.0,0.0,10.0).unwrap() }
 #[test] fn base_endpoints_hold_and_linear() {
  assert_eq!(sample(&[],0.5),7.0);
  let keys=[key(0.5,2.0,Interpolation::Hold),key(1.5,8.0,Interpolation::Linear)];
  assert_eq!(sample(&keys,0.0),2.0);assert_eq!(sample(&keys,1.499),2.0);assert_eq!(sample(&keys,1.5),8.0);assert_eq!(sample(&keys,2.0),8.0);
  let linear=[key(0.5,2.0,Interpolation::Linear),keys[1]];assert_eq!(sample(&linear,1.0),5.0);
 }
 #[test] fn bezier_inverts_actual_time_and_defaults_to_linear() {
  let mut keys=[key(0.0,0.0,Interpolation::Bezier),key(1.0,1.0,Interpolation::Linear)];
  assert!((sample(&keys,0.125)-0.125).abs()<1e-12);
  keys[0].outgoing=Some(Point{time:0.0,value:0.0});keys[1].incoming=Some(Point{time:0.0,value:1.0});
  // x(u)=u^3, so at t=.125 u=.5 and y(u)=.5, not y(.125).
  assert!((sample(&keys,0.125)-0.5).abs()<1e-12);
 }
 #[test] fn validates_unsampled_tail_and_handle_constraints() {
  let mut keys=[key(0.0,0.0,Interpolation::Linear),key(1.0,1.0,Interpolation::Linear)];
  keys[1].at.value=f64::NAN;assert!(evaluate(&keys,0.0,0.0,2.0,0.0,1.0).is_err());
  keys[1]=key(0.0,1.0,Interpolation::Linear);assert!(evaluate(&keys,0.0,0.0,2.0,0.0,1.0).is_err());
  keys[1]=key(1.0,1.0,Interpolation::Linear);keys[0].outgoing=Some(Point{time:1.1,value:0.5});assert!(evaluate(&keys,0.0,0.0,2.0,0.0,1.0).is_err());
  assert!(evaluate(&[],0.0,f64::INFINITY,2.0,0.0,1.0).is_err());
 }
}
