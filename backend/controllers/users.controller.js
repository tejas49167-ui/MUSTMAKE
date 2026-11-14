const mongoose = require("mongoose");
const User = require("../models/User");
const Competition = require("../models/Competition");
const connectDB = require("../config/database");
const { escapeRegex } = require("../utils/validation");
const { getUserSearchGrams } = require("../utils/user-search");
const { getWorkoutHistoryPage } = require("../services/workout-history.service");
const { logFailure } = require("../utils/safe-log");

const searchUsers = async (req, res) => {
    const query = typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 100)
        : "";
    if (!query) return res.json([]);

    try {
        await connectDB();
        const existingCompetitorIds = await Competition.distinct("competitor", {
            owner: req.userId
        });
        // The indexed grams narrow candidates; regex retains substring matching.
        const users = await User.find({
            searchGrams: { $all: getUserSearchGrams(query) },
            $or: [
                { name: { $regex: escapeRegex(query), $options: "i" } },
                { username: { $regex: escapeRegex(query), $options: "i" } }
            ],
            _id: { $nin: [req.userId, ...existingCompetitorIds] },
            isPrivate: { $ne: true }
        })
            .select("name username profilePicture")
            .limit(20);

        return res.json(users);
    } catch (error) {
        logFailure("User search failed.", error);
        return res.status(500).json({ message: "Could not search users." });
    }
};

const getPublicProfile = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }

    try {
        await connectDB();
        const user = await User.findById(req.params.id)
            .select("name username profilePicture age +ageReferenceYear height weight socials isPrivate");
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        if (user.isPrivate && String(user._id) !== String(req.userId)) {
            return res.status(404).json({ message: "User not found." });
        }

        const historyPage = await getWorkoutHistoryPage(user._id, req.query);
        if (historyPage.invalidCursor) {
            return res.status(400).json({ message: "Invalid workout history cursor." });
        }

        return res.json({
            success: true,
            user,
            workoutHistory: historyPage.workouts,
            workoutHistoryNextCursor: historyPage.nextCursor
        });
    } catch (error) {
        logFailure("Public profile lookup failed.", error);
        return res.status(500).json({ message: "Could not load profile." });
    }
};

module.exports = {
    searchUsers,
    getPublicProfile
};
