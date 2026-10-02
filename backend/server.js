const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const passport = require("passport");
const GoogleStrategy =
    require("passport-google-oauth20").Strategy;

require("dotenv").config();
const cloudinary = require("cloudinary").v2;

const User = require("./models/User");
const Workout = require("./models/Workout");
const Competition =
    require("./models/Competition");

const auth = require("./middleware/auth");

const app = express();


// =====================================================
// BASIC CONFIGURATION
// =====================================================

const jsonParser = express.json({ limit: "3mb" });
app.use((req, res, next) => {
    jsonParser(req, res, error => {
        if (!error) return next();

        const tooLarge = error.type === "entity.too.large";
        return res.status(tooLarge ? 413 : 400).json({
            message: tooLarge
                ? "Request body is too large."
                : "Request body must be valid JSON."
        });
    });
});

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(passport.initialize());


// =====================================================
// MONGODB
// =====================================================

let mongoConnection = null;

async function connectDB() {

    if (!process.env.MONGO_URI) {
        throw new Error(
            "MONGO_URI is missing."
        );
    }

    if (
        mongoose.connection.readyState === 1
    ) {
        return;
    }

    if (!mongoConnection) {

        mongoConnection =
            mongoose
                .connect(
                    process.env.MONGO_URI,
                    {
                        serverSelectionTimeoutMS: 10000
                    }
                )
                .catch(error => {

                    mongoConnection = null;

                    throw error;
                });
    }

    await mongoConnection;
}


// =====================================================
// TIME / DATE HELPERS
// =====================================================

const APP_TIME_ZONE =
    process.env.APP_TIME_ZONE ||
    "Asia/Kolkata";


function getDateString(
    date = new Date()
) {

    const parts =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone:
                    APP_TIME_ZONE,

                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).formatToParts(date);


    const values = {};


    parts.forEach(part => {

        if (
            part.type !==
            "literal"
        ) {
            values[part.type] =
                part.value;
        }

    });


    return `${values.year}-${values.month}-${values.day}`;
}


function previousDateString(
    dateString
) {

    const date =
        new Date(
            `${dateString}T00:00:00.000Z`
        );


    date.setUTCDate(
        date.getUTCDate() - 1
    );


    return date
        .toISOString()
        .split("T")[0];
}


function calculateStreak(
    workouts
) {

    if (
        !workouts ||
        workouts.length === 0
    ) {
        return 0;
    }


    const dates = new Set(
        workouts
            .map(workout => String(workout.date || "").slice(0, 10))
            .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    );


    let streak = 0;

    let currentDate =
        getDateString();

    // Keep yesterday's streak alive until the current app-local day ends.
    if (!dates.has(currentDate)) {
        currentDate = previousDateString(currentDate);
    }


    while (true) {

        if (
            !dates.has(
                currentDate
            )
        ) {
            break;
        }


        streak++;


        currentDate =
            previousDateString(
                currentDate
            );
    }


    return streak;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseWorkoutNumber(value, { integer = false, min = 0 } = {}) {
    if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return { valid: false, value: null };
    }

    const number = Number(value);
    const valid = Number.isFinite(number) && number >= min &&
        (integer ? Number.isSafeInteger(number) : true);

    return { valid, value: valid ? number : null };
}


// =====================================================
// GOOGLE AUTHENTICATION
// =====================================================

