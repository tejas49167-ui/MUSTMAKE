require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const passport = require("passport");

require("./config/passport");

const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");
const usersRoutes = require("./routes/users.routes");
const competitionRoutes = require("./routes/competition.routes");
const workoutsRoutes = require("./routes/workouts.routes");
const exercisesRoutes = require("./routes/exercises.routes");
const errorHandler = require("./middleware/error-handler");
const exercises = require("./config/exercises.json");
const { getFrontendOrigins } = require("./utils/auth-cookie");
const csrfOrigin = require("./middleware/csrf-origin");

const app = express();
const configuredTrustProxy = process.env.TRUST_PROXY;
const trustProxy = configuredTrustProxy === "true"
    ? true
    : configuredTrustProxy === "false"
        ? false
        : /^\d+$/.test(configuredTrustProxy || "")
            ? Number(configuredTrustProxy)
            : 1;
app.set("trust proxy", trustProxy);

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

const frontendOrigins = getFrontendOrigins();
app.use(cors({
    origin(origin, callback) {
        if (!origin || frontendOrigins.has(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true
}));

app.use(csrfOrigin);

app.use(passport.initialize());

app.use(authRoutes);
app.use(usersRoutes);
app.use(profileRoutes);
app.use(competitionRoutes);
app.use(workoutsRoutes);
app.use(exercisesRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "MUSTMAKE backend is running."
    });
});

const frontendRoot = path.resolve(__dirname, "../frontend");
if (fs.existsSync(frontendRoot)) {
    const frontendPages = {
        "/today": "index.html",
        "/exercises": "doit.html",
        "/doit": "doit.html",
        "/history": "history.html",
        "/login": "login.html",
        "/signup": "signup.html",
        "/profile": "profile.html",
        "/settings": "settings.html",
        "/edit-profile": "edit-profile.html",
        "/user-profile": "user-profile.html",
        "/competition": "competition.html",
        "/google-callback": "google-callback.html",
        "/first-details": "firstdetails.html",
        "/about": "about-us.html",
        "/about.html": "about-us.html"
    };

    for (const [route, page] of Object.entries(frontendPages)) {
        app.get(route, (req, res, next) => {
            res.sendFile(path.join(frontendRoot, "pages", page), error => {
                if (error) next(error);
            });
        });
    }

    const exercisePageSlugs = new Set(exercises.map(exercise => exercise.slug));
    app.get("/exercises/:exercise", (req, res, next) => {
        const slug = req.params.exercise;
        if (!exercisePageSlugs.has(slug)) return next();

        res.sendFile(path.join(frontendRoot, "pages", "exercises", `${slug}.html`), error => {
            if (error) next(error);
        });
    });

    app.use(express.static(frontendRoot));
} else {
    // The API is sometimes deployed from the backend directory alone. In that
    // setup, send browser requests for the About page to the frontend site.
    app.get(["/about", "/about.html"], (req, res) => {
        res.redirect("https://www.mustmake.site/about");
    });
    app.get(["/doit", "/exercises"], (req, res) => {
        res.redirect("https://www.mustmake.site/doit");
    });
}

app.use(errorHandler);

module.exports = app;
