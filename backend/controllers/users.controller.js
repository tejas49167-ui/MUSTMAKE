const mongoose = require("mongoose");
const User = require("../models/User");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { escapeRegex } = require("../utils/validation");

const currentUser = async (req, res) => {

        try {

            await connectDB();


            const user =
                await User.findById(
                    req.userId
                ).select(
                    "-passwordHash"
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

            console.error(
                "Auth error:",
                error
            );


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
                    _id: { $ne: req.userId }
                })
                .select(
                    "name username profilePicture"
                )
                .limit(20);


            res.json(users);

        } catch (error) {

            console.error(
                "User search error:",
                error
            );

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
                    "name username profilePicture dateOfBirth height weight socials"
                );


            if (!user) {

                return res.status(404).json({
                    message:
                        "User not found."
                });

            }

            const workoutHistory = await Workout.find({ user: user._id })
                .select("exercise reps sets weight amount unit date createdAt")
                .sort({ date: -1, createdAt: -1 })
                .lean();

            res.json({
                success: true,
                user,
                workoutHistory
            });


        } catch (error) {

            console.error(
                "Public profile error:",
                error
            );


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
