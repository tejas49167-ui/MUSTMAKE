const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const connectDB = require("../../config/database");
const { createAuthSession } = require("../../services/auth.service");
const loginRateLimitService = require("../../services/login-rate-limit.service");
const { parsePasswordLogin } = require("../../schemas/auth.schemas");
const { clearSessionCookie } = require("../../utils/auth-cookie");
const {
    respondToFailedLogin,
    sendAuthenticatedSession,
    sendLoginRestriction
} = require("./shared");
const { logFailure } = require("../../utils/safe-log");

const loginRateLimitStatus = async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
        await connectDB();
        await loginRateLimitService.ensureIndexes();

        const keys = loginRateLimitService.getRateLimitKeys(req, res);
        const restriction = await loginRateLimitService.getRestriction(keys);

        return res.json(restriction);
    } catch (error) {
        logFailure("Login rate-limit status failed.", error);
        return res.status(500).json({
            message: "Could not check login availability."
        });
    }
};

const login = async (req, res) => {
    try {
        await connectDB();
        await loginRateLimitService.ensureIndexes();

        const keys = loginRateLimitService.getRateLimitKeys(req, res);
        const currentRestriction = await loginRateLimitService.getRestriction(keys);
        if (currentRestriction.restricted) {
            return sendLoginRestriction(res, currentRestriction.retryAfterMs);
        }

        const credentials = parsePasswordLogin(req.body);
        if (!credentials.valid) {
            return res.status(credentials.status).json({
                message: credentials.message
            });
        }
        const { login, password } = credentials;

        const deviceAttempt = await loginRateLimitService.reserveDeviceAttempt(keys.device);
        if (!deviceAttempt) {
            const restriction = await loginRateLimitService.getRestriction(keys);
            return sendLoginRestriction(res, restriction.retryAfterMs);
        }

        if (
            deviceAttempt.restrictedUntil &&
            deviceAttempt.restrictedUntil.getTime() > Date.now()
        ) {
            return sendLoginRestriction(
                res,
                deviceAttempt.restrictedUntil.getTime() - Date.now()
            );
        }

        if (login.trim().length > 254 || Buffer.byteLength(password, "utf8") > 72) {
            return respondToFailedLogin(res, keys);
        }

        const loginValue = login.toLowerCase().trim();
        const user = await User.findOne({
            $or: [
                { username: loginValue },
                { email: loginValue }
            ]
        }).select("+ageReferenceYear +sessionVersion");

        if (!user) {
            return respondToFailedLogin(
                res,
                keys,
                "User does not exist. Please sign up."
            );
        }

        // Google-only accounts don't have a password.
        if (!user.passwordHash) {
            await loginRateLimitService.recordIpFailure(keys.ip);
            const restriction = await loginRateLimitService.getRestriction(keys);
            if (restriction.restricted) {
                return sendLoginRestriction(res, restriction.retryAfterMs);
            }
            return res.status(401).json({
                message: "Invalid username/email or password."
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
            return respondToFailedLogin(res, keys);
        }

        await loginRateLimitService.resetDeviceFailures(keys.device);
        return sendAuthenticatedSession(res, createAuthSession(user));
    } catch (error) {
        logFailure("Login failed.", error);
        return res.status(500).json({ message: "Could not login." });
    }
};

const currentSession = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        const user = await User.findById(req.userId).select("+ageReferenceYear");
        if (!user) {
            clearSessionCookie(res);
            return res.status(401).json({ message: "Session is no longer valid." });
        }

        return res.json({
            user: {
                id: user._id,
                name: user.name,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture,
                age: user.age
            }
        });
    } catch (error) {
        logFailure("Current session check failed.", error);
        return res.status(500).json({ message: "Could not verify session." });
    }
};

const logout = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await User.updateOne(
            { _id: req.userId },
            { $inc: { sessionVersion: 1 } },
            { timestamps: false }
        );
        clearSessionCookie(res);
        return res.json({ success: true });
    } catch (error) {
        clearSessionCookie(res);
        logFailure("Logout failed.", error);
        return res.status(500).json({ message: "Could not end the server session." });
    }
};

module.exports = {
    login,
    loginRateLimitStatus,
    currentSession,
    logout
};
