const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const connectDB = require("../config/database");
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

async function auth(req, res, next) {
    res.set("Cache-Control", "no-store");
    let decoded;
    try {
        const token = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
        if (!token) {
            return res.status(401).json({
                message: "Authentication required."
            });
        }

        decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"]
        });
    } catch {
        clearSessionCookie(res);
        return res.status(401).json({
            message: "Invalid or expired session."
        });
    }

    if (
        !decoded ||
        typeof decoded !== "object" ||
        !mongoose.isValidObjectId(decoded.userId)
    ) {
        clearSessionCookie(res);
        return res.status(401).json({
            message: "Invalid or expired session."
        });
    }

    let userExists;
    try {
        await connectDB();
        userExists = Boolean(await User.exists({ _id: decoded.userId }));
    } catch (error) {
        return next(error);
    }

    if (!userExists) {
        clearSessionCookie(res);
        return res.status(401).json({
            message: "Invalid or expired session."
        });
    }

    req.userId = decoded.userId;
    return next();
}

module.exports = auth;
