function getToken() {
    return localStorage.getItem("token");
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

const profilePictureInput = document.getElementById("profilePicture");
const photoPreview = document.getElementById("photoPreview");

profilePictureInput.addEventListener("change", () => {
    const file = profilePictureInput.files[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
        alert("Please select a JPG, PNG or WebP image.");
        profilePictureInput.value = "";
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        alert("Profile photo must be smaller than 2 MB.");
        profilePictureInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = event => {
        photoPreview.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

async function loadProfile() {
    try {
        const response = await fetch(`${window.API_URL}/api/profile`, {
            headers: {
                "Authorization": `Bearer ${getToken()}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Could not load profile.");
        }

        const user = data.user;

        if (user.dateOfBirth) {
            document.getElementById("dateOfBirth").value =
                user.dateOfBirth.split("T")[0];
        }

        document.getElementById("height").value = user.height || "";
        document.getElementById("weight").value = user.weight || "";

        if (user.profilePicture) {
            photoPreview.src = user.profilePicture;
        } else {
            photoPreview.src =
                "https://ui-avatars.com/api/?name=" +
                encodeURIComponent(user.name) +
                "&size=200";
        }

        if (user.socials) {
            document.getElementById("instagram").value = user.socials.instagram || "";
            document.getElementById("youtube").value = user.socials.youtube || "";
            document.getElementById("github").value = user.socials.github || "";
            document.getElementById("x").value = user.socials.x || "";
        }
    } catch (error) {
        console.error(error);
        document.getElementById("profileMessage").textContent = error.message;
    }
}

const profileForm = document.getElementById("profileForm");

profileForm.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("profileMessage");
    message.textContent = "Saving...";

    try {
        const payload = {
            dateOfBirth: document.getElementById("dateOfBirth").value,
            height: document.getElementById("height").value,
            weight: document.getElementById("weight").value,
            socials: {
                instagram: document.getElementById("instagram").value.trim(),
                youtube: document.getElementById("youtube").value.trim(),
                github: document.getElementById("github").value.trim(),
                x: document.getElementById("x").value.trim()
            }
        };

        const selectedPhoto = profilePictureInput.files?.[0];
        if (selectedPhoto) {
            payload.profilePicture = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(selectedPhoto);
            });
        }

        const response = await fetch(`${window.API_URL}/api/profile`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error(data.message || "Could not save profile.");
        }

        localStorage.setItem("user", JSON.stringify(data.user));
        message.textContent = "Profile saved successfully.";

        setTimeout(() => {
            window.location.href = "index.html";
        }, 700);
    } catch (error) {
        console.error(error);
        message.textContent = error.message;
    }
});

loadProfile();
