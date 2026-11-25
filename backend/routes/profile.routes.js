const express = require("express");
const auth = require("../middleware/auth");
const profileController = require("../controllers/profile.controller");

const router = express.Router();

router.get("/api/profile", auth, profileController.getProfile);
router.post("/api/profile/upload-signature", auth, profileController.getUploadSignature);
router.put("/api/profile/first-details", auth, profileController.completeFirstDetails);
router.put("/api/profile", auth, profileController.updateProfile);
router.put("/api/settings/privacy", auth, profileController.updatePrivacy);
router.delete("/api/account", auth, profileController.deleteAccount);

module.exports = router;
