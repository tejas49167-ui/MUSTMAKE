const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const connectDB = require("./database");

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

                // If Google ID doesn't exist, try matching email

                if (!user) {

                    user =
                        await User.findOne({
                            email:
                                email.toLowerCase()
                        });
                }

                // Create new account

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
                    // Existing account

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

module.exports = passport;
