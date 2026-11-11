const crypto = require("crypto");
const GoogleOAuthState = require("../models/GoogleOAuthState");
const connectDB = require("../config/database");
const { allowRequest } = require("../services/otp-abuse.service");
const { getCookieValue } = require("../utils/cookie");

const STATE_COOKIE_NAME = "mustmake_google_oauth_state";
const STATE_TTL_MS = 5 * 60 * 1000;
const OAUTH_START_LIMIT = 20;
const OAUTH_START_WINDOW_MS = 60 * 60 * 1000;
const CALLBACK_PATH = "/api/auth/google/callback";
let indexInitialization;

async function ensureIndexes() {
    if (!indexInitialization) {
        indexInitialization = GoogleOAuthState.init().catch(error => {
            indexInitialization = null;
            throw error;
        });
    }
    await indexInitialization;
}

function stateCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: CALLBACK_PATH,
        maxAge: STATE_TTL_MS
    };
}

function getStateCookie(req) {
    return getCookieValue(req.headers.cookie, STATE_COOKIE_NAME) || "";
}

function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length &&
        crypto.timingSafeEqual(leftBytes, rightBytes);
}

function hashState(state) {
    return crypto.createHash("sha256").update(state).digest("hex");
}

async function beginGoogleOAuth(req, res, next) {
    try {
        await ensureIndexes();
        const state = crypto.randomBytes(32).toString("base64url");
        await GoogleOAuthState.create({
            stateHash: hashState(state),
            expiresAt: new Date(Date.now() + STATE_TTL_MS)
        });
        res.set("Cache-Control", "no-store");
        res.cookie(STATE_COOKIE_NAME, state, stateCookieOptions());
        req.googleOAuthState = state;
        return next();
    } catch (error) {
        return next(error);
    }
}

async function limitGoogleOAuthStart(req, res, next) {
    try {
        await connectDB();
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const allowed = await allowRequest(
            "google-oauth-start-ip",
            ip,
            OAUTH_START_LIMIT,
            OAUTH_START_WINDOW_MS
        );
        if (!allowed) {
            return res.status(429).send("Too many Google sign-in attempts. Try again later.");
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

async function validateGoogleOAuthState(req, res, next) {
    const cookieState = getStateCookie(req);
    const queryState = typeof req.query.state === "string" ? req.query.state : "";
    res.set("Cache-Control", "no-store");
    res.clearCookie(STATE_COOKIE_NAME, stateCookieOptions());

    if (
        !/^[A-Za-z0-9_-]{43}$/.test(cookieState) ||
        !/^[A-Za-z0-9_-]{43}$/.test(queryState) ||
        !safeEqual(cookieState, queryState)
    ) {
        return res.status(400).send("Google sign-in state is invalid or expired.");
    }

    try {
        await ensureIndexes();
        const state = await GoogleOAuthState.findOneAndDelete({
            stateHash: hashState(queryState),
            expiresAt: { $gt: new Date() }
        });
        if (!state) {
            return res.status(400).send("Google sign-in state is invalid or expired.");
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    STATE_COOKIE_NAME,
    STATE_TTL_MS,
    stateCookieOptions,
    limitGoogleOAuthStart,
    beginGoogleOAuth,
    validateGoogleOAuthState
};
