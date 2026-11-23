import { forgeHairlineRadius, forgeRadius, workspaceScale as scale } from '../../studio-workspace/src/theme';
// A comment may mention rounded-lg, rounded-[9px] or borderRadius: 12 without failing.
/* Block comments too: rounded-full, cornerRadius={8} */
export const outer = <View className="rounded-md border" style={{ borderRadius: scale.radius.panel }} />;
export const inner = <View className="rounded-sm md:rounded-md rounded-control rounded-card rounded-none" style={{ borderTopLeftRadius: forgeRadius.sm }} />;
export const square = { borderRadius: 0, borderBottomRightRadius: '0' };
export const tick = { width: 6, height: 2, borderRadius: forgeHairlineRadius.tick };
export const button = <Button cornerRadius={forgeRadius.sm} title="Save" />;
export const icons = 'rectangle rounded-rectangle ellipse';
export const shape = 'roundedRect';
// radius-exempt: knob
export const dial = <View className="rounded-full" style={{ borderRadius: size / 2 }} />;
export const well = <View className="rounded-full" />; {/* radius-exempt: colour-well */}
export const sheet = { sheetCornerRadius: 10 /* radius-exempt: system-sheet */ };
export const tokens = { '--radius-control': `${scale.radius.control}px` };
