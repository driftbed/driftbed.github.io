use core::slice;

const OK: u32 = 0;
const INVALID_ARGUMENT: u32 = 1;
const INVALID_STATE: u32 = 3;
const NUMERIC_FAILURE: u32 = 5;

static mut LAST_ERROR: u32 = OK;

fn set_error(code: u32) -> u32 {
    unsafe { LAST_ERROR = code; }
    code
}

pub fn last_error_code() -> u32 {
    unsafe { LAST_ERROR }
}

fn mulberry_next(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let mut value = *state;
    value = (value ^ (value >> 15)).wrapping_mul(value | 1);
    value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
    value ^ (value >> 14)
}

fn sqrt_f64(value: f64) -> f64 {
    if value == 0.0 { return 0.0; }
    let mut guess = if value < 1.0 { 1.0 } else { value };
    for _ in 0..64 { guess = 0.5 * (guess + value / guess); }
    guess
}

pub fn self_test() -> u32 {
    let mut state = 0x1234_5678;
    let expected = [0x1b2c_c72e, 0xf0f7_7b89, 0xf09b_5c53, 0x3bdf_dfd7];
    for expected_value in expected {
        if mulberry_next(&mut state) != expected_value { return set_error(INVALID_STATE); }
    }
    set_error(OK)
}

pub unsafe fn analyze_pcm_f32(
    left: *const f32,
    right: *const f32,
    frames: u32,
    channels: u32,
    rms_out: *mut f32,
    peak_out: *mut f32,
) -> u32 {
    if left.is_null() || rms_out.is_null() || peak_out.is_null() || frames == 0 || !(channels == 1 || channels == 2) {
        return set_error(INVALID_ARGUMENT);
    }
    if channels == 2 && right.is_null() { return set_error(INVALID_ARGUMENT); }
    let count = frames as usize;
    let left_slice = slice::from_raw_parts(left, count);
    let right_slice = if channels == 2 { Some(slice::from_raw_parts(right, count)) } else { None };
    let mut sum = 0.0f64;
    let mut peak = 0.0f32;
    for index in 0..count {
        let left_value = left_slice[index];
        let right_value = right_slice.map_or(left_value, |values| values[index]);
        if !left_value.is_finite() || !right_value.is_finite() { return set_error(NUMERIC_FAILURE); }
        sum += (left_value as f64 * left_value as f64 + right_value as f64 * right_value as f64) * 0.5;
        peak = peak.max(left_value.abs()).max(right_value.abs());
    }
    let rms = sqrt_f64(sum / count as f64) as f32;
    if !rms.is_finite() || !peak.is_finite() { return set_error(NUMERIC_FAILURE); }
    *rms_out = rms;
    *peak_out = peak;
    set_error(OK)
}

pub unsafe fn scale_f32(input: *const f32, output: *mut f32, frames: u32, gain: f32) -> u32 {
    if input.is_null() || output.is_null() || frames == 0 || !gain.is_finite() { return set_error(INVALID_ARGUMENT); }
    let count = frames as usize;
    let source = slice::from_raw_parts(input, count);
    let destination = slice::from_raw_parts_mut(output, count);
    for index in 0..count {
        let value = source[index] * gain;
        if !value.is_finite() { return set_error(NUMERIC_FAILURE); }
        destination[index] = value;
    }
    set_error(OK)
}