passport.use(
    new GoogleStrategy(
        {
            clientID:
                process.env.GOOGLE_CLIENT_ID,

            clientSecret:
                process.env.GOOGLE_CLIENT_SECRET,

            callbackURL:
                process.env.GOOGLE_CALLBACK_URL
        },

        async (
            accessToken,
            refreshToken,
            profile,
            done
        ) => {

            try {

                await connectDB();


                const email =
                    profile.emails &&
                    profile.emails[0]
                        ? profile.emails[0].value
                        : null;


                if (!email) {

                    return done(
                        new Error(
                            "Google account has no email."
                        )
                    );
                }


                let user =
                    await User.findOne({
                        googleId:
                            profile.id
                    });


                // -------------------------------------------------
                // If Google ID doesn't exist, try matching email
                // -------------------------------------------------

                if (!user) {

                    user =
                        await User.findOne({
                            email:
                                email.toLowerCase()
                        });
                }


                // -------------------------------------------------
                // Create new account
                // -------------------------------------------------

                if (!user) {

                    const baseUsername =
                        email
                            .split("@")[0]
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, "")
                            .slice(0, 30) || "user";

                    let username = baseUsername;
                    let counter = 1;

                    while (await User.findOne({ username })) {
                        const suffix = String(counter++);
                        username = `${baseUsername.slice(0, 30 - suffix.length)}${suffix}`;
                    }


                    user =
                        await User.create({

                            name:
                                profile.displayName ||
                                username,

                            username,

                            email:
                                email.toLowerCase(),

                            googleId:
                                profile.id,

                            profilePicture:
                                profile.photos &&
                                profile.photos[0]
                                    ? profile.photos[0].value
                                    : null
                        });

                } else {

                    // -------------------------------------------------
                    // Existing account
                    // -------------------------------------------------

                    user.googleId =
                        profile.id;


                    if (
                        !user.profilePicture &&
                        profile.photos &&
                        profile.photos[0]
                    ) {

                        user.profilePicture =
                            profile.photos[0].value;
                    }


                    await user.save();
                }


                return done(
                    null,
                    user
                );


            } catch (error) {

                console.error(
                    "Google authentication error:",
                    error
                );


                return done(
                    error,
                    null
                );
            }
        }
    )
);


// =====================================================
// SIGN UP
// =====================================================

app.post(
    "/api/auth/signup",
    async (req, res) => {

        try {

            await connectDB();


            const body = isPlainObject(req.body) ? req.body : {};
            const { name, username, email, password } = body;


            if (
                !name ||
                !username ||
                !email ||
                !password ||
                typeof name !== "string" ||
                typeof username !== "string" ||
                typeof email !== "string" ||
                typeof password !== "string"
            ) {

                return res.status(400).json({
                    message:
                        "All fields are required."
                });
            }


            if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {

                return res.status(400).json({
                    message:
                        "Password must be at least 6 characters and no more than 72 bytes."
                });
            }


            const cleanName = name.trim();
            const cleanUsername = username.trim().toLowerCase();
            const cleanEmail = email.trim().toLowerCase();

            if (!cleanName || cleanName.length > 100) {
                return res.status(400).json({
                    message: "Name must contain 1 to 100 characters."
                });
            }

            if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
                return res.status(400).json({
                    message: "Username must be 3 to 30 characters and use only letters, numbers or underscores."
                });
            }

            if (
                cleanEmail.length > 254 ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
            ) {
                return res.status(400).json({ message: "Enter a valid email address." });
            }


            const existingUsername =
                await User.findOne({
                    username:
                        cleanUsername
                });


            if (existingUsername) {

                return res.status(409).json({
                    message:
                        "Username already exists."
                });
            }


            const existingEmail =
                await User.findOne({
                    email:
                        cleanEmail
                });


            if (existingEmail) {

                return res.status(409).json({
                    message:
                        "Email already registered."
                });
            }


            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );


            const user =
                await User.create({

                    name:
                        cleanName,

                    username:
                        cleanUsername,

                    email:
                        cleanEmail,

                    passwordHash
                });


            res.status(201).json({

                success: true,

                message:
                    "Account created successfully.",

                user: {

                    id:
                        user._id,

                    name:
                        user.name,

                    username:
                        user.username,

                    email:
                        user.email
                }
            });


        } catch (error) {

            if (error.code === 11000) {
                const duplicateField = Object.keys(error.keyPattern || {})[0];
                const message = duplicateField === "username"
                    ? "Username already exists."
                    : "Email already registered.";
                return res.status(409).json({ message });
            }

            console.error(
                "Signup error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not create account."
            });
        }
    }
);


// =====================================================
// LOGIN
// =====================================================

app.post(
    "/api/auth/login",
    async (req, res) => {

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
                        user.profilePicture
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
    }
);


// =====================================================
// GOOGLE LOGIN
// =====================================================

app.get(
    "/api/auth/google",

    passport.authenticate(
        "google",
        {
            scope: [
                "profile",
                "email"
            ],

            session: false
        }
    )
);


