const mongoose = require("mongoose");

let mongoConnection = null;

async function connectDB() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing.");
    }

    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!mongoConnection) {
        mongoConnection = mongoose
            .connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 10000
            })
            .catch(error => {
                mongoConnection = null;
                throw error;
            });
    }

    await mongoConnection;
}

module.exports = connectDB;
