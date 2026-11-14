require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../config/database");
const { getUserSearchGrams } = require("../utils/user-search");

const BATCH_SIZE = 500;

async function backfillUserSearchGrams() {
    await connectDB();

    const cursor = User.collection.find(
        {},
        { projection: { _id: 1, name: 1, username: 1 } }
    );
    let operations = [];
    let updatedCount = 0;

    for await (const user of cursor) {
        operations.push({
            updateOne: {
                filter: { _id: user._id },
                update: {
                    $set: {
                        searchGrams: getUserSearchGrams(user.name, user.username)
                    }
                }
            }
        });

        if (operations.length >= BATCH_SIZE) {
            await User.collection.bulkWrite(operations, { ordered: false });
            updatedCount += operations.length;
            operations = [];
        }
    }

    if (operations.length) {
        await User.collection.bulkWrite(operations, { ordered: false });
        updatedCount += operations.length;
    }

    await User.collection.createIndex(
        { searchGrams: 1 },
        { name: "user_search_grams" }
    );
    console.log(`Updated search grams for ${updatedCount} users.`);
}

backfillUserSearchGrams()
    .catch(error => {
        console.error("Could not backfill user search grams:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
