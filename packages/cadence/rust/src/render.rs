//! Offline mixdown. Source tracks synthesize their notes (sine oscillator,
//! 20 ms linear attack/release, velocity gain), run their inserts, then the
//! fader and pan (or their automation) and feed the master or a bus, plus
//! post-fader sends. Buses sum their inputs, run their inserts and apply
//! fader and balance into the master. The metronome click is mixed into the
//! master only when the caller asks for it.

use crate::dsp::apply_effect;
use crate::mixer_model::AutomationParam;
use crate::{Doc, Track, TrackKind, ENVELOPE_S};
use ignition_core::EngineError;
use std::f64::consts::PI;

/// One stereo signal.
pub struct Stereo {
    pub l: Vec<f64>,
    pub r: Vec<f64>,
}

impl Stereo {
    fn silent(frames: usize) -> Self {
        Self { l: vec![0.0; frames], r: vec![0.0; frames] }
    }
    fn add_scaled(&mut self, other: &Stereo, k: f64) {
        for i in 0..self.l.len() {
            self.l[i] += other.l[i] * k;
            self.r[i] += other.r[i] * k;
        }
    }
}

/// Everything one render pass produces.
pub struct Mixdown {
    pub frames: usize,
    pub master: Stereo,
    /// Post-fader output of every track and bus, in document order; empty
    /// unless the caller asked for stems.
    pub stems: Vec<(u64, Stereo)>,
}

/// Why a track is heard, the same rule `describe`-side UIs mirror:
/// with any track or bus soloed, a track sounds when it is soloed,
/// solo-safe and unmuted, or routed into a soloed bus; a bus sounds when it
/// is soloed, solo-safe and unmuted, or fed by a soloed track. With nothing
/// soloed, every unmuted track sounds. Solo takes precedence over mute.
pub fn audible(doc: &Doc) -> Vec<bool> {
    let any_solo = doc.tracks.iter().any(|t| t.solo);
    let feeds = |t: &Track, bus: u64| t.output == Some(bus) || t.sends.iter().any(|s| s.bus == bus);
    doc.tracks
        .iter()
        .map(|t| {
            if !any_solo {
                return !t.muted;
            }
            if t.solo || (t.solo_safe && !t.muted) {
                return true;
            }
            match t.kind {
                TrackKind::Bus => doc.tracks.iter().any(|src| src.solo && feeds(src, t.id)),
                _ => doc
                    .tracks
                    .iter()
                    .any(|b| b.kind == TrackKind::Bus && b.solo && feeds(t, b.id)),
            }
        })
        .collect()
}

/// Longest render one call may produce, in frames.
pub const MAX_FRAMES: usize = 48_000 * 60 * 10;

pub fn render_range_frames(doc: &Doc, from_ticks: u64, to_ticks: u64, sr: f64) -> Result<usize, EngineError> {
    let seconds_per_tick = 60.0 / (doc.ppq as f64 * doc.tempo_bpm);
    let frames = ((to_ticks - from_ticks) as f64 * seconds_per_tick * sr).round();
    // Ten minutes at 48 kHz: bounded memory for the master plus stems.
    if frames > MAX_FRAMES as f64 {
        return Err(EngineError::validation("render range too large"));
    }
    Ok(frames as usize)
}

pub fn mixdown(
    doc: &Doc,
    from_ticks: u64,
    to_ticks: u64,
    sample_rate: u64,
    include_metronome: bool,
    keep_stems: bool,
) -> Result<Mixdown, EngineError> {
    let sr = sample_rate as f64;
    let frames = render_range_frames(doc, from_ticks, to_ticks, sr)?;
    let seconds_per_tick = 60.0 / (doc.ppq as f64 * doc.tempo_bpm);
    let ticks_per_frame = 1.0 / (seconds_per_tick * sr);
    let heard = audible(doc);

    let mut master = Stereo::silent(frames);
    // Bus inputs keyed by bus id, filled by source tracks first.
    let mut bus_in: Vec<(u64, Stereo)> = doc
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Bus)
        .map(|t| (t.id, Stereo::silent(frames)))
        .collect();
    let mut stems: Vec<(u64, Stereo)> = Vec::with_capacity(doc.tracks.len());

    for (ti, track) in doc.tracks.iter().enumerate() {
        if track.kind == TrackKind::Bus {
            continue;
        }
        let mut out = Stereo::silent(frames);
        if heard[ti] {
            let dry = synthesize(track, from_ticks, to_ticks, frames, seconds_per_tick, sr);
            out.l.copy_from_slice(&dry);
            out.r.copy_from_slice(&dry);
            run_inserts(track, &mut out, sr);
            fader(track, &mut out, from_ticks, ticks_per_frame, false);
            match track.output.and_then(|b| bus_in.iter_mut().find(|(id, _)| *id == b)) {
                Some((_, input)) => input.add_scaled(&out, 1.0),
                None => master.add_scaled(&out, 1.0),
            }
            for send in &track.sends {
                if let Some((_, input)) = bus_in.iter_mut().find(|(id, _)| *id == send.bus) {
                    input.add_scaled(&out, send.level);
                }
            }
        }
        if keep_stems {
            stems.push((track.id, out));
        }
    }

    for (ti, track) in doc.tracks.iter().enumerate() {
        if track.kind != TrackKind::Bus {
            continue;
        }
        let pos = bus_in.iter().position(|(id, _)| *id == track.id).expect("bus input exists");
        let (_, mut sig) = bus_in.swap_remove(pos);
        if heard[ti] {
            run_inserts(track, &mut sig, sr);
            fader(track, &mut sig, from_ticks, ticks_per_frame, true);
            master.add_scaled(&sig, 1.0);
        } else {
            sig = Stereo::silent(frames);
        }
        if keep_stems {
            stems.push((track.id, sig));
        }
    }
    // Stems in document order, whatever order the passes produced them in.
    stems.sort_by_key(|(id, _)| doc.tracks.iter().position(|t| t.id == *id));

    if include_metronome && doc.metronome.enabled {
        click_track(doc, &mut master, from_ticks, to_ticks, seconds_per_tick, sr);
    }
    Ok(Mixdown { frames, master, stems })
}

