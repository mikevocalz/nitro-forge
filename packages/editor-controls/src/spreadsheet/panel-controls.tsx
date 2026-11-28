import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { controlTokens, tokens } from "../tokens.ts";

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
    style={{ minHeight: tokens.spacing.fixedTarget, flexDirection: "row", alignItems: "center", gap: tokens.spacing.off10, paddingHorizontal: tokens.spacing.fixedStack }}>
    <View aria-hidden {...{ className: joinClasses(!unstyled && "rounded border-2",
      !unstyled && (checked ? "border-primary bg-primary" : "border-text-muted bg-surface-raised")) }}
      style={{ width: tokens.spacing.off20, height: tokens.spacing.off20, alignItems: "center", justifyContent: "center" }}>
      {checked ? <View {...{ className: !unstyled ? "border-on-primary" : undefined }}
        style={{ width: tokens.spacing.off10, height: tokens.spacing.off6, borderLeftWidth: tokens.borderWidth.strong, borderBottomWidth: tokens.borderWidth.strong, transform: [{ rotate: "-45deg" }], marginTop: -tokens.spacing.off2 }} /> : null}
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
  return <View role="radiogroup" aria-label={label} style={{ gap: tokens.spacing.off6 }}>
    <Text {...{ className: !unstyled ? "text-text-muted" : undefined }} style={{ fontSize: tokens.text.off13 }}>{label}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.fixedElement }}>
      {choices.map(choice => {
        const checked = choice.value === value;
        return <Pressable key={choice.value} role="radio" aria-checked={checked} disabled={disabled}
          accessibilityLabel={choice.label} onPress={() => onChange(choice.value)}
          {...{ className: joinClasses(
            !unstyled && "rounded-control border focus-visible:ring-2 focus-visible:ring-focus",
            !unstyled && (checked ? "border-primary bg-primary/10" : "border-border bg-surface-raised"),
            !unstyled && disabled && "opacity-50") }}
          style={{ minHeight: tokens.spacing.fixedTarget, minWidth: tokens.spacing.fixedTarget, paddingHorizontal: tokens.spacing.off14, paddingVertical: choice.glyph ? tokens.spacing.off10 : 0,
            alignItems: "center", justifyContent: "center", gap: tokens.spacing.off6 }}>
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
  error?: string | undefined; hint?: string | undefined; unstyled: boolean; autoCapitalize?: "none" | "sentences";
}) {
  return <View style={{ gap: tokens.spacing.fixedStack, minWidth: controlTokens.extent.fieldWide, flexGrow: 1, flexBasis: controlTokens.extent.fieldWide }}>
    <Text {...{ className: !unstyled ? "text-text-muted" : undefined }} style={{ fontSize: tokens.text.off13 }}>{label}</Text>
    <TextInput editable={!disabled} maxLength={8192} value={value} onChangeText={onChange} placeholder={placeholder} accessibilityLabel={label}
      accessibilityHint={hint} autoCapitalize={autoCapitalize} autoCorrect={false} aria-invalid={Boolean(error)}
      {...{ className: joinClasses(!unstyled && "rounded-control border bg-surface-sunken text-text focus:border-focus",
        !unstyled && (error ? "border-danger" : "border-border")) }}
      style={{ minHeight: tokens.spacing.fixedTarget, paddingHorizontal: tokens.spacing.off10 }} />
    {error ? <Text selectable accessibilityRole="alert" accessibilityLiveRegion="polite"
      {...{ className: !unstyled ? "text-danger" : undefined }} style={{ fontSize: tokens.text.off13 }}>{error}</Text> : null}
  </View>;
}

/** Panel heading row; titles are real headings for screen readers. */
export function PanelHeading({ title, unstyled }: { title: string; unstyled: boolean }) {
  return <Text role="heading" aria-level={3} {...{ className: !unstyled ? "text-text font-semibold" : undefined }}
    style={{ fontSize: tokens.text.off15 }}>{title}</Text>;
}
