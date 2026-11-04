const SESSION_COOKIE_NAME = "mustmake_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const { frontend_origins } = require("../config/urls");

function getSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_MS
    };
}

function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

function clearSessionCookie(res) {
    const { maxAge, ...options } = getSessionCookieOptions();
    res.clearCookie(SESSION_COOKIE_NAME, options);
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
    getSessionCookieOptions,
    setSessionCookie,
    clearSessionCookie,
    getFrontendOrigins
};
