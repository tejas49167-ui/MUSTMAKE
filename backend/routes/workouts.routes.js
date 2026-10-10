const express = require("express");
const auth = require("../middleware/auth");
const workoutController = require("../controllers/workout.controller");

const router = express.Router();

router.post("/api/workouts", auth, workoutController.addWorkout);
router.get("/api/workouts/today", auth, workoutController.getTodayWorkouts);
router.get("/api/workouts/streaks", auth, workoutController.getStreak);
router.get("/api/workouts/history", auth, workoutController.getWorkoutHistory);
router.delete("/api/workouts/:id", auth, workoutController.deleteWorkout);

module.exports = router;
