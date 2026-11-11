require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
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
const emailPreferencesRoutes = require("./routes/email-preferences.routes");
const notificationJobRoutes = require("./routes/notification-jobs.routes");
const errorHandler = require("./middleware/error-handler");
const { backend_url, frontend_url } = require("./config/urls");
const exercises = require("./config/exercises.json");
const { getFrontendOrigins } = require("./utils/auth-cookie");
const csrfOrigin = require("./middleware/csrf-origin");

const app = express();
const configuredTrustProxy = process.env.TRUST_PROXY?.trim();
// This backend runs behind Vercel in production; trust only its first proxy hop by default.
let trustProxy = process.env.VERCEL === "1" || process.env.NODE_ENV === "production"
    ? 1
    : false;
if (configuredTrustProxy) {
    if (configuredTrustProxy === "true") {
        trustProxy = 1;
    } else if (configuredTrustProxy === "false") {
        trustProxy = false;
    } else if (/^\d+$/.test(configuredTrustProxy)) {
        const proxyHops = Number(configuredTrustProxy);
        if (!Number.isSafeInteger(proxyHops) || proxyHops > 5) {
            throw new Error("TRUST_PROXY must be true, false, or a numeric hop count from 0 to 5.");
        }
        trustProxy = proxyHops;
    } else {
        throw new Error("TRUST_PROXY must be true, false, or a numeric hop count from 0 to 5.");
    }
}
app.set("trust proxy", trustProxy);

const backendOrigin = new URL(backend_url).origin;
const production = process.env.NODE_ENV === "production";
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            scriptSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "'wasm-unsafe-eval'",
                "'sha256-0kYa/blvQdHg5cNcqjMOcf17NueaqYD2GZ3E6BpsMU8='"
            ],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: [
                "'self'",
                backendOrigin,
                "https://cdn.jsdelivr.net",
                "https://storage.googleapis.com"
            ],
            workerSrc: ["'self'", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            upgradeInsecureRequests: production ? [] : null
        }
    },
    frameguard: { action: "deny" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginEmbedderPolicy: false,
    hsts: production
        ? { maxAge: 15552000, includeSubDomains: false, preload: false }
        : false
}));
app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    next();
});

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
app.use(emailPreferencesRoutes);
app.use(notificationJobRoutes);

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
        res.redirect(`${frontend_url}/about`);
    });
    app.get(["/doit", "/exercises"], (req, res) => {
        res.redirect(`${frontend_url}/doit`);
    });
}

app.use(errorHandler);

module.exports = app;
