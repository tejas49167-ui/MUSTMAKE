const PROFILE_API_URL = "http://localhost:4000";

function getToken() {
    return localStorage.getItem("token");
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

function calculateAge(dateOfBirth) {
    if (!dateOfBirth) return null;

    const match = String(dateOfBirth).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const [, yearText, monthText, dayText] = match;
    const birthYear = Number(yearText);
    const birthMonth = Number(monthText);
    const birthDay = Number(dayText);
    const birthDate = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));
    if (
        birthDate.getUTCFullYear() !== birthYear ||
        birthDate.getUTCMonth() !== birthMonth - 1 ||
        birthDate.getUTCDate() !== birthDay
    ) return null;

    const todayParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date()).reduce((parts, part) => {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
        return parts;
    }, {});

    let age = todayParts.year - birthYear;
    if (
        todayParts.month < birthMonth ||
        (todayParts.month === birthMonth && todayParts.day < birthDay)
    ) age--;

    return age >= 0 ? age : null;
}

function safeSocialUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function optimizeCloudinaryImage(url) {
    if (!url) return url;
    return url.replace(
        /(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?![^/]*\b(?:f_auto|q_auto)\b)/,
        "$1f_auto,q_auto,w_400,c_limit/"
    );
}

async function loadProfile() {
    try {
        const response = await fetch(`${PROFILE_API_URL}/api/profile`, {
            headers: {
                "Authorization": `Bearer ${getToken()}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Could not load profile.");
        }

        const data = await response.json();
        const user = data.user;

        document.getElementById("profileName").textContent = user.name;
        document.getElementById("profileUsername").textContent = `@${user.username}`;

        const age = calculateAge(user.dateOfBirth);
        document.getElementById("profileAge").textContent =
            age !== null ? `${age} years` : "Not set";

        document.getElementById("profileHeight").textContent =
            user.height ? `${user.height} cm` : "Not set";

        document.getElementById("profileWeight").textContent =
            user.weight ? `${user.weight} kg` : "Not set";

        const photo = document.getElementById("profilePhoto");
        if (user.profilePicture) {
            photo.src = optimizeCloudinaryImage(user.profilePicture);
        } else {
            photo.src =
                "https://ui-avatars.com/api/?name=" +
                encodeURIComponent(user.name) +
                "&size=200";
        }

        displaySocials(user.socials);
    } catch (error) {
        console.error(error);
        document.getElementById("profileName").textContent =
            "Could not load profile.";
    }
}

function displaySocials(socials) {
    const container = document.getElementById("socialLinks");
    container.innerHTML = "";

    if (!socials) {
        container.textContent = "No social links added.";
        return;
    }

    const platforms = [
        { name: "Instagram", key: "instagram" },
        { name: "YouTube", key: "youtube" },
        { name: "GitHub", key: "github" },
        { name: "X", key: "x" }
    ];

    let found = false;

    platforms.forEach(platform => {
        const href = safeSocialUrl(socials[platform.key]);
        if (href) {
            found = true;
            const link = document.createElement("a");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = platform.name;
            container.appendChild(link);
        }
    });

    if (!found) {
        container.textContent = "No social links added.";
    }
}

loadProfile();
