import json,subprocess,pathlib,copy
repo=pathlib.Path('work/f2-plan/f1-native-trial');out=pathlib.Path('work/f1-native-implementation')
def parse(b):return json.loads(subprocess.check_output(['ruby','-rjson','-ryaml','-e','STDOUT.write(JSON.generate(YAML.load_stream(STDIN.read)))'],input=b))
old=parse(subprocess.check_output(['git','show','HEAD:pnpm-lock.yaml'],cwd=repo));new=parse((repo/'pnpm-lock.yaml').read_bytes());assert old[0]==new[0]
versions={'react-native-skia':{'3.10.1':'3.9.1'},'react-native-webgpu':{'0.21.4':'0.21.0'},'react-native-svg':{'15.16.1':'15.16.0'}}
for n in ['react-native-webgpu-dawn','react-native-skia-graphite-android','react-native-skia-graphite-apple-ios','react-native-skia-graphite-apple-macos','react-native-skia-graphite-apple-tvos']:versions[n]={'158.0.0':'157.1.0'}
def ref(n,v):
 v=v.split('(')[0];return versions.get(n,{}).get(v,v)
def flatten(data):
 result={}
 for k,v in data.items():
  n,ver=k.split('(')[0].rsplit('@',1);key=n+'@'+ref(n,ver);assert key not in result,key
  c=copy.deepcopy(v)
  for group in ['dependencies','optionalDependencies']:
   if group in c:c[group]={n:ref(n,v) for n,v in c[group].items()}
  result[key]=c
 return result
before=flatten(old[1]['snapshots']);after=flatten(new[1]['snapshots']);changes=[]
for key in before:
 assert key in after,key
 a=copy.deepcopy(before[key]);b=copy.deepcopy(after[key])
 if key=='@react-native/community-cli-plugin@0.88.1':
  assert b.get('optionalDependencies',{}).pop('@react-native-community/cli')=='20.2.0'
  if not b['optionalDependencies']:b.pop('optionalDependencies')
  changes.append({'package':key,'expectedChange':'Adds declared CLI20.2 optional peer context'})
 if key=='yaml@2.9.1':
  assert a.pop('optional') is True;assert 'optional' not in b;changes.append({'package':key,'expectedChange':'Previously optional-only YAML becomes required in declared CLI dependency closure'})
 if a!=b:print('UNEXPECTED',key,a,b)
 assert a==b,('Unexpected existing snapshot semantic delta',key,a,b)
# Other importer declarations stay unchanged except native version updates and three explicit CLI tools.
def importers(data):
 r=copy.deepcopy(data)
 for imp in r.values():
  for group in ['dependencies','devDependencies','optionalDependencies']:
   for n,v in imp.get(group,{}).items():
    v['version']=ref(n,v['version']);v['specifier']=versions.get(n,{}).get(v['specifier'],v['specifier'])
 return r
ai=importers(old[1]['importers']);bi=importers(new[1]['importers']);
for n in ['@react-native-community/cli','@react-native-community/cli-platform-android','@react-native-community/cli-platform-ios']:assert bi['apps/example']['devDependencies'].pop(n)=={'specifier':'20.2.0','version':'20.2.0'}
assert ai==bi,'Unexpected importer change'
# Metadata for every retained package is exactly identical, and new non-native packages must be CLI-reachable.
assert all(old[1]['packages'][k]==new[1]['packages'][k] for k in old[1]['packages'].keys()&new[1]['packages'].keys())
seen=set();todo=[n+'@20.2.0' for n in ['@react-native-community/cli','@react-native-community/cli-platform-android','@react-native-community/cli-platform-ios']]
while todo:
 k=todo.pop()
 if k in seen:continue
 seen.add(k);v=after.get(k,{})
 for group in ['dependencies','optionalDependencies']:
  for n,ver in after.get(k,{}).get(group,{}).items():todo.append(n+'@'+ver)
added=set(after)-set(before);assert added<=seen,added-seen;assert len(added)==142
for path in ['examples/native-cadence/pnpm-lock.yaml','native/persona/nitro/pnpm-lock.yaml']:assert (repo/path).read_bytes()==subprocess.check_output(['git','show','HEAD:'+path],cwd=repo)
r={'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip(),'rootActivePackages':[len(old[1]['packages']),len(new[1]['packages'])],'rootActiveSnapshots':[len(old[1]['snapshots']),len(new[1]['snapshots'])],'bootstrapUnchanged':True,'allExistingPackageMetadataIdentical':True,'allExistingSnapshotSemanticEdgesMatchExceptEnumerated':True,'expectedAdditionalChanges':changes,'all142NewSnapshotPackagesReachableFromDeclaredCLI':True,'newCLIClosurePackages':sorted(added),'importerChangesOnlyNative3AndDeclaredCLI3':True,'allOtherOwnedLocksByteIdentical':True,'peerContexts':'Full raw removed/added snapshot identities retained in lock-graph-delta.json; canonical comparison removes peer identity suffixes, then checks exact named dependency edges. CLI optional RN peer and YAML reachability role are explicitly enumerated.'}
(out/'semantic-graph-verification.json').write_text(json.dumps(r,indent=2)+'\n');print('PASS complete semantic graph;142declared CLI additions,8native replacements;2known existing snapshot role/contextchanges')
