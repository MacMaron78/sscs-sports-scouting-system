export function normalizeRegistration(body) {
    const username = String(body.username ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = body.role;

    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
        throw new Error("Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new Error("Enter a valid email address.");
    }
    if (password.length < 10 || password.length > 128) {
        throw new Error("Password must be between 10 and 128 characters.");
    }
    if (!["athlete", "scout"].includes(role)) {
        throw new Error("Choose Athlete or Scout/Agency.");
    }

    if (role === "athlete") {
        const profile = {
            firstName: requiredText(body.firstName, "First name", 150),
            lastName: requiredText(body.lastName, "Last name", 150),
            sport: requiredText(body.sport, "Sport", 100),
            position: requiredText(body.position, "Position/event", 100),
            age: optionalAge(body.age),
            location: requiredText(body.location, "Geographical location", 255),
            competitionLevel: optionalText(body.competitionLevel, "Competition level", 50),
            bio: optionalText(body.bio, "Bio", 5000),
            videoLink: optionalUrl(body.videoLink),
            careerHistory: normalizeCareerHistory(body.careerHistory),
            performanceStats: normalizeStats(body.performanceStats),
        };
        return { username, email, password, role, profile };
    }

    const profile = {
        agencyName: requiredText(body.agencyName, "Agency name", 255),
        country: requiredText(body.country, "Country", 100),
        contactPhone: optionalText(body.contactPhone, "Contact phone", 32),
        contactDetails: optionalText(body.contactDetails, "Contact details", 2000),
    };
    return { username, email, password, role, profile };
}

export function normalizeAthleteUpdate(body) {
    const allowed = {};
    for (const [inputName, columnName, maxLength] of [
        ["firstName", "first_name", 150],
        ["lastName", "last_name", 150],
        ["sport", "sport", 100],
        ["position", "position", 100],
        ["location", "location", 255],
        ["bio", "bio", 5000],
    ]) {
        if (inputName in body) {
            allowed[columnName] = requiredText(body[inputName], inputName, maxLength);
        }
    }
    if ("competitionLevel" in body) {
        allowed.competition_level = optionalText(body.competitionLevel, "Competition level", 50);
    }
    if ("age" in body) allowed.age = optionalAge(body.age);
    if ("videoLink" in body) allowed.video_link = optionalUrl(body.videoLink);
    if ("careerHistory" in body) allowed.career_history = normalizeCareerHistory(body.careerHistory);
    if ("performanceStats" in body) allowed.performance_stats = normalizeStats(body.performanceStats);
    if (!Object.keys(allowed).length) throw new Error("Provide at least one profile field to update.");
    return allowed;
}

export function normalizeAgencyUpdate(body) {
    const allowed = {};
    for (const [inputName, columnName, maxLength] of [
        ["agencyName", "agency_name", 255],
        ["country", "country", 100],
        ["contactPhone", "contact_phone", 32],
        ["contactDetails", "contact_details", 2000],
    ]) {
        if (inputName in body) {
            allowed[columnName] = requiredText(body[inputName], inputName, maxLength, true);
        }
    }
    if (!Object.keys(allowed).length) throw new Error("Provide at least one agency field to update.");
    return allowed;
}

export function normalizeSearch(query) {
    const filters = {};
    for (const key of ["sport", "position", "location", "competitionLevel"]) {
        const value = String(query[key] ?? "").trim();
        if (value) filters[key] = value.slice(0, key === "competitionLevel" ? 50 : 100);
    }
    if (query.age !== undefined && String(query.age).trim() !== "") {
        filters.age = optionalAge(query.age);
        if (filters.age === null) throw new Error("Age must be a whole number between 0 and 125.");
    }
    return filters;
}

function requiredText(value, label, maximum, allowEmpty = false) {
    const result = String(value ?? "").trim();
    if ((!allowEmpty && !result) || result.length > maximum) {
        throw new Error(`${label} is required and must be at most ${maximum} characters.`);
    }
    return result;
}

function optionalText(value, label, maximum) {
    const result = String(value ?? "").trim();
    if (result.length > maximum) throw new Error(`${label} must be at most ${maximum} characters.`);
    return result;
}

function optionalAge(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const age = Number(value);
    if (!Number.isInteger(age) || age < 0 || age > 125) {
        throw new Error("Age must be a whole number between 0 and 125.");
    }
    return age;
}

function optionalUrl(value) {
    const result = String(value ?? "").trim();
    if (!result) return "";
    let url;
    try {
        url = new URL(result);
    } catch {
        throw new Error("Enter a valid external video URL.");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Video links must use http or https.");
    }
    return result;
}

function normalizeCareerHistory(value) {
    if (value === undefined || value === null || value === "") return [];
    if (!Array.isArray(value) || value.length > 30) {
        throw new Error("Career history must be a list of up to 30 entries.");
    }
    return value.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error("Each career entry must be an object.");
        }
        return {
            period: optionalText(entry.period, "Career period", 80),
            team: requiredText(entry.team, "Career team/club", 150),
            competition: optionalText(entry.competition, "Competition", 150),
            notes: optionalText(entry.notes, "Career notes", 500),
        };
    });
}

function normalizeStats(value) {
    if (value === undefined || value === null || value === "") return {};
    const result = typeof value === "string" ? JSON.parse(value) : value;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Performance statistics must be a JSON object of sport-specific values.");
    }
    if (JSON.stringify(result).length > 10_000) {
        throw new Error("Performance statistics are too large.");
    }
    return result;
}
