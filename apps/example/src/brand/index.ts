import Constants from 'expo-constants';
import { brandSurfaces, readBrand } from './surfaces';

export const brand = readBrand(Constants.expoConfig?.extra);
export const surfaces = brandSurfaces(brand, Constants.expoConfig?.version ?? '0.0.0');
export type { ForgeBrand, BrandSurfaces } from './surfaces';
