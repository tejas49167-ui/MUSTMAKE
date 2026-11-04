const mongoose = require("mongoose");
const { getDateString } = require("../utils/date");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        username: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        passwordHash: {
            type: String,
            default: null
        },

        legalConsentAt: {
            type: Date,
            default: null
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true
        },

        profilePicture: {
            type: String,
            default: null
        },

        age: {
            type: Number,
            min: 0,
            max: 120,
            default: null,
            get(value) {
                if (value === null || value === undefined) return value;

                const referenceYear = this.get("ageReferenceYear");
                if (!Number.isInteger(referenceYear)) return value;

                const currentYear = Number(getDateString().slice(0, 4));
                return value + currentYear - referenceYear;
            }
        },

        ageReferenceYear: {
            type: Number,
            default: null,
            select: false
        },

        height: {
            type: Number,
            default: null
        },

        weight: {
            type: Number,
            default: null
        },

        socials: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({})
        }
    },
    {
        timestamps: true,
        toJSON: { getters: true },
        toObject: { getters: true }
    }
);

module.exports =
    mongoose.model("User", userSchema);
