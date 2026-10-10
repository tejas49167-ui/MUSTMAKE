const express = require("express");
const auth = require("../middleware/auth");
const usersController = require("../controllers/users.controller");

const router = express.Router();

router.get("/api/auth/me", auth, usersController.currentUser);
router.get("/api/users/search", auth, usersController.searchUsers);
router.get("/api/users/:id", auth, usersController.getPublicProfile);

module.exports = router;
