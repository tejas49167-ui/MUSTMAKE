require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { calculateStreak, getDateString } = require("../utils/date");

const BATCH_SIZE = 500;

async function backfillUserStreaks(dependencies = {}) {
    if (!dependencies.skipConnect) {
        await connectDB();
    }

    const userCollection = dependencies.userCollection || (dependencies.userModel || User).collection;
    const workoutModel = dependencies.workoutModel || Workout;
    const today = dependencies.today || getDateString();

    const cursor = dependencies.users
        ? dependencies.users
        : userCollection.find({}, { projection: { _id: 1 } });

    let operations = [];
    let updatedCount = 0;

    for await (const user of cursor) {
        const workoutDates = await workoutModel.distinct("date", {
            user: user._id,
            date: { $regex: /^\d{4}-\d{2}-\d{2}/ }
        });

        const validDates = (workoutDates || [])
            .map(d => String(d).slice(0, 10))
            .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort();

        const lastWorkoutDate = validDates.length > 0 ? validDates[validDates.length - 1] : null;
        const streak = calculateStreak(validDates, today);

        operations.push({
            updateOne: {
                filter: { _id: user._id },
                update: {
                    $set: {
                        streak,
                        lastWorkoutDate
                    }
                }
            }
        });

        if (operations.length >= BATCH_SIZE) {
            await userCollection.bulkWrite(operations, { ordered: false });
            updatedCount += operations.length;
            operations = [];
        }
    }

    if (operations.length) {
        await userCollection.bulkWrite(operations, { ordered: false });
        updatedCount += operations.length;
    }

    console.log(`Backfilled streaks and lastWorkoutDate for ${updatedCount} users.`);
    return { updatedCount };
}

if (require.main === module) {
    backfillUserStreaks()
        .catch(error => {
            console.error("Could not backfill user streaks:", error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.disconnect();
        });
}

module.exports = { backfillUserStreaks };
