function logout() {
    window.clearPrivateCaches();
    localStorage.removeItem("user");
    window.location.href = "/login";
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

function getProfileCacheKey() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        const userId = user?._id ?? user?.id;
        return userId == null
            ? null
            : `mustmake_profile_${encodeURIComponent(String(userId))}`;
    } catch (error) {
        console.warn("Could not determine the current user for profile cache.", error);
        return null;
    }
}

function readProfileCache() {
    const key = getProfileCacheKey();
    if (!key) return null;
    try {
        const data = JSON.parse(sessionStorage.getItem(key) || "null");
        return data?.user && typeof data.user === "object" ? data : null;
    } catch (error) {
        console.warn("Could not read the cached profile.", error);
        return null;
    }
}

function writeProfileCache(data) {
    const key = getProfileCacheKey();
    if (!key) return;
    try {
        sessionStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.warn("Could not cache the profile.", error);
    }
}

let profileData = null;

function renderProfile(data) {
    profileData = data;
    const user = data.user;
    document.getElementById("profileNameEdit").textContent = user.name;
    document.getElementById("profileNameEdit").disabled = false;
    document.getElementById("profileUsername").textContent = `@${user.username}`;

    const age = Number.isInteger(user.age) ? user.age : null;
    const hasAge = age !== null;
    document.getElementById("profileAge").textContent = hasAge ? age : "";
    document.getElementById("profileAgeSection").hidden = !hasAge;

    const hasHeight = user.height !== null && user.height !== undefined &&
        String(user.height).trim() !== "";
    document.getElementById("profileHeight").textContent = hasHeight
        ? user.height
        : "";
    document.getElementById("profileHeightSection").hidden = !hasHeight;

    const hasWeight = user.weight !== null && user.weight !== undefined &&
        String(user.weight).trim() !== "";
    document.getElementById("profileWeight").textContent = hasWeight
        ? user.weight
        : "";
    document.getElementById("profileWeightSection").hidden = !hasWeight;

    const hasProfileDetails = hasAge || hasHeight || hasWeight;
    document.getElementById("profileDetails").hidden = !hasProfileDetails;
    document.getElementById("profileIs").hidden = !hasProfileDetails;
    document.querySelectorAll("[data-profile-metric]").forEach(button => {
        button.disabled = false;
    });

    const photo = document.getElementById("profilePhoto");
    photo.src = user.profilePicture
        ? optimizeCloudinaryImage(user.profilePicture)
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&size=200`;
    document.getElementById("profilePhotoButton").disabled = false;

    displaySocials(user.socials);
    const socialLinks = Array.isArray(user.socials)
        ? user.socials
        : Object.values(user.socials || {});
    document.getElementById("addProfileSocial").disabled = socialLinks.filter(Boolean).length >= 10;
}

async function loadProfile() {
    const cachedProfile = readProfileCache();
    if (cachedProfile) renderProfile(cachedProfile);

    try {
        const response = await fetch(`${window.backend_url}/api/profile`);

        const data = await response.json().catch(() => null);

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error(
                data?.message || `Could not load profile (HTTP ${response.status}).`
            );
        }

        writeProfileCache(data);
        renderProfile(data);
    } catch (error) {
        console.error(error);
    }
}

function displaySocials(socials) {
    const container = document.getElementById("socialLinks");
    container.innerHTML = "";

    if (!socials) {
        container.textContent = "";
        return;
    }

    let found = false;

    const links = Array.isArray(socials) ? socials : Object.values(socials);
    links.forEach(value => {
        const href = safeSocialUrl(value);
        if (href) {
            found = true;
            const link = document.createElement("a");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = href;
            link.title = href;
            container.appendChild(link);
        }
    });

    if (!found) {
        container.textContent = "";
    }
}

const metricRules = {
    age: { min: 0, max: 120, step: "1", inputmode: "numeric" },
    height: { min: 50, max: 300, step: "0.1", inputmode: "decimal" },
    weight: { min: 20, max: 500, step: "0.1", inputmode: "decimal" }
};

function makeButton(label, className, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
}

async function updateProfile(payload) {
    const response = await fetch(`${window.backend_url}/api/profile`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.status === 401) {
        logout();
        throw new Error("Your session has expired.");
    }
    if (!response.ok) {
        throw new Error(data.message || "Could not update profile.");
    }

    const updatedData = { ...profileData, ...data, user: data.user };
    if (payload.name !== undefined && profileData?.user?.name !== data.user?.name) {
        window.clearPrivateCaches();
    }
    writeProfileCache(updatedData);
    try {
        const storedUser = JSON.parse(localStorage.getItem("user") || "null");
        const storedUserId = storedUser?._id ?? storedUser?.id;
        const updatedUserId = data.user?._id ?? data.user?.id;
        if (
            storedUser &&
            storedUserId != null &&
            updatedUserId != null &&
            String(storedUserId) === String(updatedUserId)
        ) {
            localStorage.setItem("user", JSON.stringify({ ...storedUser, ...data.user }));
        }
    } catch (error) {
        console.warn("Could not update the cached user.", error);
    }
    renderProfile(updatedData);
    return data.user;
}

const profileValueDialog = document.getElementById("profileValueDialog");
const profileValueDialogTitle = document.getElementById("profileValueDialogTitle");
const profileValueInput = document.getElementById("profileValueInput");
const profileValueHint = document.getElementById("profileValueHint");
const saveProfileValueButton = document.getElementById("saveProfileValue");
let activeProfileValue = null;
let activeProfileValueTrigger = null;
let profileValueSaving = false;

function closeProfileValueDialog() {
    if (profileValueSaving) return;
    profileValueDialog.hidden = true;
    activeProfileValueTrigger?.focus();
    activeProfileValue = null;
    activeProfileValueTrigger = null;
}

async function saveProfileValue() {
    const value = profileValueInput.value.trim();
    profileValueInput.setCustomValidity(value ? "" : "Value cannot be empty.");
    if (!profileValueInput.reportValidity()) return;

    profileValueSaving = true;
    saveProfileValueButton.disabled = true;
    try {
        await updateProfile({ [activeProfileValue]: value });
        profileValueSaving = false;
        closeProfileValueDialog();
    } catch (error) {
        console.error(`Profile ${activeProfileValue} update error:`, error);
        window.showToast(error.message || "Could not update profile.", { type: "error" });
    } finally {
        profileValueSaving = false;
        saveProfileValueButton.disabled = false;
    }
}

function openProfileValueDialog(field, trigger) {
    const rules = metricRules[field];
    activeProfileValue = field;
    activeProfileValueTrigger = trigger;
    profileValueDialogTitle.textContent = `Change ${field}`;
    profileValueInput.type = rules ? "number" : "text";
    profileValueInput.inputMode = rules?.inputmode || "text";
    profileValueInput.removeAttribute("min");
    profileValueInput.removeAttribute("max");
    profileValueInput.removeAttribute("step");
    profileValueInput.removeAttribute("maxlength");
    if (rules) {
        profileValueInput.autocomplete = "off";
        profileValueInput.min = rules.min;
        profileValueInput.max = rules.max;
        profileValueInput.step = rules.step;
    } else {
        profileValueInput.maxLength = 100;
        profileValueInput.autocomplete = "name";
    }
    profileValueInput.setAttribute("aria-label", `New ${field}`);
    profileValueInput.value = profileData.user[field] ?? "";
    profileValueInput.setCustomValidity("");
    profileValueHint.hidden = field !== "age";
    profileValueDialog.hidden = false;
    profileValueInput.focus();
    profileValueInput.select();
}

document.getElementById("profileDetails").addEventListener("click", event => {
    const trigger = event.target.closest("[data-profile-metric]");
    if (trigger && !trigger.disabled) {
        openProfileValueDialog(trigger.dataset.profileMetric, trigger);
    }
});

document.getElementById("profileNameEdit").addEventListener("click", event => {
    openProfileValueDialog("name", event.currentTarget);
});

profileValueInput.addEventListener("input", () => {
    profileValueInput.setCustomValidity(
        profileValueInput.value.trim() ? "" : "Value cannot be empty."
    );
});
profileValueInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        saveProfileValueButton.click();
    } else if (event.key === "Escape") {
        closeProfileValueDialog();
    }
});
saveProfileValueButton.addEventListener("click", saveProfileValue);
profileValueDialog.addEventListener("click", event => {
    if (event.target === profileValueDialog) closeProfileValueDialog();
});

const photoDialog = document.getElementById("profilePhotoDialog");
const photoInput = document.getElementById("profilePhotoInput");
const photoPreview = document.getElementById("profilePhotoPreview");
const savePhotoButton = document.getElementById("saveProfilePhoto");
const photoPreviewHistoryKey = "mustmakeProfilePhotoPreview";
let selectedPhotoData = "";

function closePhotoDialog() {
    photoDialog.hidden = true;
    photoInput.value = "";
    selectedPhotoData = "";
    savePhotoButton.disabled = true;
    document.getElementById("profilePhotoButton").focus();
    if (window.history.state?.[photoPreviewHistoryKey]) {
        window.history.back();
    }
}

document.getElementById("profilePhotoButton").addEventListener("click", () => {
    window.history.pushState({ ...window.history.state, [photoPreviewHistoryKey]: true }, "", location.href);
    photoPreview.src = document.getElementById("profilePhoto").src;
    photoDialog.hidden = false;
    photoPreview.focus();
});

window.addEventListener("popstate", () => {
    if (!photoDialog.hidden) {
        closePhotoDialog();
    }
});

photoDialog.addEventListener("click", event => {
    if (event.target === photoDialog) {
        closePhotoDialog();
    }
});
document.getElementById("chooseProfilePhoto").addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        window.showToast("Choose a JPG, PNG or WebP image.", { type: "warning" });
        selectedPhotoData = "";
        savePhotoButton.disabled = true;
        photoPreview.src = document.getElementById("profilePhoto").src;
        photoInput.value = "";
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        window.showToast("The photo must be smaller than 2 MB.", { type: "warning" });
        selectedPhotoData = "";
        savePhotoButton.disabled = true;
        photoPreview.src = document.getElementById("profilePhoto").src;
        photoInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        if (typeof reader.result !== "string") {
            window.showToast("Could not preview this photo.", { type: "error" });
            selectedPhotoData = "";
            savePhotoButton.disabled = true;
            return;
        }
        selectedPhotoData = reader.result;
        photoPreview.src = selectedPhotoData;
        savePhotoButton.disabled = false;
    };
    reader.onerror = () => {
        window.showToast("Could not preview this photo.", { type: "error" });
        selectedPhotoData = "";
        savePhotoButton.disabled = true;
    };
    reader.readAsDataURL(file);
});

savePhotoButton.addEventListener("click", async () => {
    if (!selectedPhotoData) return;
    savePhotoButton.disabled = true;
    const saveToast = window.showToast("Saving profile photo…", { type: "loading" });
    try {
        await updateProfile({ profilePicture: selectedPhotoData });
        saveToast?.update("Profile photo updated.", { type: "success" });
        closePhotoDialog();
    } catch (error) {
        console.error("Profile photo update error:", error);
        saveToast?.update(error.message || "Could not update profile photo.", { type: "error" });
        savePhotoButton.disabled = false;
    }
});

const socialDialog = document.getElementById("socialDialog");
const socialUrlInput = document.getElementById("socialUrlInput");
const savedSocialLinks = document.getElementById("savedSocialLinks");
const socialDialogHistoryKey = "mustmakeSocialDialog";
let socialDialogBusy = false;

function closeSocialDialog() {
    if (socialDialogBusy) return;
    socialDialog.hidden = true;
    document.getElementById("addProfileSocial").focus();
    if (window.history.state?.[socialDialogHistoryKey]) {
        window.history.back();
    }
}

function getProfileSocials() {
    const socials = profileData.user.socials;
    return (Array.isArray(socials) ? socials : Object.values(socials || {}))
        .filter(value => typeof value === "string" && safeSocialUrl(value));
}

function renderSavedSocialLinks() {
    savedSocialLinks.replaceChildren();
    const links = getProfileSocials();
    if (!links.length) {
        const empty = document.createElement("p");
        empty.className = "saved-social-links-empty";
        empty.textContent = "";
        savedSocialLinks.appendChild(empty);
        return;
    }

    links.forEach((url, index) => {
        const row = document.createElement("div");
        row.className = "saved-social-link";
        const link = document.createElement("a");
        link.href = safeSocialUrl(url);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url;
        link.title = url;

        const removeButton = makeButton(`Remove social link ${index + 1}`, "saved-social-remove", "×");
        removeButton.addEventListener("click", async () => {
            const buttons = savedSocialLinks.querySelectorAll("button");
            buttons.forEach(button => {
                button.disabled = true;
            });
            document.getElementById("saveProfileSocial").disabled = true;
            socialDialogBusy = true;
            const removeToast = window.showToast("Removing social link…", { type: "loading" });
            try {
                await updateProfile({ socials: links.filter((_, linkIndex) => linkIndex !== index) });
                renderSavedSocialLinks();
                removeToast?.update("Social link removed.", { type: "success" });
            } catch (error) {
                console.error("Social link removal error:", error);
                removeToast?.update(error.message || "Could not remove social link.", { type: "error" });
                buttons.forEach(button => {
                    button.disabled = false;
                });
            } finally {
                document.getElementById("saveProfileSocial").disabled = false;
                socialDialogBusy = false;
            }
        });
        row.append(link, removeButton);
        savedSocialLinks.appendChild(row);
    });
}

document.getElementById("addProfileSocial").addEventListener("click", () => {
    socialUrlInput.value = "";
    renderSavedSocialLinks();
    window.history.pushState(
        { ...window.history.state, [socialDialogHistoryKey]: true },
        "",
        location.href
    );
    socialDialog.hidden = false;
    socialUrlInput.focus();
});

socialDialog.addEventListener("click", event => {
    if (event.target === socialDialog) {
        closeSocialDialog();
    }
});

document.getElementById("saveProfileSocial").addEventListener("click", async () => {
    const url = safeSocialUrl(socialUrlInput.value.trim());
    if (!url) {
        window.showToast("Enter a valid URL.", { type: "warning" });
        socialUrlInput.focus();
        return;
    }

    const existing = getProfileSocials();
    if (existing.some(value => safeSocialUrl(value) === url)) {
        window.showToast("That link is already on your profile.", { type: "warning" });
        return;
    }
    if (existing.filter(Boolean).length >= 10) {
        window.showToast("You can add up to 10 social links.", { type: "warning" });
        return;
    }

    const saveButton = document.getElementById("saveProfileSocial");
    saveButton.disabled = true;
    socialDialogBusy = true;
    const addToast = window.showToast("Adding social link…", { type: "loading" });
    try {
        await updateProfile({ socials: [...existing.filter(Boolean), url] });
        addToast?.update("Social link added.", { type: "success" });
        socialDialogBusy = false;
        socialDialog.hidden = true;
        if (window.history.state?.[socialDialogHistoryKey]) {
            window.history.back();
        }
        if (document.getElementById("addProfileSocial").disabled) {
            document.querySelector("#socialLinks a:last-child")?.focus();
        } else {
            document.getElementById("addProfileSocial").focus();
        }
    } catch (error) {
        console.error("Social link update error:", error);
        addToast?.update(error.message || "Could not add social link.", { type: "error" });
    } finally {
        socialDialogBusy = false;
        saveButton.disabled = false;
    }
});

window.addEventListener("popstate", () => {
    if (socialDialog.hidden) return;
    if (socialDialogBusy) {
        window.history.pushState(
            { ...window.history.state, [socialDialogHistoryKey]: true },
            "",
            location.href
        );
        return;
    }
    closeSocialDialog();
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!profileValueDialog.hidden) closeProfileValueDialog();
    if (!photoDialog.hidden) {
        closePhotoDialog();
    }
    if (!socialDialog.hidden) closeSocialDialog();
});

loadProfile();
