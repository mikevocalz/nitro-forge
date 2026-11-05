// Host-side check for WavPeaks.sandboxLocal and analyze. CI appends this to
// the WavPeaks enum extracted from ios/ForgeSignalModule.swift, so the code
// under test is the shipped source, compiled without the Expo macros.
let fm = FileManager.default
let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("sbx-\(getpid())")
let cache = tmp.appendingPathComponent("Caches"); let sib = tmp.appendingPathComponent("Caches2")
try! fm.createDirectory(at: cache.appendingPathComponent("rec"), withIntermediateDirectories: true)
try! fm.createDirectory(at: sib, withIntermediateDirectories: true)
// 16-bit mono 8kHz WAV, 4 frames
var d = Data("RIFF".utf8); func u32(_ v: UInt32){ var x=v.littleEndian; d.append(Data(bytes:&x,count:4)) }; func u16(_ v: UInt16){ var x=v.littleEndian; d.append(Data(bytes:&x,count:2)) }
u32(44); d.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(8000); u32(16000); u16(2); u16(16)
d.append(Data("data".utf8)); u32(8); for v: Int16 in [-16384, 0, 8192, 16384] { u16(UInt16(bitPattern: v)) }
let good = cache.appendingPathComponent("rec/a.wav"); try! d.write(to: good)
let outside = sib.appendingPathComponent("b.wav"); try! d.write(to: outside)
let link = cache.appendingPathComponent("link.wav"); try! fm.createSymbolicLink(at: link, withDestinationURL: outside)
let roots = [cache.standardizedFileURL.resolvingSymlinksInPath()]
func ok(_ u: URL) -> Bool { (try? WavPeaks.sandboxLocal(u, roots: roots)) != nil }
var fails = 0
func check(_ name: String, _ c: Bool) { print((c ? "PASS " : "FAIL ") + name); if !c { fails += 1 } }
check("inside accepted", ok(good))
check("sibling prefix rejected", !ok(outside))
check("traversal rejected", !ok(URL(string: cache.absoluteString + "rec/../../Caches2/b.wav")!))
check("symlink escape rejected", !ok(link))
check("root itself rejected", !ok(cache))
check("/etc rejected", !ok(URL(fileURLWithPath: "/etc/hosts")))
let r = (try? WavPeaks.analyze(uri: good.absoluteString, columns: 2)) == nil
check("analyze rejects file outside real Caches/Documents", r)
let real = WavPeaks.sandboxRoots()[0].appendingPathComponent("forge-signal-check-\(getpid()).wav")
try! d.write(to: real)
let peaks = try! WavPeaks.analyze(uri: real.absoluteString, columns: 2)
check("analyze inside Caches returns real peaks \(peaks)", peaks == [[-0.5, 0.0], [0.25, 0.5]])
// Truncated data chunk: declared size runs past end of file.
var bad = d; bad.removeLast(2); try! bad.write(to: real)
do { _ = try WavPeaks.analyze(uri: real.absoluteString, columns: 2); check("truncated WAV rejected", false) }
catch { check("truncated WAV rejected with message: \(error.localizedDescription)",
              error.localizedDescription == "Expected a well-formed RIFF/WAVE file") }
try? fm.removeItem(at: real)
do { _ = try WavPeaks.analyze(uri: good.absoluteString, columns: 0); check("columns=0 rejected", false) }
catch { check("columns=0 rejected with message", error.localizedDescription == "columns must be between 1 and 4096") }
exit(fails == 0 ? 0 : 1)
