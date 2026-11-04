const SESSION_COOKIE_NAME = "mustmake_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_SIGNUP_COOKIE_NAME = "mustmake_pending_signup";
const PENDING_SIGNUP_MAX_AGE_MS = 30 * 60 * 1000;
const { frontend_origins } = require("../config/urls");

function getCookieOptions(maxAge) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge
    };
}

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, getCookieOptions(SESSION_MAX_AGE_MS));
}

function clearSessionCookie(res) {
    const { maxAge, ...options } = getCookieOptions(SESSION_MAX_AGE_MS);
    res.clearCookie(SESSION_COOKIE_NAME, options);
}

function setPendingSignupCookie(res, token) {
    res.cookie(
        PENDING_SIGNUP_COOKIE_NAME,
        token,
        getCookieOptions(PENDING_SIGNUP_MAX_AGE_MS)
    );
}

function clearPendingSignupCookie(res) {
    const { maxAge, ...options } = getCookieOptions(PENDING_SIGNUP_MAX_AGE_MS);
    res.clearCookie(PENDING_SIGNUP_COOKIE_NAME, options);
}

function getFrontendOrigins() {
    const configuredOrigins = (process.env.FRONTEND_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean);

    return new Set([
        ...frontend_origins,
        ...configuredOrigins
    ]);
}

module.exports = {
    SESSION_COOKIE_NAME,
    PENDING_SIGNUP_COOKIE_NAME,
    getSessionCookieOptions: () => getCookieOptions(SESSION_MAX_AGE_MS),
    setSessionCookie,
    clearSessionCookie,
    setPendingSignupCookie,
    clearPendingSignupCookie,
    getFrontendOrigins
};
