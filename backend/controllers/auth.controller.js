const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const PendingSignup = require("../models/PendingSignup");
const connectDB = require("../config/database");
const { isPlainObject, isValidEmail } = require("../utils/validation");
const {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_RESEND_COOLDOWN_MS,
    OTP_ATTEMPT_WINDOW_MS,
    generateOTP,
    generateOTPChallenge,
    hashOTP,
    createAuthSession
} = require("../services/auth.service");
const { sendOTPEmail } = require("../services/email.service");
const otpAbuseService = require("../services/otp-abuse.service");
const loginRateLimitService = require("../services/login-rate-limit.service");
const {
    setSessionCookie,
    clearSessionCookie,
    setPendingSignupCookie,
    clearPendingSignupCookie
} = require("../utils/auth-cookie");
const { getFrontendRedirect } = require("../config/urls");
const { logFailure } = require("../utils/safe-log");

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

async function savePendingSignup(data, res) {
    await PendingSignup.init();
    const pendingToken = crypto.randomBytes(32).toString("base64url");
    await PendingSignup.findOneAndUpdate(
        { email: data.email },
        {
            $set: {
                username: data.username,
                passwordHash: data.passwordHash || null,
                googleId: data.googleId || null,
                profilePicture: data.profilePicture || null,
                authProvider: data.authProvider,
                tokenHash: hashOTP(pendingToken),
                expiresAt: new Date(Date.now() + 30 * 60 * 1000)
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    setPendingSignupCookie(res, pendingToken);
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

    return res.status(401).json({
        message
    });
}

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

function isOtpLocked(guard, now = new Date()) {
    return Boolean(
        guard &&
        guard.failedAttempts >= OTP_MAX_ATTEMPTS &&
        guard.attemptWindowStartedAt &&
        guard.attemptWindowStartedAt.getTime() > now.getTime() - OTP_ATTEMPT_WINDOW_MS
    );
}

async function claimOtpSend(email, purpose, now) {
    try {
        return await OTPGuard.findOneAndUpdate(
            {
                email,
                purpose,
                $and: [
                    {
                        $or: [
                            { lastSentAt: { $exists: false } },
                            { lastSentAt: { $lte: new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS) } }
                        ]
                    },
                    {
                        $or: [
                            { attemptWindowStartedAt: { $exists: false } },
                            { attemptWindowStartedAt: { $lte: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS) } },
                            { failedAttempts: { $lt: OTP_MAX_ATTEMPTS } }
                        ]
                    }
                ]
            },
            {
                $set: { lastSentAt: now },
                $setOnInsert: { email, purpose }
            },
            { returnDocument: "after", upsert: true }
        );
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function incrementOtpFailures(email, purpose, now) {
    const activeWindow = {
        email,
        purpose,
        attemptWindowStartedAt: {
            $gt: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS)
        }
    };

    const incremented = await OTPGuard.findOneAndUpdate(
        activeWindow,
        { $inc: { failedAttempts: 1 } },
        { returnDocument: "after" }
    );

    if (incremented) {
        return incremented;
    }

    try {
        return await OTPGuard.findOneAndUpdate(
            {
                email,
                purpose,
                $or: [
                    { attemptWindowStartedAt: { $exists: false } },
                    { attemptWindowStartedAt: { $lte: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS) } }
                ]
            },
            {
                $set: {
                    failedAttempts: 1,
                    attemptWindowStartedAt: now
                },
                $setOnInsert: { email, purpose }
            },
            { returnDocument: "after", upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }

        const retried = await OTPGuard.findOneAndUpdate(
            activeWindow,
            { $inc: { failedAttempts: 1 } },
            { returnDocument: "after" }
        );

        if (!retried) {
            throw error;
        }

        return retried;
    }
}

const sendOtp = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);
        const body = isPlainObject(req.body) ? req.body : {};
        const { email, purpose } = body;

        if (typeof email !== "string" || typeof purpose !== "string") {
            return res.status(400).json({ message: "Email and OTP purpose are required." });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }
        if (!["login", "signup"].includes(purpose)) {
            return res.status(400).json({ message: "Invalid OTP purpose." });
        }

        if (purpose === "signup" && await User.findOne({ email: cleanEmail })) {
            return res.status(409).json({
                message: "User already exists. Please log in."
            });
        }

        const existingUser = purpose === "login"
            ? await User.findOne({ email: cleanEmail })
            : null;
        if (purpose === "login" && !existingUser) {
            return res.status(404).json({
                message: "User does not exist. Please sign up."
            });
        }

        const now = new Date();
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const previousOTP = await OTP.findOne({ email: cleanEmail, purpose });
        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });
        if (isOtpLocked(guard, now)) {
            return res.status(429).json({
                message: "Too many incorrect code attempts. Please try again later."
            });
        }

        const cooldownStartedAt = guard?.lastSentAt || previousOTP?.createdAt;
        if (
            cooldownStartedAt &&
            cooldownStartedAt.getTime() > now.getTime() - OTP_RESEND_COOLDOWN_MS
        ) {
            return res.status(202).json({
                success: true,
                codeAlreadySent: true,
                sentAt: cooldownStartedAt.getTime(),
                message: "A code was sent recently. Use the most recent code."
            });
        }

        let signupData = null;
        const hasSignupFields =
            typeof body.username === "string" || typeof body.password === "string";

        if (purpose === "signup") {
            if (hasSignupFields) {
                const username = typeof body.username === "string"
                    ? body.username.trim().toLowerCase()
                    : "";
                const password = typeof body.password === "string" ? body.password : "";

                if (!/^[a-z0-9_]{3,30}$/.test(username)) {
                    return res.status(400).json({
                        message: "Username must be 3 to 30 characters and use only letters, numbers or underscores."
                    });
                }
                if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
                    return res.status(400).json({
                        message: "Password must be at least 6 characters and no more than 72 bytes."
                    });
                }

                signupData = {
                    username,
                    passwordHash: await bcrypt.hash(password, 12)
                };
            } else if (
                previousOTP?.expiresAt > now &&
                previousOTP.signupData?.passwordHash
            ) {
                signupData = previousOTP.signupData.toObject
                    ? previousOTP.signupData.toObject()
                    : previousOTP.signupData;
            } else {
                return res.status(400).json({
                    message: "Signup details expired. Please enter your details again."
                });
            }
        }

        let usernameExists = false;
        if (purpose === "signup") {
            usernameExists = Boolean(await User.findOne({ username: signupData.username }));
        }

        if (usernameExists) {
            return res.status(409).json({
                message: "That username is already taken. Please choose another one."
            });
        }

        const challengeToken = generateOTPChallenge();
        const allowed = await otpAbuseService.allowOtpSend(cleanEmail, ip, now);
        if (!allowed) {
            return res.status(429).json({
                message: "Too many code requests. Please try again later."
            });
        }

        const sendClaim = await claimOtpSend(cleanEmail, purpose, now);
        if (!sendClaim) {
            return res.status(429).json({
                message: "Too many code requests. Please wait before trying again."
            });
        }

        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
        await OTP.deleteMany({ email: cleanEmail, purpose });

        const otpRecord = await OTP.create({
            email: cleanEmail,
            otpHash,
            challengeHash: hashOTP(challengeToken),
            purpose,
            expiresAt,
            ...(signupData ? { signupData } : {})
        });

        try {
            await sendOTPEmail(cleanEmail, otp, purpose);
        } catch (error) {
            await Promise.all([
                OTP.deleteOne({ _id: otpRecord._id, otpHash }),
                OTPGuard.updateOne(
                    { email: cleanEmail, purpose, lastSentAt: now },
                    { $unset: { lastSentAt: 1 } }
                )
            ]);
            throw error;
        }

        return res.status(202).json({
            success: true,
            challengeToken,
            sentAt: now.getTime(),
            message: "Verification code sent."
        });
    } catch (error) {
        logFailure("Send OTP failed.", error);
        return res.status(500).json({ message: "Could not process the code request." });
    }
};

