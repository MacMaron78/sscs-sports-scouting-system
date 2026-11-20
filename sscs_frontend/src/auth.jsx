import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api("/auth/me")
            .then(({ user: currentUser }) => setUser(currentUser))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const value = useMemo(() => ({
        user,
        loading,
        async login(email, password, expectedRole) {
            const result = await api("/auth/login", {
                method: "POST",
                body: { email, password, expectedRole },
            });
            setUser(result.user);
            return result.user;
        },
        async register(values) {
            const result = await api("/auth/register", { method: "POST", body: values });
            setUser(result.user);
            return result.user;
        },
        async logout() {
            await api("/auth/logout", { method: "POST" });
            setUser(null);
        },
        setProfilePhoto(hasPhoto) {
            setUser((current) => current ? { ...current, has_profile_photo: hasPhoto } : current);
        },
    }), [user, loading]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used inside AuthProvider.");
    return context;
}
