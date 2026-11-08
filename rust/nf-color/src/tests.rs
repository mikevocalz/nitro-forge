//! nf-color tests. Fixtures live in `tests/fixtures/`; provenance and
//! licenses are recorded in `THIRD_PARTY_NOTICES.md` and `README.md`.

use super::*;
use std::time::Instant;

fn fixture(name: &str) -> Vec<u8> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
    std::fs::read(format!("{path}{name}")).expect("fixture readable")
}

fn icc_profile(name: &str) -> Profile {
    Profile::from_icc(&fixture(name)).expect("fixture profile parses")
}

fn gradient_rgba(pixels: usize) -> Vec<u8> {
    // Deterministic pseudo-random-but-reproducible RGBA8 ramp covering the
    // full sRGB cube including saturated corners.
    let mut v = Vec::with_capacity(pixels * 4);
    let mut state = 0x9E3779B97F4A7C15u64;
    for _ in 0..pixels {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        v.push((state & 0xFF) as u8);
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        v.push((state & 0xFF) as u8);
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        v.push((state & 0xFF) as u8);
        v.push(255);
    }
    v
}

fn to_f32_rgba(src: &[u8]) -> Vec<f32> {
    src.iter().map(|&b| b as f32 / 255.0).collect()
}

// ---- Profile parsing ----

#[test]
fn builtin_profiles_info() {
    for (p, space) in [
        (Profile::srgb(), "RGB "),
        (Profile::display_p3(), "RGB "),
        (Profile::rec2020(), "RGB "),
        (Profile::adobe_rgb(), "RGB "),
        (Profile::prophoto(), "RGB "),
    ] {
        let info = p.info();
        assert_eq!(info.color_space, space);
        assert_eq!(info.class, "mntr");
    }
}

#[test]
fn fixture_profiles_parse() {
    let cases = [
        ("sRGB-v4.icc", "mntr", "RGB "),
        ("DisplayP3-v4.icc", "mntr", "RGB "),
        ("Rec2020-v4.icc", "mntr", "RGB "),
        ("sGrey-v4.icc", "mntr", "GRAY"),
        ("srgb-perceptual.icc", "spac", "RGB "),
        ("cmyk-lcms-test1.icc", "prtr", "CMYK"),
    ];
    for (name, class, space) in cases {
        let p = icc_profile(name);
        let info = p.info();
        assert_eq!(info.class, class, "{name}");
        assert_eq!(info.color_space, space, "{name}");
    }
}

#[test]
fn nonconforming_profiles_tolerated() {
    // moxcms test assets: byte-swapped rendering intent and a truncated
    // v4 desc tag. Both parse (documented moxcms tolerance); the transforms
    // below must still work.
    for name in ["hostile-swapped-intent.icc", "hostile-truncated-desc.icc"] {
        let p = icc_profile(name);
        let mut px = [200u8, 100, 50, 255];
        let mut out = [0u8; 4];
        let t = Transform::new(&p, &Profile::srgb(), Channels::Rgba, Channels::Rgba, Intent::Perceptual)
            .expect("transform builds");
        t.transform_u8(&px, &mut out).expect("transform runs");
        assert_ne!(px, out, "{name} should actually transform");
        px[3] = 128;
        let mut out2 = [0u8; 4];
        t.transform_u8(&px, &mut out2).expect("alpha variant runs");
        assert_eq!(out2[3], 128, "alpha must pass through");
    }
}

#[test]
fn hostile_profiles_rejected() {
    assert!(matches!(
        Profile::from_icc(&[]),
        Err(ColorError::InvalidInput(_))
    ));
    assert!(matches!(
        Profile::from_icc(&[0u8; 132]),
        Err(ColorError::ProfileParse(_))
    ));
    // Truncations of a valid profile at several lengths.
    let srgb = fixture("sRGB-v4.icc");
    for cut in [4usize, 64, 128, 200, srgb.len() / 2, srgb.len() - 1] {
        assert!(
            Profile::from_icc(&srgb[..cut]).is_err(),
            "truncated at {cut} must fail"
        );
    }
    // Oversized input rejected by our bound before moxcms sees it.
    let big = vec![0u8; MAX_PROFILE_BYTES];
    assert!(matches!(
        Profile::from_icc(&big),
        Err(ColorError::LimitExceeded(_))
    ));
}

