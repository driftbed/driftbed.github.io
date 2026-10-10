#![no_std]

mod abi;

pub const ABI_VERSION: u32 = 1;
pub const NUMERIC_CONTRACT_VERSION: u32 = 1;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn driftbed_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn driftbed_numeric_contract_version() -> u32 {
    NUMERIC_CONTRACT_VERSION
}

#[no_mangle]
pub extern "C" fn driftbed_capabilities() -> u32 {
    // Bit 0 is the validated ABI/scalar-kernel foundation. Bit 1 is reserved
    // for the complete Wasm DSP pipeline and remains unset until parity gates pass.
    1
}

#[no_mangle]
pub extern "C" fn driftbed_self_test() -> u32 {
    abi::self_test()
}

#[no_mangle]
pub extern "C" fn driftbed_last_error_code() -> u32 {
    abi::last_error_code()
}

#[no_mangle]
pub unsafe extern "C" fn driftbed_analyze_pcm_f32(
    left: *const f32,
    right: *const f32,
    frames: u32,
    channels: u32,
    rms_out: *mut f32,
    peak_out: *mut f32,
) -> u32 {
    abi::analyze_pcm_f32(left, right, frames, channels, rms_out, peak_out)
}

#[no_mangle]
pub unsafe extern "C" fn driftbed_scale_f32(
    input: *const f32,
    output: *mut f32,
    frames: u32,
    gain: f32,
) -> u32 {
    abi::scale_f32(input, output, frames, gain)
}
