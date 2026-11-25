const User = require("../models/User");
const Workout = require("../models/Workout");
const { calculateStreak, getDateString, previousDateString } = require("../utils/date");

async function getWorkoutStreak(userId, today = getDateString(), userModelOrDependencies = User) {
    let userModel = User;
    if (userModelOrDependencies) {
        if (userModelOrDependencies.userModel || userModelOrDependencies.UserModel) {
            userModel = userModelOrDependencies.userModel || userModelOrDependencies.UserModel;
        } else if (typeof userModelOrDependencies.findById === "function") {
            userModel = userModelOrDependencies;
        } else if (typeof userModelOrDependencies.distinct === "function") {
            // Fallback if a Workout model mock was passed directly
            const workoutDates = await userModelOrDependencies.distinct("date", {
                user: userId,
                date: {
                    $lte: `${today}\uffff`,
                    $regex: /^\d{4}-\d{2}-\d{2}/
                }
            });
            return calculateStreak(workoutDates, today);
        }
    }

    const userQuery = userModel.findById(userId).select("streak lastWorkoutDate");
    const user = typeof userQuery?.lean === "function" ? await userQuery.lean() : await userQuery;

    if (!user || !user.lastWorkoutDate) {
        return 0;
    }

    const yesterday = previousDateString(today);
    if (user.lastWorkoutDate < yesterday) {
        return 0;
    }

    return user.streak || 0;
}

async function recordWorkoutStreak(userId, workoutDate, dependencies = {}) {
    const userModel = dependencies.userModel || dependencies.UserModel || User;
    const workoutModel = dependencies.workoutModel || dependencies.WorkoutModel || Workout;
    const today = dependencies.today || getDateString();

    if (workoutDate === today) {
        const yesterday = previousDateString(today);
        const userQuery = userModel.findById(userId).select("streak lastWorkoutDate");
        const user = typeof userQuery?.lean === "function" ? await userQuery.lean() : await userQuery;

        if (user) {
            let nextStreak = user.streak || 0;
            if (user.lastWorkoutDate === today) {
                if (nextStreak < 1) nextStreak = 1;
            } else if (user.lastWorkoutDate === yesterday) {
                nextStreak = (user.streak || 0) + 1;
            } else {
                nextStreak = 1;
            }

            await userModel.updateOne(
                { _id: userId },
                { $set: { streak: nextStreak, lastWorkoutDate: today } }
            );

            return { streak: nextStreak, lastWorkoutDate: today };
        }
    }

    return recalculateUserStreak(userId, today, { userModel, workoutModel });
}

async function recalculateUserStreak(userId, today = getDateString(), dependencies = {}) {
    const userModel = dependencies.userModel || dependencies.UserModel || User;
    const workoutModel = dependencies.workoutModel || dependencies.WorkoutModel || Workout;

    const workoutDates = await workoutModel.distinct("date", {
        user: userId,
        date: { $regex: /^\d{4}-\d{2}-\d{2}/ }
    });

    const validDates = (workoutDates || [])
        .map(d => String(d).slice(0, 10))
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

    const lastWorkoutDate = validDates.length > 0 ? validDates[validDates.length - 1] : null;
    const streak = calculateStreak(validDates, today);

    await userModel.updateOne(
        { _id: userId },
        { $set: { streak, lastWorkoutDate } }
    );

    return { streak, lastWorkoutDate };
}

module.exports = {
    getWorkoutStreak,
    recordWorkoutStreak,
    recalculateUserStreak
};
