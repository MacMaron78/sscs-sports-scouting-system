import { useEffect, useRef, useState } from "react";
import { Link, matchPath, Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
    Bell,
    Bookmark,
    Building2,
    Camera,
    House,
    LifeBuoy,
    LogIn,
    LogOut,
    Menu,
    MessageSquare,
    Moon,
    Search,
    Shield,
    Sun,
    UserRound,
    UserPlus,
    Users,
    X,
} from "lucide-react";
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
    const mobileMenuButtonRef = useRef(null);
    const mobileDrawerCloseRef = useRef(null);
    const profileMenuButtonRef = useRef(null);
    const profileMenuWrapRef = useRef(null);
    const wasMobileMenuOpen = useRef(false);
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
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [profileMenuOpen, setProfileMenuOpen] = useState(false);
    const [theme, setTheme] = useState(() => {
        try {
            return window.localStorage.getItem("sscs-theme") === "dark" ? "dark" : "light";
        } catch (error) {
            console.error("Could not read the saved SSCS theme preference:", error);
            return "light";
        }
    });

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

    useEffect(() => {
        setMobileMenuOpen(false);
        setProfileMenuOpen(false);
    }, [location.pathname, location.hash]);

    useEffect(() => {
        if (!location.hash) return undefined;
        const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (!target) return undefined;

        const frame = window.requestAnimationFrame(() => {
            target.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                block: "start",
            });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [location.hash, location.pathname]);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            window.localStorage.setItem("sscs-theme", theme);
        } catch (error) {
            console.error("Could not save the SSCS theme preference:", error);
        }
    }, [theme]);

    useEffect(() => {
        if (!mobileMenuOpen) {
            if (wasMobileMenuOpen.current) mobileMenuButtonRef.current?.focus();
            wasMobileMenuOpen.current = false;
            return undefined;
        }

        wasMobileMenuOpen.current = true;
        const drawer = document.querySelector(".mobile-nav-drawer");
        const focusableElements = drawer?.querySelectorAll("a[href], button:not(:disabled)") || [];
        mobileDrawerCloseRef.current?.focus();
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        function handleDrawerKeyDown(event) {
            if (event.key === "Escape") {
                setMobileMenuOpen(false);
                return;
            }
            if (event.key !== "Tab" || focusableElements.length === 0) return;
            const first = focusableElements[0];
            const last = focusableElements[focusableElements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", handleDrawerKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleDrawerKeyDown);
        };
    }, [mobileMenuOpen]);

    useEffect(() => {
        if (!profileMenuOpen) return undefined;
        function closeOnOutsideClick(event) {
            if (!profileMenuWrapRef.current?.contains(event.target)) setProfileMenuOpen(false);
        }
        function closeOnEscape(event) {
            if (event.key === "Escape") {
                setProfileMenuOpen(false);
                profileMenuButtonRef.current?.focus();
            }
        }
        document.addEventListener("pointerdown", closeOnOutsideClick);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsideClick);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [profileMenuOpen]);

    const navigationRole = loading ? "loading" : user?.role ?? "guest";
    const navigationItems = [
        { id: "home", to: "/", label: "Home", icon: "home", end: true },
        { id: "athlete-dashboard", to: "/athlete-dashboard", label: "Dashboard", mobileLabel: "Home", icon: "dashboard", mobileIcon: House, roles: ["athlete"], mobile: true },
        { id: "athlete-profile", to: "/profile", label: "My profile", mobileLabel: "Profile", icon: "profile", mobileIcon: UserRound, roles: ["athlete"], mobile: true },
        { id: "athlete-agencies", to: "/agencies", label: "Agencies", mobileLabel: "Opportunities", icon: "agencies", mobileIcon: Building2, roles: ["athlete"], mobile: true },
        { id: "athlete-inbox", to: "/inbox", label: "Inbox", mobileLabel: "Messages", icon: "inbox", mobileIcon: MessageSquare, roles: ["athlete"], badge: unreadCount, badgeLabel: "unread messages", mobile: true },
        { id: "athlete-support", to: "/support", label: "Contact Admin", accessibleMobileLabel: "Support Inbox", icon: "inbox", mobileIcon: LifeBuoy, roles: ["athlete"], badge: supportUnreadCount, badgeLabel: "unread support messages", end: true },
        { id: "scout-dashboard", to: "/scout-dashboard", label: "Dashboard", mobileLabel: "Home", icon: "dashboard", mobileIcon: House, roles: ["scout"], mobile: true },
        { id: "scout-search", to: "/athletes", label: "Find athletes", mobileLabel: "Discover", icon: "search", mobileIcon: Search, roles: ["scout"], mobile: true },
        { id: "scout-shortlist", to: "/shortlist", label: "Shortlist", mobileLabel: "Shortlist", icon: "shortlist", mobileIcon: Bookmark, roles: ["scout"], mobile: true },
        { id: "scout-agencies", to: "/agencies", label: "Agencies", icon: "agencies", roles: ["scout"] },
        { id: "scout-inbox", to: "/inbox", label: "Inbox", mobileLabel: "Messages", icon: "inbox", mobileIcon: MessageSquare, roles: ["scout"], badge: unreadCount, badgeLabel: "unread messages", mobile: true },
        { id: "scout-support", to: "/support", label: "Contact Admin", accessibleMobileLabel: "Support Inbox", icon: "inbox", mobileIcon: LifeBuoy, roles: ["scout"], badge: supportUnreadCount, badgeLabel: "unread support messages", end: true },
        { id: "scout-profile", to: "/profile", label: "Agency profile", icon: "profile", roles: ["scout"] },
        { id: "admin-home", to: "/", label: "Home", icon: "home", mobileIcon: House, roles: ["admin"], desktop: false, mobile: true, end: true },
        { id: "admin-console", to: "/admin", label: "Admin console", mobileLabel: "Admin", accessibleMobileLabel: "Admin Console", desktopTitle: "Admin console", shortLabel: "Admin", icon: "reports", mobileIcon: Shield, roles: ["admin"], badge: pendingApprovalCount, badgeLabel: "administrator requests need review", badgeType: "approval", mobile: true, end: true },
        { id: "admin-support", to: "/admin#support-inbox", label: "Support Inbox", mobileLabel: "Support", accessibleMobileLabel: "Support Inbox", shortLabel: "Support", icon: "inbox", mobileIcon: LifeBuoy, roles: ["admin"], badge: supportUnreadCount, badgeLabel: "unread support conversations", badgeType: "approval", mobile: true, end: true },
        { id: "admin-users", to: "/admin#approval-queue", label: "Accounts", mobileLabel: "Accounts", icon: "profile", mobileIcon: Users, roles: ["admin"], desktop: false, mobile: true, end: true },
        { id: "guest-home", to: "/", label: "Home", icon: "home", mobileIcon: House, roles: ["guest"], desktop: false, mobile: true, end: true },
        { id: "guest-login", to: "/login", label: "Log in", mobileLabel: "Login", icon: "inbox", mobileIcon: LogIn, roles: ["guest"], desktop: false, mobile: true, end: true },
        { id: "guest-register", to: "/register", label: "Get started", mobileLabel: "Join", icon: "inbox", mobileIcon: UserPlus, roles: ["guest"], desktop: false, mobile: true },
    ];
    const canShowNavigationItem = (item) => !item.roles || item.roles.includes(navigationRole);
    const desktopNavigationItems = navigationItems.filter((item) => item.desktop !== false && canShowNavigationItem(item));
    const mobileOrder = {
        athlete: ["athlete-dashboard", "athlete-agencies", "athlete-inbox", "athlete-profile"],
        scout: ["scout-dashboard", "scout-search", "scout-shortlist", "scout-inbox"],
        admin: ["admin-home", "admin-console", "admin-support", "admin-users"],
        guest: ["guest-home", "guest-login", "guest-register"],
    };
    const roleMobileOrder = mobileOrder[navigationRole] || [];
    const mobileNavigationItems = navigationItems
        .filter((item) => item.mobile && canShowNavigationItem(item))
        .sort((left, right) => roleMobileOrder.indexOf(left.id) - roleMobileOrder.indexOf(right.id));
    const moreNavigationItems = navigationItems.filter((item) => (
        canShowNavigationItem(item)
        && item.desktop !== false
        && !item.mobile
        && item.id !== "home"
    ));
    const dashboardPaths = ["/athlete-dashboard", "/scout-dashboard", "/admin"];
    const showMobileWelcome = Boolean(user && dashboardPaths.includes(location.pathname));
    const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
    const searchPath = user?.role === "admin"
        ? "/admin#approval-queue"
        : user?.role === "scout" ? "/athletes" : "/agencies";
    const notificationPath = user?.role === "admin"
        ? (supportUnreadCount ? "/admin#support-inbox" : pendingApprovalCount ? "/admin#approval-queue" : "/admin")
        : (supportUnreadCount ? "/support" : "/inbox");
    const notificationCount = user?.role === "admin"
        ? supportUnreadCount + pendingApprovalCount
        : unreadCount + supportUnreadCount;
    const roleLabel = user?.role === "scout" ? "Scout / Agency" : user?.role;
    const profilePath = user?.role === "admin" ? "" : "/profile";
    const profileLabel = "Edit profile";

    function isNavigationItemActive(item) {
        const [path, hash] = item.to.split("#");
        const matchesPath = Boolean(matchPath({ path: path || "/", end: Boolean(item.end) }, location.pathname));
        if (!matchesPath) return false;
        if (hash) return location.hash === `#${hash}`;
        if (item.id === "admin-console") {
            return !["#support-inbox", "#approval-queue"].includes(location.hash);
        }
        return true;
    }

    function renderMobileNavItem(item) {
        const Icon = item.mobileIcon;
        const active = isNavigationItemActive(item);
        return <Link
            key={item.id}
            to={item.to}
            aria-current={active ? "page" : undefined}
            aria-label={item.accessibleMobileLabel || item.label}
            title={item.accessibleMobileLabel || item.label}
            className={`mobile-nav-link${active ? " is-active" : ""}`}
        >
            <span className="mobile-nav-icon"><Icon size={20} strokeWidth={2} aria-hidden="true" focusable="false" /></span>
            <span className="mobile-nav-label">{item.mobileLabel || item.label}</span>
            {item.badge > 0 && <span className="mobile-nav-badge" aria-label={`${item.badge} ${item.badgeLabel}`}>{item.badge > 99 ? "99+" : item.badge}</span>}
        </Link>;
    }

    function closeMobileDrawer() {
        setMobileMenuOpen(false);
    }

    return (
        <div className={`app-shell${location.pathname === "/" ? " home-shell" : ""}${location.pathname.startsWith("/login") ? " login-shell" : ""}${location.pathname.startsWith("/admin") ? " admin-shell" : ""}`}>
            <span className="ball-pointer" ref={pointerRef} aria-hidden="true" />
            <aside className="app-sidebar">
                <Link className="brand" to="/">
                    <span className="brand-icon">S</span>
                    <span>SSCS<small>SPORTS SCOUTING</small></span>
                </Link>
                {(user || moreNavigationItems.length > 0) && <div className="mobile-more">
                    <button
                        ref={mobileMenuButtonRef}
                        className="mobile-more-toggle"
                        type="button"
                        aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                        aria-controls="mobile-nav-drawer"
                        aria-expanded={mobileMenuOpen}
                        onClick={() => setMobileMenuOpen((open) => !open)}
                    >
                        {mobileMenuOpen
                            ? <X size={20} aria-hidden="true" focusable="false" />
                            : <Menu size={20} aria-hidden="true" focusable="false" />}
                    </button>
                </div>}
                {mobileMenuOpen && <>
                    <button className="mobile-drawer-backdrop" type="button" aria-label="Dismiss navigation drawer" onClick={closeMobileDrawer} />
                    <aside className="mobile-nav-drawer" id="mobile-nav-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-drawer-title">
                        <div className="mobile-drawer-heading">
                            <div><span>SSCS WORKSPACE</span><strong id="mobile-drawer-title">Navigation</strong></div>
                            <button ref={mobileDrawerCloseRef} className="mobile-drawer-close" type="button" onClick={closeMobileDrawer} aria-label="Close navigation drawer">
                                <X size={20} aria-hidden="true" focusable="false" />
                            </button>
                        </div>
                        {user && <div className="mobile-drawer-account">
                            <PhotoAvatar userId={user.id} initials={user.username?.[0]?.toUpperCase() || "S"} hasPhoto={user.has_profile_photo} version={profilePhotoVersion} className="nav-avatar" />
                            <span><strong>{user.username}</strong><small>{roleLabel} · SSCS ID {user.id}</small></span>
                        </div>}
                        <nav className="mobile-drawer-links" aria-label="More navigation">
                        {moreNavigationItems.map((item) => {
                            const active = isNavigationItemActive(item);
                            return <Link
                                key={item.id}
                                to={item.to}
                                aria-current={active ? "page" : undefined}
                                className={`mobile-more-link${active ? " is-active" : ""}`}
                                onClick={closeMobileDrawer}
                            >
                                <span className="sidebar-nav-icon"><SidebarIcon name={item.icon} /></span>
                                <span>{item.label}</span>
                                {item.badge > 0 && <span
                                    className={item.badgeType === "approval" ? "sidebar-approval-badge" : "sidebar-unread-badge"}
                                    aria-label={`${item.badge} ${item.badgeLabel}`}
                                >{item.badge > 99 ? "99+" : item.badge}</span>}
                            </Link>;
                        })}
                        </nav>
                        {user && <div className="mobile-drawer-account-actions">
                            {profilePath && <Link to={profilePath} onClick={closeMobileDrawer}><UserRound size={18} aria-hidden="true" />{profileLabel}</Link>}
                            <button type="button" onClick={() => { closeMobileDrawer(); void handleLogout(); }} disabled={signingOut}>
                                <LogOut size={18} aria-hidden="true" />{signingOut ? "Signing out…" : "Log out"}
                            </button>
                        </div>}
                    </aside>
                </>}
                <div className="sidebar-section-label"><span /> WORKSPACE</div>
                <nav className="navigation" aria-label="Main navigation">
                    {desktopNavigationItems.map((item) => {
                        const active = isNavigationItemActive(item);
                        return <Link
                            key={item.id}
                            to={item.to}
                            aria-current={active ? "page" : undefined}
                            aria-label={item.desktopTitle || (item.id === "admin-support" ? "Support Inbox" : undefined)}
                            title={item.desktopTitle || (item.id === "admin-support" ? "Support Inbox" : undefined)}
                            className={active ? "active" : undefined}
                        >
                            <span className="sidebar-nav-icon"><SidebarIcon name={item.icon} /></span>
                            {item.shortLabel
                                ? <>
                                    <span className="admin-nav-label-long">{item.label}</span>
                                    <span className="admin-nav-label-short" aria-hidden="true">{item.shortLabel}</span>
                                </>
                                : <span>{item.label}</span>}
                            {item.badge > 0 && <span
                                className={item.badgeType === "approval" ? "sidebar-approval-badge" : "sidebar-unread-badge"}
                                aria-label={`${item.badge} ${item.badgeLabel}`}
                            >{item.badge > 99 ? "99+" : item.badge}</span>}
                        </Link>;
                    })}
                </nav>
                <div className="sidebar-footer">
                    <span className="sidebar-footer-mark">S</span>
                    <span><strong>SSCS NETWORK</strong><small>SPORTS · SCOUTING · OPPORTUNITY</small></span>
                </div>
            </aside>
            <div className="app-workspace">
                <header className={`topbar${!user ? " topbar-guest" : ""}`}>
                    <div className="topbar-context">
                        <span className="topbar-context-dot" />
                        <span className="topbar-context-full">{user ? `${user.role === "scout" ? "SCOUT & AGENCY" : user.role.toUpperCase()} WORKSPACE` : "SPORTS SCOUTING NETWORK"}</span>
                        <span className="topbar-context-compact">{user ? `${user.role === "scout" ? "SCOUT" : user.role.toUpperCase()} WORKSPACE` : "SSCS NETWORK"}</span>
                    </div>
                    <div className="account-actions">
                        {loading ? <span className="muted small">Loading…</span> : user ? <>
                            <span className="user-chip"><PhotoAvatar userId={user.id} initials={user.username[0].toUpperCase()} hasPhoto={user.has_profile_photo} version={profilePhotoVersion} className="nav-avatar" />{user.username}<span className="role-label">{user.role === "scout" ? "Scout & Agency" : user.role}</span></span>
                            {user.role === "admin" && <label
                                className={`topbar-photo-control${profilePhotoUploading ? " is-uploading" : ""}`}
                                title={user.has_profile_photo ? "Change profile photo" : "Upload profile photo"}
                                aria-label={user.has_profile_photo ? "Change profile photo" : "Upload profile photo"}
                            >
                                <input
                                    className="sr-only"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={uploadProfilePhoto}
                                    disabled={profilePhotoUploading}
                                />
                                <Camera size={17} aria-hidden="true" focusable="false" />
                                <span className="topbar-photo-label">{profilePhotoUploading ? "Uploading…" : user.has_profile_photo ? "Change photo" : "Upload photo"}</span>
                            </label>}
                            <button
                                className="button button-outline button-compact topbar-logout"
                                onClick={handleLogout}
                                disabled={signingOut}
                                aria-label={signingOut ? "Signing out" : "Log out"}
                            >
                                <LogOut className="mobile-control-icon" size={17} aria-hidden="true" />
                                <span className="topbar-logout-label">{signingOut ? "Signing out…" : "Log out"}</span>
                            </button>
                        </> : <>
                            <Link className="login-link" to="/login">Log in</Link>
                            <Link className="button button-compact" to="/register">Get started</Link>
                        </>}
                    </div>
                    {user && <div className="mobile-header-tools" aria-label="Quick actions">
                        <button className="mobile-header-icon" type="button" aria-label="Search" title="Search" onClick={() => navigate(searchPath)}>
                            <Search size={19} aria-hidden="true" />
                        </button>
                        <span className="mobile-role-indicator">{roleLabel}</span>
                        {location.pathname !== "/" && <button
                            className="mobile-header-icon"
                            type="button"
                            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                        >
                            {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
                        </button>}
                        <button
                            className="mobile-header-icon mobile-notification-button"
                            type="button"
                            aria-label={`${notificationCount ? `${notificationCount} unread notifications. ` : ""}Open notifications`}
                            title="Open notifications"
                            onClick={() => navigate(notificationPath)}
                        >
                            <Bell size={19} aria-hidden="true" />
                            {notificationCount > 0 && <span className="mobile-header-badge" aria-hidden="true">{notificationCount > 99 ? "99+" : notificationCount}</span>}
                        </button>
                        <div className="mobile-account-menu-wrap" ref={profileMenuWrapRef}>
                            <button
                                ref={profileMenuButtonRef}
                                className="mobile-profile-button"
                                type="button"
                                aria-label={profileMenuOpen ? "Close account menu" : "Open account menu"}
                                aria-expanded={profileMenuOpen}
                                aria-controls="mobile-account-menu"
                                onClick={() => setProfileMenuOpen((open) => !open)}
                            >
                                <PhotoAvatar userId={user.id} initials={user.username?.[0]?.toUpperCase() || "S"} hasPhoto={user.has_profile_photo} version={profilePhotoVersion} className="nav-avatar" />
                            </button>
                            {profileMenuOpen && <div className="mobile-account-menu" id="mobile-account-menu">
                                <strong>{user.username}</strong>
                                <small>{roleLabel} · SSCS ID {user.id}</small>
                                {profilePath && <Link to={profilePath} onClick={() => setProfileMenuOpen(false)}>{profileLabel}</Link>}
                                {user.role === "admin" && <label className="mobile-account-photo-control">
                                    <input
                                        className="sr-only"
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        aria-label="Upload or change profile photo"
                                        onChange={(event) => {
                                            setProfileMenuOpen(false);
                                            void uploadProfilePhoto(event);
                                        }}
                                        disabled={profilePhotoUploading}
                                    />
                                    <Camera size={17} aria-hidden="true" focusable="false" />
                                    <span>{profilePhotoUploading ? "Uploading…" : user.has_profile_photo ? "Change profile photo" : "Upload profile photo"}</span>
                                </label>}
                                <button type="button" onClick={() => { setProfileMenuOpen(false); void handleLogout(); }} disabled={signingOut}>
                                    {signingOut ? "Signing out…" : "Log out"}
                                </button>
                            </div>}
                        </div>
                    </div>}
                </header>
                {signOutError && <p className="sign-out-error" role="alert">{signOutError}</p>}
                {profilePhotoNotice && <p className={`profile-photo-notice${profilePhotoNotice.error ? " is-error" : ""}`} role={profilePhotoNotice.error ? "alert" : "status"}>{profilePhotoNotice.message}</p>}
                {signingOut && <AuthProgressBar label="Signing out" complete={signOutProgressComplete} />}
                {showMobileWelcome && <section className="mobile-welcome" aria-label="Welcome">
                    <div><p>{greeting}</p><h1>{user.username}</h1><span>{roleLabel} <i aria-hidden="true">·</i> SSCS ID {user.id}</span></div>
                    <span className="mobile-welcome-mark" aria-hidden="true">{user.username?.[0]?.toUpperCase() || "S"}</span>
                </section>}
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
            <nav className={`mobile-bottom-nav${mobileNavigationItems.length === 3 ? " has-three-items" : ""}`} aria-label="Mobile primary navigation">
                {mobileNavigationItems.map(renderMobileNavItem)}
            </nav>
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
