/** Normalized point used by CurvesEditor; x is input and y is output. */
export interface CurvePoint { readonly id: string; readonly x: number; readonly y: number }
/** Host-owned transfer curve. The renderer explicitly uses linear or monotone cubic interpolation. */
export interface ColorCurve { readonly interpolation: "linear" | "monotone"; readonly points: readonly CurvePoint[] }
/** Normalized levels values consumed by LevelsEditor. */
export interface ColorLevels { readonly inputBlack: number; readonly inputWhite: number; readonly gamma: number; readonly outputBlack: number; readonly outputWhite: number }
/** HSV-style grading tint plus exposure adjustment used by ColorGradingWheels. */
export interface GradingBand { readonly hue: number; readonly saturation: number; readonly exposureEv: number }
/** Three grading ranges and their application-supplied tonal mix. */
export interface ColorGrade {
  /** Tonal ranges or an explicit lift/gamma/gain correction model. @default tonal */
  readonly model?:"tonal"|"lift-gamma-gain";
  readonly liftGammaGain?:{readonly lift:number;readonly gamma:number;readonly gain:number};
  readonly shadows: GradingBand; readonly midtones: GradingBand; readonly highlights: GradingBand; readonly balance: number; readonly blend: number }
/** A hue selection may wrap across zero. Other ranges are ordered, normalized bounds. */
export interface HSLSecondary {
  readonly enabled: boolean;
  readonly hueStart: number; readonly hueEnd: number; readonly hueFeather: number;
  readonly saturationMin: number; readonly saturationMax: number;
  readonly luminanceMin: number; readonly luminanceMax: number;
  readonly softness: number; readonly denoise: number;
  readonly hueShift: number; readonly saturationShift: number; readonly luminanceShift: number;
  readonly showMask: boolean; readonly invert: boolean;
}
/** Engine-supplied histogram bins on an explicit input domain; no image sampling in the UI. */
export interface HistogramChannel {
 readonly id:string;readonly label:string;readonly bins:readonly number[];
 /** Actual engine-measured counts; absence means clipping has not been measured. */
 readonly clipping?:{readonly low:number;readonly high:number};
}
/** Decoded frame scope sample; normalized x/y with an engine-produced intensity. */
export interface ScopeSample { readonly x: number; readonly y: number; readonly intensity: number }
/** Rejects nonfinite/out-of-range inputs instead of silently rewriting document state. */
export function bounded(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be ${min}..${max}`);
}
/** Validates levels without permitting a zero-width input domain or reversed output range. */
export function validateLevels(value: ColorLevels): void {
  for (const key of ["inputBlack", "inputWhite", "outputBlack", "outputWhite"] as const) bounded(value[key], 0, 1, key);
  bounded(value.gamma, .1, 10, "Gamma");
  if (value.inputBlack >= value.inputWhite || value.outputBlack > value.outputWhite) throw new RangeError("Levels require increasing input and ordered output bounds");
}
/** Checks a strictly increasing input curve with fixed endpoint inputs and unique point IDs. */
export function validateCurve(curve: ColorCurve): void {
  if (!["linear", "monotone"].includes(curve.interpolation) || curve.points.length < 2 || curve.points.length > 64) throw new RangeError("A linear/monotone curve requires 2..64 points");
  const ids = new Set<string>(); let previous = -1;
  for (const point of curve.points) {
    if (!point.id || ids.has(point.id)) throw new TypeError("Curve point IDs must be distinct");
    bounded(point.x, 0, 1, "Curve input"); bounded(point.y, 0, 1, "Curve output");
    if (point.x <= previous) throw new RangeError("Curve inputs must strictly increase");
    previous = point.x; ids.add(point.id);
  }
  if (curve.points[0]!.x !== 0 || curve.points.at(-1)!.x !== 1) throw new RangeError("Curve endpoint inputs must be zero and one");
}
/** Moves one curve point; endpoint inputs stay fixed, and interior inputs cannot cross neighbors. */
export function moveCurvePoint(curve: ColorCurve, id: string, x: number, y: number): ColorCurve {
  validateCurve(curve); bounded(x, 0, 1, "Curve input"); bounded(y, 0, 1, "Curve output");
  const index = curve.points.findIndex(point => point.id === id);
  if (index < 0) throw new TypeError("Unknown curve point");
  const old = curve.points[index]!;
  const lo = curve.points[index - 1]?.x, hi = curve.points[index + 1]?.x;
  let input = index === 0 || index === curve.points.length - 1 ? old.x : Math.max(lo! + (old.x - lo!) / 1e6, Math.min(hi! - (hi! - old.x) / 1e6, x));
  if (lo !== undefined && hi !== undefined && (input <= lo || input >= hi)) input = old.x;
  return { ...curve, points: curve.points.map((point, i) => i === index ? { ...point, x: input, y } : point) };
}
/** Monotone cubic Hermite or linear interpolation, with clamped domain. Never overshoots a local segment. */
export function evaluateCurve(curve: ColorCurve, input: number): number {
  validateCurve(curve); if (!Number.isFinite(input)) throw new RangeError("Curve input must be finite");
  const points = curve.points, x = Math.max(0, Math.min(1, input));
  const index = Math.max(0, points.findIndex((point, i) => i > 0 && x <= point.x) - 1);
  const a = points[index]!, b = points[index + 1]!, width = b.x - a.x, t = (x - a.x) / width;
  if (curve.interpolation === "linear") return a.y + (b.y - a.y) * t;
  const slopes = points.slice(1).map((point, i) => (point.y - points[i]!.y) / (point.x - points[i]!.x));
  const tangent = (i: number): number => {
    if (i === 0) return slopes[0]!;
    if (i === points.length - 1) return slopes.at(-1)!;
    const left = slopes[i - 1]!, right = slopes[i]!;
    if (left * right <= 0) return 0;
    const h0 = points[i]!.x - points[i - 1]!.x, h1 = points[i + 1]!.x - points[i]!.x;
    const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / left + w1 / right);
  };
  const y = (2*t**3-3*t*t+1)*a.y+(t**3-2*t*t+t)*width*tangent(index)+(-2*t**3+3*t*t)*b.y+(t**3-t*t)*width*tangent(index+1);
  return Math.max(Math.min(a.y,b.y),Math.min(Math.max(a.y,b.y),y));
}
/** Pools histogram counts without dropping source bins; linear/log scaling is applied after pooling. */
export function poolHistogram(bins: readonly number[], columns = 128): number[] {
  if (!Number.isInteger(columns) || columns < 1 || columns > 512 || bins.length > 65536) throw new RangeError("Histogram pooling requires 1..512 columns and at most 65536 bins");
  const result = Array(Math.min(columns, bins.length)).fill(0) as number[];
  for (let i=0;i<bins.length;i++) { const count = bins[i]!; if (!Number.isFinite(count) || count < 0) throw new RangeError("Histogram counts must be finite and nonnegative"); const index = Math.min(result.length-1,Math.floor(i*result.length/bins.length)); result[index]! += count; if(!Number.isFinite(result[index])) throw new RangeError("Histogram total overflow"); }
  return result;
}
/** Bounded scope density grid. Samples outside the normalized domain are invalid, not silently clipped. */
export function poolScope(samples: readonly ScopeSample[], size = 32): number[] {
  if (!Number.isInteger(size) || size < 4 || size > 64 || samples.length > 65536) throw new RangeError("Scope grid requires 4..64 cells per side and at most 65536 samples");
  const result = Array(size*size).fill(0) as number[];
  for (const sample of samples) { bounded(sample.x,0,1,"Scope x"); bounded(sample.y,0,1,"Scope y"); bounded(sample.intensity,0,1,"Scope intensity"); const index = Math.min(size-1,Math.floor(sample.y*size))*size+Math.min(size-1,Math.floor(sample.x*size)); result[index]! += sample.intensity; }
  return result;
}
/** Validates grading ranges. The consuming engine defines its tonal weighting. */
export function validateGrade(value: ColorGrade): void {
  if(value.model!==undefined&&!['tonal','lift-gamma-gain'].includes(value.model))throw new TypeError('Unknown grading model');
  if(value.model==='lift-gamma-gain'&&!value.liftGammaGain)throw new TypeError('Lift/gamma/gain requires explicit levels');
  if(value.liftGammaGain){bounded(value.liftGammaGain.lift,-1,1,'Lift');bounded(value.liftGammaGain.gamma,.1,10,'Gamma');bounded(value.liftGammaGain.gain,0,8,'Gain');}
  for (const key of ["shadows","midtones","highlights"] as const) { bounded(value[key].hue,0,360,"Grading hue"); bounded(value[key].saturation,0,1,"Grading saturation"); bounded(value[key].exposureEv,-10,10,"Grading exposure"); }
  bounded(value.balance,-1,1,"Grading balance"); bounded(value.blend,0,1,"Grading blend");
}
/** Checks HSL selection, wrapping hue bounds and correction ranges. */
export function validateHSLSecondary(value: HSLSecondary): void {
  for(const key of ["enabled","showMask","invert"] as const)if(typeof value[key]!=="boolean")throw new TypeError(`Secondary ${key} must be boolean`);
  bounded(value.hueStart,0,360,"Hue start");bounded(value.hueEnd,0,360,"Hue end");bounded(value.hueFeather,0,180,"Hue feather");
  for(const key of ["saturationMin","saturationMax","luminanceMin","luminanceMax","softness","denoise"] as const)bounded(value[key],0,1,key);
  if(value.saturationMin>value.saturationMax||value.luminanceMin>value.luminanceMax)throw new RangeError("Secondary selection bounds must be ordered");
  bounded(value.hueShift,-180,180,"Hue shift");bounded(value.saturationShift,-1,1,"Saturation shift");bounded(value.luminanceShift,-1,1,"Luminance shift");
}