const verifyOtp = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);
        const body = isPlainObject(req.body) ? req.body : {};
        const { email, otp, purpose } = body;

        if (typeof email !== "string" || typeof purpose !== "string") {
            return res.status(400).json({
                message: "Email, OTP and purpose are required."
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }
        if (!["login", "signup"].includes(purpose)) {
            return res.status(400).json({ message: "Invalid OTP purpose." });
        }

        const now = new Date();
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const allowed = await otpAbuseService.allowOtpVerification(cleanEmail, ip, now);
        if (!allowed) {
            return res.status(429).json({
                message: "Too many code attempts. Request a new code later."
            });
        }

        const cleanOTP = typeof otp === "string" ? otp.trim() : "";
        const challengeToken = typeof body.challengeToken === "string"
            ? body.challengeToken
            : "";
        if (!/^\d{6}$/.test(cleanOTP)) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });
        if (isOtpLocked(guard, now)) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const otpRecord = await OTP.findOne({ email: cleanEmail, purpose });
        if (!otpRecord || otpRecord.expiresAt <= now) {
            if (otpRecord) {
                await OTP.deleteOne({ _id: otpRecord._id, expiresAt: { $lte: now } });
            }
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        if (
            otpRecord.attempts >= OTP_MAX_ATTEMPTS ||
            (purpose === "signup" && !otpRecord.signupData?.passwordHash)
        ) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const submittedOtpHash = Buffer.from(hashOTP(cleanOTP), "hex");
        const storedOtpHash = Buffer.from(otpRecord.otpHash, "hex");
        const submittedChallengeHash = Buffer.from(hashOTP(challengeToken), "hex");
        const storedChallengeHash = Buffer.from(otpRecord.challengeHash || "", "hex");
        const otpMatches = submittedOtpHash.length === storedOtpHash.length &&
            crypto.timingSafeEqual(submittedOtpHash, storedOtpHash);
        const challengeMatches = submittedChallengeHash.length === storedChallengeHash.length &&
            storedChallengeHash.length > 0 &&
            crypto.timingSafeEqual(submittedChallengeHash, storedChallengeHash);

        if (otpMatches && challengeMatches && purpose === "signup") {
            const existingUser = await User.findOne({ email: cleanEmail });
            if (existingUser) {
                await OTP.deleteOne({ _id: otpRecord._id });
                return res.status(409).json({
                    message: "An account with this email already exists. Please log in."
                });
            }
        }

        if (!otpMatches || !challengeMatches) {
            const updatedRecord = await OTP.findOneAndUpdate(
                {
                    _id: otpRecord._id,
                    attempts: { $lt: OTP_MAX_ATTEMPTS },
                    expiresAt: { $gt: new Date() }
                },
                { $inc: { attempts: 1 } },
                { returnDocument: "after" }
            );

            if (!updatedRecord) {
                return res.status(401).json({ message: "Invalid or expired code." });
            }

            const updatedGuard = await incrementOtpFailures(
                cleanEmail,
                purpose,
                new Date()
            );
            if (
                updatedRecord.attempts >= OTP_MAX_ATTEMPTS ||
                updatedGuard.failedAttempts >= OTP_MAX_ATTEMPTS
            ) {
                await OTP.deleteMany({ email: cleanEmail, purpose });
                return res.status(401).json({ message: "Invalid or expired code." });
            }

            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const consumedOTP = await OTP.findOneAndDelete({
            _id: otpRecord._id,
            otpHash: otpRecord.otpHash,
            challengeHash: otpRecord.challengeHash,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: OTP_MAX_ATTEMPTS }
        });
        if (!consumedOTP) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        await OTPGuard.updateOne(
            { email: cleanEmail, purpose },
            {
                $set: { failedAttempts: 0 },
                $unset: { attemptWindowStartedAt: 1 }
            }
        );

        if (purpose === "signup") {
            try {
                await savePendingSignup({
                    email: cleanEmail,
                    username: consumedOTP.signupData.username,
                    passwordHash: consumedOTP.signupData.passwordHash,
                    authProvider: "password"
                }, res);
                return res.json({
                    success: true,
                    pendingSignup: true,
                    message: "Email verified. Complete your details to create your account."
                });
            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({
                        message: "Signup could not be completed. Please restart signup."
                    });
                }
                throw error;
            }
        }

        const user = await User.findOne({ email: cleanEmail })
            .select("+ageReferenceYear +sessionVersion");
        if (!user) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        if (!user.emailVerifiedAt) {
            user.emailVerifiedAt = new Date();
            if (typeof user.save === "function") await user.save();
        }

        const session = createAuthSession(user);
        res.set("Cache-Control", "no-store");
        clearPendingSignupCookie(res);
        setSessionCookie(res, session.token);
        return res.json({
            success: true,
            user: session.user
        });
    } catch (error) {
        logFailure("Verify OTP failed.", error);
        return res.status(500).json({ message: "Could not verify the code." });
    }
};