app.get(
    "/api/auth/google/callback",

    passport.authenticate(
        "google",
        {
            failureRedirect:
                "https://perspiration.vercel.app/frontend/pages/login.html",

            session: false
        }
    ),

    async (req, res) => {

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
                    req.user.profilePicture
            };


            const params =
                new URLSearchParams({

                    token,

                    user:
                        JSON.stringify(user)
                });


            res.redirect(
                `https://perspiration.vercel.app/frontend/pages/google-callback.html#${params.toString()}`
            );


        } catch (error) {

            console.error(
                "Google callback error:",
                error
            );


            res.redirect(
                "https://perspiration.vercel.app/frontend/pages/login.html"
            );
        }
    }
);


// =====================================================
// GET CURRENT USER
// =====================================================

app.get(
    "/api/auth/me",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const user =
                await User.findById(
                    req.userId
                ).select(
                    "-passwordHash"
                );


            if (!user) {

                return res.status(404).json({
                    message:
                        "User not found."
                });
            }


            res.json({

                success: true,

                user
            });


        } catch (error) {

            console.error(
                "Auth error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not get user."
            });
        }
    }
);
// ==========================================
// USER PROFILE
// ==========================================

// GET MY PROFILE
app.get(
    "/api/profile",
    auth,
    async (req, res) => {
        try {
            await connectDB();

            const user =
                await User.findById(
                    req.userId
                ).select("-passwordHash");

            if (!user) {
                return res.status(404).json({
                    message: "User not found."
                });
            }

            res.json({
                success: true,
                user
            });

        } catch (error) {

            console.error(
                "Get profile error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not load profile."
            });
        }
    }
);


// UPDATE MY PROFILE
app.put(
    "/api/profile",
    auth,
    async (req, res) => {
        try {
            await connectDB();

            if (!isPlainObject(req.body)) {
                return res.status(400).json({ message: "Profile data must be an object." });
            }

            const {
                name,
                dateOfBirth,
                height,
                weight,
                profilePicture,
                socials
            } = req.body;

            let normalizedName;
            if (name !== undefined) {
                if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
                    return res.status(400).json({ message: "Name must contain 1 to 100 characters." });
                }
                normalizedName = name.trim();
            }

            let normalizedDateOfBirth;
            if (dateOfBirth !== undefined) {
                if (dateOfBirth === null || dateOfBirth === "") {
                    normalizedDateOfBirth = null;
                } else if (
                    !isValidDateOnly(dateOfBirth) ||
                    dateOfBirth > getDateString()
                ) {
                    return res.status(400).json({ message: "Enter a valid date of birth that is not in the future." });
                } else {
                    normalizedDateOfBirth = new Date(`${dateOfBirth}T00:00:00.000Z`);
                }
            }

            function profileMetric(value, min, max) {
                if (value === "" || value === null) return { valid: true, value: null };
                if (typeof value !== "number" && typeof value !== "string") {
                    return { valid: false, value: null };
                }
                const number = Number(value);
                return {
                    valid: Number.isFinite(number) && number >= min && number <= max,
                    value: number
                };
            }

            const normalizedHeight = height === undefined ? null : profileMetric(height, 50, 300);
            const normalizedWeight = weight === undefined ? null : profileMetric(weight, 20, 500);
            if (normalizedHeight && !normalizedHeight.valid) {
                return res.status(400).json({ message: "Height must be between 50 and 300 cm." });
            }
            if (normalizedWeight && !normalizedWeight.valid) {
                return res.status(400).json({ message: "Weight must be between 20 and 500 kg." });
            }

            let normalizedSocials;
            if (socials !== undefined) {
                if (!isPlainObject(socials)) {
                    return res.status(400).json({ message: "Social links must be an object." });
                }

                normalizedSocials = {};
                for (const key of ["instagram", "youtube", "github", "x"]) {
                    const value = socials[key];
                    if (value === undefined || value === null || value === "") {
                        normalizedSocials[key] = null;
                        continue;
                    }
                    if (typeof value !== "string" || value.trim().length > 500) {
                        return res.status(400).json({ message: "Social links must be valid HTTP or HTTPS URLs." });
                    }
                    try {
                        const url = new URL(value.trim());
                        if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
                            throw new Error("Unsupported URL protocol.");
                        }
                        normalizedSocials[key] = url.href;
                    } catch {
                        return res.status(400).json({ message: "Social links must be valid HTTP or HTTPS URLs." });
                    }
                }
            }

            const user =
                await User.findById(
                    req.userId
                );

            if (!user) {
                return res.status(404).json({
                    message:
                        "User not found."
                });
            }

            let profilePictureUrl;
            if (profilePicture !== undefined) {
                if (!profilePicture) {
                    profilePictureUrl = null;
                } else if (typeof profilePicture === "string" && profilePicture.startsWith("data:image/")) {
                    const match = profilePicture.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
                    if (!match) {
                        return res.status(400).json({ message: "Profile photo must be a JPG, PNG or WebP image." });
                    }

                    const imageBytes = Buffer.from(match[2], "base64");
                    if (imageBytes.length > 2 * 1024 * 1024) {
                        return res.status(413).json({ message: "Profile photo must be smaller than 2 MB." });
                    }

                    const upload = await cloudinary.uploader.upload(profilePicture, {
                        folder: "just-do-it/profile-pictures",
                        public_id: `user_${req.userId}`,
                        overwrite: true,
                        resource_type: "image"
                    });
                    profilePictureUrl = upload.secure_url;
                } else if (typeof profilePicture === "string" && /^https?:\/\//i.test(profilePicture)) {
                    profilePictureUrl = profilePicture;
                } else {
                    return res.status(400).json({ message: "Invalid profile photo." });
                }
            }

            if (normalizedName !== undefined) user.name = normalizedName;

            if (normalizedDateOfBirth !== undefined) user.dateOfBirth = normalizedDateOfBirth;

            if (normalizedHeight) user.height = normalizedHeight.value;

            if (normalizedWeight) user.weight = normalizedWeight.value;

            if (
                profilePicture !== undefined
            ) {
                user.profilePicture =
                    profilePictureUrl;
            }

            if (socials !== undefined) {

                user.socials = normalizedSocials;
            }

            await user.save();

            const updatedUser =
                await User.findById(
                    req.userId
                ).select("-passwordHash");

            res.json({
                success: true,
                user: updatedUser
            });

        } catch (error) {

            console.error(
                "Update profile error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not update profile."
            });
        }
    }
);


