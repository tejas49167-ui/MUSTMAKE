const express = require("express");
const passport = require("passport");
const authController = require("../controllers/auth.controller");
const profileController = require("../controllers/profile.controller");
const auth = require("../middleware/auth");
const {
    limitGoogleOAuthStart,
    beginGoogleOAuth,
    validateGoogleOAuthState
} = require("../middleware/google-oauth-state");
const { getFrontendRedirect } = require("../config/urls");
const {
    GOOGLE_PASSWORD_ACCOUNT_EXISTS
} = require("../services/google-account.service");

const router = express.Router();

router.post("/api/auth/send-otp", authController.sendOtp);
router.post("/api/auth/verify-otp", authController.verifyOtp);
router.put("/api/auth/complete-signup", profileController.completeSignup);
router.post("/api/auth/signup", authController.signup);
router.post("/api/auth/login", authController.login);
router.get("/api/auth/login-rate-limit", authController.loginRateLimitStatus);
router.get("/api/auth/session", auth, authController.currentSession);
router.post("/api/auth/logout", authController.logout);

router.get(
    "/api/auth/google",
    limitGoogleOAuthStart,
    beginGoogleOAuth,
    (req, res, next) => passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false,
        state: req.googleOAuthState
    })(req, res, next)
);

router.get(
    "/api/auth/google/callback",
    validateGoogleOAuthState,
    (req, res, next) => passport.authenticate(
        "google",
        { session: false },
        (error, user) => {
            if (error?.code === GOOGLE_PASSWORD_ACCOUNT_EXISTS) {
                return res.redirect(getFrontendRedirect(
                    "/pages/login.html?googleError=password-account"
                ));
            }
            if (error) return next(error);
            if (!user) {
                return res.redirect(getFrontendRedirect("/pages/login.html"));
            }

            req.user = user;
            return authController.googleCallback(req, res, next);
        }
    )(req, res, next)
);

module.exports = router;