const login = async (req, res) => {

        try {

            await connectDB();
            await loginRateLimitService.ensureIndexes();

            const keys = loginRateLimitService.getRateLimitKeys(req, res);
            const currentRestriction =
                await loginRateLimitService.getRestriction(keys);

            if (currentRestriction.restricted) {
                return sendLoginRestriction(
                    res,
                    currentRestriction.retryAfterMs
                );
            }


            const body = isPlainObject(req.body) ? req.body : {};
            const { login, password } = body;


            if (
                !login ||
                !password ||
                typeof login !== "string" ||
                typeof password !== "string"
            ) {

                return res.status(400).json({
                    message:
                        "Username/email and password are required."
                });
            }

            const deviceAttempt =
                await loginRateLimitService.reserveDeviceAttempt(keys.device);

            if (!deviceAttempt) {
                const restriction =
                    await loginRateLimitService.getRestriction(keys);
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

            if (
                login.trim().length > 254 ||
                Buffer.byteLength(password, "utf8") > 72
            ) {
                return respondToFailedLogin(res, keys);
            }

            const loginValue =
                login
                    .toLowerCase()
                    .trim();


            const user =
                await User.findOne({

                    $or: [

                        {
                            username:
                                loginValue
                        },

                        {
                            email:
                                loginValue
                        }

                    ]
                }).select("+ageReferenceYear +sessionVersion");


            if (!user) {
                return respondToFailedLogin(
                    res,
                    keys,
                    "User does not exist. Please sign up."
                );
            }


            // Google-only accounts don't have a password
            if (!user.passwordHash) {
                await loginRateLimitService.recordIpFailure(keys.ip);
                const restriction =
                    await loginRateLimitService.getRestriction(keys);
                if (restriction.restricted) {
                    return sendLoginRestriction(res, restriction.retryAfterMs);
                }
                return res.status(401).json({
                    message: "Invalid username/email or password."
                });
            }


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.passwordHash
                );


            if (!passwordMatch) {
                return respondToFailedLogin(res, keys);
            }

            await loginRateLimitService.resetDeviceFailures(keys.device);

            return sendAuthenticatedSession(res, createAuthSession(user));


        } catch (error) {
            logFailure("Login failed.", error);


            res.status(500).json({
                message:
                    "Could not login."
            });
        }
    };

const googleCallback = async (req, res) => {
        try {
            if (req.user?.pendingSignup === true) {
                await savePendingSignup({
                    email: req.user.email,
                    username: req.user.username,
                    googleId: req.user.googleId,
                    profilePicture: req.user.profilePicture,
                    authProvider: "google"
                }, res);
                res.set("Cache-Control", "no-store");
                return res.redirect(getFrontendRedirect(
                    "/pages/google-callback.html?pendingSignup=1"
                ));
            }
            if (!req.user?._id) {
                return res.redirect(getFrontendRedirect("/pages/login.html"));
            }
            const session = createAuthSession(req.user);
            clearPendingSignupCookie(res);
            setSessionCookie(res, session.token);
            res.set("Cache-Control", "no-store");
            return res.redirect(getFrontendRedirect("/pages/google-callback.html"));
        } catch (error) {
            logFailure("Google callback failed.", error);
            return res.redirect(getFrontendRedirect("/pages/login.html"));
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
    sendOtp,
    verifyOtp,
    login,
    loginRateLimitStatus,
    googleCallback,
    currentSession,
    logout
};
