const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const passport = require("passport");
const GoogleStrategy =
    require("passport-google-oauth20").Strategy;

require("dotenv").config();

const User = require("./models/User");
const Workout = require("./models/Workout");
const Competition =
    require("./models/Competition");

const auth = require("./middleware/auth");

const app = express();


// =====================================================
// BASIC CONFIGURATION
// =====================================================

app.use(express.json());

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


    const dates =
        new Set(
            workouts.map(
                workout =>
                    workout.date
            )
        );


    let streak = 0;

    let currentDate =
        getDateString();


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

                    let username =
                        email
                            .split("@")[0]
                            .toLowerCase()
                            .replace(
                                /[^a-z0-9_]/g,
                                ""
                            );


                    if (!username) {
                        username = "user";
                    }


                    const baseUsername =
                        username;


                    let counter = 1;


                    while (
                        await User.findOne({
                            username
                        })
                    ) {

                        username =
                            `${baseUsername}${counter}`;

                        counter++;
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


            const {
                name,
                username,
                email,
                password
            } = req.body;


            if (
                !name ||
                !username ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    message:
                        "All fields are required."
                });
            }


            if (
                password.length < 6
            ) {

                return res.status(400).json({
                    message:
                        "Password must be at least 6 characters."
                });
            }


            const cleanUsername =
                username
                    .toLowerCase()
                    .trim();


            const cleanEmail =
                email
                    .toLowerCase()
                    .trim();


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
                        name.trim(),

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


            const {
                login,
                password
            } = req.body;


            if (
                !login ||
                !password
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
                "http://127.0.0.1:5500/frontend/pages/login.html",

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
                `http://127.0.0.1:5500/frontend/pages/google-callback.html?${params.toString()}`
            );


        } catch (error) {

            console.error(
                "Google callback error:",
                error
            );


            res.redirect(
                "http://127.0.0.1:5500/frontend/pages/login.html"
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

            const {
                name,
                dateOfBirth,
                height,
                weight,
                profilePicture,
                socials
            } = req.body;

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

            if (name !== undefined) {
                user.name =
                    name.trim();
            }

            if (dateOfBirth !== undefined) {
                user.dateOfBirth =
                    dateOfBirth || null;
            }

            if (height !== undefined) {
                user.height =
                    height === ""
                        ? null
                        : Number(height);
            }

            if (weight !== undefined) {
                user.weight =
                    weight === ""
                        ? null
                        : Number(weight);
            }

            if (
                profilePicture !== undefined
            ) {
                user.profilePicture =
                    profilePicture || null;
            }

            if (socials !== undefined) {

                user.socials = {
                    instagram:
                        socials.instagram || null,

                    youtube:
                        socials.youtube || null,

                    github:
                        socials.github || null,

                    x:
                        socials.x || null
                };
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

            const query =
                req.query.q?.trim();

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
            // Workout dates are stored as strings. Match the calendar-day
            // prefix so records stored as either YYYY-MM-DD or an ISO date
            // timestamp are included.
            const records = await Workout.find({ user: { $in: ids }, date: new RegExp(`^${today}`) })
                .select("user exercise reps sets weight amount unit date")
                .sort({ createdAt: 1 });
            const byUser = new Map();
            for (const record of records) {
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


            const {
                exercise,
                reps,
                sets,
                weight,
                amount,
                unit
            } = req.body;


            if (!exercise) {

                return res.status(400).json({
                    message:
                        "Exercise is required."
                });
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

                    reps:
                        reps !== undefined &&
                        reps !== ""
                            ? Number(reps)
                            : null,

                    sets:
                        sets !== undefined &&
                        sets !== ""
                            ? Number(sets)
                            : null,

                    weight:
                        weight !== undefined &&
                        weight !== ""
                            ? Number(weight)
                            : null,

                    amount:
                        amount !== undefined &&
                        amount !== ""
                            ? Number(amount)
                            : null,

                    unit:
                        unit || null,

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
