const mongoose = require("mongoose");
const Competition = require("../models/Competition");
const User = require("../models/User");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { getDateString } = require("../utils/date");

const addCompetitor = async (req, res) => {

        try {

            await connectDB();


            const {
                competitorId
            } = req.body;


            if (!competitorId) {

                return res.status(400).json({
                    message:
                        "Competitor ID is required."
                });
            }

            if (!mongoose.isValidObjectId(competitorId)) {
                return res.status(400).json({ message: "Invalid competitor ID." });
            }


            if (
                competitorId.toString() ===
                req.userId.toString()
            ) {

                return res.status(400).json({
                    message:
                        "You cannot add yourself."
                });
            }


            const competitor =
                await User.findById(
                    competitorId
                );


            if (!competitor) {

                return res.status(404).json({
                    message:
                        "User not found."
                });
            }


            const existing =
                await Competition.findOne({

                    owner:
                        req.userId,

                    competitor:
                        competitorId
                });


            if (existing) {

                return res.status(409).json({
                    message:
                        "User is already in your competition."
                });
            }


            const competition =
                await Competition.create({

                    owner:
                        req.userId,

                    competitor:
                        competitorId
                });


            res.status(201).json({

                success: true,

                message:
                    "Competitor added successfully.",

                competition
            });


        } catch (error) {

            if (error.code === 11000) {
                return res.status(409).json({ message: "User is already in your competition." });
            }

            console.error(
                "Add competition error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not add competitor."
            });
        }
    };

const removeCompetitor = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.userId)) {
            return res.status(400).json({ message: "Invalid competitor ID." });
        }
        await connectDB();
        const removed = await Competition.findOneAndDelete({ owner: req.userId, competitor: req.params.userId });
        if (!removed) return res.status(404).json({ message: "Competitor not found." });
        res.json({ success: true });
    } catch (error) {
        if (error.name === "CastError") return res.status(400).json({ message: "Invalid competitor ID." });
        console.error("Remove competition error:", error);
        res.status(500).json({ message: "Could not remove competitor." });
    }
};

const getCompetitors = async (req, res) => {

        try {

            await connectDB();


            const competitions =
                await Competition.find({

                    owner:
                        req.userId

                })
                .populate(
                    "competitor",
                    "name username profilePicture"
                )
                .sort({
                    createdAt:
                        -1
                });
            const ids = competitions.map(item => item.competitor?._id).filter(Boolean);
            const today = getDateString();
            // Include recent records as well as today's date key. Some older
            // records may have a date key from a different timezone setting;
            // their createdAt timestamp still identifies the app-local day.
            const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const records = await Workout.find({
                user: { $in: ids },
                $or: [
                    { date: new RegExp(`^${today}`) },
                    { createdAt: { $gte: recentCutoff } }
                ]
            })
                .select("user exercise reps sets weight amount unit date createdAt")
                .sort({ createdAt: 1 });
            const byUser = new Map();
            for (const record of records) {
                if (!String(record.date || "").startsWith(today) && getDateString(record.createdAt) !== today) {
                    continue;
                }
                const id = record.user.toString();
                if (!byUser.has(id)) byUser.set(id, []);
                byUser.get(id).push(record);
            }
            res.json(competitions.filter(item => item.competitor).map(item => {
                const todayWorkouts = byUser.get(item.competitor._id.toString()) || [];
                return {
                    id: item.competitor._id,
                    name: item.competitor.name,
                    username: item.competitor.username,
                    profilePicture: item.competitor.profilePicture,
                    todayWorkouts
                };
            }));


        } catch (error) {

            console.error(
                "Load competition error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load competition."
            });
        }
    };

module.exports = {
    addCompetitor,
    removeCompetitor,
    getCompetitors
};
