import Constants from 'expo-constants';
import { labSurfaces, readBrand } from './surfaces';

export const brand = readBrand(Constants.expoConfig?.extra);
export const surfaces = labSurfaces(brand);
export type { ForgeBrand, LabSurfaces } from './surfaces';
