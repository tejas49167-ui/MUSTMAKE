const SESSION_COOKIE_NAME = "mustmake_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
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
        "https://mustmake.site",
        "https://www.mustmake.site",
        "https://mustmake.vercel.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:4000",
        "http://127.0.0.1:4000",
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
