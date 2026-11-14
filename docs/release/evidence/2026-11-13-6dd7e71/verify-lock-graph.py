from pathlib import Path
import json,hashlib,base64,re,tarfile,subprocess
import sys
if len(sys.argv)!=4:raise SystemExit('usage: verify-lock-graph.py <forge-checkout> <published-archives> <scratch-directory>')
repo=Path(sys.argv[1]).resolve();published=Path(sys.argv[2]).resolve();scratch=Path(sys.argv[3]).resolve();scratch.mkdir(parents=True,exist_ok=True)
ruby='puts JSON.generate(Psych.parse_stream(File.read(ARGV[0])).children.map { |doc| stream=Psych::Nodes::Stream.new; stream.children << doc; Psych.safe_load(stream.to_yaml, aliases: true) })'
def norm(value):
 if isinstance(value,str):
  value=value.replace('v1.0.0-rc.1/nyc-tron-','v1.0.0-rc.2/nyc-tron-').replace('-1.0.0-rc.1.tgz','-1.0.0-rc.2.tgz')
  return re.sub(r'(nyc-tron-[a-z-]+-1\.0\.0-rc\.2\.tgz)\([a-f0-9]{32}\)',r'\1(PEER_CONTEXT)',value)
 if isinstance(value,dict):return {norm(k):norm(v)for k,v in value.items()}
 if isinstance(value,list):return [norm(v)for v in value]
 return value
results=[]
for file,name in [('pnpm-lock.yaml','root'),('examples/native-cadence/pnpm-lock.yaml','native-cadence')]:
 original=scratch/(name+'-before.yaml');original.write_bytes(subprocess.check_output(['git','show','fe6cc5a3b3e9fbba72be7bca3e6aa9453b8c256e:'+file],cwd=repo))
 docs=[]
 for source in [original,repo/file]:docs.append(json.loads(subprocess.check_output(['ruby','-rpsych','-rjson','-e',ruby,str(source)])))
 assert len(docs[0])==len(docs[1])==2
 assert docs[0][0]==docs[1][0],(name,'package-manager bootstrap document changed')
 before,after=docs[0][1],docs[1][1]
 for field in set(before)|set(after):
  if field not in ['packages','snapshots','importers']:assert before.get(field)==after.get(field),(name,field)
 for field in ['packages','snapshots']:
  b={k:v for k,v in before[field].items()if not k.startswith('@nyc-tron/')};a={k:v for k,v in after[field].items()if not k.startswith('@nyc-tron/')}
  assert b==a,(name,field,'nonTron graph changed')
 assert norm(before['importers'])==norm(after['importers']),(name,'importer diff beyond TronURL/peer contexts')
 assert norm(before['snapshots'])==norm(after['snapshots']),(name,'snapshot diff beyond TronURL/peer contexts')
 b={norm(k):v for k,v in before['packages'].items()if k.startswith('@nyc-tron/')};a={k:v for k,v in after['packages'].items()if k.startswith('@nyc-tron/')};assert set(b)==set(a)
 changes=[]
 for key,value in a.items():
  url=value['resolution']['tarball'];filename=url.rsplit('/',1)[1];data=(published/filename).read_bytes()
  assert value['resolution']['integrity']=='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
  assert value['version']=='1.0.0-rc.2'
  old={k:v for k,v in b[key].items()if k not in ['resolution','version']};new={k:v for k,v in value.items()if k not in ['resolution','version']}
  if old!=new:
   with tarfile.open(published/filename)as t:manifest=json.load(t.extractfile('package/package.json'))
   expected=json.loads(json.dumps(old))
   for peer,version in old.get('peerDependencies',{}).items():
    publishedVersion=manifest.get('peerDependencies',{}).get(peer)
    if peer.startswith('@nyc-tron/'):
     assert version=='^1.0.0-rc.1' and publishedVersion=='^1.0.0-rc.2'
     expected['peerDependencies'][peer]=publishedVersion
     changes.append({'package':manifest['name'],'field':'peerDependencies.'+peer,'before':version,'after':publishedVersion,'matchesPublishedManifest':True})
    elif version!=publishedVersion:
     assert manifest['name']=='@nyc-tron/ui' and peer=='react-native-gesture-handler' and version=='>=3.4.0 <4' and publishedVersion=='>=3.3.0 <4'
     expected['peerDependencies'][peer]=publishedVersion
     changes.append({'package':manifest['name'],'field':'peerDependencies.'+peer,'before':version,'after':publishedVersion,'matchesPublishedManifest':True})
   assert expected==new,(name,key,'unexpected metadata change')
 results.append({'lock':file,'yamlDocuments':2,'packageManagerDocumentUnchanged':True,'packagesBefore':len(before['packages']),'packagesAfter':len(after['packages']),'snapshotsBefore':len(before['snapshots']),'snapshotsAfter':len(after['snapshots']),'nonTronPackagesAndSnapshotsUnchanged':True,'importersAndSnapshotsOnlyTronUrlsAndPeerContextsChanged':True,'allTronSha512MatchPublishedBytes':True,'metadataChanges':changes})
(scratch/'lock-graph-comparison.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