// ==========================================
// SEARCH USERS
// ==========================================

app.get(
    "/api/users/search",
    auth,
    async (req, res) => {

        try {

            await connectDB();

            const query = typeof req.query.q === "string"
                ? req.query.q.trim().slice(0, 100)
                : "";

            if (!query) {

                return res.json([]);

            }

            const users =
                await User.find({

                    $or: [

                        {
                            name: {
                                $regex: escapeRegex(query),
                                $options: "i"
                            }
                        },

                        {
                            username: {
                                $regex: escapeRegex(query),
                                $options: "i"
                            }
                        }

                    ],
                    _id: { $ne: req.userId }
                })
                .select(
                    "name username profilePicture"
                )
                .limit(20);


            res.json(users);

        } catch (error) {

            console.error(
                "User search error:",
                error
            );

            res.status(500).json({

                message:
                    "Could not search users."

            });

        }

    }
);

// ==========================================
// PUBLIC USER PROFILE
// ==========================================

app.get(
    "/api/users/:id",
    auth,
    async (req, res) => {

        try {

            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({ message: "Invalid user ID." });
            }

            await connectDB();

            const user =
                await User.findById(
                    req.params.id
                )
                .select(
                    "name username profilePicture dateOfBirth height weight socials"
                );


            if (!user) {

                return res.status(404).json({
                    message:
                        "User not found."
                });

            }

            const workoutHistory = await Workout.find({ user: user._id })
                .select("exercise reps sets weight amount unit date createdAt")
                .sort({ date: -1, createdAt: -1 })
                .lean();

            res.json({
                success: true,
                user,
                workoutHistory
            });


        } catch (error) {

            console.error(
                "Public profile error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load profile."
            });

        }

    }
);

// =====================================================
// COMPETITION - ADD USER
// =====================================================

