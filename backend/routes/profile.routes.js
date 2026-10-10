const express = require("express");
const auth = require("../middleware/auth");
const profileController = require("../controllers/profile.controller");

const router = express.Router();

router.get("/api/profile", auth, profileController.getProfile);
router.put("/api/profile", auth, profileController.updateProfile);
router.delete("/api/account", auth, profileController.deleteAccount);

module.exports = router;
