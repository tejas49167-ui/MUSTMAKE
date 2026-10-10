const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const OTP = require("../models/OTP");
const connectDB = require("../config/database");
const { isPlainObject, isValidEmail } = require("../utils/validation");
const {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    generateOTP,
    hashOTP,
    createAuthSession
} = require("../services/auth.service");
const { sendOTPEmail } = require("../services/email.service");

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
                    typeof body.name === "string" ||
                    typeof body.username === "string" ||
                    typeof body.password === "string";

                if (hasSignupFields) {
                    const name = typeof body.name === "string" ? body.name.trim() : "";
                    const username = typeof body.username === "string"
                        ? body.username.trim().toLowerCase()
                        : "";
                    const password = typeof body.password === "string" ? body.password : "";

                    if (!name || name.length > 100) {
                        return res.status(400).json({
                            message: "Name must contain 1 to 100 characters."
                        });
                    }

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
                        name,
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

            // Keep the existing code valid during the resend cooldown. A
            // signup form retry can refresh its saved details without sending
            // another email, which also lets a refreshed page resume signup.
            const recentOTP = previousOTP &&
                previousOTP.createdAt > new Date(Date.now() - 60 * 1000);

            if (recentOTP) {
                if (purpose === "signup" && signupData) {
                    if (hasSignupFields) {
                        previousOTP.signupData = signupData;
                        await previousOTP.save();
                    }

                    return res.json({
                        success: true,
                        codeAlreadySent: true,
                        sentAt: previousOTP.createdAt.getTime(),
                        message: "A code was sent recently. Use the current code from your email."
                    });
                }

                return res.status(429).json({
                    message:
                        "Please wait 60 seconds before requesting another OTP."
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

            if (previousOTP) {
                await OTP.deleteOne({ _id: previousOTP._id });
            }

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
                await OTP.deleteOne({ _id: otpRecord._id });
                throw error;
            }

            return res.json({
                success: true,
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
                    { new: true }
                );

                if (updatedRecord?.attempts >= OTP_MAX_ATTEMPTS) {
                    await OTP.deleteOne({ _id: updatedRecord._id });
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

            let user;

            if (purpose === "signup") {
                try {
                    user = await User.create({
                        name: consumedOTP.signupData.name,
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
                user = await User.findOne({ email: cleanEmail });
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
                });


            if (!user) {

                return res.status(401).json({
                    message:
                        "Invalid username/email or password."
                });
            }


            // Google-only accounts don't have a password
            if (!user.passwordHash) {

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

                return res.status(401).json({
                    message:
                        "Invalid username/email or password."
                });
            }


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

                    dateOfBirth:
                        user.dateOfBirth
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

                dateOfBirth:
                    req.user.dateOfBirth
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
    googleCallback
};