app.post(
    "/api/competition/add",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const {
                competitorId
            } = req.body;


            if (!competitorId) {

                return res.status(400).json({
                    message:
                        "Competitor ID is required."
                });
            }

            if (!mongoose.isValidObjectId(competitorId)) {
                return res.status(400).json({ message: "Invalid competitor ID." });
            }


            if (
                competitorId.toString() ===
                req.userId.toString()
            ) {

                return res.status(400).json({
                    message:
                        "You cannot add yourself."
                });
            }


            const competitor =
                await User.findById(
                    competitorId
                );


            if (!competitor) {

                return res.status(404).json({
                    message:
                        "User not found."
                });
            }


            const existing =
                await Competition.findOne({

                    owner:
                        req.userId,

                    competitor:
                        competitorId
                });


            if (existing) {

                return res.status(409).json({
                    message:
                        "User is already in your competition."
                });
            }


            const competition =
                await Competition.create({

                    owner:
                        req.userId,

                    competitor:
                        competitorId
                });


            res.status(201).json({

                success: true,

                message:
                    "Competitor added successfully.",

                competition
            });


        } catch (error) {

            if (error.code === 11000) {
                return res.status(409).json({ message: "User is already in your competition." });
            }

            console.error(
                "Add competition error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not add competitor."
            });
        }
    }
);

// Remove only a competitor relationship owned by the authenticated account.
app.delete("/api/competition/:userId", auth, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ message: "Invalid competitor ID." });
        }
        await connectDB();
        const removed = await Competition.findOneAndDelete({ owner: req.userId, competitor: req.params.userId });
        if (!removed) return res.status(404).json({ message: "Competitor not found." });
        res.json({ success: true });
    } catch (error) {
        if (error.name === "CastError") return res.status(400).json({ message: "Invalid competitor ID." });
        console.error("Remove competition error:", error);
        res.status(500).json({ message: "Could not remove competitor." });
    }
});


// =====================================================
// COMPETITION - GET MY COMPETITORS
// =====================================================

app.get(
    "/api/competition",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const competitions =
                await Competition.find({

                    owner:
                        req.userId

                })
                .populate(
                    "competitor",
                    "name username profilePicture"
                )
                .sort({
                    createdAt:
                        -1
                });
            const ids = competitions.map(item => item.competitor?._id).filter(Boolean);
            const today = getDateString();
            // Include recent records as well as today's date key. Some older
            // records may have a date key from a different timezone setting;
            // their createdAt timestamp still identifies the app-local day.
            const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const records = await Workout.find({
                user: { $in: ids },
                $or: [
                    { date: new RegExp(`^${today}`) },
                    { createdAt: { $gte: recentCutoff } }
                ]
            })
                .select("user exercise reps sets weight amount unit date createdAt")
                .sort({ createdAt: 1 });
            const byUser = new Map();
            for (const record of records) {
                if (!String(record.date || "").startsWith(today) && getDateString(record.createdAt) !== today) {
                    continue;
                }
                const id = record.user.toString();
                if (!byUser.has(id)) byUser.set(id, []);
                byUser.get(id).push(record);
            }
            res.json(competitions.filter(item => item.competitor).map(item => {
                const todayWorkouts = byUser.get(item.competitor._id.toString()) || [];
                return {
                    id: item.competitor._id,
                    name: item.competitor.name,
                    username: item.competitor.username,
                    profilePicture: item.competitor.profilePicture,
                    todayWorkouts
                };
            }));


        } catch (error) {

            console.error(
                "Load competition error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load competition."
            });
        }
    }
);


// =====================================================
// ADD WORKOUT
// =====================================================

