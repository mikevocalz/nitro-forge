import { Text, View, type ViewProps } from "react-native";
import { Select } from "@nyc-tron/ui/components/Select";
import { Button } from "@nyc-tron/ui/components/Button";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { assertRgba, rgbaToHex } from "../color.ts";
import type { ThemeColorReference } from "./color-management.ts";
import { tokens } from "../tokens.ts";
export type { ThemeColorReference } from "./color-management.ts";
/** Identity-bearing color bindings for ThemeColorReferences. */
export interface ThemeColorReferencesProps extends Omit<ViewProps, "children"> {
  readonly references: readonly ThemeColorReference[];
  readonly referenceId: string | null;
  readonly onBind: (id: string) => void;
  /** Host materializes its current resolved color before removing the binding. */
  readonly onDetach: () => void;
  readonly disabled?: boolean;
  readonly unstyled?: boolean;
}
/** Binds theme tokens by identity; previews never replace references with literal colors. */
export function ThemeColorReferences({ references, referenceId, onBind, onDetach, disabled = false, unstyled = false, ...props }: ThemeColorReferencesProps) {
  const ids = new Set<string>();
  if (references.length > 1000) throw new RangeError("Page theme references above 1000");
  references.forEach(reference => { if (!reference.id || !reference.label || ids.has(reference.id)) throw new TypeError("Theme references require distinct IDs and labels"); ids.add(reference.id); assertRgba(reference.preview); });
  const current = references.find(reference => reference.id === referenceId);
  return <View {...props} style={[{ gap: tokens.spacing.fixedElement }, props.style]}>
    <Select label="Theme color reference" placeholder="Choose a reference" value={referenceId ?? ""} disabled={disabled} unstyled={unstyled}
      options={references.map(reference => ({ value: reference.id, label: `${reference.label} — ${reference.source}` }))} onValueChange={id => { if (!disabled && id !== referenceId) onBind(id); }}/>
    <Text accessibilityLiveRegion="polite" {...{ className: joinClasses(!unstyled && "text-text-muted") }}>{current ? `${current.label}: ${rgbaToHex(current.preview, true)}` : referenceId === null ? "Literal color; no theme binding" : `Unresolved reference: ${referenceId}`}</Text>
    <Button title="Detach theme reference" disabled={disabled || referenceId === null} onPress={onDetach} unstyled={unstyled}/>
  </View>;
}