fn synthesize(
    track: &Track,
    from_ticks: u64,
    to_ticks: u64,
    frames: usize,
    seconds_per_tick: f64,
    sr: f64,
) -> Vec<f64> {
    let mut dry = vec![0.0f64; frames];
    let ramp_samples = ENVELOPE_S * sr;
    for clip in &track.clips {
        let clip_start = clip.start_ticks;
        let clip_end = clip.end_ticks();
        if clip_end <= from_ticks || clip_start >= to_ticks {
            continue;
        }
        for note in &clip.notes {
            let note_start = clip_start.saturating_add(note.start_ticks);
            let note_end = note_start.saturating_add(note.length_ticks).min(clip_end);
            if note_end <= note_start {
                continue;
            }
            let s0 = (note_start as f64 - from_ticks as f64) * seconds_per_tick * sr;
            let s1 = (note_end as f64 - from_ticks as f64) * seconds_per_tick * sr;
            let i0 = s0.ceil().max(0.0) as usize;
            let i1 = s1.ceil().min(frames as f64) as usize;
            if i0 >= i1 {
                continue;
            }
            let freq = 440.0 * 2f64.powf((note.pitch as f64 - 69.0) / 12.0);
            let vel = note.velocity as f64 / 127.0;
            for (i, out) in dry.iter_mut().enumerate().take(i1).skip(i0) {
                let x = i as f64 - s0;
                let attack = if x < ramp_samples { (x / ramp_samples).max(0.0) } else { 1.0 };
                let rel = s1 - i as f64;
                let release = if rel < ramp_samples { (rel / ramp_samples).max(0.0) } else { 1.0 };
                *out += (2.0 * PI * freq * x / sr).sin() * attack.min(release) * vel;
            }
        }
    }
    dry
}

fn run_inserts(track: &Track, sig: &mut Stereo, sr: f64) {
    for insert in track.inserts.iter().filter(|i| !i.bypassed) {
        apply_effect(&insert.effect, &mut sig.l, &mut sig.r, sr);
    }
}

/// Fader and pan, or their automation when a lane is in read mode. Source
/// tracks pan a mono signal with equal power; buses carry stereo, so their
/// pan acts as balance (the far side is attenuated, the near side kept).
fn fader(track: &Track, sig: &mut Stereo, from_ticks: u64, ticks_per_frame: f64, balance: bool) {
    let gains = |volume: f64, pan: f64| -> (f64, f64) {
        if balance {
            let p = pan.clamp(-1.0, 1.0);
            (volume * (1.0 - p.max(0.0)), volume * (1.0 + p.min(0.0)))
        } else {
            let angle = (pan.clamp(-1.0, 1.0) + 1.0) * PI / 4.0;
            (angle.cos() * volume, angle.sin() * volume)
        }
    };
    let gain_lane = track.automation.lane(AutomationParam::Gain);
    let pan_lane = track.automation.lane(AutomationParam::Pan);
    let automated = gain_lane.value_at(0.0).is_some() || pan_lane.value_at(0.0).is_some();
    if !automated {
        let (gl, gr) = gains(track.volume, track.pan);
        sig.l.iter_mut().for_each(|s| *s *= gl);
        sig.r.iter_mut().for_each(|s| *s *= gr);
        return;
    }
    for i in 0..sig.l.len() {
        let t = from_ticks as f64 + i as f64 * ticks_per_frame;
        let volume = gain_lane.value_at(t).unwrap_or(track.volume);
        let pan = pan_lane.value_at(t).unwrap_or(track.pan);
        let (gl, gr) = gains(volume, pan);
        sig.l[i] *= gl;
        sig.r[i] *= gr;
    }
}

/// 30 ms decaying sine per beat; 1.5 kHz on the downbeat, 1 kHz otherwise.
fn click_track(doc: &Doc, master: &mut Stereo, from_ticks: u64, to_ticks: u64, seconds_per_tick: f64, sr: f64) {
    let [n, d] = doc.time_sig;
    let beat_ticks = (doc.ppq as u64 * 4) / d as u64;
    if beat_ticks == 0 {
        return;
    }
    let click_len = (0.030 * sr) as usize;
    let first = from_ticks.div_ceil(beat_ticks);
    let mut beat = first;
    while beat * beat_ticks < to_ticks {
        let at = ((beat * beat_ticks - from_ticks) as f64 * seconds_per_tick * sr).round() as usize;
        let freq = if beat % n as u64 == 0 { 1500.0 } else { 1000.0 };
        for k in 0..click_len {
            let i = at + k;
            if i >= master.l.len() {
                break;
            }
            let t = k as f64 / sr;
            let s = (2.0 * PI * freq * t).sin() * (-t / 0.008).exp() * doc.metronome.volume;
            master.l[i] += s;
            master.r[i] += s;
        }
        beat += 1;
    }
}

/// Interleave to f32le stereo bytes.
pub fn to_f32le(sig: &Stereo) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(sig.l.len() * 8);
    for i in 0..sig.l.len() {
        bytes.extend_from_slice(&(sig.l[i] as f32).to_le_bytes());
        bytes.extend_from_slice(&(sig.r[i] as f32).to_le_bytes());
    }
    bytes
}
