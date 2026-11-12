//! Read-only measurements over a mixdown: windowed peak/RMS meters,
//! ITU-R BS.1770 loudness, and a log-band spectrogram.

use crate::dsp::{lin_to_db, Biquad};
use crate::render::{Mixdown, Stereo};
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::f64::consts::PI;

/// Most meter windows one call returns.
pub const MAX_METER_WINDOWS: usize = 4096;
/// Most spectrogram frames one call returns.
pub const MAX_SPECTRO_FRAMES: usize = 2048;
/// Most STFT frames `detect_beats` analyzes in one call.
pub const MAX_BEAT_FRAMES: usize = 16384;
/// Most onsets `detect_beats` reports in one call.
pub const MAX_ONSETS: usize = 8192;
/// Onsets closer than this are merged into the earlier one.
const MIN_ONSET_SECONDS: f64 = 0.08;
/// Fewer onsets than this cannot support a tempo estimate.
const MIN_ONSETS_FOR_BPM: usize = 4;

/// Round for the wire: meters do not need 17 significant digits.
fn r6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

fn db_or_null(db: f64) -> Value {
    if db.is_finite() {
        json!((db * 100.0).round() / 100.0)
    } else {
        Value::Null
    }
}

/// Per-window peak (max |sample| over both channels) and RMS (both
/// channels), linear.
fn windows(sig: &Stereo, window: usize) -> (Vec<f64>, Vec<f64>) {
    let n = sig.l.len();
    let mut peak = Vec::with_capacity(n.div_ceil(window));
    let mut rms = Vec::with_capacity(n.div_ceil(window));
    let mut start = 0;
    while start < n {
        let end = (start + window).min(n);
        let (mut p, mut sum) = (0.0f64, 0.0f64);
        for i in start..end {
            p = p.max(sig.l[i].abs()).max(sig.r[i].abs());
            sum += (sig.l[i] * sig.l[i] + sig.r[i] * sig.r[i]) * 0.5;
        }
        peak.push(r6(p));
        rms.push(r6((sum / (end - start) as f64).sqrt()));
        start = end;
    }
    (peak, rms)
}

fn meter_entry(sig: &Stereo, window: usize) -> Value {
    let (peak, rms) = windows(sig, window);
    let max = peak.iter().cloned().fold(0.0f64, f64::max);
    json!({ "peak": peak, "rms": rms, "max_peak": max, "clipped": max >= 1.0 })
}

/// `meter` op body.
pub fn meter(mix: &Mixdown, sample_rate: u64, window_ms: f64) -> Result<Value, EngineError> {
    let window = ((window_ms / 1000.0) * sample_rate as f64).round().max(1.0) as usize;
    if mix.frames.div_ceil(window) > MAX_METER_WINDOWS {
        return Err(EngineError::validation(format!(
            "range needs more than {MAX_METER_WINDOWS} meter windows; widen window_ms or shorten the range"
        )));
    }
    let tracks: Vec<Value> = mix
        .stems
        .iter()
        .map(|(id, sig)| {
            let mut v = meter_entry(sig, window);
            v["id"] = json!(id);
            v
        })
        .collect();
    Ok(json!({
        "window_frames": window,
        "window_seconds": window as f64 / sample_rate as f64,
        "tracks": tracks,
        "master": meter_entry(&mix.master, window),
    }))
}

