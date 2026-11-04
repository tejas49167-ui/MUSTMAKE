const mongoose = require("mongoose");

const googleOAuthStateSchema = new mongoose.Schema({
    stateHash: {
        type: String,
        required: true,
        unique: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 }
    }
});

module.exports = mongoose.model("GoogleOAuthState", googleOAuthStateSchema);
