const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const connectDB = require("../config/database");
const { isPlainObject, isValidEmail } = require("../utils/validation");
const {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_RESEND_COOLDOWN_MS,
    OTP_ATTEMPT_WINDOW_MS,
    generateOTP,
    hashOTP,
    createAuthSession
} = require("../services/auth.service");
const { sendOTPEmail } = require("../services/email.service");
const loginRateLimitService = require("../services/login-rate-limit.service");

function sendLoginRestriction(res, retryAfterMs) {
    return res.status(429).json({
        restricted: true,
        retryAfterMs,
        message: "Login temporarily restricted."
    });
}

async function respondToFailedLogin(res, keys) {
    await loginRateLimitService.recordIpFailure(keys.ip);
    const restriction = await loginRateLimitService.getRestriction(keys);

    if (restriction.restricted) {
        return sendLoginRestriction(res, restriction.retryAfterMs);
    }

    return res.status(401).json({
        message: "Invalid username/email or password."
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
        console.error("Login rate-limit status error:", error);
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

        try {

            await connectDB();

            const body =
                isPlainObject(req.body)
                    ? req.body
                    : {};

            const { email, purpose } = body;

            if (
                typeof email !== "string" ||
                typeof purpose !== "string"
            ) {
                return res.status(400).json({
                    message:
                        "Email and OTP purpose are required."
                });
            }

            const cleanEmail =
                email.trim().toLowerCase();

            if (!isValidEmail(cleanEmail)) {
                return res.status(400).json({
                    message:
                        "Enter a valid email address."
                });
            }

            if (
                !["login", "signup"].includes(
                    purpose
                )
            ) {
                return res.status(400).json({
                    message:
                        "Invalid OTP purpose."
                });
            }

            const existingUser = await User.findOne({ email: cleanEmail });

            // SIGNUP

            if (
                purpose === "signup" &&
                existingUser
            ) {
                return res.status(409).json({
                    message:
                        "Email already registered. Please login"
                });
            }

            // LOGIN

            if (
                purpose === "login" &&
                !existingUser
            ) {
                return res.status(404).json({
                    message:
                        "No account exists with this email."
                });
            }

            const previousOTP = await OTP.findOne({
                email: cleanEmail,
                purpose
            });

            let signupData = null;
            let hasSignupFields = false;

            if (purpose === "signup") {
                hasSignupFields =
                    typeof body.username === "string" ||
                    typeof body.password === "string";

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
                    previousOTP &&
                    previousOTP.expiresAt > new Date() &&
                    previousOTP.signupData?.passwordHash
                ) {
                    // A page refresh should not discard a still-valid signup draft.
                    signupData = previousOTP.signupData.toObject
                        ? previousOTP.signupData.toObject()
                        : previousOTP.signupData;
                } else {
                    return res.status(400).json({
                        message: "Signup details expired. Please enter your details again."
                    });
                }

                const usernameOwner = await User.findOne({ username: signupData.username });
                if (usernameOwner) {
                    return res.status(409).json({ message: "Username already exists." });
                }
            }

            const now = new Date();
            const guard = await OTPGuard.findOne({
                email: cleanEmail,
                purpose
            });

            if (isOtpLocked(guard, now)) {
                return res.status(429).json({
                    message: "Too many incorrect attempts. Please wait five minutes before requesting another OTP."
                });
            }

            // Keep the current code valid during the cooldown. Signup retries
            // may update the saved draft without sending another email.
            const cooldownStartedAt = guard?.lastSentAt || previousOTP?.createdAt;
            const withinCooldown = cooldownStartedAt &&
                cooldownStartedAt.getTime() > now.getTime() - OTP_RESEND_COOLDOWN_MS;

            if (withinCooldown) {
                if (
                    purpose === "signup" &&
                    signupData &&
                    previousOTP?.expiresAt > now
                ) {
                    if (hasSignupFields) {
                        previousOTP.signupData = signupData;
                        await previousOTP.save();
                    }

                    return res.json({
                        success: true,
                        codeAlreadySent: true,
                        sentAt: cooldownStartedAt.getTime(),
                        message: "A code was sent recently. Use the current code from your email."
                    });
                }

                return res.status(429).json({
                    message:
                        "Please wait 60 seconds before requesting another OTP."
                });
            }

            const sendClaim = await claimOtpSend(cleanEmail, purpose, now);
            if (!sendClaim) {
                const latestGuard = await OTPGuard.findOne({
                    email: cleanEmail,
                    purpose
                });

                return res.status(429).json({
                    message: isOtpLocked(latestGuard, now)
                        ? "Too many incorrect attempts. Please wait five minutes before requesting another OTP."
                        : "Please wait 60 seconds before requesting another OTP."
                });
            }

            const otp =
                generateOTP();

            const otpHash =
                hashOTP(otp);

            const expiresAt =
                new Date(
                    Date.now() +
                    OTP_EXPIRY_MINUTES *
                    60 *
                    1000
                );

            await OTP.deleteMany({ email: cleanEmail, purpose });

            const otpRecord = await OTP.create({
                email: cleanEmail,
                otpHash,
                purpose,
                expiresAt,
                ...(signupData ? { signupData } : {})
            });

            try {
                await sendOTPEmail(cleanEmail, otp, purpose);
            } catch (error) {
                await OTP.deleteOne({ _id: otpRecord._id, otpHash });
                throw error;
            }

            return res.json({
                success: true,
                sentAt: now.getTime(),
                message:
                    "OTP sent successfully."
            });

        } catch (error) {

            console.error(
                "Send OTP error:",
                error
            );

            return res.status(500).json({
                message:
                    "Could not send OTP."
            });
        }
    };

const verifyOtp = async (req, res) => {

        try {

            await connectDB();

            const body =
                isPlainObject(req.body)
                    ? req.body
                    : {};

            const {
                email,
                otp,
                purpose
            } = body;

            if (typeof email !== "string" || typeof otp !== "string" || typeof purpose !== "string") {
                return res.status(400).json({
                    message:
                        "Email, OTP and purpose are required."
                });
            }

            const cleanEmail =
                email.trim().toLowerCase();

            const cleanOTP =
                otp.trim();

            if (!isValidEmail(cleanEmail)) {
                return res.status(400).json({ message: "Enter a valid email address." });
            }

            if (!/^\d{6}$/.test(cleanOTP)) {
                return res.status(400).json({
                    message:
                        "OTP must be 6 digits."
                });
            }

            if (
                !["login", "signup"].includes(
                    purpose
                )
            ) {
                return res.status(400).json({
                    message:
                        "Invalid OTP purpose."
                });
            }

            const guard = await OTPGuard.findOne({
                email: cleanEmail,
                purpose
            });

            if (isOtpLocked(guard)) {
                return res.status(429).json({
                    message: "Too many incorrect attempts. Please wait five minutes before requesting another OTP."
                });
            }

            const otpRecord = await OTP.findOne({ email: cleanEmail, purpose });

            if (!otpRecord) {
                return res.status(400).json({
                    message:
                        "OTP expired or not found. Please request a new OTP."
                });
            }

            if (
                otpRecord.expiresAt <
                new Date()
            ) {
                await OTP.deleteOne({
                    _id: otpRecord._id
                });

                return res.status(400).json({
                    message:
                        "OTP expired. Please request a new OTP."
                });
            }

            if (
                otpRecord.attempts >=
                OTP_MAX_ATTEMPTS
            ) {
                await OTP.deleteOne({
                    _id: otpRecord._id
                });

                return res.status(429).json({
                    message:
                        "Too many incorrect attempts. Please request a new OTP."
                });
            }

            if (purpose === "signup" && !otpRecord.signupData?.passwordHash) {
                await OTP.deleteOne({ _id: otpRecord._id });
                return res.status(400).json({
                    message: "Signup details expired. Please start signup again."
                });
            }

            const submittedHash = Buffer.from(hashOTP(cleanOTP), "hex");
            const storedHash = Buffer.from(otpRecord.otpHash, "hex");

            if (
                submittedHash.length !== storedHash.length ||
                !crypto.timingSafeEqual(submittedHash, storedHash)
            ) {
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
                    const currentRecord = await OTP.findById(otpRecord._id);
                    if (currentRecord?.attempts >= OTP_MAX_ATTEMPTS) {
                        await OTP.deleteOne({ _id: currentRecord._id });
                        return res.status(429).json({
                            message: "Too many incorrect attempts. Please request a new OTP."
                        });
                    }

                    return res.status(400).json({
                        message: "OTP expired or already used. Please request a new OTP."
                    });
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
                    return res.status(429).json({
                        message: "Too many incorrect attempts. Please request a new OTP."
                    });
                }

                return res.status(401).json({ message: "Invalid OTP." });
            }

            // Atomically consume the code so two requests cannot use it twice.
            const consumedOTP = await OTP.findOneAndDelete({
                _id: otpRecord._id,
                otpHash: otpRecord.otpHash,
                expiresAt: { $gt: new Date() },
                attempts: { $lt: OTP_MAX_ATTEMPTS }
            });

            if (!consumedOTP) {
                return res.status(400).json({
                    message: "OTP expired or already used. Please request a new OTP."
                });
            }

            await OTPGuard.updateOne(
                { email: cleanEmail, purpose },
                {
                    $set: {
                        failedAttempts: 0
                    },
                    $unset: { attemptWindowStartedAt: 1 }
                }
            );

            let user;

            if (purpose === "signup") {
                try {
                    user = await User.create({
                        name: consumedOTP.signupData.username,
                        username: consumedOTP.signupData.username,
                        email: cleanEmail,
                        passwordHash: consumedOTP.signupData.passwordHash
                    });
                } catch (error) {
                    if (error.code === 11000) {
                        const field = Object.keys(error.keyPattern || {})[0];
                        return res.status(409).json({
                            message: field === "username"
                                ? "Username already exists. Please restart signup with a different username."
                                : "Email already registered. Please login instead."
                        });
                    }
                    throw error;
                }
            } else {
                user = await User.findOne({ email: cleanEmail }).select("+ageReferenceYear");
                if (!user) {
                    return res.status(404).json({ message: "Account not found." });
                }
            }

            const session = createAuthSession(user);

            return res.json({
                success: true,
                message:
                    "OTP verified successfully.",
                ...session
            });

        } catch (error) {

            console.error(
                "Verify OTP error:",
                error
            );

            return res.status(500).json({
                message:
                    "Could not verify OTP."
            });
        }
    };

