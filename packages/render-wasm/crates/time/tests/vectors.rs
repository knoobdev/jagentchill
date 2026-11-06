//! Runs `packages/editor-core/fixtures/time-vectors.json` against the crate: the same file the TypeScript
//! implementation is held to, so the two agree to the tick.

use serde_json::{Value, json};
use time::*;

fn call(op: &str, args: Value) -> Result<Value, String> {
    macro_rules! options {
        () => {
            serde_json::from_value(args.clone()).map_err(|error| format!("{op}: {error}"))?
        };
    }
    let ticks = |time: MediaTime| json!(time.as_ticks());
    Ok(match op {
        "mediaTime" => ticks(media_time(options!())?),
        "mediaTimeFromSeconds" => ticks(media_time_from_seconds(options!())?),
        "mediaTimeToSeconds" => json!(media_time_to_seconds(options!())),
        "mediaTimeFromFrame" => ticks(media_time_from_frame(options!())?),
        "mediaTimeToFrame" => json!(media_time_to_frame(options!())? as i64),
        "roundToFrame" => ticks(round_to_frame(options!())?),
        "floorToFrame" => ticks(floor_to_frame(options!())?),
        "isFrameAligned" => json!(is_frame_aligned(options!())?),
        "lastFrameTime" => ticks(last_frame_time(options!())?),
        "snappedSeekTime" => ticks(snapped_seek_time(options!())?),
        "mediaTimeAdd" => ticks(media_time_add(options!())?),
        "mediaTimeSub" => ticks(media_time_sub(options!())?),
        "mediaTimeMin" => ticks(media_time_min(options!())),
        "mediaTimeMax" => ticks(media_time_max(options!())),
        "mediaTimeClamp" => ticks(media_time_clamp(options!())),
        "guessTimecodeFormat" => json!(guess_timecode_format(options!())),
        "formatTimecode" => json!(format_timecode(options!())),
        "parseTimecode" => json!(parse_timecode(options!()).map(MediaTime::as_ticks)),
        "retimedDuration" => ticks(retimed_duration(options!())?),
        "sourceTimeAt" => ticks(source_time_at(options!())),
        "clipTimeAt" => ticks(clip_time_at(options!())),
        other => return Err(format!("unknown operation {other}")),
    })
}

fn same(actual: &Value, expected: &Value) -> bool {
    match (actual.as_f64(), expected.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => actual == expected,
    }
}

#[test]
fn shared_vectors_agree() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../editor-core/fixtures/time-vectors.json");
    let file: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("the vector file exists")).unwrap();
    let mut count = 0;
    for section in ["base", "retime"] {
        for case in file[section].as_array().unwrap() {
            let op = case["op"].as_str().unwrap();
            let outcome = call(op, case["args"].clone());
            match (&outcome, case.get("error").and_then(Value::as_str)) {
                (Err(code), Some(expected)) => assert_eq!(code, expected, "{op} {}", case["args"]),
                (Ok(value), None) => assert!(same(value, &case["expect"]), "{op} {}: {value} instead of {}", case["args"], case["expect"]),
                _ => panic!("{op} {}: {outcome:?} instead of {case}", case["args"]),
            }
            count += 1;
        }
    }
    assert!(count >= 2500, "{count} cases");
}
