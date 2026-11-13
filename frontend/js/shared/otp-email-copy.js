// Copy an OTP opened from an email and fill it when an OTP field is on this page.
(function handleEmailCopyOtp() {
    const params = new URLSearchParams(window.location.search);
    const otpFromEmail = params.get("copy_otp");
    if (!otpFromEmail) return;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(otpFromEmail).catch(() => {});
    }

    const otpInput = document.querySelector(
        'input[name="otp"], input#otp, input[autocomplete="one-time-code"]'
    );
    if (otpInput) {
        otpInput.value = otpFromEmail;
        otpInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    params.delete("copy_otp");
    const cleanUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState({}, document.title, cleanUrl);
})();
