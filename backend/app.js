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
const errorHandler = require("./middleware/error-handler");

const app = express();

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

app.use(authRoutes);
app.use(usersRoutes);
app.use(profileRoutes);
app.use(competitionRoutes);
app.use(workoutsRoutes);

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
        "/history": "history.html",
        "/login": "login.html",
        "/signup": "signup.html",
        "/profile": "profile.html",
        "/edit-profile": "edit-profile.html",
        "/user-profile": "user-profile.html",
        "/add-workout": "add-workout.html",
        "/competition": "competition.html",
        "/google-callback": "google-callback.html",
        "/first-details": "firstdetails.html"
    };

    for (const [route, page] of Object.entries(frontendPages)) {
        app.get(route, (req, res, next) => {
            res.sendFile(path.join(frontendRoot, "pages", page), error => {
                if (error) next(error);
            });
        });
    }

    app.use(express.static(frontendRoot));
}

app.use(errorHandler);

module.exports = app;