/// BS.1770 K-weighting at any sample rate: a high shelf then the RLB
/// high-pass, using the published analogue prototype constants.
fn k_weighting(sr: f64) -> (Biquad, Biquad) {
    let (f0, g, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = (PI * f0 / sr).tan();
    let vh = 10f64.powf(g / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad::from_normalized(
        (vh + vb * k / q + k * k) / a0,
        2.0 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    );
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = (PI * f0 / sr).tan();
    let a0 = 1.0 + k / q + k * k;
    let hp = Biquad::from_normalized(
        1.0,
        -2.0,
        1.0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    );
    (shelf, hp)
}

fn lufs(mean_square: f64) -> f64 {
    if mean_square <= 0.0 {
        f64::NEG_INFINITY
    } else {
        -0.691 + 10.0 * mean_square.log10()
    }
}

/// `loudness` op body: integrated (gated), momentary (400 ms) and
/// short-term (3 s) loudness of the master, plus the sample peak.
pub fn loudness(mix: &Mixdown, sample_rate: u64) -> Value {
    let sr = sample_rate as f64;
    let (shelf, hp) = k_weighting(sr);
    let mut l = mix.master.l.clone();
    let mut r = mix.master.r.clone();
    for ch in [&mut l, &mut r] {
        shelf.process(ch);
        hp.process(ch);
    }
    // Per-100 ms sums of squares, summed over both channels.
    let step = (0.1 * sr).round().max(1.0) as usize;
    let sums: Vec<f64> = l
        .chunks(step)
        .zip(r.chunks(step))
        .map(|(a, b)| a.iter().chain(b.iter()).map(|x| x * x).sum())
        .collect();
    // Block of `n` steps → mean square per channel-summed sample frame.
    let block = |n: usize| -> Vec<f64> {
        if sums.len() < n {
            return Vec::new();
        }
        (0..=sums.len() - n)
            .map(|i| sums[i..i + n].iter().sum::<f64>() / (n * step) as f64)
            .collect()
    };
    let momentary = block(4);
    let short_term = block(30);

    let abs_gated: Vec<f64> = momentary.iter().cloned().filter(|&ms| lufs(ms) > -70.0).collect();
    let integrated = if abs_gated.is_empty() {
        f64::NEG_INFINITY
    } else {
        let rel = lufs(abs_gated.iter().sum::<f64>() / abs_gated.len() as f64) - 10.0;
        let gated: Vec<f64> = abs_gated.into_iter().filter(|&ms| lufs(ms) > rel).collect();
        lufs(gated.iter().sum::<f64>() / gated.len().max(1) as f64)
    };
    let max_of = |v: &[f64]| v.iter().cloned().map(lufs).fold(f64::NEG_INFINITY, f64::max);
    let peak = mix
        .master
        .l
        .iter()
        .chain(mix.master.r.iter())
        .fold(0.0f64, |m, v| m.max(v.abs()));
    json!({
        "integrated_lufs": db_or_null(integrated),
        "momentary_max_lufs": db_or_null(max_of(&momentary)),
        "short_term_max_lufs": db_or_null(max_of(&short_term)),
        "sample_peak_dbfs": db_or_null(lin_to_db(peak)),
        "momentary_lufs": momentary.iter().map(|&ms| db_or_null(lufs(ms))).collect::<Vec<_>>(),
        "step_seconds": step as f64 / sr,
    })
}

/// In-place iterative radix-2 FFT. `re.len()` must be a power of two.
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

/// Options for [`spectrogram`], validated by the op.
pub struct SpectroOptions {
    pub fft_size: usize,
    pub hop: usize,
    pub bands: usize,
}

/// `spectrogram` op body: Hann-windowed STFT of the mono master, power
/// averaged into log-spaced bands from 20 Hz to Nyquist, dBFS where a
/// full-scale sine reads 0 dB, floored at -120.
pub fn spectrogram(mix: &Mixdown, sample_rate: u64, o: &SpectroOptions) -> Result<Value, EngineError> {
    let sr = sample_rate as f64;
    let n = o.fft_size;
    let mono: Vec<f64> = mix.master.l.iter().zip(&mix.master.r).map(|(a, b)| (a + b) * 0.5).collect();
    let count = if mono.len() < n { 1 } else { (mono.len() - n) / o.hop + 1 };
    if count > MAX_SPECTRO_FRAMES {
        return Err(EngineError::validation(format!(
            "range needs more than {MAX_SPECTRO_FRAMES} frames; raise hop or shorten the range"
        )));
    }
    let window: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect();
    let norm = 2.0 / window.iter().sum::<f64>();
    let nyquist = sr / 2.0;
    let lo = 20f64.min(nyquist / 2.0);
    let edges: Vec<f64> = (0..=o.bands)
        .map(|b| lo * (nyquist / lo).powf(b as f64 / o.bands as f64))
        .collect();
    let bin_hz = sr / n as f64;
    let ranges: Vec<(usize, usize)> = edges
        .windows(2)
        .map(|e| {
            let a = (e[0] / bin_hz).round() as usize;
            let b = ((e[1] / bin_hz).round() as usize).max(a + 1).min(n / 2);
            (a.min(b - 1), b)
        })
        .collect();
    let mut frames = Vec::with_capacity(count);
    let (mut re, mut im) = (vec![0.0; n], vec![0.0; n]);
    for f in 0..count {
        let start = f * o.hop;
        for i in 0..n {
            re[i] = mono.get(start + i).copied().unwrap_or(0.0) * window[i];
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let row: Vec<f64> = ranges
            .iter()
            .map(|&(a, b)| {
                let p = (a..b).map(|k| (re[k] * re[k] + im[k] * im[k]) * norm * norm).sum::<f64>()
                    / (b - a) as f64;
                let db = 10.0 * p.max(1e-12).log10();
                (db.max(-120.0) * 10.0).round() / 10.0
            })
            .collect();
        frames.push(row);
    }
    let centres: Vec<f64> = edges.windows(2).map(|e| ((e[0] * e[1]).sqrt()).round()).collect();
    Ok(json!({
        "bands_hz": centres,
        "hop_seconds": o.hop as f64 / sr,
        "frames": frames,
    }))
}

/// Default `detectBeats` sensitivity. It gives k = 1, the mean + one
/// standard deviation threshold the op used before sensitivity existed.
pub const DEFAULT_BEAT_SENSITIVITY: f64 = 0.5;

/// Options for [`detect_beats`], validated by the op.
pub struct BeatOptions {
    pub fft_size: usize,
    pub hop: usize,
    /// 0.0..=1.0. The onset threshold is mean + k·σ of the spectral flux
    /// with k = 2·(1 − sensitivity): 0 needs flux two deviations above the
    /// mean, 1 accepts any local maximum above the mean.
    pub sensitivity: f64,
}

/// Threshold multiplier k for a sensitivity in 0..=1.
fn threshold_k(sensitivity: f64) -> f64 {
    2.0 * (1.0 - sensitivity)
}

/// Tempo estimate from the novelty envelope: the lag in 60..=240 BPM whose
/// period best correlates the envelope with itself, reported back as BPM.
/// `None` when the envelope is too short or perfectly uncorrelated.
fn estimate_bpm(novelty: &[f64], sr: f64, hop: usize) -> Option<f64> {
    if novelty.len() < 8 {
        return None;
    }
    let mut best_score = 0.0f64;
    let mut best_lag = 0usize;
    let mut bpm = 60.0f64;
    while bpm <= 240.0 {
        let lag = ((sr * 60.0) / (bpm * hop as f64)).round() as usize;
        if lag >= 2 && lag * 2 <= novelty.len() {
            let mut sum = 0.0;
            let mut count = 0usize;
            for i in 0..novelty.len() - lag {
                sum += novelty[i] * novelty[i + lag];
                count += 1;
            }
            let score = sum / count as f64;
            if score > best_score {
                best_score = score;
                best_lag = lag;
            }
        }
        bpm += 0.5;
    }
    if best_lag == 0 {
        None
    } else {
        // Report the BPM the winning lag actually measures, not the
        // candidate that produced it (lags are integer frames).
        Some((60.0 * sr / (best_lag as f64 * hop as f64) * 10.0).round() / 10.0)
    }
}

/// `detectBeats` op body: spectral-flux onset detection over the mono
/// master. Each STFT frame's positive magnitude difference against the
/// previous frame sums into a novelty value; local maxima above
/// mean + k·σ (k from `o.sensitivity`, 1 at the default 0.5), separated by
/// at least 80 ms, are onsets.
/// `estimated_bpm` is the novelty autocorrelation peak in 60..=240 BPM,
/// `null` with fewer than four onsets.
pub fn detect_beats(mix: &Mixdown, sample_rate: u64, o: &BeatOptions) -> Result<Value, EngineError> {
    let sr = sample_rate as f64;
    let n = o.fft_size;
    let mono: Vec<f64> = mix.master.l.iter().zip(&mix.master.r).map(|(a, b)| (a + b) * 0.5).collect();
    let count = if mono.len() < n { 1 } else { (mono.len() - n) / o.hop + 1 };
    if count > MAX_BEAT_FRAMES {
        return Err(EngineError::validation(format!(
            "range needs more than {MAX_BEAT_FRAMES} analysis frames; raise hop or shorten the range"
        )));
    }
    let window: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect();
    let mut novelty = Vec::with_capacity(count);
    let mut prev = vec![0.0f64; n / 2];
    let (mut re, mut im) = (vec![0.0; n], vec![0.0; n]);
    for f in 0..count {
        let start = f * o.hop;
        for i in 0..n {
            re[i] = mono.get(start + i).copied().unwrap_or(0.0) * window[i];
            im[i] = 0.0;
        }
        fft(&mut re, &mut im);
        let mut flux = 0.0;
        for k in 1..=n / 2 {
            let mag = (re[k] * re[k] + im[k] * im[k]).sqrt();
            flux += (mag - prev[k - 1]).max(0.0);
            prev[k - 1] = mag;
        }
        novelty.push(flux);
    }
    // Adaptive threshold: mean + k standard deviations of the flux.
    let body = &novelty[1.min(novelty.len())..];
    let mean = body.iter().sum::<f64>() / body.len().max(1) as f64;
    let var = body.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / body.len().max(1) as f64;
    let threshold = mean + threshold_k(o.sensitivity) * var.sqrt();
    let min_gap = ((MIN_ONSET_SECONDS * sr) / o.hop as f64).round().max(1.0) as usize;
    let mut onset_frames: Vec<usize> = Vec::new();
    let mut last = usize::MAX;
    for f in 1..count.saturating_sub(1) {
        if novelty[f] > threshold
            && novelty[f] >= novelty[f - 1]
            && novelty[f] >= novelty[f + 1]
            && (last == usize::MAX || f - last >= min_gap)
        {
            onset_frames.push(f);
            last = f;
            if onset_frames.len() > MAX_ONSETS {
                return Err(EngineError::validation(format!(
                    "range produced more than {MAX_ONSETS} onsets; shorten the range"
                )));
            }
        }
    }
    let onsets_seconds: Vec<f64> = onset_frames
        .iter()
        .map(|&f| {
            let t = (f * o.hop) as f64 / sr + n as f64 / (2.0 * sr);
            (t * 1000.0).round() / 1000.0
        })
        .collect();
    let estimated_bpm = if onset_frames.len() >= MIN_ONSETS_FOR_BPM {
        estimate_bpm(&novelty, sr, o.hop)
    } else {
        None
    };
    Ok(json!({
        "onsets_seconds": onsets_seconds,
        "estimated_bpm": estimated_bpm,
        "hop_seconds": o.hop as f64 / sr,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(sr: f64, secs: f64, freq: f64, amp: f64) -> Mixdown {
        let n = (sr * secs) as usize;
        let l: Vec<f64> = (0..n).map(|i| (2.0 * PI * freq * i as f64 / sr).sin() * amp).collect();
        Mixdown { frames: n, master: Stereo { l: l.clone(), r: l }, stems: vec![] }
    }

    #[test]
    fn full_scale_1k_in_both_channels_reads_zero_lufs() {
        // BS.1770: a 0 dBFS 997 Hz sine in one channel reads -3.01 LUFS, so
        // the same sine in both reads 0.
        let v = loudness(&tone(48000.0, 3.0, 997.0, 1.0), 48000);
        let i = v["integrated_lufs"].as_f64().unwrap();
        assert!(i.abs() < 0.05, "integrated {i}");
        assert!((v["sample_peak_dbfs"].as_f64().unwrap()).abs() < 0.01);
    }

    #[test]
    fn minus_20db_tone_and_silence() {
        let v = loudness(&tone(44100.0, 2.0, 997.0, 0.1), 44100);
        let i = v["integrated_lufs"].as_f64().unwrap();
        assert!((i - -20.0).abs() < 0.05, "integrated {i}");
        let s = loudness(&tone(44100.0, 1.0, 997.0, 0.0), 44100);
        assert!(s["integrated_lufs"].is_null());
        assert!(s["sample_peak_dbfs"].is_null());
        // Shorter than one 400 ms block: no momentary values.
        let short = loudness(&tone(48000.0, 0.2, 997.0, 1.0), 48000);
        assert!(short["integrated_lufs"].is_null());
        assert_eq!(short["momentary_lufs"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn spectrogram_peaks_in_the_band_holding_the_tone() {
        let mix = tone(48000.0, 0.5, 1000.0, 1.0);
        let v = spectrogram(&mix, 48000, &SpectroOptions { fft_size: 2048, hop: 1024, bands: 32 }).unwrap();
        let hz: Vec<f64> = v["bands_hz"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let row: Vec<f64> = v["frames"][3].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let (best, _) = row.iter().enumerate().fold((0, f64::MIN), |a, (i, &d)| if d > a.1 { (i, d) } else { a });
        assert!(hz[best] > 700.0 && hz[best] < 1400.0, "peak band {} Hz", hz[best]);
        assert!(row[best] > -12.0, "peak level {}", row[best]);
        assert!(row[0] < row[best] - 40.0);
    }

    #[test]
    fn meter_windows_peak_and_rms() {
        let mix = Mixdown { stems: vec![(7, Stereo { l: vec![0.5; 100], r: vec![-1.0; 100] })], ..tone(1000.0, 0.1, 10.0, 0.0) };
        let v = meter(&mix, 1000, 50.0).unwrap();
        assert_eq!(v["window_frames"], 50);
        let t = &v["tracks"][0];
        assert_eq!(t["id"], 7);
        assert_eq!(t["peak"], json!([1.0, 1.0]));
        assert_eq!(t["clipped"], true);
        let rms = t["rms"][0].as_f64().unwrap();
        assert!((rms - (0.625f64).sqrt()).abs() < 1e-5);
        assert_eq!(v["master"]["max_peak"], 0.0);
    }
}
