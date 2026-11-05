const express = require("express");
const auth = require("../middleware/auth");
const emailPreferencesController = require("../controllers/email-preferences.controller");

const router = express.Router();

router.get("/api/settings/email-notifications", auth, emailPreferencesController.getPreferences);
router.put("/api/settings/email-notifications", auth, emailPreferencesController.updatePreferences);

module.exports = router;