app.post(
    "/api/workouts",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            if (!isPlainObject(req.body)) {
                return res.status(400).json({ message: "Workout data must be an object." });
            }

            const { exercise, reps, sets, weight, amount } = req.body;
            const supportedExercises = new Set([
                "Push-ups", "Pull-ups", "Dumbbell", "Squats",
                "Skipping Rope", "Running", "Walking"
            ]);

            if (typeof exercise !== "string" || !supportedExercises.has(exercise)) {
                return res.status(400).json({ message: "Select a supported exercise." });
            }

            let workoutValues = { reps: null, sets: null, weight: null, amount: null, unit: null };
            if (["Push-ups", "Pull-ups", "Squats"].includes(exercise)) {
                const parsedReps = parseWorkoutNumber(reps, { integer: true, min: 1 });
                const parsedSets = parseWorkoutNumber(sets, { integer: true, min: 1 });
                if (!parsedReps.valid || !parsedSets.valid || !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                    return res.status(400).json({ message: "Reps and sets must be positive whole numbers." });
                }
                workoutValues = { ...workoutValues, reps: parsedReps.value, sets: parsedSets.value };
            } else if (exercise === "Dumbbell") {
                const parsedWeight = parseWorkoutNumber(weight, { min: 0 });
                const parsedReps = parseWorkoutNumber(reps, { integer: true, min: 1 });
                const parsedSets = parseWorkoutNumber(sets, { integer: true, min: 1 });
                if (!parsedWeight.valid || !parsedReps.valid || !parsedSets.valid || !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                    return res.status(400).json({ message: "Enter a valid weight, reps and sets." });
                }
                workoutValues = {
                    ...workoutValues,
                    weight: parsedWeight.value,
                    reps: parsedReps.value,
                    sets: parsedSets.value
                };
            } else {
                const parsedAmount = parseWorkoutNumber(amount, {
                    integer: exercise === "Skipping Rope",
                    min: exercise === "Skipping Rope" ? 1 : 0
                });
                if (!parsedAmount.valid) {
                    return res.status(400).json({ message: "Enter a valid workout amount." });
                }
                workoutValues = {
                    ...workoutValues,
                    amount: parsedAmount.value,
                    unit: exercise === "Skipping Rope" ? "jumps" : "km"
                };
            }


            const date =
                getDateString();


            const workout =
                await Workout.create({

                    // IMPORTANT:
                    // The logged-in user's ID comes
                    // from the JWT authentication.
                    user:
                        req.userId,

                    exercise,

                    ...workoutValues,

                    date
                });


            res.status(201).json(
                workout
            );


        } catch (error) {

            console.error(
                "Save workout error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not save workout."
            });
        }
    }
);


// =====================================================
// TODAY'S WORKOUTS
// =====================================================

app.get(
    "/api/workouts/today",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const today =
                getDateString();


            const workouts =
                await Workout.find({

                    user:
                        req.userId,

                    date:
                        today

                }).sort({
                    createdAt:
                        -1
                });


            res.json(
                workouts
            );


        } catch (error) {

            console.error(
                "Load today's workouts error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load workouts."
            });
        }
    }
);


// =====================================================
// STREAK
// =====================================================

app.get(
    "/api/workouts/streaks",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const workouts =
                await Workout.find(

                    {
                        user:
                            req.userId
                    },

                    {
                        date:
                            1
                    }
                );


            const streak =
                calculateStreak(
                    workouts
                );


            res.json({
                streak
            });


        } catch (error) {

            console.error(
                "Load streak error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load streak."
            });
        }
    }
);


// =====================================================
// HISTORY
// =====================================================

app.get(
    "/api/workouts/history",
    auth,
    async (req, res) => {

        try {

            await connectDB();


            const workouts =
                await Workout.find({

                    user:
                        req.userId

                }).sort({

                    date:
                        -1,

                    createdAt:
                        -1
                });


            res.json(
                workouts
            );


        } catch (error) {

            console.error(
                "Load history error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load history."
            });
        }
    }
);


// =====================================================
// DELETE WORKOUT
// =====================================================

app.delete(
    "/api/workouts/:id",
    auth,
    async (req, res) => {

        try {

            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({ message: "Invalid workout ID." });
            }

            await connectDB();


            const workout =
                await Workout.findOneAndDelete({

                    _id:
                        req.params.id,

                    // IMPORTANT:
                    // A user can delete only
                    // their own workout.
                    user:
                        req.userId
                });


            if (!workout) {

                return res.status(404).json({
                    message:
                        "Workout not found."
                });
            }


            res.json({
                success: true
            });


        } catch (error) {

            console.error(
                "Delete workout error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not delete workout."
            });
        }
    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.json({
            success: true,
            message:
                "Just Do It backend is running."
        });
    }
);

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    console.error("Unhandled request error:", req.method, req.path, error.message);
    return res.status(500).json({ message: "Internal server error." });
});


// =====================================================
// SERVER
// =====================================================

const PORT =
    process.env.PORT || 4000;


app.listen(
    PORT,
    () => {

        console.log(
            `Server running at http://localhost:${PORT}`
        );

    }
);
