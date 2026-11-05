import type { ReactNode } from 'react';

/** One feedback beat: `end-stop` nudges the pointer past the limit and back,
 * `commit` flashes the rim. `seq` changes on every beat so repeats replay. */
export type TurretPulse = Readonly<{ kind: 'end-stop' | 'commit'; dir: 1 | -1; seq: number }>;

export type TurretPointerProps = {
  /** Shown stop, in screen degrees. */
  deg: number;
  /** Detent travel; 0 steps instantly (Reduce Motion). */
  durationMs: number;
  easing: string;
  bezier: readonly [number, number, number, number];
  reduceMotion: boolean;
  pulse: TurretPulse | null;
  size: number;
  children: ReactNode;
};

export type TurretRimProps = {
  pulse: TurretPulse | null;
  reduceMotion: boolean;
  size: number;
  commitColor: string;
  limitColor: string;
};
