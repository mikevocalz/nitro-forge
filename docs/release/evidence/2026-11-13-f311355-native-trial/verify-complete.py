import pathlib,json,subprocess,re,concurrent.futures,os
repo=pathlib.Path('work/f2-plan/f1-native-trial');out=pathlib.Path('work/f1-native-implementation')
def parse(s):return json.loads(subprocess.check_output(['ruby','-rjson','-ryaml','-e','STDOUT.write(JSON.generate(YAML.load_stream(STDIN.read)))'],input=s))
a=parse(subprocess.check_output(['git','show','HEAD:pnpm-lock.yaml'],cwd=repo));b=parse((repo/'pnpm-lock.yaml').read_bytes());assert a[0]==b[0];old=a[1];new=b[1];existing=old['packages'].keys()&new['packages'].keys();assert all(old['packages'][k]==new['packages'][k] for k in existing)
native={'react-native-skia','react-native-webgpu','react-native-svg','react-native-webgpu-dawn','react-native-skia-graphite-android','react-native-skia-graphite-apple-ios','react-native-skia-graphite-apple-macos','react-native-skia-graphite-apple-tvos'}
name=lambda key:key.rsplit('@',1)[0]
removed=old['packages'].keys()-new['packages'].keys();added=new['packages'].keys()-old['packages'].keys();assert len(removed)==8 and {name(k) for k in removed}==native
# Verify new non-native packages belong to the declared CLI dependency closure.
seen=set();todo=[]
for n in ['@react-native-community/cli','@react-native-community/cli-platform-android','@react-native-community/cli-platform-ios']:
 todo.append(n+'@'+new['importers']['apps/example']['devDependencies'][n]['version'])
while todo:
 key=todo.pop()
 if key in seen:continue
 seen.add(key);node=new['snapshots'].get(key,{})
 for group in ['dependencies','optionalDependencies']:
  for n,v in node.get(group,{}).items():todo.append(n+'@'+v)
closure={key.split('(')[0] for key in seen};nonNative={k for k in added if name(k) not in native};assert nonNative<=closure,nonNative-closure
# Read-only registry metadata requests; no dependency install/archive download/build or lock mutation.
free=os.statvfs('.').f_bavail*os.statvfs('.').f_frsize
# Match exact immutable-version registry integrity for every new package, not just the three leaf packages.
def verify(k):
 n,v=k.rsplit('@',1);url='https://registry.npmjs.org/'+n.replace('/','%2F')+'/'+v
 p=json.loads(subprocess.check_output(['curl','-fsS','--max-time','20',url]));assert p['dist']['integrity']==new['packages'][k]['resolution']['integrity'],k
 return k,{'url':url,'tarball':p['dist']['tarball'],'integrity':p['dist']['integrity']}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:proof=dict(ex.map(verify,sorted(added)))
for path in ['examples/native-cadence/pnpm-lock.yaml','native/persona/nitro/pnpm-lock.yaml']:
 assert (repo/path).read_bytes()==subprocess.check_output(['git','show','HEAD:'+path],cwd=repo),path
result={'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip(),'oldPackages':len(old['packages']),'newPackages':len(new['packages']),'oldSnapshots':len(old['snapshots']),'newSnapshots':len(new['snapshots']),'bootstrapUnchanged':True,'allExistingPackageMetadataUnchanged':True,'removedNativeFamily':sorted(removed),'nativeReplacements':sorted(k for k in added if name(k) in native),'cliClosureAdditions':sorted(nonNative),'everyNonNativeAdditionReachableFromDeclaredCLI':True,'allNewPackageSHA512MatchesRegistry':True,'newPackageMetadata':proof,'isolatedNativeCadenceAndPersonaLocksByteIdentical':True,'note':'Complete raw snapshot-name and same-key delta is retained separately; CLI adds an optional RN peer context and both native patches get new identities. No public platform pruned.'}
(out/'verified-complete-graph.json').write_text(json.dumps(result,indent=2)+'\n');print('PASS',len(added),'new/replacement metadata integrity matches;',len(nonNative),'CLI closure additions')
