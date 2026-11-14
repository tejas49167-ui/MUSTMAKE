const mongoose = require("mongoose");
const Competition = require("../models/Competition");
const User = require("../models/User");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { getDateString } = require("../utils/date");
const { isPlainObject } = require("../utils/validation");
const { logFailure } = require("../utils/safe-log");

const addCompetitor = async (req, res) => {
    try {
        if (!isPlainObject(req.body)) {
            return res.status(400).json({
                message: "Competition data must be an object."
            });
        }

        const { competitorId } = req.body;
        if (!competitorId) {
            return res.status(400).json({ message: "Competitor ID is required." });
        }
        if (typeof competitorId !== "string" || !mongoose.isValidObjectId(competitorId)) {
            return res.status(400).json({ message: "Invalid competitor ID." });
        }

        const competitorObjectId = new mongoose.Types.ObjectId(competitorId);
        if (competitorObjectId.equals(req.userId)) {
            return res.status(400).json({ message: "You cannot add yourself." });
        }

        await connectDB();
        const competitor = await User.findById(competitorId);
        if (!competitor) {
            return res.status(404).json({ message: "User not found." });
        }

        const existing = await Competition.findOne({
            owner: req.userId,
            competitor: competitorId
        });
        if (existing) {
            return res.status(409).json({
                message: "User is already in your competition."
            });
        }

        const competition = await Competition.create({
            owner: req.userId,
            competitor: competitorId
        });

        return res.status(201).json({
            success: true,
            message: "Competitor added successfully.",
            competition
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: "User is already in your competition."
            });
        }

        logFailure("Add competition failed.", error);
        return res.status(500).json({ message: "Could not add competitor." });
    }
};

const removeCompetitor = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ message: "Invalid competitor ID." });
        }

        await connectDB();
        const removed = await Competition.findOneAndDelete({
            owner: req.userId,
            competitor: req.params.userId
        });
        if (!removed) {
            return res.status(404).json({ message: "Competitor not found." });
        }

        return res.json({ success: true });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(400).json({ message: "Invalid competitor ID." });
        }

        logFailure("Remove competition failed.", error);
        return res.status(500).json({ message: "Could not remove competitor." });
    }
};

const getCompetitors = async (req, res) => {
    try {
        await connectDB();
        const competitions = await Competition.find({ owner: req.userId })
            .populate("competitor", "name username profilePicture isPrivate")
            .sort({ createdAt: -1 });
        const ids = competitions
            .filter(item => item.competitor && !item.competitor.isPrivate)
            .map(item => item.competitor._id)
            .filter(Boolean);
        if (ids.length === 0) return res.json([]);

        const today = getDateString();
        const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const records = await Workout.find({
            user: { $in: ids },
            $or: [
                { date: new RegExp(`^${today}`) },
                { createdAt: { $gte: recentCutoff } }
            ]
        })
            .select("user exercise reps sets weight amount duration unit date createdAt")
            .sort({ createdAt: 1 });

        const workoutsByUser = new Map();
        for (const record of records) {
            const dateMatches = String(record.date || "").startsWith(today);
            const createdToday = record.createdAt && getDateString(record.createdAt) === today;
            if (!dateMatches && !createdToday) continue;

            const id = record.user.toString();
            const workouts = workoutsByUser.get(id) || [];
            workouts.push(record);
            workoutsByUser.set(id, workouts);
        }

        const result = competitions
            .filter(item => item.competitor && !item.competitor.isPrivate)
            .map(item => ({
                id: item.competitor._id,
                name: item.competitor.name,
                username: item.competitor.username,
                profilePicture: item.competitor.profilePicture,
                todayWorkouts: workoutsByUser.get(item.competitor._id.toString()) || []
            }));

        return res.json(result);
    } catch (error) {
        logFailure("Load competition failed.", error);
        return res.status(500).json({ message: "Could not load competition." });
    }
};

module.exports = {
    addCompetitor,
    removeCompetitor,
    getCompetitors
};
