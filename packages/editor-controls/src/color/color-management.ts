import { assertRgba, type RgbaColor } from "../color.ts";

/** A selectable, application-supplied profile in ColorSpaceChooser and SoftProofControls. */
export interface ColorProfile {
  /** Stable profile identity; not a display name or inferred ICC conversion. */
  readonly id: string;
  readonly label: string;
  readonly model: "rgb" | "cmyk" | "gray" | "lab";
}
/** Profile-bearing CMYK percentages displayed by PrintColorChannels. */
export interface PrintColor {
  readonly profileId: string;
  /** Omitted for legacy CMYK call sites. Lab is CIELAB L*, a*, b*. */
  readonly model?: "cmyk" | "lab";
  /** CMYK percentages or profile-defined Lab channels; never implicitly converted. */
  readonly channels: readonly [number, number, number, number] | readonly [number, number, number];
  readonly alpha: number;
}
/** Floating RGB values displayed by WideGamutChannels, without clipping or conversion. */
export interface WideGamutColor {
  readonly profileId: string;
  /** Encoded/linear interpretation belongs to the named profile. */
  readonly channels: readonly [number, number, number];
  readonly alpha: number;
}
/** Named reference displayed by ThemeColorReferences. Binding preserves this identity. */
export interface ThemeColorReference {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  /** Current resolved display preview; never replaces the reference in the document. */
  readonly preview: RgbaColor;
}
/** Spot/global definition edited by SpotAndGlobalColorEditor. */
export interface NamedColor {
  readonly id: string;
  readonly name: string;
  readonly kind: "spot" | "global";
  readonly tint: number;
  /** Print overprint intent; the output engine applies separation policy. @default false */
  readonly overprint?: boolean;
  /** sRGB alternate preview, not an ink/profile conversion. */
  readonly alternate: RgbaColor;
}
/** A color kept in its original profile, with a separate display-only preview. */
export interface ProfileColor { readonly profileId:string; readonly channels:readonly number[]; readonly alpha:number; readonly preview:RgbaColor }
/** Engine-produced gamut report rendered by GamutWarning. */
export interface GamutReport {
  readonly sourceProfileId: string;
  readonly destinationProfileId: string;
  readonly outside: number;
  readonly total: number;
  readonly maximumDeltaE?: number;
  /** Engine-generated mapped preview beside the untouched original channel values. */
  readonly comparison?: {readonly original:ProfileColor;readonly mapped:ProfileColor};
}
/** Host-owned proof settings consumed by SoftProofControls. */
export interface SoftProofSettings {
  readonly enabled: boolean;
  readonly profileId: string | null;
  readonly intent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric";
  readonly blackPointCompensation: boolean;
  readonly simulatePaper: boolean;
  readonly simulateBlackInk: boolean;
  /** Requests the output engine's gamut clipping overlay. @default false */
  readonly showGamutClipping?: boolean;
}
/** Checks a named profile collection before presenting choices. */
export function validateProfiles(profiles: readonly ColorProfile[]): void {
  if (profiles.length > 1000) throw new RangeError("Limit profile choices to 1000");
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (!profile.id.trim() || !profile.label.trim() || ids.has(profile.id) || !["rgb", "cmyk", "gray", "lab"].includes(profile.model)) throw new TypeError("Profiles require distinct IDs, labels and a known model");
    ids.add(profile.id);
  }
}
/** Validates profile-preserving numeric channels; rejects invalid edits rather than clipping. */
export function validateColorChannels(color: PrintColor | WideGamutColor, count: number, min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new RangeError("Channel bounds must be finite and increasing");
  if (!color.profileId.trim()) throw new TypeError("Color channels require an explicit profile identity");
  if (color.channels.length !== count || color.channels.some(value => !Number.isFinite(value) || value < min || value > max)) throw new RangeError(`Expected ${count} finite channels in ${min}..${max}`);
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 1) throw new RangeError("Alpha must be 0..1");
}
/** Validates measured gamut counts and optional delta E. No gamut is inferred from RGB bytes. */
export function validateGamutReport(report: GamutReport): void {
  if (!report.sourceProfileId || !report.destinationProfileId) throw new TypeError("Gamut report requires both profiles");
  if (![report.outside, report.total].every(Number.isSafeInteger) || report.outside < 0 || report.total < report.outside) throw new RangeError("Invalid gamut sample counts");
  if(report.comparison){
    for(const color of [report.comparison.original,report.comparison.mapped]){
      if(!color.profileId||color.channels.length<1||color.channels.length>16||color.channels.some(n=>!Number.isFinite(n))||!Number.isFinite(color.alpha)||color.alpha<0||color.alpha>1)throw new TypeError("Invalid profile-bearing gamut comparison");assertRgba(color.preview);
    }
    if(report.comparison.original.profileId!==report.sourceProfileId||report.comparison.mapped.profileId!==report.destinationProfileId)throw new TypeError("Gamut comparison profiles do not match the report");
  }
  if (report.maximumDeltaE !== undefined && (!Number.isFinite(report.maximumDeltaE) || report.maximumDeltaE < 0)) throw new RangeError("Delta E must be nonnegative");
}
/** Checks a named definition before a single host commit. */
export function validateNamedColor(color: NamedColor): void {
  if (!color.id || !color.name.trim() || color.name.length > 256 || !["spot", "global"].includes(color.kind)) throw new TypeError("Named colors require an ID, name and spot/global kind");
  if (!Number.isFinite(color.tint) || color.tint < 0 || color.tint > 100) throw new RangeError("Tint must be 0..100 percent");
  if(color.overprint!==undefined&&typeof color.overprint!=="boolean")throw new TypeError("Overprint must be boolean");
  assertRgba(color.alternate);
}
/** Ensures enabled proofing always identifies an available output profile. */
export function validateSoftProof(settings: SoftProofSettings, profiles: readonly ColorProfile[]): void {
  validateProfiles(profiles);
  for(const key of ["enabled","blackPointCompensation","simulatePaper","simulateBlackInk"] as const)if(typeof settings[key]!=="boolean")throw new TypeError(`Proof ${key} must be boolean`);
  if(settings.showGamutClipping!==undefined&&typeof settings.showGamutClipping!=="boolean")throw new TypeError("Gamut clipping must be boolean");
  if (settings.profileId !== null && !profiles.some(profile => profile.id === settings.profileId)) throw new TypeError("Unknown proof profile");
  if (settings.enabled && settings.profileId === null) throw new TypeError("Choose a proof profile before enabling proofing");
  if (!["perceptual", "relative-colorimetric", "saturation", "absolute-colorimetric"].includes(settings.intent)) throw new TypeError("Unknown rendering intent");
}

/** Explicit policy for profile reassignment/conversion requested from the host. */
export type ColorConversionPolicy = "preserve-numbers" | "preserve-appearance";
/** Validates CMYK or Lab entries against the editor's explicit chroma bounds. */
export function validatePrintColor(color: PrintColor, labRange: readonly [number,number] = [-128,127]): void {
  if(color.model === undefined || color.model === "cmyk") { validateColorChannels(color,4,0,100); return; }
  if(color.model !== "lab") throw new TypeError("Print color model must be CMYK or Lab");
  if(!labRange.every(Number.isFinite)||labRange[0]>=labRange[1])throw new RangeError("Lab chroma range must increase");
  validateColorChannels(color,3,Math.min(0,labRange[0]),Math.max(100,labRange[1]));
  if(color.channels[0]!<0||color.channels[0]!>100||color.channels.slice(1).some(value=>value<labRange[0]||value>labRange[1]))throw new RangeError("Lab channels exceed the profile's editable bounds");
}
