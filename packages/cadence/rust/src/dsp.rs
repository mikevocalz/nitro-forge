//! Insert effect DSP: biquad EQ, a feed-forward compressor and a gain stage.
//! Original implementation. Biquad coefficients follow the well-known
//! Audio EQ Cookbook formulas (R. Bristow-Johnson).

use crate::mixer_model::{CompressorParams, EqBand, EqBandType, Effect};
use std::f64::consts::PI;

pub fn db_to_lin(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

pub fn lin_to_db(lin: f64) -> f64 {
    if lin <= 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * lin.log10()
    }
}

/// Normalized biquad (a0 == 1), direct form I state per channel.
#[derive(Debug, Clone, Copy)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Biquad {
    /// From coefficients already divided by a0.
    pub fn from_normalized(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Biquad {
        Biquad { b0, b1, b2, a1, a2 }
    }

    pub fn for_band(band: &EqBand, sample_rate: f64) -> Biquad {
        // Keep the centre below Nyquist so low sample rates stay stable.
        let f = band.freq_hz.min(sample_rate * 0.49);
        let w0 = 2.0 * PI * f / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * band.q);
        let a = 10f64.powf(band.gain_db / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match band.band_type {
            EqBandType::Peak => (
                1.0 + alpha * a,
                -2.0 * cos,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos,
                1.0 - alpha / a,
            ),
            EqBandType::LowShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cos + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
                    a * ((a + 1.0) - (a - 1.0) * cos - s),
                    (a + 1.0) + (a - 1.0) * cos + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cos),
                    (a + 1.0) + (a - 1.0) * cos - s,
                )
            }
            EqBandType::HighShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cos + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
                    a * ((a + 1.0) + (a - 1.0) * cos - s),
                    (a + 1.0) - (a - 1.0) * cos + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cos),
                    (a + 1.0) - (a - 1.0) * cos - s,
                )
            }
            EqBandType::LowPass => (
                (1.0 - cos) / 2.0,
                1.0 - cos,
                (1.0 - cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
            EqBandType::HighPass => (
                (1.0 + cos) / 2.0,
                -(1.0 + cos),
                (1.0 + cos) / 2.0,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            ),
        };
        Biquad { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    /// Magnitude response in dB at `freq_hz`.
    pub fn magnitude_db(&self, freq_hz: f64, sample_rate: f64) -> f64 {
        let w = 2.0 * PI * freq_hz / sample_rate;
        // |H(e^jw)|^2 via the complex numerator/denominator.
        let (c1, s1) = (w.cos(), w.sin());
        let (c2, s2) = ((2.0 * w).cos(), (2.0 * w).sin());
        let nr = self.b0 + self.b1 * c1 + self.b2 * c2;
        let ni = -(self.b1 * s1 + self.b2 * s2);
        let dr = 1.0 + self.a1 * c1 + self.a2 * c2;
        let di = -(self.a1 * s1 + self.a2 * s2);
        let mag2 = (nr * nr + ni * ni) / (dr * dr + di * di);
        10.0 * mag2.log10()
    }

    /// Filter a buffer in place, starting from silent state.
    pub fn process(&self, buf: &mut [f64]) {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        for s in buf.iter_mut() {
            let x = *s;
            let y = self.b0 * x + self.b1 * x1 + self.b2 * x2 - self.a1 * y1 - self.a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            *s = y;
        }
    }
}

/// Static compressor curve: output level for an input level, both dBFS,
/// with a quadratic soft knee centred on the threshold.
pub fn compressor_out_db(c: &CompressorParams, in_db: f64) -> f64 {
    let over = in_db - c.threshold_db;
    let knee = c.knee_db;
    let slope = 1.0 / c.ratio - 1.0;
    let gain = if knee > 0.0 && over.abs() <= knee / 2.0 {
        slope * (over + knee / 2.0).powi(2) / (2.0 * knee)
    } else if over > knee / 2.0 {
        slope * over
    } else {
        0.0
    };
    in_db + gain + c.makeup_db
}

/// Stereo-linked feed-forward compressor: one peak detector over both
/// channels, one-pole attack/release smoothing of the gain in dB.
fn compress(c: &CompressorParams, l: &mut [f64], r: &mut [f64], sample_rate: f64) {
    let att = (-1.0 / (c.attack_ms * 0.001 * sample_rate)).exp();
    let rel = (-1.0 / (c.release_ms * 0.001 * sample_rate)).exp();
    let mut reduction_db = 0.0f64; // <= 0
    for i in 0..l.len() {
        let peak = l[i].abs().max(r[i].abs());
        let in_db = if peak > 1e-9 { lin_to_db(peak) } else { -180.0 };
        let target = compressor_out_db(c, in_db) - c.makeup_db - in_db;
        let coeff = if target < reduction_db { att } else { rel };
        reduction_db = target + coeff * (reduction_db - target);
        let g = db_to_lin(reduction_db + c.makeup_db);
        l[i] *= g;
        r[i] *= g;
    }
}

/// Run one effect over a stereo pair in place.
pub fn apply_effect(effect: &Effect, l: &mut [f64], r: &mut [f64], sample_rate: f64) {
    match effect {
        Effect::Gain { gain_db } => {
            let g = db_to_lin(*gain_db);
            l.iter_mut().chain(r.iter_mut()).for_each(|s| *s *= g);
        }
        Effect::Eq { bands } => {
            for band in bands.iter().filter(|b| b.enabled) {
                let bq = Biquad::for_band(band, sample_rate);
                bq.process(l);
                bq.process(r);
            }
        }
        Effect::Compressor(c) => compress(c, l, r, sample_rate),
    }
}

/// Combined magnitude response of an EQ's enabled bands, dB.
pub fn eq_response_db(bands: &[EqBand], freq_hz: f64, sample_rate: f64) -> f64 {
    bands
        .iter()
        .filter(|b| b.enabled)
        .map(|b| Biquad::for_band(b, sample_rate).magnitude_db(freq_hz, sample_rate))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn band(t: EqBandType, f: f64, g: f64, q: f64) -> EqBand {
        EqBand { band_type: t, freq_hz: f, gain_db: g, q, enabled: true }
    }

    #[test]
    fn peak_band_hits_its_gain_at_centre_and_is_flat_far_away() {
        let b = Biquad::for_band(&band(EqBandType::Peak, 1000.0, 6.0, 1.0), 48000.0);
        assert!((b.magnitude_db(1000.0, 48000.0) - 6.0).abs() < 0.01);
        assert!(b.magnitude_db(30.0, 48000.0).abs() < 0.1);
        assert!(b.magnitude_db(18000.0, 48000.0).abs() < 0.2);
    }

    #[test]
    fn shelves_and_passes_have_the_expected_shape() {
        let ls = Biquad::for_band(&band(EqBandType::LowShelf, 200.0, -12.0, 0.71), 48000.0);
        assert!((ls.magnitude_db(20.0, 48000.0) + 12.0).abs() < 0.3);
        assert!(ls.magnitude_db(10000.0, 48000.0).abs() < 0.1);
        let hp = Biquad::for_band(&band(EqBandType::HighPass, 1000.0, 0.0, 0.71), 48000.0);
        assert!(hp.magnitude_db(100.0, 48000.0) < -35.0);
        assert!(hp.magnitude_db(10000.0, 48000.0).abs() < 0.1);
        assert!((hp.magnitude_db(1000.0, 48000.0) + 3.0).abs() < 0.1);
    }

    #[test]
    fn filtering_matches_the_response() {
        // A 1 kHz sine through a +6 dB peak comes out about twice as loud.
        let sr = 48000.0;
        let b = Biquad::for_band(&band(EqBandType::Peak, 1000.0, 6.0, 1.0), sr);
        let mut buf: Vec<f64> = (0..48000).map(|i| (2.0 * PI * 1000.0 * i as f64 / sr).sin()).collect();
        b.process(&mut buf);
        let peak = buf[24000..].iter().fold(0.0f64, |m, v| m.max(v.abs()));
        assert!((lin_to_db(peak) - 6.0).abs() < 0.1, "peak {peak}");
    }

    #[test]
    fn compressor_curve_is_continuous_and_reduces_above_threshold() {
        let c = CompressorParams { threshold_db: -20.0, ratio: 4.0, knee_db: 6.0, attack_ms: 1.0, release_ms: 50.0, makeup_db: 0.0 };
        assert_eq!(compressor_out_db(&c, -40.0), -40.0);
        assert!((compressor_out_db(&c, 0.0) - -15.0).abs() < 1e-9);
        // continuity at the knee edges
        for edge in [-23.0, -17.0] {
            let a = compressor_out_db(&c, edge - 1e-6);
            let b = compressor_out_db(&c, edge + 1e-6);
            assert!((a - b).abs() < 1e-4);
        }
        let hard = CompressorParams { knee_db: 0.0, ..c };
        assert!((compressor_out_db(&hard, -10.0) - -17.5).abs() < 1e-9);
    }

    #[test]
    fn compressor_pulls_a_loud_tone_toward_the_curve() {
        let sr = 48000.0;
        let c = CompressorParams { threshold_db: -20.0, ratio: 10.0, knee_db: 0.0, attack_ms: 1.0, release_ms: 50.0, makeup_db: 0.0 };
        let mut l: Vec<f64> = (0..24000).map(|i| (2.0 * PI * 440.0 * i as f64 / sr).sin()).collect();
        let mut r = l.clone();
        compress(&c, &mut l, &mut r, sr);
        let peak = l[12000..].iter().fold(0.0f64, |m, v| m.max(v.abs()));
        // 0 dBFS in, ratio 10 above -20 → about -18 dBFS out.
        assert!((lin_to_db(peak) - -18.0).abs() < 1.0, "peak db {}", lin_to_db(peak));
    }
}
