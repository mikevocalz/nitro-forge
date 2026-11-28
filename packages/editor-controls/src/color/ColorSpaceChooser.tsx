import { Select, type SelectBaseProps } from "@nyc-tron/ui/components/Select";
import { validateProfiles, type ColorProfile } from "./color-management.ts";
export type { ColorProfile } from "./color-management.ts";
/** Profile choices and explicit profile-change request from ColorSpaceChooser. */
export interface ColorSpaceChooserProps extends Omit<SelectBaseProps, "label" | "value" | "onValueChange"> {
  readonly profiles: readonly ColorProfile[];
  readonly value: string;
  /** Requests the host's profile policy/conversion; the chooser never converts pixels. */
  readonly onProfileChange: (id: string) => void;
  readonly label?: string;
}
/** Selects an application-provided color profile without conflating assign and convert. */
export function ColorSpaceChooser({ profiles, value, onProfileChange, label = "Color profile", ...props }: ColorSpaceChooserProps) {
  validateProfiles(profiles);
  if (!profiles.some(profile => profile.id === value)) throw new TypeError("Selected color profile is unavailable");
  return <Select {...props} label={label} value={value} options={profiles.map(profile => ({ value: profile.id, label: `${profile.label} (${profile.model.toUpperCase()})` }))} onValueChange={id => { if (!props.disabled && id !== value) onProfileChange(id); }}/ >;
}
