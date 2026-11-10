#!/usr/bin/env python3
"""Check generated/native Swift ABI source contracts, not Swift typechecking or concurrency.

Usage: python check-swift-abi.py /path/to/packages/react-native-video
Requires generation with the pinned v1 Nitrogen version first.
"""
from pathlib import Path
import re
import sys
if len(sys.argv) != 2:
 raise SystemExit("Usage: check-swift-abi.py /path/to/packages/react-native-video")
root=Path(sys.argv[1]).resolve()
assert (root / "nitrogen/generated/apple/swift").is_dir(), "Generate v1 Swift sources first"
def norm(s):
 s=re.sub(r'/\*.*?\*/','',s)
 s=re.sub(r'\b(any|throws)\b','',s)
 s=re.sub(r'\s|[()]','',s)
 s=s.replace('->Void','')
 return s
checks=0
for spec in (root/'nitrogen/generated/apple/swift').glob('Hybrid*Spec.swift'):
 name=spec.stem.removesuffix('Spec')
 files=list((root/'ios').rglob(name+'.swift'))
 assert len(files)==1,(name,files)
 native=files[0].read_text()
 protocol=spec.read_text().split('// Static Properties')[0]
 for signature in re.findall(r'^  func (.+)$',protocol,re.M):
  method=signature.split('(')[0]
  match=re.search(r'\bfunc '+method+r'\b([^{}]+)\{',native)
  assert match, (name,method,'missing')
  actual=method+match[1]
  assert norm(actual)==norm(signature),(name,signature,actual)
  checks+=1
print(f'PASS: {checks} generated method signatures match native implementations (nonthrowing witnesses allowed).')
all_native='\n'.join(p.read_text() for p in (root/'ios').rglob('*.swift'))
for token in ['withError:', 'withResult:', 'Promise<Void>()','Promise<VideoInformation>()', 'Variant_NullType__any_HybridVideoPlayerSourceSpec_', 'Variant_NullType_TextTrack?','onTrackChange(nil)']:
 assert token not in all_native,token
print('PASS: no v0 Promise constructors/labels or nullable variant signatures remain.')
for name in ['HybridVideoPlayer','HybridVideoPlayerSource','HybridVideoViewViewManager']:
 native=next((root/'ios').rglob(name+'.swift')).read_text()
 assert '    try super.init()' in native
 assert re.search(r'(?<!try )super\.init\(\)', native) is None
player=next((root/'ios').rglob('HybridVideoPlayer.swift')).read_text()
assert 'self.eventEmitter = try HybridVideoPlayerEventEmitter()' in player
assert 'case .first(let newSource):' in player and 'case .second(_):' in player
assert player.count('onTrackChange(.first(.null))')==2
print('PASS: throwing base initialization, source variant case order, and explicit null emissions.')
for name,count in [('HybridVideoPlayerEventEmitter',20),('HybridVideoViewViewManager',6)]:
 native=next((root/'ios').rglob(name+'.swift')).read_text()
 assert native.count('callback.callAndForget(')==count
 assert 'ListenerSubscription(remove: .native {' in native
 assert 'listener: @escaping' not in native
print('PASS: all 26 event callbacks dispatch using v1 callAndForget; native removal callbacks are wrapped.')

assert checks == 49, f"Expected 49 method checks, got {checks}"
print("Source contract checks only: Swift typechecking, concurrency checks, Xcode builds, and device playback remain required.")

# Under InternalImportsByDefault, exposed Apple SDK types require public imports.
public_imports = {'ios/view/VideoComponentView.swift': ['AVFoundation', 'Foundation', 'UIKit'], 'ios/core/Spec/NativeVideoPlayerSpec.swift': ['AVFoundation'], 'ios/core/Spec/NativeVideoPlayerSourceSpec.swift': ['AVFoundation', 'Foundation'], 'ios/core/Spec/DRMManagerSpec.swift': ['AVFoundation'], 'ios/core/Extensions/ResizeMode+VideoGravity.swift': ['AVFoundation']}
for file, modules in public_imports.items():
 native = (root / file).read_text()
 for module in modules:
  assert f"public import {module}\n" in native, (file, module, "missing public import")
print("PASS: all 8 required Apple SDK public imports cover the reviewed public API surfaces.")
