import { useMemo } from "react";
import { Text, type TextProps } from "react-native";
import { joinClasses } from "@nyc-tron/ui/components/styles";
import { colorReferences, formulaSegments, REFERENCE_TONE_CLASSES } from "./reference-colors.ts";

/**
 * A formula with each reference drawn in its tone, matching the outlines
 * `SpreadsheetGrid` draws for the same formula. Use it wherever a formula is
 * shown read-only: a cell inspector, an audit list, a history entry.
 */
export interface FormulaReferenceTextProps extends Omit<TextProps, "children"> {
  readonly formula: string;
  /** References qualified with this sheet count as the current sheet. */
  readonly sheetName?: string;
  readonly className?: string;
  readonly unstyled?: boolean;
}

export function FormulaReferenceText({ formula, sheetName, className, unstyled = false, ...props }: FormulaReferenceTextProps) {
  const segments = useMemo(() => formulaSegments(formula, colorReferences(formula, sheetName)), [formula, sheetName]);
  return <Text selectable {...props} {...{ className: joinClasses(!unstyled && "text-text", className) }}
    style={[{ fontVariant: ["tabular-nums"] }, props.style]}>
    {segments.map((segment, i) => segment.tone === undefined
      ? segment.text
      : <Text key={i} {...{ className: !unstyled ? REFERENCE_TONE_CLASSES[segment.tone]!.text + " font-semibold" : undefined }}>
        {segment.text}
      </Text>)}
  </Text>;
}
