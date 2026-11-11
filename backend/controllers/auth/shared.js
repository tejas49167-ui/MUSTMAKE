const loginRateLimitService = require("../../services/login-rate-limit.service");
const {
    setSessionCookie,
    clearPendingSignupCookie
} = require("../../utils/auth-cookie");

function sendAuthenticatedSession(res, session) {
    res.set("Cache-Control", "no-store");
    clearPendingSignupCookie(res);
    setSessionCookie(res, session.token);
    return res.json({
        success: true,
        user: session.user
    });
}

function sendLoginRestriction(res, retryAfterMs) {
    return res.status(429).json({
        restricted: true,
        retryAfterMs,
        message: "Login temporarily restricted."
    });
}

async function respondToFailedLogin(
    res,
    keys,
    message = "Invalid username/email or password."
) {
    await loginRateLimitService.recordIpFailure(keys.ip);
    const restriction = await loginRateLimitService.getRestriction(keys);

    if (restriction.restricted) {
        return sendLoginRestriction(res, restriction.retryAfterMs);
    }

    return res.status(401).json({ message });
}

module.exports = {
    respondToFailedLogin,
    sendAuthenticatedSession,
    sendLoginRestriction
};
