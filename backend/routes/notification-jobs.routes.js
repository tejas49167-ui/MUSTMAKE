const crypto = require("crypto");
const express = require("express");
const connectDB = require("../config/database");
const { runDueReminders } = require("../services/email-reminder.service");
const { logFailure } = require("../utils/safe-log");

const router = express.Router();

function hasValidCronAuthorization(authorization, secret) {
    if (typeof authorization !== "string" || !secret) return false;
    const expected = `Bearer ${secret}`;
    const providedBuffer = Buffer.from(authorization);
    const expectedBuffer = Buffer.from(expected);
    return providedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

router.get("/api/cron/exercise-reminders", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return res.status(503).json({ message: "Reminder scheduler is not configured." });
    }
    if (!hasValidCronAuthorization(req.get("authorization"), secret)) {
        return res.status(401).json({ message: "Unauthorized." });
    }

    try {
        await connectDB();
        const results = await runDueReminders();
        return res.json({ success: true, ...results });
    } catch (error) {
        logFailure("Exercise reminder scheduler failed.", error);
        return res.status(500).json({ message: "Could not process exercise reminders." });
    }
});

module.exports = router;
