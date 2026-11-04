const express = require("express");
const passport = require("passport");
const authController = require("../controllers/auth.controller");
const auth = require("../middleware/auth");
const {
    limitGoogleOAuthStart,
    beginGoogleOAuth,
    validateGoogleOAuthState
} = require("../middleware/google-oauth-state");
const { getFrontendRedirect } = require("../config/urls");

const router = express.Router();

router.post("/api/auth/send-otp", authController.sendOtp);
router.post("/api/auth/verify-otp", authController.verifyOtp);
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
    passport.authenticate("google", {
        failureRedirect: getFrontendRedirect("/pages/login.html"),
        session: false
    }),
    authController.googleCallback
);

module.exports = router;
