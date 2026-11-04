const mongoose = require("mongoose");
const User = require("../models/User");
const Competition = require("../models/Competition");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { escapeRegex } = require("../utils/validation");
const { getWorkoutHistoryPage } = require("../services/workout-history.service");
const { logFailure } = require("../utils/safe-log");

const currentUser = async (req, res) => {

        try {

            await connectDB();


            const user =
                await User.findById(
                    req.userId
                ).select(
                    "-passwordHash +ageReferenceYear"
                );


            if (!user) {

                return res.status(404).json({
                    message:
                        "User not found."
                });
            }


            res.json({

                success: true,

                user
            });


        } catch (error) {

            logFailure("Current user lookup failed.", error);


            res.status(500).json({
                message:
                    "Could not get user."
            });
        }
    };

const searchUsers = async (req, res) => {

        try {

            await connectDB();

            const query = typeof req.query.q === "string"
                ? req.query.q.trim().slice(0, 100)
                : "";

            if (!query) {

                return res.json([]);

            }

            const existingCompetitorIds = await Competition.distinct("competitor", {
                owner: req.userId
            });

            const users =
                await User.find({

                    $or: [

                        {
                            name: {
                                $regex: escapeRegex(query),
                                $options: "i"
                            }
                        },

                        {
                            username: {
                                $regex: escapeRegex(query),
                                $options: "i"
                            }
                        }

                    ],
                    _id: { $nin: [req.userId, ...existingCompetitorIds] }
                })
                .select(
                    "name username profilePicture"
                )
                .limit(20);


            res.json(users);

        } catch (error) {

            logFailure("User search failed.", error);

            res.status(500).json({

                message:
                    "Could not search users."

            });

        }

    };

const getPublicProfile = async (req, res) => {

        try {

            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({ message: "Invalid user ID." });
            }

            await connectDB();

            const user =
                await User.findById(
                    req.params.id
                )
                .select(
                    "name username profilePicture age +ageReferenceYear height weight socials"
                );


            if (!user) {

                return res.status(404).json({
                    message:
                        "User not found."
                });

            }

            const historyPage = await getWorkoutHistoryPage(user._id, req.query);
            if (historyPage.invalidCursor) {
                return res.status(400).json({ message: "Invalid workout history cursor." });
            }

            res.json({
                success: true,
                user,
                workoutHistory: historyPage.workouts,
                workoutHistoryNextCursor: historyPage.nextCursor
            });


        } catch (error) {

            logFailure("Public profile lookup failed.", error);


            res.status(500).json({
                message:
                    "Could not load profile."
            });

        }

    };

module.exports = {
    currentUser,
    searchUsers,
    getPublicProfile
};
