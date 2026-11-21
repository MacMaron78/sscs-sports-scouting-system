import { Navigate, Route, Routes } from "react-router-dom";
import { Layout, ProtectedRoute } from "./components";
import {
    AdminDashboardPage,
    AgencyDetailPage,
    AgencyDirectoryPage,
    AthleteDetailPage,
    AthleteDashboardPage,
    AthleteSearchPage,
    AuthPage,
    HomePage,
    InboxPage,
    LoginPortalPage,
    NewMessagePage,
    PasswordResetPage,
    ProfilePage,
    ScoutDashboardPage,
    ShortlistPage,
} from "./pages";
import { SupportInboxPage } from "./support";

export default function App() {
    return <Routes>
        <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="login" element={<LoginPortalPage />} />
            <Route path="login/athlete" element={<LoginPortalPage role="athlete" />} />
            <Route path="login/scout" element={<LoginPortalPage role="scout" />} />
            <Route path="login/admin" element={<LoginPortalPage role="admin" />} />
            <Route path="reset-password" element={<PasswordResetPage />} />
            <Route path="register" element={<AuthPage mode="register" />} />
            <Route element={<ProtectedRoute />}>
                <Route path="inbox" element={<InboxPage />} />
                <Route path="messages/new/:recipientId" element={<NewMessagePage />} />
                <Route path="athletes/:id" element={<AthleteDetailPage />} />
                <Route path="agencies" element={<AgencyDirectoryPage />} />
                <Route path="agencies/:id" element={<AgencyDetailPage />} />
                <Route element={<ProtectedRoute roles={["athlete", "scout"]} />}>
                    <Route path="support" element={<SupportInboxPage />} />
                </Route>
                <Route element={<ProtectedRoute roles={["scout"]} />}>
                    <Route path="scout-dashboard" element={<ScoutDashboardPage />} />
                    <Route path="athletes" element={<AthleteSearchPage />} />
                    <Route path="shortlist" element={<ShortlistPage />} />
                </Route>
                <Route element={<ProtectedRoute roles={["athlete"]} />}>
                    <Route path="athlete-dashboard" element={<AthleteDashboardPage />} />
                </Route>
                <Route element={<ProtectedRoute roles={["athlete", "scout"]} />}>
                    <Route path="profile" element={<ProfilePage />} />
                </Route>
                <Route element={<ProtectedRoute roles={["admin"]} />}>
                    <Route path="admin" element={<AdminDashboardPage />} />
                </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
    </Routes>;
}