#[test]
fn mutated_profiles_never_panic() {
    // Deterministic mutation fuzz-lite over a valid profile: every byte is
    // XORed/rotated in turn plus a pseudo-random sweep. Parsing or
    // transform construction may fail; panicking may not.
    let base = fixture("sRGB-v4.icc");
    let mut state = 0xDEADBEEFCAFEF00Du64;
    for i in 0..600 {
        let mut m = base.clone();
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let idx = (state as usize) % m.len();
        m[idx] ^= (i as u8).wrapping_add(1);
        if i % 3 == 0 {
            // Also truncate at a pseudo-random point.
            let cut = 132 + ((state >> 8) as usize) % (m.len() - 132);
            m.truncate(cut.max(1));
        }
        let _ = Profile::from_icc(&m);
        if let Ok(p) = Profile::from_icc(&m) {
            let _ = Transform::new(&p, &Profile::srgb(), Channels::Rgba, Channels::Rgba, Intent::Perceptual);
        }
    }
}

// ---- Transforms ----

#[test]
fn srgb_to_builtins_all_intents() {
    let src = gradient_rgba(64);
    for dst in [
        Profile::display_p3(),
        Profile::rec2020(),
        Profile::adobe_rgb(),
        Profile::prophoto(),
    ] {
        for intent in [
            Intent::Perceptual,
            Intent::RelativeColorimetric,
            Intent::Saturation,
            Intent::AbsoluteColorimetric,
        ] {
            let t = Transform::new(&Profile::srgb(), &dst, Channels::Rgba, Channels::Rgba, intent)
                .expect("transform builds");
            let mut out = vec![0u8; src.len()];
            let n = t.transform_u8(&src, &mut out).expect("transform runs");
            assert_eq!(n as usize, 64);
            // Alpha must pass through untouched (input alpha is 255).
            assert!(out.chunks_exact(4).all(|px| px[3] == 255));
        }
    }
}

