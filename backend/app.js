require("dotenv").config();

const express = require("express");
const cors = require("cors");
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

app.use(errorHandler);

module.exports = app;
