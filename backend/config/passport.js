const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const connectDB = require("./database");
const { backend_url } = require("./urls");
const { getAccountForVerifiedGoogleProfile } = require("../services/google-account.service");
const { logFailure } = require("../utils/safe-log");

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL:
                process.env.GOOGLE_CALLBACK_URL ||
                `${backend_url}/api/auth/google/callback`
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                await connectDB();
                const user = await getAccountForVerifiedGoogleProfile(profile);
                return done(null, user);
            } catch (error) {
                logFailure("Google authentication failed.", error);
                return done(error, null);
            }
        }
    )
);

module.exports = passport;
