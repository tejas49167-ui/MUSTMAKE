const jwt = require("jsonwebtoken");
const {
    SESSION_COOKIE_NAME,
    clearSessionCookie
} = require("../utils/auth-cookie");

function getCookieValue(cookieHeader, name) {
    if (!cookieHeader) return null;

    const cookie = cookieHeader.split(";").find(part => {
        const separator = part.indexOf("=");
        return separator >= 0 && part.slice(0, separator).trim() === name;
    });

    if (!cookie) return null;
    return cookie.slice(cookie.indexOf("=") + 1).trim();
}

function auth(req, res, next) {
    try {
        const token = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
        if (!token) {
            return res.status(401).json({
                message: "Authentication required."
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch {
        clearSessionCookie(res);
        return res.status(401).json({
            message: "Invalid or expired session."
        });
    }
}

module.exports = auth;
