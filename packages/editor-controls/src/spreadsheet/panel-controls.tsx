import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";

/**
 * Small controlled inputs the spreadsheet panels share. They are internal to
 * `forge/spreadsheet`; app screens should use their own form kit.
 */

export function PanelCheckbox({ label, checked, onChange, disabled, unstyled }: {
  label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; unstyled: boolean;
}) {
  return <Pressable role="checkbox" aria-checked={checked} aria-disabled={disabled} disabled={disabled}
    accessibilityLabel={label} onPress={() => onChange(!checked)}
    {...{ className: joinClasses(!unstyled && "rounded-control focus-visible:ring-2 focus-visible:ring-focus",
      !unstyled && disabled && "opacity-50") }}
    style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 }}>
    <View aria-hidden {...{ className: joinClasses(!unstyled && "rounded border-2",
      !unstyled && (checked ? "border-primary bg-primary" : "border-text-muted bg-surface-raised")) }}
      style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      {checked ? <View {...{ className: !unstyled ? "border-on-primary" : undefined }}
        style={{ width: 10, height: 6, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{ rotate: "-45deg" }], marginTop: -2 }} /> : null}
    </View>
    <Text {...{ className: !unstyled ? "text-text" : undefined }} style={{ flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}

export interface PanelChoice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Optional drawn preview shown above the label. */
  readonly glyph?: ReactNode;
}

/** A radio group drawn as a row of chips; with glyphs it is a small gallery. */
export function PanelChoices<T extends string>({ label, value, choices, onChange, disabled, unstyled }: {
  label: string; value: T; choices: readonly PanelChoice<T>[]; onChange: (next: T) => void; disabled?: boolean; unstyled: boolean;
}) {
  return <View role="radiogroup" aria-label={label} style={{ gap: 6 }}>
    <Text {...{ className: !unstyled ? "text-text-muted" : undefined }} style={{ fontSize: 13 }}>{label}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {choices.map(choice => {
        const checked = choice.value === value;
        return <Pressable key={choice.value} role="radio" aria-checked={checked} disabled={disabled}
          accessibilityLabel={choice.label} onPress={() => onChange(choice.value)}
          {...{ className: joinClasses(
            !unstyled && "rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
            !unstyled && (checked ? "border-primary bg-primary/10" : "border-border bg-surface-raised"),
            !unstyled && disabled && "opacity-50") }}
          style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 14, paddingVertical: choice.glyph ? 10 : 0,
            alignItems: "center", justifyContent: "center", gap: 6 }}>
          {choice.glyph ?? null}
          <Text {...{ className: joinClasses(!unstyled && "text-text", checked && "font-semibold") }}>{choice.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

/** Labeled single-line field; `error` is announced and drawn under it. */
export function PanelField({disabled=false, label, value, onChange, placeholder, error, hint, unstyled, autoCapitalize = "none" }: {
  disabled?:boolean;label: string; value: string; onChange: (next: string) => void; placeholder?: string;
  error?: string; hint?: string; unstyled: boolean; autoCapitalize?: "none" | "sentences";
}) {
  return <View style={{ gap: 4, minWidth: 140, flexGrow: 1, flexBasis: 140 }}>
    <Text {...{ className: !unstyled ? "text-text-muted" : undefined }} style={{ fontSize: 13 }}>{label}</Text>
    <TextInput editable={!disabled} maxLength={8192} value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label}
      accessibilityHint={hint} autoCapitalize={autoCapitalize} autoCorrect={false} aria-invalid={Boolean(error)}
      {...{ className: joinClasses(!unstyled && "rounded-control border bg-surface-sunken text-text focus:border-focus",
        !unstyled && (error ? "border-danger" : "border-border")) }}
      style={{ minHeight: 44, paddingHorizontal: 10 }} />
    {error ? <Text selectable accessibilityRole="alert" accessibilityLiveRegion="polite"
      {...{ className: !unstyled ? "text-danger" : undefined }} style={{ fontSize: 13 }}>{error}</Text> : null}
  </View>;
}

/** Panel heading row; titles are real headings for screen readers. */
export function PanelHeading({ title, unstyled }: { title: string; unstyled: boolean }) {
  return <Text role="heading" aria-level={3} {...{ className: !unstyled ? "text-text font-semibold" : undefined }}
    style={{ fontSize: 16 }}>{title}</Text>;
}
