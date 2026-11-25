function logout() {
    window.MUSTMAKE.clearSession();
    window.location.href = "/login";
}

const profilePictureInput = document.getElementById("profilePicture");
const photoPreview = document.getElementById("photoPreview");
const ageInput = document.getElementById("age");
const nameInput = document.getElementById("name");
const consentInput = document.getElementById("legalConsent");
const socialLinksContainer = document.getElementById("social-links-container");
const addSocialLinkButton = document.getElementById("add-social-link");
const socialLinksCount = document.getElementById("social-links-count");
const continueButton = document.querySelector("#profileForm .save-button");
const maxSocialLinks = 10;
const pendingSignup = sessionStorage.getItem("pendingSignup") === "true";
let profileLoaded = pendingSignup;
let profileSaving = false;
let profileSaved = false;

function updateContinueButton() {
    if (!nameInput || !consentInput || !continueButton) return;
    continueButton.disabled = profileSaving ||
        profileSaved ||
        !profileLoaded ||
        !nameInput.value.trim() ||
        !consentInput.checked;
}

nameInput?.addEventListener("input", updateContinueButton);
consentInput?.addEventListener("change", updateContinueButton);
updateContinueButton();

function updateSocialLinksCount() {
    if (!socialLinksContainer || !socialLinksCount || !addSocialLinkButton) return;
    const count = getSocialLinksCount();
    socialLinksCount.textContent = `${count} of ${maxSocialLinks} links`;
    addSocialLinkButton.disabled = count >= maxSocialLinks;
}

function getSocialLinksCount() {
    return socialLinksContainer?.querySelectorAll(".social-link-item").length || 0;
}

function addSocialLink(url = "") {
    if (!socialLinksContainer) return;
    if (getSocialLinksCount() >= maxSocialLinks) return;

    const item = document.createElement("div");
    item.className = "social-link-item";

    const urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.name = "socialUrl[]";
    urlInput.placeholder = "https://example.com/you";
    urlInput.value = url;
    urlInput.setAttribute("aria-label", "Social link URL");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-social-link";
    removeButton.setAttribute("aria-label", "Remove social link");
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
        item.remove();
        updateSocialLinksCount();
    });

    item.append(urlInput, removeButton);
    socialLinksContainer.appendChild(item);
    updateSocialLinksCount();
    urlInput.focus();
}

addSocialLinkButton?.addEventListener("click", () => addSocialLink());
updateSocialLinksCount();

profilePictureInput?.addEventListener("change", () => {
    const file = profilePictureInput.files[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
        window.showToast("Please select a JPG, PNG or WebP image.", { type: "warning" });
        profilePictureInput.value = "";
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        window.showToast("Profile photo must be smaller than 2 MB.", { type: "warning" });
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
        const response = await fetch(`${window.backend_url}/api/profile`);

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Could not load profile.");
        }

        const user = data.user;

        if (nameInput) {
            nameInput.value = user.name === user.username ? "" : user.name || "";
            updateContinueButton();
        }

        ageInput.value = user.age ?? "";

        document.getElementById("height").value = user.height || "";
        document.getElementById("weight").value = user.weight || "";

        if (photoPreview) {
            if (user.profilePicture) {
                photoPreview.src = user.profilePicture;
            } else {
                photoPreview.src =
                    "https://ui-avatars.com/api/?name=" +
                    encodeURIComponent(user.name) +
                    "&size=200";
            }
        }

        if (socialLinksContainer) {
            const savedSocialLinks = (Array.isArray(user.socials)
                ? user.socials
                : Object.values(user.socials || {}))
                .filter(url => typeof url === "string" && url.trim())
                .slice(0, maxSocialLinks);
            socialLinksContainer.replaceChildren();
            if (savedSocialLinks.length) {
                savedSocialLinks.forEach(url => addSocialLink(url));
            }
        }
        profileLoaded = true;
        updateContinueButton();
    } catch (error) {
        console.error(error);
        window.showToast("Your profile details could not be loaded.", {
            type: "error",
            action: { label: "Try again", onClick: loadProfile }
        });
    }
}

const profileForm = document.getElementById("profileForm");

profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (profileSaving) return;
    profileSaving = true;
    updateContinueButton();
    const saveToast = window.showToast("Saving your profile…", { type: "loading" });

    try {
        const name = nameInput?.value.trim();
        if (nameInput && (!name || name.length > 100)) {
            throw new Error("Please enter a name between 1 and 100 characters.");
        }

        const payload = {
            age: ageInput.value,
            height: document.getElementById("height").value,
            weight: document.getElementById("weight").value,
            legalConsent: Boolean(consentInput?.checked)
        };

        if (nameInput) {
            payload.name = name;
        }

        if (socialLinksContainer) {
            const socialLinks = [];
            for (const item of socialLinksContainer.querySelectorAll(".social-link-item")) {
                const url = item.querySelector('[name="socialUrl[]"]').value.trim();
                if (url) socialLinks.push(url);
            }
            if (socialLinks.length > maxSocialLinks) {
                throw new Error(`You can add up to ${maxSocialLinks} social links.`);
            }
            payload.socials = socialLinks;
        }

        const selectedPhoto = profilePictureInput?.files?.[0];
        if (selectedPhoto) {
            const signatureResponse = await fetch(`${window.backend_url}/api/profile/upload-signature`, {
                method: "POST"
            });
            if (!signatureResponse.ok) {
                throw new Error("Could not authorize photo upload.");
            }
            const { signature, timestamp, apiKey, cloudName, folder } = await signatureResponse.json();

            const formData = new FormData();
            formData.append("file", selectedPhoto);
            formData.append("api_key", apiKey);
            formData.append("timestamp", timestamp);
            formData.append("signature", signature);
            formData.append("folder", folder);

            const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
                method: "POST",
                body: formData
            });
            if (!uploadResponse.ok) {
                throw new Error("Photo upload failed.");
            }
            const uploadResult = await uploadResponse.json();
            payload.profilePicture = uploadResult.secure_url;
        }

        const profileEndpoint = pendingSignup
            ? "/api/auth/complete-signup"
            : nameInput
                ? "/api/profile/first-details"
                : "/api/profile";
        const response = await fetch(`${window.backend_url}${profileEndpoint}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
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

        profileSaved = true;
        if (pendingSignup) {
            sessionStorage.removeItem("pendingSignup");
            window.saveAuthenticatedSession(data.user);
        } else {
            localStorage.setItem("user", JSON.stringify(data.user));
        }

        saveToast?.dismiss();
        window.queueToast("Profile saved.", "success");
        setTimeout(() => {
            if (nameInput && typeof window.redirectAfterFirstDetails === "function") {
                window.redirectAfterFirstDetails();
                return;
            }
            window.location.href = "/today";
        }, 700);
    } catch (error) {
        console.error(error);
        saveToast?.update(error.message || "Could not save profile.", { type: "error" });
    } finally {
        profileSaving = false;
        updateContinueButton();
    }
});

if (!pendingSignup) {
    loadProfile();
}