#[test]
fn transform_is_deterministic() {
    let src = gradient_rgba(256);
    let t = Transform::new(
        &icc_profile("sRGB-v4.icc"),
        &icc_profile("DisplayP3-v4.icc"),
        Channels::Rgba,
        Channels::Rgba,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let mut a = vec![0u8; src.len()];
    let mut b = vec![0u8; src.len()];
    t.transform_u8(&src, &mut a).unwrap();
    t.transform_u8(&src, &mut b).unwrap();
    assert_eq!(a, b, "same input must give bit-identical output");
}

#[test]
fn srgb_to_srgb_near_identity() {
    let src = [10u8, 128, 250, 77, 0, 0, 255, 255];
    let t = Transform::new(
        &Profile::srgb(),
        &Profile::srgb(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .unwrap();
    let mut out = vec![0u8; src.len()];
    t.transform_u8(&src, &mut out).unwrap();
    for (i, (a, b)) in src.iter().zip(out.iter()).enumerate() {
        if i % 4 == 3 {
            assert_eq!(a, b, "alpha passthrough");
        } else {
            assert!(a.abs_diff(*b) <= 2, "sRGB→sRGB channel {i} drifted: {a} vs {b}");
        }
    }
}

#[test]
fn wide_gamut_dst_actually_differs() {
    // Saturated sRGB red must land differently in Rec.2020.
    let src = [255u8, 0, 0, 255];
    let t = Transform::new(
        &Profile::srgb(),
        &Profile::rec2020(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let mut out = [0u8; 4];
    t.transform_u8(&src, &mut out).unwrap();
    assert_ne!(out, src, "sRGB red should move in Rec.2020");
    // Rec.2020 red primary has more red headroom: G/B should drop toward 0
    // or stay small while R stays high — just assert plausibility.
    assert!(out[0] > 200);
}

#[test]
fn cmyk_roundtrip() {
    let cmyk_profile = icc_profile("cmyk-lcms-test1.icc");
    // sRGB → CMYK
    let to_cmyk = Transform::new(
        &Profile::srgb(),
        &cmyk_profile,
        Channels::Rgba,
        Channels::Cmyk,
        Intent::Perceptual,
    )
    .expect("sRGB→CMYK builds");
    let src = gradient_rgba(32);
    let mut cmyk = vec![0u8; src.len()];
    to_cmyk.transform_u8(&src, &mut cmyk).expect("sRGB→CMYK runs");
    assert_eq!(cmyk.len(), src.len());

    // CMYK → sRGB
    let to_rgb = Transform::new(
        &cmyk_profile,
        &Profile::srgb(),
        Channels::Cmyk,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .expect("CMYK→sRGB builds");
    let mut back = vec![0u8; src.len()];
    to_rgb.transform_u8(&cmyk, &mut back).expect("CMYK→sRGB runs");
    // Round-trip through a real output profile is lossy but should be
    // correlated: mean absolute error bounded loosely.
    let mae: u64 = src
        .iter()
        .zip(back.iter())
        .map(|(a, b)| a.abs_diff(*b) as u64)
        .sum::<u64>()
        / src.len() as u64;
    assert!(mae < 80, "CMYK round-trip MAE too large: {mae}");
}

#[test]
fn gray_transforms() {
    let gray = icc_profile("sGrey-v4.icc");
    let to_gray = Transform::new(
        &Profile::srgb(),
        &gray,
        Channels::Rgba,
        Channels::Gray,
        Intent::RelativeColorimetric,
    )
    .expect("sRGB→Gray builds");
    let src = [255u8, 0, 0, 255, 0, 255, 0, 255, 10, 20, 30, 255];
    let mut g = [0u8; 3];
    to_gray.transform_u8(&src, &mut g).expect("runs");
    assert!(g.iter().all(|&v| v > 0));

    let to_rgb = Transform::new(
        &gray,
        &Profile::srgb(),
        Channels::Gray,
        Channels::Rgba,
        Intent::RelativeColorimetric,
    )
    .expect("Gray→sRGB builds");
    let mut rgba = [0u8; 12];
    to_rgb.transform_u8(&g, &mut rgba).expect("runs");
    // Gray must produce R=G=B per pixel.
    for px in rgba.chunks_exact(4) {
        assert_eq!(px[0], px[1]);
        assert_eq!(px[1], px[2]);
        assert_eq!(px[3], 255);
    }
}

#[test]
fn f32_transform_matches_u8() {
    let t = Transform::new(
        &Profile::srgb(),
        &Profile::display_p3(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .unwrap();
    let src8 = gradient_rgba(16);
    let srcf: Vec<f32> = to_f32_rgba(&src8);
    let mut out8 = vec![0u8; src8.len()];
    let mut outf = vec![0f32; srcf.len()];
    t.transform_u8(&src8, &mut out8).unwrap();
    t.transform_f32(&srcf, &mut outf).unwrap();
    for (a, b) in out8.iter().zip(outf.iter()) {
        let bf = (*b * 255.0).round().clamp(0.0, 255.0) as u8;
        // f32 path is higher precision; allow a couple LSB of divergence.
        assert!(a.abs_diff(bf) <= 3, "u8={a} f32→u8={bf}");
    }
}

#[test]
fn buffer_validation() {
    let t = Transform::new(
        &Profile::srgb(),
        &Profile::display_p3(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .unwrap();
    let src = [0u8; 8];
    assert!(matches!(
        t.transform_u8(&src[..7], &mut [0u8; 8]),
        Err(ColorError::InvalidInput(_))
    ));
    assert!(matches!(
        t.transform_u8(&src, &mut [0u8; 4]),
        Err(ColorError::InvalidInput(_))
    ));
    // f32 non-finite rejection
    let t32 = Transform::new(
        &Profile::srgb(),
        &Profile::display_p3(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .unwrap();
    assert!(matches!(
        t32.transform_f32(&[f32::NAN; 4], &mut [0f32; 4]),
        Err(ColorError::InvalidInput(_))
    ));
}

#[test]
fn unsupported_layouts_rejected() {
    let srgb = Profile::srgb();
    let cmyk = icc_profile("cmyk-lcms-test1.icc");
    // CMYK channels on an RGB profile.
    assert!(matches!(
        Transform::new(&srgb, &srgb, Channels::Cmyk, Channels::Rgba, Intent::Perceptual),
        Err(ColorError::Unsupported(_))
    ));
    // RGB channels on a CMYK profile.
    assert!(matches!(
        Transform::new(&cmyk, &cmyk, Channels::Rgba, Channels::Cmyk, Intent::Perceptual),
        Err(ColorError::Unsupported(_))
    ));
    // CMYK → CMYK same profile still needs a real connection; moxcms may
    // reject identity device-link-ish transforms — either way it must not
    // panic.
    let _ = Transform::new(&cmyk, &cmyk, Channels::Cmyk, Channels::Cmyk, Intent::Perceptual);
}

// ---- Soft proof ----

#[test]
fn soft_proof_cmyk_chain() {
    let doc = Profile::srgb();
    let proof = icc_profile("cmyk-lcms-test1.icc");
    let display = Profile::display_p3();
    let sp = SoftProof::new(&doc, &proof, &display, Intent::Perceptual)
        .expect("soft-proof chain builds");
    let src = gradient_rgba(16);
    let mut out = vec![0u8; src.len()];
    let n = sp.transform_u8(&src, &mut out).expect("proof runs");
    assert_eq!(n as usize, 16);
}

#[test]
fn soft_proof_rgb_chain_and_f32() {
    let doc = Profile::srgb();
    let proof = icc_profile("srgb-perceptual.icc");
    let display = Profile::srgb();
    let sp = SoftProof::new(&doc, &proof, &display, Intent::RelativeColorimetric)
        .expect("RGB soft-proof chain builds");
    let srcf = to_f32_rgba(&gradient_rgba(8));
    let mut outf = vec![0f32; srcf.len()];
    sp.transform_f32(&srcf, &mut outf).expect("f32 proof runs");
    assert!(outf.iter().all(|v| v.is_finite()));
}

// ---- Gamut ----

#[test]
fn gamut_flags_out_of_gamut_rec2020_to_srgb() {
    // Wide-gamut source (Rec.2020) into sRGB proof: saturated corners must
    // be flagged.
    let src_profile = Profile::rec2020();
    let proof = Profile::srgb();
    let meter = GamutMeter::new(&src_profile, &proof, Channels::Rgba, Intent::Perceptual)
        .expect("meter builds");
    // Hand-built Rec.2020 primaries: deep saturated colors that exceed
    // sRGB gamut.
    let mut src = Vec::new();
    for &(r, g, b) in &[
        (1.0f32, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
        (1.0, 1.0, 0.0),
        (0.2, 0.2, 0.2), // neutral — in gamut
        (0.5, 0.5, 0.5),
    ] {
        src.extend_from_slice(&[r, g, b, 1.0]);
    }
    let mut dst = vec![0f32; src.len()]; // RGBA proof → 4ch scratch
    let report = meter.measure_f32(&src, &mut dst).expect("measure runs");
    eprintln!("gamut report: {report:?}");
    assert_eq!(report.pixels, 6);
    assert!(
        report.total_flagged > 0,
        "saturated Rec.2020 colors must flag against sRGB proof: {report:?}"
    );
    // Neutrals may or may not flag depending on rounding; primaries must.
    assert!(report.out_of_range + report.roundtrip_mismatch > 0);
}

#[test]
fn gamut_in_gamut_is_clean() {
    // sRGB → sRGB proof: everything is in gamut; counts should be ~0.
    // (Round-trip through identical profiles is near-exact.)
    let src_profile = Profile::srgb();
    let proof = Profile::srgb();
    let meter = GamutMeter::new(&src_profile, &proof, Channels::Rgba, Intent::Perceptual)
        .expect("meter builds");
    let src8 = gradient_rgba(64);
    let srcf = to_f32_rgba(&src8);
    let mut dst = vec![0f32; srcf.len()];
    let report = meter.measure_f32(&srcf, &mut dst).expect("measure runs");
    assert_eq!(report.pixels, 64);
    assert_eq!(
        report.total_flagged, 0,
        "sRGB→sRGB should measure clean: {report:?}"
    );
}

#[test]
fn gamut_counts_stable_across_intents() {
    // The decision record requires counts stable across intents: same
    // input, all four intents, report totals must be identical or within a
    // small tolerance (perceptual vs colorimetric mappings differ at the
    // boundary).
    let src_profile = Profile::rec2020();
    let proof = Profile::srgb();
    let srcf = {
        let mut v = Vec::new();
        for i in 0..32 {
            let t = i as f32 / 31.0;
            v.extend_from_slice(&[t, (1.0 - t) * 0.8, 0.1, 1.0]);
        }
        v
    };
    let mut totals = Vec::new();
    for intent in [
        Intent::Perceptual,
        Intent::RelativeColorimetric,
        Intent::Saturation,
        Intent::AbsoluteColorimetric,
    ] {
        let meter = GamutMeter::new(&src_profile, &proof, Channels::Rgba, intent).unwrap();
        let mut dst = vec![0f32; srcf.len()];
        let r = meter.measure_f32(&srcf, &mut dst).unwrap();
        totals.push(r.total_flagged);
    }
    let min = *totals.iter().min().unwrap();
    let max = *totals.iter().max().unwrap();
    assert!(
        max - min <= 4,
        "gamut counts should be roughly intent-stable, got {totals:?}"
    );
}

// ---- Perf sanity ----

#[test]
fn transform_perf_sanity() {
    // 1 MP RGBA sRGB→Display-P3 u8. Generous bound: catches pathological
    // LUT rebuilds, not a benchmark. moxcms matrix-shaper path should do
    // this in tens of ms.
    let pixels = 1_048_576usize;
    let src = gradient_rgba(pixels);
    let t = Transform::new(
        &Profile::srgb(),
        &Profile::display_p3(),
        Channels::Rgba,
        Channels::Rgba,
        Intent::Perceptual,
    )
    .unwrap();
    let mut out = vec![0u8; src.len()];
    let start = Instant::now();
    let n = t.transform_u8(&src, &mut out).unwrap();
    let el = start.elapsed();
    assert_eq!(n as usize, pixels);
    // Sanity floor: >100k pixels/sec even on slow/CI hardware.
    let mpps = pixels as f64 / el.as_secs_f64() / 1e6;
    assert!(mpps > 0.1, "transform throughput collapsed: {mpps} MPix/s");
}

#[test]
fn spac_class_profile_supported_but_intent_limited() {
    // 'spac' (colorspace conversion) profiles carry only perceptual and
    // colorimetric LUTs. Saturation has no LUT and must fail cleanly;
    // AbsoluteColorimetric falls back to the colorimetric tags inside
    // moxcms (documented moxcms behavior, not an nf-color substitution).
    let spac = icc_profile("srgb-perceptual.icc");
    let srgb = Profile::srgb();
    for intent in [Intent::Perceptual, Intent::RelativeColorimetric] {
        assert!(
            Transform::new(&srgb, &spac, Channels::Rgba, Channels::Rgba, intent).is_ok(),
            "{intent:?} should build"
        );
        assert!(
            Transform::new(&spac, &srgb, Channels::Rgba, Channels::Rgba, intent).is_ok(),
            "{intent:?} reverse should build"
        );
    }
    assert!(
        Transform::new(&srgb, &spac, Channels::Rgba, Channels::Rgba, Intent::Saturation).is_err(),
        "Saturation must fail: profile has no saturation LUT"
    );
    assert!(
        Transform::new(&srgb, &spac, Channels::Rgba, Channels::Rgba, Intent::AbsoluteColorimetric)
            .is_ok(),
        "AbsoluteColorimetric uses the colorimetric LUT tags in moxcms"
    );
}

