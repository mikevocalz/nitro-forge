import {LevelFader,type LevelFaderProps} from './LevelFader.tsx';
import type {ScopedControlProps} from '../inputs/useScopedControl.ts';
export interface VerticalFaderProps extends Omit<LevelFaderProps,'orientation'|'onChange'>,ScopedControlProps {onPreview?:(gain:number)=>void}
/** Canonical vertical name for the shared fader owner, including fine/numeric/reset controls. */
export function VerticalFader({onPreview,...props}:VerticalFaderProps){return <LevelFader {...props} orientation="vertical" {...(onPreview?{onChange:onPreview}:{})}/>;}
