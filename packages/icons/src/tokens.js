/** Forge icon tokens; all colors are overridable by the consuming app theme. */
export const iconColors=Object.freeze({
  ink:"#18202D", inkInverse:"#F8FAFC", muted:"#737F91",
  accent:"#6859E8", accentBright:"#8E83FF", cyan:"#00B6C7",
  positive:"#139E75", warning:"#C68B27", negative:"#D94462",
});
export const iconSizes=Object.freeze({xs:12,sm:16,toolbar:20,default:24,touch:28,feature:32,hero:48});
export const iconStroke=Object.freeze({size:24,width:2.35,cap:"round",join:"round"});
export const iconMotion=Object.freeze({
  hoverMs:120, pressMs:110, selectMs:225, deselectMs:175,
  successMs:320, errorMs:240, loadingMs:850,
  pressScale:0.9, selectedScale:1.075,
});
export const iconStates=Object.freeze(["idle","hover","pressed","selected","disabled","loading","success","error","recording"]);
