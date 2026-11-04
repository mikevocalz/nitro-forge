import Foundation
import ExpoModulesCore

// Independent Forge implementation. No ArtCraft source or assets are vendored.
// Expo Modules 2.0 annotation API in stable Expo SDK 58 (the API remains beta).
@ExpoModule("ForgeSignal")
public class ForgeSignalModule: Module {
  @JS(.concurrent)
  func analyzeWavFile(_ uri: String, columns: Int) async throws -> [[Double]] {
    try WavPeaks.analyze(uri: uri, columns: columns)
  }
}

private enum WavPeaks {
  enum Problem: Error {
    case invalidColumns
    case invalidUri
    case fileTooLarge
    case malformedWav
    case unsupportedPcm
  }

  static func read16(_ bytes: [UInt8], _ at: Int) -> Int {
    Int(bytes[at]) | (Int(bytes[at + 1]) << 8)
  }

  static func read32(_ bytes: [UInt8], _ at: Int) -> Int {
    Int(bytes[at]) | (Int(bytes[at + 1]) << 8) |
      (Int(bytes[at + 2]) << 16) | (Int(bytes[at + 3]) << 24)
  }

  static func code(_ bytes: [UInt8], _ at: Int) -> String {
    String(decoding: bytes[at..<(at + 4)], as: UTF8.self)
  }

  static func analyze(uri: String, columns: Int) throws -> [[Double]] {
    guard (1...4096).contains(columns) else { throw Problem.invalidColumns }
    guard let url = URL(string: uri), url.isFileURL else { throw Problem.invalidUri }
    let path = url.path
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    guard let size = attributes[.size] as? NSNumber, size.int64Value <= 64 * 1024 * 1024 else {
      throw Problem.fileTooLarge
    }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    let bytes = Array(data)
    guard bytes.count >= 44,
          code(bytes, 0) == "RIFF",
          code(bytes, 8) == "WAVE" else {
      throw Problem.malformedWav
    }

    var offset = 12
    var sampleFormat = 0
    var channels = 0
    var bitDepth = 0
    var blockAlign = 0
    var sampleRate = 0
    var pcmStart: Int?
    var pcmLength = 0

    while offset + 8 <= bytes.count {
      let name = code(bytes, offset)
      let count = read32(bytes, offset + 4)
      let start = offset + 8
      guard count >= 0, count <= bytes.count - start else { throw Problem.malformedWav }
      if name == "fmt " {
        guard count >= 16 else { throw Problem.malformedWav }
        sampleFormat = read16(bytes, start)
        channels = read16(bytes, start + 2)
        sampleRate = read32(bytes, start + 4)
        blockAlign = read16(bytes, start + 12)
        bitDepth = read16(bytes, start + 14)
      } else if name == "data", pcmStart == nil {
        pcmStart = start
        pcmLength = count
      }
      offset = start + count + (count & 1)
    }

    guard sampleFormat == 1, (1...2).contains(channels), bitDepth == 16,
          (8000...384000).contains(sampleRate), blockAlign == channels * 2,
          let first = pcmStart, pcmLength > 0, pcmLength % blockAlign == 0 else {
      throw Problem.unsupportedPcm
    }
    let frames = pcmLength / blockAlign
    var lows = [Double](repeating: 1, count: columns)
    var highs = [Double](repeating: -1, count: columns)
    for frame in 0..<frames {
      let bucket = min(columns - 1, Int((Int64(frame) * Int64(columns)) / Int64(frames)))
      let start = first + frame * blockAlign
      for channel in 0..<channels {
        let raw = UInt16(read16(bytes, start + channel * 2))
        let value = Double(Int16(bitPattern: raw)) / 32768.0
        lows[bucket] = min(lows[bucket], value)
        highs[bucket] = max(highs[bucket], value)
      }
    }
    return (0..<columns).map { index in
      highs[index] < lows[index] ? [0.0, 0.0] : [lows[index], highs[index]]
    }
  }
}