const signup = (req, res) => res.status(410).json({
        message: "Email verification is required. Request a signup code to create an account."
    });

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
                }).select("+ageReferenceYear");


            if (!user) {
                return respondToFailedLogin(res, keys);
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
                    message:
                        "This account uses Google login."
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

            const token =
                jwt.sign(

                    {
                        userId:
                            user._id.toString()
                    },

                    process.env.JWT_SECRET,

                    {
                        expiresIn:
                            "7d"
                    }
                );


            res.json({

                success: true,

                token,

                user: {

                    id:
                        user._id,

                    name:
                        user.name,

                    username:
                        user.username,

                    email:
                        user.email,

                    profilePicture:
                        user.profilePicture,

                    age:
                        user.age
                }
            });


        } catch (error) {

            console.error(
                "Login error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not login."
            });
        }
    };

const googleCallback = async (req, res) => {

        try {

            const token =
                jwt.sign(

                    {
                        userId:
                            req.user._id.toString()
                    },

                    process.env.JWT_SECRET,

                    {
                        expiresIn:
                            "7d"
                    }
                );


            const user = {

                id:
                    req.user._id,

                name:
                    req.user.name,

                username:
                    req.user.username,

                email:
                    req.user.email,

                profilePicture:
                    req.user.profilePicture,

                age:
                    req.user.age
            };


            const params =
                new URLSearchParams({

                    token,

                    user:
                        JSON.stringify(user)
                });


            res.redirect(
                `https://mustmake.vercel.app/pages/google-callback.html#${params.toString()}`
            );


        } catch (error) {

            console.error(
                "Google callback error:",
                error
            );


            res.redirect(
                "https://mustmake.vercel.app/pages/login.html"
            );
        }
    };

module.exports = {
    sendOtp,
    verifyOtp,
    signup,
    login,
    loginRateLimitStatus,
    googleCallback
};
