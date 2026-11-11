const { createAuthSession } = require("../../services/auth.service");
const { savePendingSignup } = require("../../services/pending-signup.service");
const {
    setSessionCookie,
    clearPendingSignupCookie
} = require("../../utils/auth-cookie");
const { getFrontendRedirect } = require("../../config/urls");
const { logFailure } = require("../../utils/safe-log");

const googleCallback = async (req, res) => {
    try {
        if (req.user?.pendingSignup === true) {
            await savePendingSignup({
                email: req.user.email,
                username: req.user.username,
                googleId: req.user.googleId,
                profilePicture: req.user.profilePicture,
                authProvider: "google"
            }, res);
            res.set("Cache-Control", "no-store");
            return res.redirect(getFrontendRedirect(
                "/pages/google-callback.html?pendingSignup=1"
            ));
        }

        if (!req.user?._id) {
            return res.redirect(getFrontendRedirect("/pages/login.html"));
        }

        const session = createAuthSession(req.user);
        clearPendingSignupCookie(res);
        setSessionCookie(res, session.token);
        res.set("Cache-Control", "no-store");
        return res.redirect(getFrontendRedirect("/pages/google-callback.html"));
    } catch (error) {
        logFailure("Google callback failed.", error);
        return res.redirect(getFrontendRedirect("/pages/login.html"));
    }
};

module.exports = { googleCallback };
