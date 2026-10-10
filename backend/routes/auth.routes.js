const express = require("express");
const passport = require("passport");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.post("/api/auth/send-otp", authController.sendOtp);
router.post("/api/auth/verify-otp", authController.verifyOtp);
router.post("/api/auth/signup", authController.signup);
router.post("/api/auth/login", authController.login);

router.get(
    "/api/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false
    })
);

router.get(
    "/api/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "https://mustmake.vercel.app/pages/login.html",
        session: false
    }),
    authController.googleCallback
);

module.exports = router;
