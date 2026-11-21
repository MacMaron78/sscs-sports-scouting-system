import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { api, profilePhotoUrl } from "./api";

function SidebarIcon({ name }) {
    let icon;
    switch (name) {
        case "home":
            icon = <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>;
            break;
        case "dashboard":
            icon = <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>;
            break;
        case "profile":
            icon = <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;
            break;
        case "agencies":
            icon = <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 21v-5h6v5" /></>;
            break;
        case "inbox":
            icon = <><path d="M4 4h16v16H4z" /><path d="M4 13h4l2 3h4l2-3h4" /></>;
            break;
        case "search":
            icon = <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>;
            break;
        case "shortlist":
            icon = <><path d="M6 4h12v17l-6-4-6 4z" /><path d="m9 10 2 2 4-4" /></>;
            break;
        case "reports":
            icon = <><path d="M4 20V4m0 16h17" /><path d="M8 16v-4m4 4V8m4 8v-6m4 6V5" /></>;
            break;
        default:
            icon = null;
    }

    return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>;
}

export function Layout() {
    const { user, loading, logout, setProfilePhoto } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const pointerRef = useRef(null);
    const seenUnreadIds = useRef(new Set());
    const [unreadCount, setUnreadCount] = useState(0);
    const [supportUnreadCount, setSupportUnreadCount] = useState(0);
    const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
    const [messageAlert, setMessageAlert] = useState(null);
    const [signingOut, setSigningOut] = useState(false);
    const [signOutProgressComplete, setSignOutProgressComplete] = useState(false);
    const [signOutError, setSignOutError] = useState("");
    const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
    const [profilePhotoVersion, setProfilePhotoVersion] = useState(0);
    const [profilePhotoNotice, setProfilePhotoNotice] = useState(null);

    async function uploadProfilePhoto(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setProfilePhotoNotice({ error: true, message: "Choose a JPEG, PNG, or WebP profile photo." });
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            setProfilePhotoNotice({ error: true, message: "Profile photos must be 3 MB or smaller." });
            return;
        }

        setProfilePhotoNotice(null);
        setProfilePhotoUploading(true);
        try {
            await api("/me/profile-photo", {
                method: "POST",
                body: file,
                headers: { "Content-Type": file.type },
            });
            setProfilePhoto(true);
            setProfilePhotoVersion((version) => version + 1);
            setProfilePhotoNotice({ error: false, message: "Profile photo updated." });
        } catch (error) {
            setProfilePhotoNotice({ error: true, message: error.message });
        } finally {
            setProfilePhotoUploading(false);
        }
    }

    async function handleLogout() {
        setSignOutError("");
        setSignOutProgressComplete(false);
        setSigningOut(true);
        const startedAt = Date.now();
        let requestError;
        try {
            await logout();
        } catch (error) {
            requestError = error;
        }
        const remaining = 2000 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
        setSignOutProgressComplete(true);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        setSigningOut(false);
        if (requestError) {
            setSignOutError(requestError.message || "Could not log out. Please try again.");
            return;
        }
        navigate("/");
    }

    useEffect(() => {
        if (!user) {
            seenUnreadIds.current = new Set();
            setUnreadCount(0);
            setSupportUnreadCount(0);
            setMessageAlert(null);
            return undefined;
        }

        let initialized = false;
        let active = true;
        const checkUnreadMessages = async () => {
            try {
                const result = await api("/messages/unread");
                if (!active) return;
                const recentMessages = result.recentMessages || [];
                setUnreadCount(result.unreadCount);
                setSupportUnreadCount(result.supportUnreadCount || 0);

                if (!initialized) {
                    seenUnreadIds.current = new Set(recentMessages.map((message) => String(message.id)));
                    initialized = true;
                    return;
                }

                const newestMessage = recentMessages.find((message) => !seenUnreadIds.current.has(String(message.id)));
                for (const message of recentMessages) {
                    seenUnreadIds.current.add(String(message.id));
                }
                if (newestMessage) setMessageAlert(newestMessage);
            } catch (error) {
                console.error("Could not check for new messages:", error);
            }
        };

        void checkUnreadMessages();
        const intervalId = window.setInterval(checkUnreadMessages, 15000);
        const handleVisibility = () => {
            if (document.visibilityState === "visible") void checkUnreadMessages();
        };
        window.addEventListener("focus", checkUnreadMessages);
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            active = false;
            window.clearInterval(intervalId);
            window.removeEventListener("focus", checkUnreadMessages);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [user?.id]);

    useEffect(() => {
        if (user?.role !== "admin") {
            setPendingApprovalCount(0);
            return undefined;
        }

        let active = true;
        const checkPendingApprovals = async () => {
            try {
                const result = await api("/admin/summary");
                if (!result?.summary
                    || !Number.isInteger(result.summary.pending_approval_requests)
                    || !Number.isInteger(result.summary.pending_password_reset_requests)) {
                    throw new Error("The server returned invalid administrator request counts.");
                }
                if (active) {
                    setPendingApprovalCount(
                        result.summary.pending_approval_requests + result.summary.pending_password_reset_requests,
                    );
                }
            } catch (error) {
                console.error("Could not check for pending administrator requests:", error);
            }
        };

        void checkPendingApprovals();
        const intervalId = window.setInterval(checkPendingApprovals, 15000);
        const handleVisibility = () => {
            if (document.visibilityState === "visible") void checkPendingApprovals();
        };
        const handleAdminRequestChange = () => void checkPendingApprovals();
        window.addEventListener("focus", checkPendingApprovals);
        window.addEventListener("sscs:refresh-admin-alerts", handleAdminRequestChange);
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            active = false;
            window.clearInterval(intervalId);
            window.removeEventListener("focus", checkPendingApprovals);
            window.removeEventListener("sscs:refresh-admin-alerts", handleAdminRequestChange);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [user?.id, user?.role]);

    useEffect(() => {
        if (!messageAlert) return undefined;
        const timeoutId = window.setTimeout(() => setMessageAlert(null), 8000);
        return () => window.clearTimeout(timeoutId);
    }, [messageAlert]);

    useEffect(() => {
        const pointer = pointerRef.current;
        if (!pointer || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;

        const interactiveSelector = "button:not(:disabled), a.button, [role='button']";
        const movePointer = (event) => {
            if (event.pointerType !== "mouse") return;
            pointer.style.left = `${event.clientX}px`;
            pointer.style.top = `${event.clientY}px`;
            const interactive = event.target instanceof Element && event.target.closest(interactiveSelector);
            pointer.classList.toggle("is-visible", Boolean(interactive));
            document.documentElement.classList.toggle("has-ball-cursor", Boolean(interactive));
        };
        const hidePointer = () => {
            pointer.classList.remove("is-visible");
            document.documentElement.classList.remove("has-ball-cursor");
        };

        document.addEventListener("pointermove", movePointer);
        document.addEventListener("pointerleave", hidePointer);
        return () => {
            document.removeEventListener("pointermove", movePointer);
            document.removeEventListener("pointerleave", hidePointer);
            document.documentElement.classList.remove("has-ball-cursor");
        };
    }, []);

    return (
        <div className={`app-shell${location.pathname === "/" ? " home-shell" : ""}${location.pathname.startsWith("/login") ? " login-shell" : ""}${location.pathname.startsWith("/admin") ? " admin-shell" : ""}`}>
            <span className="ball-pointer" ref={pointerRef} aria-hidden="true" />
            <aside className="app-sidebar">
                <Link className="brand" to="/">
                    <span className="brand-icon">S</span>
                    <span>SSCS<small>SPORTS SCOUTING</small></span>
                </Link>
                <div className="sidebar-section-label"><span /> WORKSPACE</div>
                <nav className="navigation" aria-label="Main navigation">
                    <NavLink to="/" end><span className="sidebar-nav-icon"><SidebarIcon name="home" /></span>Home</NavLink>
                    {user?.role === "athlete" && <>
                        <NavLink to="/athlete-dashboard"><span className="sidebar-nav-icon"><SidebarIcon name="dashboard" /></span>Dashboard</NavLink>
                        <NavLink to="/profile"><span className="sidebar-nav-icon"><SidebarIcon name="profile" /></span>My profile</NavLink>
                        <NavLink to="/agencies"><span className="sidebar-nav-icon"><SidebarIcon name="agencies" /></span>Agencies</NavLink>
                        <NavLink to="/inbox"><span className="sidebar-nav-icon"><SidebarIcon name="inbox" /></span>Inbox{unreadCount > 0 && <span className="sidebar-unread-badge" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}</NavLink>
                        <NavLink to="/support"><span className="sidebar-nav-icon"><SidebarIcon name="inbox" /></span>Contact Admin{supportUnreadCount > 0 && <span className="sidebar-unread-badge" aria-label={`${supportUnreadCount} unread support messages`}>{supportUnreadCount > 99 ? "99+" : supportUnreadCount}</span>}</NavLink>
                    </>}
                    {user?.role === "scout" && <>
                        <NavLink to="/scout-dashboard"><span className="sidebar-nav-icon"><SidebarIcon name="dashboard" /></span>Dashboard</NavLink>
                        <NavLink to="/athletes"><span className="sidebar-nav-icon"><SidebarIcon name="search" /></span>Find athletes</NavLink>
                        <NavLink to="/shortlist"><span className="sidebar-nav-icon"><SidebarIcon name="shortlist" /></span>Shortlist</NavLink>
                        <NavLink to="/agencies"><span className="sidebar-nav-icon"><SidebarIcon name="agencies" /></span>Agencies</NavLink>
                        <NavLink to="/inbox"><span className="sidebar-nav-icon"><SidebarIcon name="inbox" /></span>Inbox{unreadCount > 0 && <span className="sidebar-unread-badge" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}</NavLink>
                        <NavLink to="/support"><span className="sidebar-nav-icon"><SidebarIcon name="inbox" /></span>Contact Admin{supportUnreadCount > 0 && <span className="sidebar-unread-badge" aria-label={`${supportUnreadCount} unread support messages`}>{supportUnreadCount > 99 ? "99+" : supportUnreadCount}</span>}</NavLink>
                        <NavLink to="/profile"><span className="sidebar-nav-icon"><SidebarIcon name="profile" /></span>Agency profile</NavLink>
                    </>}
                    {user?.role === "admin" && <>
                        <NavLink to="/admin" aria-label="Admin console" title="Admin console">
                            <span className="sidebar-nav-icon"><SidebarIcon name="reports" /></span>
                            <span className="admin-nav-label-long">Admin console</span>
                            <span className="admin-nav-label-short" aria-hidden="true">Admin</span>
                            {pendingApprovalCount > 0 && <span className="sidebar-approval-badge" aria-label={`${pendingApprovalCount} administrator requests need review`}>{pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}</span>}
                        </NavLink>
                        <NavLink to="/admin#support-inbox" aria-label="Support Inbox" title="Support Inbox">
                            <span className="sidebar-nav-icon"><SidebarIcon name="inbox" /></span>
                            <span className="admin-nav-label-long">Support Inbox</span>
                            <span className="admin-nav-label-short" aria-hidden="true">Support</span>
                            {supportUnreadCount > 0 && <span className="sidebar-approval-badge" aria-label={`${supportUnreadCount} unread support conversations`}>{supportUnreadCount > 99 ? "99+" : supportUnreadCount}</span>}
                        </NavLink>
                    </>}
                </nav>
                <div className="sidebar-footer">
                    <span className="sidebar-footer-mark">S</span>
                    <span><strong>SSCS NETWORK</strong><small>SPORTS · SCOUTING · OPPORTUNITY</small></span>
                </div>
            </aside>
            <div className="app-workspace">
                <header className="topbar">
                    <div className="topbar-context"><span className="topbar-context-dot" />{user ? `${user.role === "scout" ? "SCOUT & AGENCY" : user.role.toUpperCase()} WORKSPACE` : "SPORTS SCOUTING NETWORK"}</div>
                    <div className="account-actions">
                        {loading ? <span className="muted small">Loading…</span> : user ? <>
                            <span className="user-chip"><PhotoAvatar userId={user.id} initials={user.username[0].toUpperCase()} hasPhoto={user.has_profile_photo} version={profilePhotoVersion} className="nav-avatar" />{user.username}<span className="role-label">{user.role === "scout" ? "Scout & Agency" : user.role}</span></span>
                            {user.role === "admin" && <label className={`topbar-photo-control${profilePhotoUploading ? " is-uploading" : ""}`} title={user.has_profile_photo ? "Change profile photo" : "Upload profile photo"}>
                                <input
                                    className="sr-only"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={uploadProfilePhoto}
                                    disabled={profilePhotoUploading}
                                />
                                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
                                    <circle cx="12" cy="13" r="3.5" />
                                </svg>
                                {profilePhotoUploading ? "Uploading…" : user.has_profile_photo ? "Change photo" : "Upload photo"}
                            </label>}
                            <button className="button button-outline button-compact" onClick={handleLogout} disabled={signingOut}>{signingOut ? "Signing out…" : "Log out"}</button>
                        </> : <>
                            <Link className="login-link" to="/login">Log in</Link>
                            <Link className="button button-compact" to="/register">Get started</Link>
                        </>}
                    </div>
                </header>
                {signOutError && <p className="sign-out-error" role="alert">{signOutError}</p>}
                {profilePhotoNotice && <p className={`profile-photo-notice${profilePhotoNotice.error ? " is-error" : ""}`} role={profilePhotoNotice.error ? "alert" : "status"}>{profilePhotoNotice.message}</p>}
                {signingOut && <AuthProgressBar label="Signing out" complete={signOutProgressComplete} />}
                <main className="main-content"><Outlet /></main>
                {messageAlert && <button
                    className="message-toast"
                    onClick={() => {
                        setMessageAlert(null);
                        navigate("/inbox");
                    }}
                    aria-label={`New message from ${messageAlert.sender_username}. Open inbox.`}
                >
                    <span className="message-toast-icon" aria-hidden="true">⌁</span>
                    <span className="message-toast-copy">
                        <strong>New message <span>· {messageAlert.sender_username}</span></strong>
                        <span>{messageAlert.body}</span>
                        <small>Open your inbox <span aria-hidden="true">→</span></small>
                    </span>
                    <span className="message-toast-dismiss" aria-hidden="true">×</span>
                </button>}
                <footer className="footer">
                    <span>SSCS · Sports Scouting &amp; Coordination System</span>
                    <span>Connecting talent with opportunity</span>
                </footer>
            </div>
        </div>
    );
}

export function AuthProgressBar({ label, complete = false }) {
    return <div className="auth-progress" role="status" aria-live="polite">
        <span className="auth-progress-track"><span className={`auth-progress-fill${complete ? " is-complete" : ""}`} /></span>
        <span className="auth-progress-label">{label}…</span>
    </div>;
}

export function ProtectedRoute({ roles }) {
    const { user, loading } = useAuth();
    if (loading) return <Loading />;
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
    return <Outlet />;
}

export function Loading({ label = "Loading…" }) {
    return <div className="loading-state"><span className="spinner" />{label}</div>;
}

export function ErrorNotice({ error }) {
    if (!error) return null;
    return <div className="notice notice-error" role="alert">{error}</div>;
}

export function SuccessNotice({ children }) {
    if (!children) return null;
    return <div className="notice notice-success" role="status">{children}</div>;
}

export function PhotoAvatar({ userId, initials, className = "", hasPhoto = false, preview = "", version = 0, alt = "" }) {
    const [imageFailed, setImageFailed] = useState(false);
    const src = preview || (hasPhoto && userId ? profilePhotoUrl(userId, version) : "");

    useEffect(() => {
        setImageFailed(false);
    }, [src]);

    return <span className={`photo-avatar ${className}`}>
        {src && !imageFailed
            ? <img src={src} alt={alt} onError={() => setImageFailed(true)} />
            : initials}
    </span>;
}

export function VerificationBadge({ status }) {
    if (status !== "verified") return null;
    return <span
        className="verification-badge"
        title="An SSCS administrator reviewed this profile; this is not a guarantee of sporting claims."
    >
        <span aria-hidden="true">★</span> Admin reviewed
    </span>;
}

export function VerifiedAccountTick({ status, role }) {
    if (role === "admin" || status !== "verified") return null;
    return <span
        className="verified-account-tick"
        role="img"
        aria-label="Admin-reviewed account"
        title="This profile has been reviewed by an SSCS administrator."
    >
        ✓
    </span>;
}

export function PageIntro({ eyebrow, title, description, action }) {
    return <div className="page-intro">
        <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="intro-copy">{description}</p>}</div>
        {action && <div className="intro-action">{action}</div>}
    </div>;
}

export function AthleteCard({ athlete, shortlisted, onShortlist }) {
    const { user } = useAuth();
    const initials = `${athlete.first_name?.[0] || ""}${athlete.last_name?.[0] || ""}`;
    return <article className="athlete-card">
        <div className="athlete-card-head">
            <PhotoAvatar userId={athlete.user_id} initials={initials} hasPhoto={athlete.has_profile_photo} className="avatar" />
            <span className="badge badge-green">{athlete.sport}</span>
        </div>
        <h3>{athlete.first_name} {athlete.last_name}<VerifiedAccountTick status={athlete.verification_status} /></h3>
        <p className="card-subtitle">{athlete.position} · {athlete.location}{athlete.age !== null && athlete.age !== undefined ? ` · ${athlete.age} yrs` : ""}</p>
        {athlete.bio && <p className="card-bio">{athlete.bio}</p>}
        <div className="card-actions">
            <Link className="button button-outline button-compact" to={`/athletes/${athlete.id}`}>View profile</Link>
            {user?.role === "scout" && <>
                <button className={`button button-compact ${shortlisted ? "button-saved" : ""}`} onClick={() => onShortlist(athlete)}>
                    {shortlisted ? "✓ Saved" : "+ Shortlist"}
                </button>
                <Link className="text-action" to={`/messages/new/${athlete.user_id}`}>Message</Link>
            </>}
        </div>
    </article>;
}

export function EmptyState({ title, children, action }) {
    return <div className="empty-state">
        <span className="empty-icon">✳</span>
        <h3>{title}</h3>
        {children && <p>{children}</p>}
        {action}
    </div>;
}
