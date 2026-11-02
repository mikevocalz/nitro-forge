import { describe, expect, it } from "vitest";
import { boardTransform, projectPointer, strokeToSegments } from "../src/geometry";

describe("native ink geometry", () => {
  it("preserves true pressure and ordered segment coordinates", () => {
    const segments = strokeToSegments({
      kind: "stroke", id: "ink-01", color: "#112233", baseWidth: 8,
      opacity: 0.5,
      points: [{x:1, y:2, pressure:0.25},{x:3,y:4,pressure:0.75}],
    });
    expect(segments).toEqual([{
      id:"ink-01", x1:1, y1:2, x2:3, y2:4,
      width:4, color:"#112233", opacity:0.5, dot:false,
    }]);
  });
  it("renders a tap as a dot and does not fabricate source pressure", () => {
    const dot = strokeToSegments({
      kind:"stroke",id:"d",color:"red",baseWidth:6,points:[{x:1,y:2}],
    });
    expect(dot).toHaveLength(1);
    expect(dot[0]?.dot).toBe(true);
    expect(dot[0]?.width).toBe(6); // base brush width, sample pressure absent
  });
  it("rejects corrupt geometry instead of drawing gaps or unsafe paths", () => {
    expect(strokeToSegments({
      kind:"stroke",id:"bad",color:"black",baseWidth:-1,points:[{x:1,y:2}],
    })).toHaveLength(0);
    expect(strokeToSegments({
      kind:"stroke",id:"bad",color:"black",baseWidth:4,
      points:[{x:1,y:2},{x:NaN,y:2}],
    })).toHaveLength(0);
    expect(strokeToSegments({
      kind:"stroke",id:"empty",color:"black",baseWidth:2,points:[],
    })).toHaveLength(0);
  });
  it("clamps valid out-of-range pressure for a display width only", () => {
    const s = strokeToSegments({
      kind:"stroke",id:"a",color:"red",baseWidth:10,
      points:[{x:0,y:0,pressure:-2},{x:1,y:1,pressure:3}],
    });
    expect(s[0]?.width).toBe(5);
  });
  it("uses one uniform scale, centers content and inverts pointer coordinates", () => {
    const xform = boardTransform(1000,500,400,400);
    expect(xform).toEqual({scale:0.4,offsetX:0,offsetY:100});
    expect(projectPointer(200,200,1000,500,xform!)).toEqual([500,250]);
    expect(projectPointer(200,10,1000,500,xform!)).toBeNull();
    expect(projectPointer(200,10,1000,500,xform!,true)).toEqual([500,0]);
  });
  it("rejects invalid or non-invertible board layouts", () => {
    expect(boardTransform(0,500,400,400)).toBeNull();
    expect(boardTransform(1000,500,Infinity,400)).toBeNull();
    expect(projectPointer(NaN,1,100,100,{scale:1,offsetX:0,offsetY:0})).toBeNull();
  });
});
