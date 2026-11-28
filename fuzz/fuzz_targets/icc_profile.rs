//! nf-color `Profile::from_icc`: an untrusted ICC profile (embedded in an
//! image or picked by the user, parsed by moxcms), then a transform built
//! and run in both directions against sRGB.
#![no_main]

use libfuzzer_sys::fuzz_target;
use nf_color::{Channels, Intent, Profile, Transform};

const INTENTS: [Intent; 4] = [
    Intent::Perceptual,
    Intent::RelativeColorimetric,
    Intent::Saturation,
    Intent::AbsoluteColorimetric,
];

fuzz_target!(|data: &[u8]| {
    let Ok(profile) = Profile::from_icc(data) else {
        return;
    };
    let _ = profile.info();
    let srgb = Profile::srgb();
    let intent = INTENTS[data.len() % INTENTS.len()];
    for channels in [Channels::Rgb, Channels::Gray, Channels::Cmyk] {
        let n = channels.count();
        let src: Vec<u8> = (0..16 * n).map(|i| (i * 37 % 256) as u8).collect();
        if let Ok(t) = Transform::new(&profile, &srgb, channels, Channels::Rgb, intent) {
            let mut dst = vec![0u8; 16 * 3];
            let _ = t.transform_u8(&src, &mut dst);
            let fsrc: Vec<f32> = src.iter().map(|&v| f32::from(v) / 255.0).collect();
            let mut fdst = vec![0f32; 16 * 3];
            let _ = t.transform_f32(&fsrc, &mut fdst);
        }
        if let Ok(t) = Transform::new(&srgb, &profile, Channels::Rgb, channels, intent) {
            let src = vec![128u8; 16 * 3];
            let mut dst = vec![0u8; 16 * n];
            let _ = t.transform_u8(&src, &mut dst);
        }
    }
});
