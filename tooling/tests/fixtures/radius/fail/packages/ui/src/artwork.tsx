// Document content may be any shape, but the marker never excuses these.
export const a = <View className="rounded-lg" />; {/* radius-exempt: artwork */}
export const b = <View className="rounded-[3px]" />; {/* radius-exempt: artwork */}
export const c = { '--radius-art': '9px' }; // radius-exempt: artwork
