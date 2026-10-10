const User = require("../models/User");
const Workout = require("../models/Workout");
const Competition = require("../models/Competition");
const OTP = require("../models/OTP");
const connectDB = require("../config/database");
const cloudinary = require("../config/cloudinary");
const {
    isPlainObject,
    isValidDateOnly,
    isAtLeastAge
} = require("../utils/validation");
const { getDateString } = require("../utils/date");

const getProfile = async (req, res) => {
        try {
            await connectDB();

            const user =
                await User.findById(
                    req.userId
                ).select("-passwordHash");

            if (!user) {
                return res.status(404).json({
                    message: "User not found."
                });
            }

            res.json({
                success: true,
                user
            });

        } catch (error) {

            console.error(
                "Get profile error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not load profile."
            });
        }
    };

const updateProfile = async (req, res) => {
        try {
            await connectDB();

            if (!isPlainObject(req.body)) {
                return res.status(400).json({ message: "Profile data must be an object." });
            }

            const {
                name,
                dateOfBirth,
                height,
                weight,
                profilePicture,
                socials
            } = req.body;

            let normalizedName;
            if (name !== undefined) {
                if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
                    return res.status(400).json({ message: "Name must contain 1 to 100 characters." });
                }
                normalizedName = name.trim();
            }

            let normalizedDateOfBirth;
            if (dateOfBirth !== undefined) {
                if (dateOfBirth === null || dateOfBirth === "") {
                    normalizedDateOfBirth = null;
                } else if (
                    !isValidDateOnly(dateOfBirth) ||
                    dateOfBirth > getDateString()
                ) {
                    return res.status(400).json({ message: "Enter a valid date of birth that is not in the future." });
                } else if (!isAtLeastAge(dateOfBirth, 5)) {
                    return res.status(400).json({ message: "You must be at least 5 years old to create an account." });
                } else {
                    normalizedDateOfBirth = new Date(`${dateOfBirth}T00:00:00.000Z`);
                }
            }

            function profileMetric(value, min, max) {
                if (value === "" || value === null) return { valid: true, value: null };
                if (typeof value !== "number" && typeof value !== "string") {
                    return { valid: false, value: null };
                }
                const number = Number(value);
                return {
                    valid: Number.isFinite(number) && number >= min && number <= max,
                    value: number
                };
            }

            const normalizedHeight = height === undefined ? null : profileMetric(height, 50, 300);
            const normalizedWeight = weight === undefined ? null : profileMetric(weight, 20, 500);
            if (normalizedHeight && !normalizedHeight.valid) {
                return res.status(400).json({ message: "Height must be between 50 and 300 cm." });
            }
            if (normalizedWeight && !normalizedWeight.valid) {
                return res.status(400).json({ message: "Weight must be between 20 and 500 kg." });
            }

            let normalizedSocials;
            if (socials !== undefined) {
                if (!isPlainObject(socials)) {
                    return res.status(400).json({ message: "Social links must be an object." });
                }

                normalizedSocials = {};
                for (const key of ["instagram", "youtube", "github", "x"]) {
                    const value = socials[key];
                    if (value === undefined || value === null || value === "") {
                        normalizedSocials[key] = null;
                        continue;
                    }
                    if (typeof value !== "string" || value.trim().length > 500) {
                        return res.status(400).json({ message: "Social links must be valid HTTP or HTTPS URLs." });
                    }
                    try {
                        const url = new URL(value.trim());
                        if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
                            throw new Error("Unsupported URL protocol.");
                        }
                        normalizedSocials[key] = url.href;
                    } catch {
                        return res.status(400).json({ message: "Social links must be valid HTTP or HTTPS URLs." });
                    }
                }
            }

            const user =
                await User.findById(
                    req.userId
                );

            if (!user) {
                return res.status(404).json({
                    message:
                        "User not found."
                });
            }

            let profilePictureUrl;
            if (profilePicture !== undefined) {
                if (!profilePicture) {
                    profilePictureUrl = null;
                } else if (typeof profilePicture === "string" && profilePicture.startsWith("data:image/")) {
                    const match = profilePicture.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
                    if (!match) {
                        return res.status(400).json({ message: "Profile photo must be a JPG, PNG or WebP image." });
                    }

                    const imageBytes = Buffer.from(match[2], "base64");
                    if (imageBytes.length > 2 * 1024 * 1024) {
                        return res.status(413).json({ message: "Profile photo must be smaller than 2 MB." });
                    }

                    const upload = await cloudinary.uploader.upload(profilePicture, {
                        folder: "just-do-it/profile-pictures",
                        public_id: `user_${req.userId}`,
                        overwrite: true,
                        resource_type: "image"
                    });
                    profilePictureUrl = upload.secure_url;
                } else if (typeof profilePicture === "string" && /^https?:\/\//i.test(profilePicture)) {
                    profilePictureUrl = profilePicture;
                } else {
                    return res.status(400).json({ message: "Invalid profile photo." });
                }
            }

            if (normalizedName !== undefined) user.name = normalizedName;

            if (normalizedDateOfBirth !== undefined) user.dateOfBirth = normalizedDateOfBirth;

            if (normalizedHeight) user.height = normalizedHeight.value;

            if (normalizedWeight) user.weight = normalizedWeight.value;

            if (
                profilePicture !== undefined
            ) {
                user.profilePicture =
                    profilePictureUrl;
            }

            if (socials !== undefined) {

                user.socials = normalizedSocials;
            }

            await user.save();

            const updatedUser =
                await User.findById(
                    req.userId
                ).select("-passwordHash");

            res.json({
                success: true,
                user: updatedUser
            });

        } catch (error) {

            console.error(
                "Update profile error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not update profile."
            });
        }
    };

const deleteAccount = async (req, res) => {
    try {
        await connectDB();

        const user = await User.findById(req.userId).select("email profilePicture");
        if (!user) {
            return res.status(404).json({ message: "Account not found." });
        }

        await Promise.all([
            Workout.deleteMany({ user: req.userId }),
            Competition.deleteMany({
                $or: [
                    { owner: req.userId },
                    { competitor: req.userId }
                ]
            }),
            OTP.deleteMany({ email: user.email })
        ]);

        await User.deleteOne({ _id: req.userId });

        if (user.profilePicture && user.profilePicture.includes("res.cloudinary.com")) {
            try {
                await cloudinary.uploader.destroy(
                    `just-do-it/profile-pictures/user_${req.userId}`,
                    { resource_type: "image" }
                );
            } catch (error) {
                console.error("Could not remove deleted account's profile photo:", error);
            }
        }

        return res.json({ success: true });
    } catch (error) {
        console.error("Delete account error:", error);
        return res.status(500).json({ message: "Could not delete your account." });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    deleteAccount
};
