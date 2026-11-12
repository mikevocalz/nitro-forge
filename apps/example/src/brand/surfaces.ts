// Every user-visible string that carries the product name comes from here, so
// a brand manifest replace reaches the title bar and the About screen. The
// launcher label and bundle metadata come from tooling/brand/plugin.cjs.

export type ForgeBrand = {
  id: string;
  productName: string;
  shortName: string;
  /** The studio a single-studio build opens. Absent for the suite. */
  engine?: string;
  bundleIdentifier: string;
  androidPackage: string;
};

export type BrandSurfaces = {
  /** Navigation title of the home screen (suite builds). */
  homeTitle: string;
  /** Title shown in the workspace bar for a studio; suite builds pass the studio's own title. */
  workspaceTitle: (studioTitle: string) => string;
  documentTitle: (studioTitle: string) => string;
  /** Label of the leading button in a studio workspace. */
  leading: { label: string; href: '/' | '/about' };
  about: { title: string; heading: string; rows: { label: string; value: string }[] };
};

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

export function brandSurfaces(brand: ForgeBrand, version: string): BrandSurfaces {
  const single = !!brand.engine;
  return {
    homeTitle: brand.productName,
    workspaceTitle: studioTitle => (single ? brand.shortName : studioTitle),
    documentTitle: studioTitle => `Untitled ${single ? brand.shortName : studioTitle} document`,
    leading: single ? { label: 'About', href: '/about' } : { label: 'All apps', href: '/' },
    about: {
      title: `About ${brand.shortName}`,
      heading: brand.productName,
      rows: [
        { label: 'Version', value: version },
        { label: 'App ID (iOS)', value: brand.bundleIdentifier },
        { label: 'App ID (Android)', value: brand.androidPackage },
      ],
    },
  };
}
