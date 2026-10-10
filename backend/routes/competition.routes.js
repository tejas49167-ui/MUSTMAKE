const express = require("express");
const auth = require("../middleware/auth");
const competitionController = require("../controllers/competition.controller");

const router = express.Router();

router.post("/api/competition/add", auth, competitionController.addCompetitor);
router.delete("/api/competition/:userId", auth, competitionController.removeCompetitor);
router.get("/api/competition", auth, competitionController.getCompetitors);

module.exports = router;
