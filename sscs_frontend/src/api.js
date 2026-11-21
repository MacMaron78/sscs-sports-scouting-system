const API_URL = import.meta.env.VITE_API_URL || "/api";

export async function api(path, options = {}) {
    const isBinaryBody = typeof Blob !== "undefined" && options.body instanceof Blob;
    let response;
    try {
        response = await fetch(`${API_URL}${path}`, {
            ...options,
            credentials: "include",
            headers: {
                ...(options.body && !isBinaryBody ? { "Content-Type": "application/json" } : {}),
                ...options.headers,
            },
            body: options.body ? (isBinaryBody ? options.body : JSON.stringify(options.body)) : undefined,
        });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error(
                "Could not reach the SSCS server. Check your internet connection and try again shortly. If this happened during registration or an upload, check whether it completed before retrying.",
            );
        }
        throw error;
    }

    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
}

export function profilePhotoUrl(userId, version = 0) {
    return `${API_URL}/profile-photos/${encodeURIComponent(userId)}?v=${version}`;
}

export function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}
