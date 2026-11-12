// Every string this app shows that carries its name comes from here, so a
// brand manifest replace reaches the screen. The config plugin
// (tooling/brand/plugin.cjs) writes the manifest into `extra.forgeBrand`;
// the launcher label and bundle metadata come from the plugin directly.
// tooling/brand/rebrand-check.mjs calls shownStrings() and scans the files
// in renderedIn for a hardcoded old name.

export type ForgeBrand = {
  id: string;
  productName: string;
  shortName: string;
  bundleIdentifier: string;
  androidPackage: string;
};

export type LabSurfaces = {
  /** Screen header, the first thing on the page. */
  title: string;
};

/** Screens that render these strings, relative to the app root. */
export const renderedIn = ['App.tsx'];

const isBrand = (v: unknown): v is ForgeBrand => {
  const b = v as Partial<ForgeBrand> | null;
  return !!b && typeof b.productName === 'string' && typeof b.shortName === 'string' && typeof b.id === 'string';
};

/** Reads `extra.forgeBrand` written by the config plugin. Throws if it is missing. */
export function readBrand(extra: unknown): ForgeBrand {
  const brand = (extra as { forgeBrand?: unknown } | null | undefined)?.forgeBrand;
  if (!isBrand(brand)) throw new Error('extra.forgeBrand is missing: add tooling/brand/plugin.cjs to app.json plugins');
  return brand;
}

export function labSurfaces(brand: ForgeBrand): LabSurfaces {
  return { title: brand.productName };
}

export function shownStrings(brand: ForgeBrand, _version: string): string[] {
  const s = labSurfaces(brand);
  return [s.title];
}
