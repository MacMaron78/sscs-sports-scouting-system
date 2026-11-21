import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";

process.env.FRONTEND_ORIGIN = "http://localhost:5173";
process.env.JWT_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.PGSCHEMA = "sscs_api";

let storedPhoto = null;
let athleteDiscoverable = true;
let athleteVerification = { status: "unverified", requestedAt: null, reviewedAt: null, reviewedBy: null };
let athleteProfileRecord = {
    id: 3,
    first_name: "Test",
    last_name: "Athlete",
    sport: "Football",
    position: "Forward",
    age: 20,
    location: "Kampala",
    is_discoverable: true,
    competition_level: null,
    bio: "A test athlete",
    video_link: "",
    career_history: [],
    performance_stats: {},
    updated_at: "2026-11-14T00:00:00.000Z",
};
let agencyProfileRecord = {
    id: 4,
    agency_name: "Test Agency",
    country: "Uganda",
    contact_phone: "",
    contact_details: "",
    updated_at: "2026-11-14T00:00:00.000Z",
};
let scoutVerificationStatus = "unverified";
let registeredScout = null;
let lastAthleteSearchSql = "";
const userBlocks = new Set();
const storedMessages = [];
const supportMessages = [];
const supportConversations = new Map();
const supportReplyTransactionQueries = [];
let failNextSupportActivityUpdate = false;
const storedReports = [];
const storedPasswordResetRequests = [];
const storedPasswordResetAudit = [];
let nextMessageId = 1;
let nextSupportMessageId = 1;
let nextReportId = 1;
let nextPasswordResetRequestId = 1;
let testUserTokenVersion = 0;

const fakePool = {
    async query(sql, values = []) {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
            return { rows: [], rowCount: 0 };
        }
        if (sql.includes("SELECT id, username FROM") && sql.includes("role = 'admin'")) {
            return { rows: [{ id: 2, username: "test-admin" }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".support_conversations")) {
            const userId = Number(values[0]);
            const existing = supportConversations.get(userId);
            supportConversations.set(userId, {
                user_id: userId,
                status: "open",
                created_at: existing?.created_at || "2026-11-14T00:00:00.000Z",
                updated_at: "2026-11-14T00:00:00.000Z",
                resolved_at: null,
                resolved_by: null,
            });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".messages")
            && sql.includes("VALUES ($1, $2, $3, $4)")) {
            const [senderId, recipientId, body, supportUserId] = values;
            const message = {
                id: nextSupportMessageId++,
                sender_id: Number(senderId),
                recipient_id: Number(recipientId),
                body,
                support_user_id: Number(supportUserId),
                sent_at: `2026-11-14T00:0${nextSupportMessageId}:00.000Z`,
                is_read: false,
            };
            supportMessages.push(message);
            return { rows: [message], rowCount: 1 };
        }
        if (sql.includes("SELECT status FROM") && sql.includes(".support_conversations")) {
            const conversation = supportConversations.get(Number(values[0]));
            return conversation ? { rows: [{ status: conversation.status }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("SELECT c.user_id, u.username, u.role") && sql.includes(".support_conversations")) {
            const userId = Number(values[0]);
            const conversation = supportConversations.get(userId);
            const user = userId === 3
                ? { username: "test-scout", role: "scout" }
                : userId === 4
                    ? { username: "scout.regression", role: "scout" }
                    : { username: "test-athlete", role: "athlete" };
            return conversation
                ? { rows: [{ user_id: userId, ...user }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".support_conversations")
            && sql.includes("SET status = $1")) {
            const [status, resolverId, userId] = values;
            const conversation = supportConversations.get(Number(userId));
            if (!conversation) return { rows: [], rowCount: 0 };
            Object.assign(conversation, {
                status,
                updated_at: "2026-11-14T00:10:00.000Z",
                resolved_at: status === "resolved" ? "2026-11-14T00:10:00.000Z" : null,
                resolved_by: status === "resolved" ? resolverId : null,
            });
            return { rows: [{ user_id: Number(userId), status, updated_at: conversation.updated_at, resolved_at: conversation.resolved_at }], rowCount: 1 };
        }
        if (sql.includes("UPDATE") && sql.includes(".support_conversations SET updated_at")) {
            if (failNextSupportActivityUpdate) {
                failNextSupportActivityUpdate = false;
                throw new Error("Injected support activity update failure.");
            }
            const conversation = supportConversations.get(Number(values[0]));
            if (conversation) conversation.updated_at = "2026-11-14T00:10:00.000Z";
            return { rows: [], rowCount: conversation ? 1 : 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".messages SET is_read = TRUE")
            && sql.includes("sender_id = $1")) {
            const userId = Number(values[0]);
            let updated = 0;
            for (const message of supportMessages) {
                if (message.support_user_id === userId
                    && message.sender_id === userId && !message.is_read) {
                    message.is_read = true;
                    updated += 1;
                }
            }
            return { rows: [], rowCount: updated };
        }
        if (sql.includes("UPDATE") && sql.includes(".messages SET is_read = TRUE")
            && sql.includes("recipient_id = $1")) {
            const userId = Number(values[0]);
            let updated = 0;
            for (const message of supportMessages) {
                if (message.support_user_id === userId
                    && message.recipient_id === userId && !message.is_read) {
                    message.is_read = true;
                    updated += 1;
                }
            }
            return { rows: [], rowCount: updated };
        }
        if (sql.includes("SELECT c.user_id, c.status") && sql.includes(".support_conversations c")
            && sql.includes("AS unread_count")) {
            const conversations = [...supportConversations.values()].map((conversation) => {
                const userId = conversation.user_id;
                const role = userId === 1 ? "athlete" : "scout";
                const userMessages = supportMessages.filter((message) => message.support_user_id === userId);
                const latest = userMessages.at(-1);
                return {
                    ...conversation,
                    username: userId === 1 ? "test-athlete" : userId === 3 ? "test-scout" : "scout.regression",
                    role,
                    display_name: role === "athlete" ? "Test Athlete" : "Test Scout",
                    latest_message: latest?.body || null,
                    latest_message_at: latest?.sent_at || null,
                    unread_count: userMessages.filter((message) => message.sender_id === userId && !message.is_read).length,
                };
            });
            conversations.sort((first, second) => second.unread_count - first.unread_count);
            return { rows: conversations, rowCount: conversations.length };
        }
        if (sql.includes("JOIN") && sql.includes(".support_conversations c")
            && sql.includes("WHERE c.user_id = $1")) {
            const userId = Number(values[0]);
            const rows = supportMessages
                .filter((message) => message.support_user_id === userId)
                .map((message) => ({
                    ...message,
                    sender_username: message.sender_id === 2 ? "test-admin" : message.sender_id === 1 ? "test-athlete" : message.sender_id === 3 ? "test-scout" : "scout.regression",
                    sender_role: message.sender_id === 2 ? "admin" : message.sender_id === 1 ? "athlete" : "scout",
                    recipient_username: message.recipient_id === 2 ? "test-admin" : message.recipient_id === 1 ? "test-athlete" : message.recipient_id === 3 ? "test-scout" : "scout.regression",
                    recipient_role: message.recipient_id === 2 ? "admin" : message.recipient_id === 1 ? "athlete" : "scout",
                }));
            return { rows, rowCount: rows.length };
        }
        if (sql.includes("SELECT m.id, m.sender_id, m.recipient_id") && sql.includes(".messages m")) {
            const userId = Number(values[0]);
            const rows = supportMessages
                .filter((message) => message.support_user_id === userId)
                .map((message) => ({
                    ...message,
                    sender_username: message.sender_id === 2 ? "test-admin" : message.sender_id === 1 ? "test-athlete" : message.sender_id === 3 ? "test-scout" : "scout.regression",
                    sender_role: message.sender_id === 2 ? "admin" : message.sender_id === 1 ? "athlete" : "scout",
                    recipient_username: message.recipient_id === 2 ? "test-admin" : message.recipient_id === 1 ? "test-athlete" : message.recipient_id === 3 ? "test-scout" : "scout.regression",
                    recipient_role: message.recipient_id === 2 ? "admin" : message.recipient_id === 1 ? "athlete" : "scout",
                }));
            return { rows, rowCount: rows.length };
        }
        if (sql.includes("INSERT INTO") && sql.includes("messages")) {
            const [senderId, recipientId, body] = values;
            const blocked = userBlocks.has(`${senderId}:${recipientId}`) || userBlocks.has(`${recipientId}:${senderId}`);
            if (blocked) return { rows: [], rowCount: 0 };
            const message = {
                id: nextMessageId++,
                sender_id: Number(senderId),
                recipient_id: Number(recipientId),
                body,
                sent_at: "2026-11-14T00:00:00.000Z",
                is_read: false,
            };
            storedMessages.push(message);
            return { rows: [message], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".users") && values.length === 4) {
            if (values[3] === "scout") {
                registeredScout = {
                    id: 4,
                    username: values[0],
                    email: values[1],
                    password_hash: values[2],
                    role: "scout",
                    is_active: true,
                    token_version: 0,
                    verification_status: "unverified",
                };
                return {
                    rows: [{
                        id: registeredScout.id,
                        username: registeredScout.username,
                        email: registeredScout.email,
                        role: registeredScout.role,
                    }],
                    rowCount: 1,
                };
            }
        }
        if (sql.includes("INSERT INTO") && sql.includes(".agency_profiles")) {
            if (registeredScout) {
                agencyProfileRecord = {
                    ...agencyProfileRecord,
                    id: 4,
                    agency_name: values[1],
                    country: values[2],
                    contact_phone: values[3],
                    contact_details: values[4],
                };
            }
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT id FROM") && sql.includes("LOWER(email) = LOWER($1)") && sql.includes(".users")) {
            return values[0].toLowerCase() === "athlete@example.com"
                ? { rows: [{ id: 1 }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".password_reset_requests")
            && sql.includes("SET status = 'superseded'")) {
            storedPasswordResetRequests.forEach((entry) => {
                if (entry.user_id === Number(values[0]) && entry.status === "approved") {
                    entry.status = "superseded";
                    entry.reset_code_hash = null;
                    entry.reset_code_expires_at = null;
                }
            });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".password_reset_requests (user_id)")) {
            let entry = storedPasswordResetRequests.find((item) => item.user_id === Number(values[0]) && item.status === "pending");
            if (entry) {
                entry.requested_at = new Date().toISOString();
            } else {
                entry = {
                    id: nextPasswordResetRequestId++,
                    user_id: Number(values[0]),
                    status: "pending",
                    requested_at: new Date().toISOString(),
                    reviewed_at: null,
                    reset_code_expires_at: null,
                    reset_code_hash: null,
                    failed_attempts: 0,
                };
                storedPasswordResetRequests.push(entry);
            }
            return { rows: [{ id: entry.id }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".password_reset_audit")) {
            let entry;
            if (sql.includes("event_type, details")) {
                const [requestId, userId, eventType, details] = values;
                entry = { reset_request_id: requestId, user_id: userId, actor_id: null, event_type: eventType, details: JSON.parse(details) };
            } else if (sql.includes("actor_id, event_type")) {
                const [requestId, userId, actorId, eventType] = values;
                entry = {
                    reset_request_id: requestId,
                    user_id: userId,
                    actor_id: actorId,
                    event_type: eventType || (sql.includes("'declined'") ? "declined" : undefined),
                    details: {},
                };
            } else {
                const [requestId, userId] = values;
                entry = {
                    reset_request_id: requestId,
                    user_id: userId,
                    actor_id: null,
                    event_type: sql.includes("'requested'") ? "requested" : "reset_completed",
                    details: {},
                };
            }
            storedPasswordResetAudit.push({ id: storedPasswordResetAudit.length + 1, ...entry, created_at: new Date().toISOString() });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT e.id, e.reset_request_id")) {
            return {
                rows: [...storedPasswordResetAudit].reverse().map((entry) => ({
                    ...entry,
                    target_username: "test-athlete",
                    target_email: "athlete@example.com",
                    actor_username: entry.actor_id ? "test-admin" : null,
                })),
                rowCount: storedPasswordResetAudit.length,
            };
        }
        if (sql.includes("SELECT r.id, r.user_id, r.reset_code_hash")) {
            const entry = storedPasswordResetRequests.find((item) => item.user_id === 1
                && item.status === "approved"
                && item.failed_attempts < 5
                && item.reset_code_expires_at > new Date());
            return { rows: entry ? [{ ...entry }] : [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("SET failed_attempts = failed_attempts + 1")) {
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(values[0]));
            if (entry) {
                entry.failed_attempts += 1;
                if (entry.failed_attempts >= 5) {
                    entry.reset_code_hash = null;
                    entry.reset_code_expires_at = null;
                }
            }
            return { rows: [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".users SET password_hash = $1")) {
            testPasswordHash = values[0];
            testUserTokenVersion += 1;
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("UPDATE") && sql.includes(".password_reset_requests")
            && sql.includes("SET status = 'completed'")) {
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(values[0]));
            if (entry) {
                entry.status = "completed";
                entry.reset_code_hash = null;
                entry.reset_code_expires_at = null;
            }
            return { rows: [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".password_reset_requests")
            && sql.includes("SET status = 'declined'")) {
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(values[1]) && item.status === "pending");
            if (entry) {
                entry.status = "declined";
                entry.reviewed_at = new Date().toISOString();
            }
            return { rows: entry ? [{ ...entry }] : [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("UPDATE") && sql.includes(".password_reset_requests r")
            && sql.includes("SET status = 'approved'")) {
            const [reviewerId, codeHash, expiresAt, requestId, allowedStatus] = values;
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(requestId)
                && item.status === allowedStatus);
            if (entry) {
                entry.status = "approved";
                entry.reviewed_by = reviewerId;
                entry.reviewed_at = new Date().toISOString();
                entry.reset_code_hash = codeHash;
                entry.reset_code_expires_at = expiresAt;
                entry.failed_attempts = 0;
            }
            return { rows: entry ? [{ ...entry }] : [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("SELECT id, status FROM") && sql.includes(".password_reset_requests")) {
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(values[0]));
            return { rows: entry ? [{ id: entry.id, status: entry.status }] : [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("SELECT r.id, r.status, u.is_active")) {
            const entry = storedPasswordResetRequests.find((item) => item.id === Number(values[0]));
            return { rows: entry ? [{ id: entry.id, status: entry.status, is_active: true }] : [], rowCount: entry ? 1 : 0 };
        }
        if (sql.includes("SELECT r.id, r.user_id, u.username, u.email, u.role")) {
            return {
                rows: storedPasswordResetRequests
                    .filter((entry) => ["pending", "approved"].includes(entry.status))
                    .map((entry) => ({
                        id: entry.id,
                        user_id: entry.user_id,
                        status: entry.status,
                        requested_at: entry.requested_at,
                        reviewed_at: entry.reviewed_at,
                        reset_code_expires_at: entry.reset_code_expires_at,
                        failed_attempts: entry.failed_attempts,
                        username: "test-athlete",
                        email: "athlete@example.com",
                        role: "athlete",
                    })),
                rowCount: storedPasswordResetRequests.length,
            };
        }
        if (sql.includes("AS blocked_user_id") && sql.includes(".user_blocks b")) {
            const blockerId = String(values[0]);
            return {
                rows: [...userBlocks]
                    .filter((pair) => pair.startsWith(`${blockerId}:`))
                    .map((pair) => {
                        const blockedUserId = Number(pair.split(":")[1]);
                        return {
                            blocked_user_id: blockedUserId,
                            username: blockedUserId === 3 ? "test-scout" : "test-athlete",
                            role: blockedUserId === 3 ? "scout" : "athlete",
                            display_name: blockedUserId === 3 ? "Test Scout" : "Test Athlete",
                        };
                    }),
                rowCount: userBlocks.size,
            };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".user_blocks (")) {
            userBlocks.add(`${values[0]}:${values[1]}`);
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("DELETE FROM") && sql.includes(".user_blocks")) {
            userBlocks.delete(`${values[0]}:${values[1]}`);
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT id, role FROM") && sql.includes(".users")) {
            const id = Number(values[0]);
            return {
                rows: [id === 2 ? { id, role: "admin" } : { id, role: id === 3 ? "scout" : "athlete" }],
                rowCount: 1,
            };
        }
        if (sql.includes("AS display_name") && sql.includes("WHERE u.id = $1 AND u.is_active = TRUE")) {
            const targetId = String(values[0]);
            const callerId = String(values[3]);
            const blocked = userBlocks.has(`${callerId}:${targetId}`) || userBlocks.has(`${targetId}:${callerId}`);
            return {
                rows: blocked ? [] : [{
                    id: Number(targetId),
                    username: targetId === "3" ? "test-scout" : "test-athlete",
                    role: targetId === "3" ? "scout" : "athlete",
                    display_name: targetId === "3" ? "Test Scout" : "Test Athlete",
                }],
                rowCount: blocked ? 0 : 1,
            };
        }
        if (sql.includes("SELECT m.id, m.body, m.sent_at, m.is_read") && sql.includes(".messages m")) {
            const userId = String(values[0]);
            return {
                rows: storedMessages
                    .filter((entry) => String(entry.sender_id) === userId || String(entry.recipient_id) === userId)
                    .map((entry) => ({
                        ...entry,
                        sender_username: String(entry.sender_id) === "3" ? "test-scout" : "test-athlete",
                        sender_has_profile_photo: false,
                        recipient_username: String(entry.recipient_id) === "3" ? "test-scout" : "test-athlete",
                        recipient_has_profile_photo: false,
                    })),
                rowCount: storedMessages.length,
            };
        }
        if (sql.includes("SELECT sender_id, recipient_id FROM") && sql.includes(".messages")) {
            const message = storedMessages.find((entry) => (
                String(entry.id) === String(values[0])
                && (String(entry.sender_id) === String(values[1]) || String(entry.recipient_id) === String(values[1]))
            ));
            return { rows: message ? [message] : [], rowCount: message ? 1 : 0 };
        }
        if (sql.includes("INSERT INTO") && sql.includes(".user_reports")) {
            const [reporterId, targetUserId, messageId, category, details] = values;
            const report = {
                id: nextReportId++,
                reporter_id: Number(reporterId),
                reporter_username: String(reporterId) === "2" ? "test-admin" : String(reporterId) === "3" ? "test-scout" : "test-athlete",
                target_user_id: Number(targetUserId),
                target_username: String(targetUserId) === "3" ? "test-scout" : "test-athlete",
                message_id: messageId,
                category,
                details,
                status: "pending",
                created_at: "2026-11-14T00:00:00.000Z",
                reviewed_at: null,
            };
            storedReports.push(report);
            return { rows: [report], rowCount: 1 };
        }
        if (sql.includes("FROM") && sql.includes(".user_reports r")) {
            return { rows: [...storedReports], rowCount: storedReports.length };
        }
        if (sql.includes("UPDATE") && sql.includes(".user_reports")) {
            const [status, reviewerId, id] = values;
            const report = storedReports.find((entry) => String(entry.id) === String(id) && entry.status === "pending");
            if (!report) return { rows: [], rowCount: 0 };
            Object.assign(report, { status, reviewed_by: reviewerId, reviewed_at: "2026-11-14T00:05:00.000Z" });
            return { rows: [{ id: report.id, status, reviewed_by: reviewerId, reviewed_at: report.reviewed_at }], rowCount: 1 };
        }
        if (sql.includes("SELECT status FROM") && sql.includes(".user_reports")) {
            const report = storedReports.find((entry) => String(entry.id) === String(values[0]));
            return { rows: report ? [{ status: report.status }] : [], rowCount: report ? 1 : 0 };
        }
        if (sql.includes("ORDER BY p.last_name, p.first_name")) {
            lastAthleteSearchSql = sql;
            return {
                rows: athleteDiscoverable ? [{ id: 3, verification_status: athleteVerification.status }] : [],
                rowCount: athleteDiscoverable ? 1 : 0,
            };
        }
        if (sql.includes("WHERE p.id = $1 AND u.is_active = TRUE")) {
            const role = values[2];
            const callerId = String(values[1]);
            if (role === "scout" && !athleteDiscoverable) return { rows: [], rowCount: 0 };
            if (role === "athlete" && callerId !== "1") return { rows: [], rowCount: 0 };
            return {
                rows: [{
                    user_id: 1,
                    id: 3,
                    username: "test-athlete",
                    first_name: "Test",
                    last_name: "Athlete",
                    sport: "Football",
                    verification_status: athleteVerification.status,
                    is_discoverable: athleteDiscoverable,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET is_discoverable = $1")) {
            athleteDiscoverable = values[0];
            return { rows: [{ is_discoverable: athleteDiscoverable }], rowCount: 1 };
        }
        if (sql.includes("WITH updated_profile AS")) {
            const isAgency = sql.includes(".agency_profiles");
            const record = isAgency ? agencyProfileRecord : athleteProfileRecord;
            const verification = isAgency ? scoutVerificationStatus : athleteVerification.status;
            const fields = [...sql.matchAll(/([a-z_]+) IS DISTINCT FROM \$(\d+)/g)];
            const changedFields = fields.filter(([, column, parameter]) => {
                let value = values[Number(parameter) - 1];
                if (["career_history", "performance_stats"].includes(column)) value = JSON.parse(value);
                if (column === "age" && value !== null) value = Number(value);
                return JSON.stringify(record[column] ?? null) !== JSON.stringify(value ?? null);
            });
            if (!changedFields.length) return { rows: [], rowCount: 0 };

            for (const [, column, parameter] of changedFields) {
                let value = values[Number(parameter) - 1];
                if (["career_history", "performance_stats"].includes(column)) value = JSON.parse(value);
                if (column === "age" && value !== null) value = Number(value);
                record[column] = value;
            }
            if (isAgency) {
                scoutVerificationStatus = "unverified";
                return { rows: [{ ...record, verification_status: scoutVerificationStatus }], rowCount: 1 };
            }
            athleteVerification = { status: "unverified", requestedAt: null, reviewedAt: null, reviewedBy: null };
            return { rows: [{ ...record, verification_status: athleteVerification.status }], rowCount: 1 };
        }
        if (sql.includes("FROM \"sscs_api\".athlete_profiles p") && sql.includes("WHERE p.user_id = $1")) {
            return {
                rows: [{ ...athleteProfileRecord, verification_status: athleteVerification.status }],
                rowCount: 1,
            };
        }
        if (sql.includes("FROM \"sscs_api\".agency_profiles a") && sql.includes("WHERE u.id = $1")) {
            return {
                rows: [{
                    ...agencyProfileRecord,
                    verification_status: registeredScout ? registeredScout.verification_status : scoutVerificationStatus,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("FROM \"sscs_api\".agency_profiles a") && sql.includes("WHERE a.user_id = $1")) {
            return {
                rows: [{
                    ...agencyProfileRecord,
                    verification_status: registeredScout ? registeredScout.verification_status : scoutVerificationStatus,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET verification_status = 'pending'")) {
            if (registeredScout && Number(values[0]) === registeredScout.id) {
                registeredScout.verification_status = "pending";
                scoutVerificationStatus = "pending";
                return {
                    rows: [{
                        verification_status: "pending",
                        verification_requested_at: "2026-11-14T00:00:00.000Z",
                        verification_reviewed_at: null,
                    }],
                    rowCount: 1,
                };
            }
            if (!["unverified", "rejected"].includes(athleteVerification.status)) {
                return { rows: [], rowCount: 0 };
            }
            athleteVerification = {
                status: "pending",
                requestedAt: "2026-11-14T00:00:00.000Z",
                reviewedAt: null,
                reviewedBy: null,
            };
            return {
                rows: [{
                    verification_status: athleteVerification.status,
                    verification_requested_at: athleteVerification.requestedAt,
                    verification_reviewed_at: athleteVerification.reviewedAt,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SET verification_status = $1")) {
            const [status, id, reviewerId] = values;
            if (registeredScout && String(id) === String(registeredScout.id)) {
                const canReview = registeredScout.verification_status === "pending" && ["verified", "rejected"].includes(status);
                const canRevoke = registeredScout.verification_status === "verified" && status === "unverified";
                if (!canReview && !canRevoke) return { rows: [], rowCount: 0 };
                registeredScout.verification_status = status;
                scoutVerificationStatus = status;
                return {
                    rows: [{
                        id: registeredScout.id,
                        verification_status: status,
                        verification_requested_at: "2026-11-14T00:00:00.000Z",
                        verification_reviewed_at: status === "unverified" ? null : "2026-11-14T00:05:00.000Z",
                        verification_reviewed_by: status === "unverified" ? null : reviewerId,
                    }],
                    rowCount: 1,
                };
            }
            const canReview = athleteVerification.status === "pending" && ["verified", "rejected"].includes(status);
            const canRevoke = athleteVerification.status === "verified" && status === "unverified";
            if (String(id) !== "1" || (!canReview && !canRevoke)) return { rows: [], rowCount: 0 };
            athleteVerification = {
                status,
                requestedAt: status === "unverified" ? null : athleteVerification.requestedAt,
                reviewedAt: status === "unverified" ? null : "2026-11-14T00:05:00.000Z",
                reviewedBy: status === "unverified" ? null : reviewerId,
            };
            return {
                rows: [{
                    id: Number(id),
                    verification_status: athleteVerification.status,
                    verification_requested_at: athleteVerification.requestedAt,
                    verification_reviewed_at: athleteVerification.reviewedAt,
                    verification_reviewed_by: athleteVerification.reviewedBy,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SELECT role, verification_status")) {
            return {
                rows: [String(values[0]) === "1"
                    ? { role: "athlete", verification_status: athleteVerification.status }
                    : { role: "admin", verification_status: "unverified" }],
                rowCount: 1,
            };
        }
        if (sql.includes("AS pending_approval_requests")) {
            return {
                rows: [{
                    total_users: 3,
                    athlete_accounts: 1,
                    agencies: 1,
                    shortlist_entries: 0,
                    messages: 0,
                    pending_approval_requests: [athleteVerification.status, scoutVerificationStatus]
                        .filter((status) => status === "pending").length,
                    pending_password_reset_requests: storedPasswordResetRequests
                        .filter((entry) => entry.status === "pending").length,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("athlete_count")) {
            return { rows: [{ athlete_count: 7, agency_count: 3 }], rowCount: 1 };
        }
        if (sql.includes("AS unread_count")) {
            const userId = Number(values[0]);
            const isAdmin = values[1] === "admin";
            return {
                rows: [{
                    unread_count: 2,
                    support_unread_count: supportMessages.filter((message) => (
                        !message.is_read
                        && message.support_user_id !== null
                        && (isAdmin
                            ? message.recipient_id === userId
                            : message.recipient_id === userId && message.support_user_id === userId)
                    )).length,
                    recent_messages: [
                        { id: 21, body: "Are you available for a trial?", sent_at: "2026-11-03T10:00:00.000Z", sender_username: "scout-one" },
                        { id: 20, body: "I saw your profile.", sent_at: "2026-11-03T09:00:00.000Z", sender_username: "scout-two" },
                    ],
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("password_hash")) {
            lastLoginIdentifier = values[0];
            if (String(values[0]).toLowerCase() === "scout.regression@example.com" && registeredScout) {
                return {
                    rows: [{
                        ...registeredScout,
                        password_hash: registeredScout.password_hash,
                        has_profile_photo: false,
                    }],
                    rowCount: 1,
                };
            }
            return {
                rows: [{
                    id: 1,
                    username: "test-athlete",
                    email: "athlete@example.com",
                    role: "athlete",
                    is_active: true,
                    token_version: testUserTokenVersion,
                    password_hash: testPasswordHash,
                    has_profile_photo: false,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("u.profile_photo, u.profile_photo_type")) {
            return {
                rows: storedPhoto ? [{
                    id: Number(values[0]),
                    role: "athlete",
                    verification_status: athleteVerification.status,
                    athlete_is_discoverable: athleteDiscoverable,
                    profile_photo: storedPhoto.data,
                    profile_photo_type: storedPhoto.type,
                }] : [],
                rowCount: storedPhoto ? 1 : 0,
            };
        }
        if (sql.includes("LEFT JOIN") && sql.includes("athlete_profiles")) {
            return {
                rows: [{
                    id: 3,
                    username: "test-athlete",
                    email: "athlete@example.com",
                    role: "athlete",
                    is_active: true,
                    created_at: "2026-01-01T00:00:00.000Z",
                    first_name: "Test",
                    last_name: "Athlete",
                    sport: "Football",
                    position: "Forward",
                    age: 20,
                    location: "Kampala",
                    bio: "A test athlete",
                    video_link: "",
                    career_history: [],
                    performance_stats: {},
                    agency_name: null,
                    country: null,
                    contact_phone: null,
                    contact_details: null,
                }],
                rowCount: 1,
            };
        }
        if (sql.includes("SELECT id, username, email, role, is_active")) {
            const id = String(values[0]);
            const user = id === "2"
                ? { id: 2, username: "test-admin", email: "admin@example.com", role: "admin", is_active: true, token_version: 0, verification_status: "verified" }
                : id === "4" && registeredScout
                    ? { ...registeredScout, verification_status: registeredScout.verification_status, has_profile_photo: false }
                : id === "3"
                    ? { id: 3, username: "test-scout", email: "scout@example.com", role: "scout", is_active: true, token_version: 0, verification_status: scoutVerificationStatus }
                    : { id: 1, username: "test-athlete", email: "athlete@example.com", role: "athlete", is_active: true, token_version: testUserTokenVersion, verification_status: athleteVerification.status };
            return { rows: [user], rowCount: 1 };
        }
        if (sql.includes("SET profile_photo = $1")) {
            storedPhoto = { data: values[0], type: values[1] };
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SET profile_photo = NULL")) {
            storedPhoto = null;
            return { rows: [], rowCount: 1 };
        }
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
    },
    async connect() {
        const query = this.query.bind(this);
        let transactionSnapshot;
        return {
            async query(sql, values) {
                supportReplyTransactionQueries.push(sql);
                if (sql === "BEGIN") {
                    transactionSnapshot = {
                        messages: supportMessages.map((message) => ({ ...message })),
                        conversations: new Map([...supportConversations].map(([userId, conversation]) => (
                            [userId, { ...conversation }]
                        ))),
                    };
                }
                const result = await query(sql, values);
                if (sql === "ROLLBACK" && transactionSnapshot) {
                    supportMessages.splice(0, supportMessages.length, ...transactionSnapshot.messages);
                    supportConversations.clear();
                    for (const [userId, conversation] of transactionSnapshot.conversations) {
                        supportConversations.set(userId, conversation);
                    }
                }
                if (sql === "COMMIT" || sql === "ROLLBACK") transactionSnapshot = null;
                return result;
            },
            release() {},
        };
    },
};

let testPasswordHash;
let lastLoginIdentifier;
const app = createApp(fakePool);
let server;
let baseUrl;

before(async () => {
    testPasswordHash = await bcrypt.hash("valid-password-123", 4);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test("health endpoint checks the database dependency", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "connected" });
});

test("public summary returns counts without exposing account records", async () => {
    const response = await fetch(`${baseUrl}/api/public/summary`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { athlete_count: 7, agency_count: 3 });
});

test("scout search requires an authenticated user", async () => {
    const response = await fetch(`${baseUrl}/api/athletes`);

    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /log in/i);
});

test("athlete discovery requires a verified scout and respects athlete visibility", async () => {
    const scoutToken = jwt.sign(
        { sub: "3", role: "scout" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const athleteToken = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const scoutHeaders = { Cookie: `sscs_session=${scoutToken}` };
    const athleteHeaders = { Cookie: `sscs_session=${athleteToken}`, "Content-Type": "application/json" };

    scoutVerificationStatus = "unverified";
    const unverifiedSearch = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(unverifiedSearch.status, 403);

    scoutVerificationStatus = "verified";
    const search = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(search.status, 200);
    assert.match(lastAthleteSearchSql, /p\.is_discoverable = TRUE/);
    assert.doesNotMatch(lastAthleteSearchSql, /u\.email/);

    const hide = await fetch(`${baseUrl}/api/me/athlete-visibility`, {
        method: "PATCH",
        headers: athleteHeaders,
        body: JSON.stringify({ isDiscoverable: false }),
    });
    assert.equal(hide.status, 200);
    assert.equal((await hide.json()).isDiscoverable, false);

    const hiddenSearch = await fetch(`${baseUrl}/api/athletes`, { headers: scoutHeaders });
    assert.equal(hiddenSearch.status, 200);
    assert.equal((await hiddenSearch.json()).athletes.length, 0);

    storedPhoto = { data: Buffer.from("private-photo"), type: "image/png" };
    const hiddenPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers: scoutHeaders });
    assert.equal(hiddenPhoto.status, 404);
    const ownerPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers: { Cookie: athleteHeaders.Cookie } });
    assert.equal(ownerPhoto.status, 200);
    storedPhoto = null;

    const hiddenProfile = await fetch(`${baseUrl}/api/athletes/3`, { headers: scoutHeaders });
    assert.equal(hiddenProfile.status, 404);

    const ownerProfile = await fetch(`${baseUrl}/api/athletes/3`, { headers: { Cookie: athleteHeaders.Cookie } });
    assert.equal(ownerProfile.status, 200);

    const show = await fetch(`${baseUrl}/api/me/athlete-visibility`, {
        method: "PATCH",
        headers: athleteHeaders,
        body: JSON.stringify({ isDiscoverable: true }),
    });
    assert.equal(show.status, 200);
    assert.equal((await show.json()).isDiscoverable, true);
});

test("role-specific login rejects accounts from the other portal without setting a session", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "test-athlete",
            password: "valid-password-123",
            expectedRole: "scout",
        }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Please use the Athlete login portal." });
    assert.equal(response.headers.get("set-cookie"), null);
});

test("role-specific login accepts an account from the selected portal", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "ATHLETE@example.com",
            password: "valid-password-123",
            expectedRole: "athlete",
        }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, "athlete");
    assert.equal(lastLoginIdentifier, "ATHLETE@example.com");
    assert.match(response.headers.get("set-cookie"), /^sscs_session=/);
});

test("administrator login portal rejects non-administrator accounts", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "test-athlete",
            password: "valid-password-123",
            expectedRole: "admin",
        }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Please use the Administrator login portal." });
});

test("newly registered scouts remain unverified until administrator approval", async () => {
    registeredScout = null;
    scoutVerificationStatus = "unverified";

    const registration = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "scout.regression",
            email: "scout.regression@example.com",
            password: "valid-password-123",
            role: "scout",
            agencyName: "Regression Scout Agency",
            country: "Uganda",
            contactPhone: "+256700000000",
            contactDetails: "Isolated automated test scout",
        }),
    });
    assert.equal(registration.status, 201);
    assert.equal(registeredScout.verification_status, "unverified");
    assert.equal(registeredScout.role, "scout");

    const scoutSession = registration.headers.get("set-cookie");
    assert.match(scoutSession, /^sscs_session=/);

    const profile = await fetch(`${baseUrl}/api/me/profile`, {
        headers: { Cookie: scoutSession },
    });
    assert.equal(profile.status, 200);
    const { profileType, profile: scoutProfile } = await profile.json();
    assert.equal(profileType, "agency");
    assert.equal(scoutProfile.verification_status, "unverified");

    const unverifiedSearch = await fetch(`${baseUrl}/api/athletes`, {
        headers: { Cookie: scoutSession },
    });
    assert.equal(unverifiedSearch.status, 403);

    const reviewRequest = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: scoutSession },
    });
    assert.equal(reviewRequest.status, 201);
    assert.equal((await reviewRequest.json()).verification.verification_status, "pending");

    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const approval = await fetch(`${baseUrl}/api/admin/users/4/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(approval.status, 200);
    assert.equal((await approval.json()).verification.verification_status, "verified");
    assert.equal(registeredScout.verification_status, "verified");

    const verifiedSearch = await fetch(`${baseUrl}/api/athletes`, {
        headers: { Cookie: scoutSession },
    });
    assert.equal(verifiedSearch.status, 200);

    registeredScout = null;
    scoutVerificationStatus = "unverified";
    agencyProfileRecord = {
        id: 4,
        agency_name: "Test Agency",
        country: "Uganda",
        contact_phone: "",
        contact_details: "",
        updated_at: "2026-11-14T00:00:00.000Z",
    };
});

test("administrators are trusted and cannot be treated as ordinary unverified users", async () => {
    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const athleteToken = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );

    const profile = await fetch(`${baseUrl}/api/me/profile`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal(profile.status, 200);
    const adminProfile = await profile.json();
    assert.equal(adminProfile.profileType, "admin");
    assert.equal(adminProfile.profile.role, "admin");
    assert.equal(adminProfile.profile.verification_status, "verified");

    const summary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal(summary.status, 200);

    const unauthorizedVerify = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${athleteToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(unauthorizedVerify.status, 403);
});

test("admin user list includes all athlete profile fields", async () => {
    const token = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const response = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Cookie: `sscs_session=${token}` },
    });

    assert.equal(response.status, 200);
    const { users } = await response.json();
    assert.equal(users.length, 1);
    assert.equal(users[0].sport, "Football");
    assert.equal(users[0].position, "Forward");
    assert.equal(users[0].location, "Kampala");
    assert.deepEqual(users[0].career_history, []);
    assert.deepEqual(users[0].performance_stats, {});
});

test("unread-message endpoint returns the signed-in user's count and recent messages", async () => {
    const token = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const response = await fetch(`${baseUrl}/api/messages/unread`, {
        headers: { Cookie: `sscs_session=${token}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.unreadCount, 2);
    assert.equal(payload.supportUnreadCount, 0);
    assert.equal(payload.recentMessages.length, 2);
    assert.equal(payload.recentMessages[0].sender_username, "scout-one");
});

test("support inbox isolates athlete and scout conversations and supports admin replies, read state, and resolution", async () => {
    supportMessages.splice(0);
    supportConversations.clear();
    nextSupportMessageId = 1;
    const tokenFor = (id, role) => jwt.sign(
        { sub: String(id), role },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const headersFor = (id, role) => ({
        Cookie: `sscs_session=${tokenFor(id, role)}`,
        "Content-Type": "application/json",
    });
    const athleteHeaders = headersFor(1, "athlete");
    const scoutHeaders = headersFor(3, "scout");
    const adminHeaders = headersFor(2, "admin");

    const athleteMessage = await fetch(`${baseUrl}/api/support/messages`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({
            body: "I need help with my profile.",
            support_user_id: 3,
        }),
    });
    assert.equal(athleteMessage.status, 201);
    const athleteMessagePayload = await athleteMessage.json();
    assert.equal(athleteMessagePayload.message.sender_role, "athlete");
    assert.equal(athleteMessagePayload.message.support_user_id, 1);

    const scoutMessage = await fetch(`${baseUrl}/api/support/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ body: "I need help with scouting access." }),
    });
    assert.equal(scoutMessage.status, 201);
    assert.equal((await scoutMessage.json()).message.sender_role, "scout");
    assert.equal(supportConversations.get(1).status, "open");
    assert.equal(supportConversations.get(3).status, "open");

    supportMessages.push({
        id: 999,
        sender_id: 1,
        recipient_id: 2,
        body: "Unassociated legacy admin message",
        sent_at: "2026-11-14T00:09:00.000Z",
        is_read: false,
        support_user_id: null,
    });

    const emptyMessage = await fetch(`${baseUrl}/api/support/messages`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ body: "   " }),
    });
    assert.equal(emptyMessage.status, 400);
    const oversizedMessage = await fetch(`${baseUrl}/api/support/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ body: "x".repeat(5001) }),
    });
    assert.equal(oversizedMessage.status, 400);
    const adminUserInbox = await fetch(`${baseUrl}/api/support/messages`, { headers: adminHeaders });
    assert.equal(adminUserInbox.status, 403);

    const adminUnread = await fetch(`${baseUrl}/api/messages/unread`, { headers: adminHeaders });
    assert.equal((await adminUnread.json()).supportUnreadCount, 2);

    const forbiddenQueue = await fetch(`${baseUrl}/api/admin/support/conversations`, { headers: scoutHeaders });
    assert.equal(forbiddenQueue.status, 403);
    const forbiddenThread = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, { headers: athleteHeaders });
    assert.equal(forbiddenThread.status, 403);
    const forbiddenReply = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ body: "Not an administrator." }),
    });
    assert.equal(forbiddenReply.status, 403);
    const forbiddenResolve = await fetch(`${baseUrl}/api/admin/support/conversations/1`, {
        method: "PATCH",
        headers: scoutHeaders,
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(forbiddenResolve.status, 403);

    const queueResponse = await fetch(`${baseUrl}/api/admin/support/conversations`, { headers: adminHeaders });
    assert.equal(queueResponse.status, 200);
    const queue = await queueResponse.json();
    assert.equal(queue.conversations.length, 2);
    assert.deepEqual(new Set(queue.conversations.map((conversation) => conversation.user_id)), new Set([1, 3]));
    const athleteConversation = queue.conversations.find((conversation) => conversation.user_id === 1);
    assert.equal(athleteConversation.unread_count, 1);
    assert.equal(athleteConversation.latest_message, "I need help with my profile.");

    const adminThread = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, { headers: adminHeaders });
    assert.equal(adminThread.status, 200);
    assert.equal((await adminThread.json()).messages[0].is_read, true);

    supportReplyTransactionQueries.splice(0);
    const reply = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            body: "We can help with that.",
            support_user_id: 3,
        }),
    });
    assert.equal(reply.status, 201);
    const replyPayload = await reply.json();
    assert.equal(replyPayload.message.sender_role, "admin");
    assert.equal(replyPayload.message.support_user_id, 1);
    assert.equal(supportReplyTransactionQueries[0], "BEGIN");
    const replyInsertIndex = supportReplyTransactionQueries.findIndex((sql) => (
        sql.includes("INSERT INTO") && sql.includes(".messages")
    ));
    const activityUpdateIndex = supportReplyTransactionQueries.findIndex((sql) => (
        sql.includes("UPDATE") && sql.includes(".support_conversations SET updated_at")
    ));
    assert.ok(replyInsertIndex > 0);
    assert.ok(activityUpdateIndex > replyInsertIndex);
    assert.equal(supportReplyTransactionQueries.at(-1), "COMMIT");

    const messageCountBeforeFailedReply = supportMessages.length;
    const activityBeforeFailedReply = supportConversations.get(1).updated_at;
    supportReplyTransactionQueries.splice(0);
    failNextSupportActivityUpdate = true;
    const originalConsoleError = console.error;
    console.error = () => {};
    let failedReply;
    try {
        failedReply = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, {
            method: "POST",
            headers: adminHeaders,
            body: JSON.stringify({ body: "This reply must roll back." }),
        });
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(failedReply.status, 500);
    assert.equal((await failedReply.json()).error, "An unexpected server error occurred.");
    assert.equal(supportMessages.length, messageCountBeforeFailedReply);
    assert.equal(supportConversations.get(1).updated_at, activityBeforeFailedReply);
    assert.equal(supportReplyTransactionQueries.at(-1), "ROLLBACK");

    const athleteUnread = await fetch(`${baseUrl}/api/messages/unread`, { headers: athleteHeaders });
    assert.equal((await athleteUnread.json()).supportUnreadCount, 1);

    const athleteHistoryResponse = await fetch(`${baseUrl}/api/support/messages?userId=3`, { headers: athleteHeaders });
    assert.equal(athleteHistoryResponse.status, 200);
    const athleteHistory = await athleteHistoryResponse.json();
    assert.equal(athleteHistory.messages.length, 2);
    assert.deepEqual(athleteHistory.messages.map((message) => message.body), [
        "I need help with my profile.",
        "We can help with that.",
    ]);
    assert.equal(athleteHistory.messages.some((message) => message.body.includes("legacy admin")), false);
    assert.equal(athleteHistory.messages[1].is_read, true);
    assert.equal(athleteHistory.messages.some((message) => message.body.includes("scouting access")), false);

    const readUnread = await fetch(`${baseUrl}/api/messages/unread`, { headers: athleteHeaders });
    assert.equal((await readUnread.json()).supportUnreadCount, 0);

    const resolved = await fetch(`${baseUrl}/api/admin/support/conversations/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(resolved.status, 200);
    const resolvedPayload = await resolved.json();
    assert.equal(resolvedPayload.conversation.status, "resolved");
    assert.equal(resolvedPayload.conversation.resolved_at, supportConversations.get(1).resolved_at);
    assert.equal(supportConversations.get(1).resolved_by, 2);
    const adminReopened = await fetch(`${baseUrl}/api/admin/support/conversations/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "open" }),
    });
    assert.equal(adminReopened.status, 200);
    const reopenedPayload = await adminReopened.json();
    assert.equal(reopenedPayload.conversation.status, "open");
    assert.equal(reopenedPayload.conversation.resolved_at, null);
    assert.equal(supportConversations.get(1).resolved_by, null);
    const resolvedAgain = await fetch(`${baseUrl}/api/admin/support/conversations/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(resolvedAgain.status, 200);
    const statusResponse = await fetch(`${baseUrl}/api/support/messages`, { headers: athleteHeaders });
    const resolvedHistory = await statusResponse.json();
    assert.equal(statusResponse.status, 200, JSON.stringify(resolvedHistory));
    assert.equal(resolvedHistory.status, "resolved", JSON.stringify(resolvedHistory));

    const reopened = await fetch(`${baseUrl}/api/support/messages`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ body: "Following up on this request." }),
    });
    assert.equal(reopened.status, 201);
    assert.equal(supportConversations.get(1).status, "open");
    assert.equal(supportConversations.get(3).status, "open");

    const isolatedAdminHistory = await fetch(`${baseUrl}/api/admin/support/conversations/1/messages`, { headers: adminHeaders });
    assert.equal(isolatedAdminHistory.status, 200);
    const adminHistory = await isolatedAdminHistory.json();
    assert.equal(adminHistory.messages.length, 3);
    assert.equal(adminHistory.messages.some((message) => message.body.includes("scouting access")), false);
    assert.equal(adminHistory.messages.some((message) => message.body.includes("legacy admin")), false);

    const missingConversation = await fetch(`${baseUrl}/api/admin/support/conversations/999/messages`, { headers: adminHeaders });
    assert.equal(missingConversation.status, 404);
    supportMessages.splice(0);
    supportConversations.clear();
});

test("unread-message endpoint requires authentication", async () => {
    const response = await fetch(`${baseUrl}/api/messages/unread`);

    assert.equal(response.status, 401);
});

test("blocking prevents new messages in both directions while reports enter admin review", async () => {
    userBlocks.clear();
    storedMessages.splice(0);
    storedReports.splice(0);
    nextMessageId = 1;
    nextReportId = 1;
    athleteDiscoverable = true;
    scoutVerificationStatus = "verified";
    const tokenFor = (id, role) => jwt.sign(
        { sub: String(id), role },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const athleteHeaders = {
        Cookie: `sscs_session=${tokenFor(1, "athlete")}`,
        "Content-Type": "application/json",
    };
    const scoutHeaders = {
        Cookie: `sscs_session=${tokenFor(3, "scout")}`,
        "Content-Type": "application/json",
    };
    const adminHeaders = { Cookie: `sscs_session=${tokenFor(2, "admin")}` };

    const firstMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "Hello" }),
    });
    assert.equal(firstMessage.status, 201, JSON.stringify(await firstMessage.clone().json()));

    const block = await fetch(`${baseUrl}/api/blocks`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ blockedUserId: 3 }),
    });
    assert.equal(block.status, 201);

    const blockList = await fetch(`${baseUrl}/api/blocks`, { headers: athleteHeaders });
    assert.equal((await blockList.json()).blocks[0].blocked_user_id, 3);

    const hiddenRecipient = await fetch(`${baseUrl}/api/recipients/3`, { headers: athleteHeaders });
    assert.equal(hiddenRecipient.status, 404);

    const blockedMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "A new message" }),
    });
    assert.equal(blockedMessage.status, 404);

    const history = await fetch(`${baseUrl}/api/messages`, { headers: athleteHeaders });
    assert.equal((await history.json()).messages.length, 1);

    const unblock = await fetch(`${baseUrl}/api/blocks/3`, {
        method: "DELETE",
        headers: athleteHeaders,
    });
    assert.equal(unblock.status, 204);
    assert.equal((await (await fetch(`${baseUrl}/api/blocks`, { headers: athleteHeaders })).json()).blocks.length, 0);

    const secondMessage = await fetch(`${baseUrl}/api/messages`, {
        method: "POST",
        headers: scoutHeaders,
        body: JSON.stringify({ recipientId: 1, body: "A message after unblocking" }),
    });
    assert.equal(secondMessage.status, 201);
    const { message } = await secondMessage.json();

    const accountReport = await fetch(`${baseUrl}/api/reports`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({ targetUserId: 3, category: "spam", details: "Suspicious outreach" }),
    });
    assert.equal(accountReport.status, 201);
    const accountReportPayload = await accountReport.json();

    const messageReport = await fetch(`${baseUrl}/api/reports`, {
        method: "POST",
        headers: athleteHeaders,
        body: JSON.stringify({
            targetUserId: 3,
            messageId: message.id,
            category: "harassment",
            details: "Please review this message",
        }),
    });
    assert.equal(messageReport.status, 201);

    const queue = await fetch(`${baseUrl}/api/admin/reports`, { headers: adminHeaders });
    assert.equal(queue.status, 200);
    assert.equal((await queue.json()).reports.length, 2);

    const review = await fetch(`${baseUrl}/api/admin/reports/${accountReportPayload.report.id}`, {
        method: "PATCH",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).report.status, "resolved");
});

test("state-changing requests reject an unexpected browser origin", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
    });

    assert.equal(response.status, 403);
});

test("development API allows the frontend loopback origin for state-changing requests", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:5173" },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("profile photos upload, serve, reject invalid formats, and can be removed", async () => {
    const token = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const headers = { Cookie: `sscs_session=${token}` };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const invalidUpload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: Buffer.from("not an image"),
    });
    assert.equal(invalidUpload.status, 415);

    const upload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: png,
    });
    assert.equal(upload.status, 200);
    assert.deepEqual(await upload.json(), { message: "Profile photo updated." });

    const anonymousPhoto = await fetch(`${baseUrl}/api/profile-photos/1`);
    assert.equal(anonymousPhoto.status, 401);

    const photo = await fetch(`${baseUrl}/api/profile-photos/1`, { headers });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/png");
    assert.equal(photo.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

    const removal = await fetch(`${baseUrl}/api/me/profile-photo`, { method: "DELETE", headers });
    assert.equal(removal.status, 204);
    const missingPhoto = await fetch(`${baseUrl}/api/profile-photos/1`, { headers });
    assert.equal(missingPhoto.status, 404);
});

test("administrators can upload and remove their own profile photo", async () => {
    const token = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const headers = { Cookie: `sscs_session=${token}` };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const upload = await fetch(`${baseUrl}/api/me/profile-photo`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "image/png" },
        body: png,
    });
    assert.equal(upload.status, 200);

    const photo = await fetch(`${baseUrl}/api/profile-photos/2`, { headers });
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);

    const removal = await fetch(`${baseUrl}/api/me/profile-photo`, { method: "DELETE", headers });
    assert.equal(removal.status, 204);
});

test("athletes can request manual profile review and admins can approve it", async () => {
    const athleteToken = jwt.sign(
        { sub: "1", role: "athlete" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );

    const request = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(request.status, 201);
    assert.equal((await request.json()).verification.verification_status, "pending");

    const pendingSummary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal(pendingSummary.status, 200);
    assert.equal((await pendingSummary.json()).summary.pending_approval_requests, 1);

    const duplicateRequest = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(duplicateRequest.status, 409);

    const approval = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(approval.status, 200);
    const { verification } = await approval.json();
    assert.equal(verification.verification_status, "verified");
    assert.equal(verification.verification_reviewed_by, 2);
    const reviewedSummary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal((await reviewedSummary.json()).summary.pending_approval_requests, 0);

    const revocation = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "unverified" }),
    });
    assert.equal(revocation.status, 200);
    assert.equal((await revocation.json()).verification.verification_status, "unverified");

    await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    const rejection = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "rejected" }),
    });
    assert.equal(rejection.status, 200);
    assert.equal((await rejection.json()).verification.verification_status, "rejected");

    const resubmission = await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    assert.equal(resubmission.status, 201);
    assert.equal((await resubmission.json()).verification.verification_status, "pending");

    const profileEdit = await fetch(`${baseUrl}/api/me/athlete-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${athleteToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sport: "Basketball" }),
    });
    assert.equal(profileEdit.status, 200);
    assert.equal((await profileEdit.json()).athlete.verification_status, "unverified");

    await fetch(`${baseUrl}/api/me/verification-request`, {
        method: "POST",
        headers: { Cookie: `sscs_session=${athleteToken}` },
    });
    const approvalAfterEdit = await fetch(`${baseUrl}/api/admin/users/1/verification`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "verified" }),
    });
    assert.equal(approvalAfterEdit.status, 200);

    const unchangedAthleteProfile = await fetch(`${baseUrl}/api/me/athlete-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${athleteToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sport: "Basketball" }),
    });
    assert.equal(unchangedAthleteProfile.status, 200);
    assert.equal((await unchangedAthleteProfile.json()).athlete.verification_status, "verified");

    const scoutToken = jwt.sign(
        { sub: "3", role: "scout" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const previousScoutVerification = scoutVerificationStatus;
    scoutVerificationStatus = "verified";
    const unchangedAgencyProfile = await fetch(`${baseUrl}/api/me/agency-profile`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${scoutToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ agencyName: "Test Agency" }),
    });
    assert.equal(unchangedAgencyProfile.status, 200);
    assert.equal((await unchangedAgencyProfile.json()).agency.verification_status, "verified");
    scoutVerificationStatus = previousScoutVerification;
});

test("password reset requests stay private until admin review and approved codes work once", async () => {
    storedPasswordResetRequests.length = 0;
    storedPasswordResetAudit.length = 0;
    nextPasswordResetRequestId = 1;
    testUserTokenVersion = 0;
    testPasswordHash = await bcrypt.hash("valid-password-123", 4);

    const requestReset = (email) => fetch(`${baseUrl}/api/auth/password-reset-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
    });
    const existingAccountResponse = await requestReset("ATHLETE@example.com");
    const unknownAccountResponse = await requestReset("unknown@example.com");
    assert.equal(existingAccountResponse.status, 202);
    assert.equal(unknownAccountResponse.status, 202);
    assert.deepEqual(await existingAccountResponse.json(), await unknownAccountResponse.json());
    assert.equal(storedPasswordResetRequests.length, 1);
    assert.equal(storedPasswordResetAudit[0].event_type, "requested");

    const adminToken = jwt.sign(
        { sub: "2", role: "admin", ver: 0 },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const adminHeaders = {
        Cookie: `sscs_session=${adminToken}`,
        "Content-Type": "application/json",
    };
    const queue = await fetch(`${baseUrl}/api/admin/password-reset-requests`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal(queue.status, 200);
    const queuedRequests = await queue.json();
    assert.equal(queuedRequests.requests.length, 1);
    assert.equal("reset_code_hash" in queuedRequests.requests[0], false);
    const adminSummary = await fetch(`${baseUrl}/api/admin/summary`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    assert.equal((await adminSummary.json()).summary.pending_password_reset_requests, 1);

    const approval = await fetch(`${baseUrl}/api/admin/password-reset-requests/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(approval.status, 200);
    const { resetCode } = await approval.json();
    assert.match(resetCode, /^[A-Za-z0-9_-]{43}$/);
    const replacement = await fetch(`${baseUrl}/api/admin/password-reset-requests/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "regenerate" }),
    });
    assert.equal(replacement.status, 200);
    const { resetCode: replacementCode } = await replacement.json();
    assert.notEqual(replacementCode, resetCode);

    const oldSession = jwt.sign(
        { sub: "1", role: "athlete", ver: 0 },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const reset = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            code: resetCode,
            password: "new-valid-password-456",
        }),
    });
    assert.equal(reset.status, 400);
    const approvedReset = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            code: replacementCode,
            password: "new-valid-password-456",
        }),
    });
    assert.equal(approvedReset.status, 200);

    const replay = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            code: replacementCode,
            password: "another-valid-password-789",
        }),
    });
    assert.equal(replay.status, 400);

    const oldSessionCheck = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `sscs_session=${oldSession}` },
    });
    assert.equal(oldSessionCheck.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            password: "new-valid-password-456",
            expectedRole: "athlete",
        }),
    });
    assert.equal(login.status, 200);
    const audit = await fetch(`${baseUrl}/api/admin/password-reset-audit`, {
        headers: { Cookie: `sscs_session=${adminToken}` },
    });
    const events = (await audit.json()).events.map((event) => event.event_type);
    assert.ok(events.includes("approved"));
    assert.ok(events.includes("code_regenerated"));
    assert.ok(events.includes("code_attempt_failed"));
    assert.ok(events.includes("reset_completed"));
});

test("admins can decline password reset requests without issuing a code", async () => {
    storedPasswordResetRequests.length = 0;
    storedPasswordResetAudit.length = 0;
    nextPasswordResetRequestId = 1;
    testUserTokenVersion = 0;
    testPasswordHash = await bcrypt.hash("valid-password-123", 4);
    await fetch(`${baseUrl}/api/auth/password-reset-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "athlete@example.com" }),
    });
    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const response = await fetch(`${baseUrl}/api/admin/password-reset-requests/1`, {
        method: "PATCH",
        headers: {
            Cookie: `sscs_session=${adminToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "declined" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).request.status, "declined");
    assert.equal(storedPasswordResetRequests[0].reset_code_hash, null);
    assert.equal(storedPasswordResetAudit[1].event_type, "declined");
});

test("the fifth incorrect code attempt locks the code until an admin regenerates it", async () => {
    storedPasswordResetRequests.length = 0;
    storedPasswordResetAudit.length = 0;
    nextPasswordResetRequestId = 1;
    testUserTokenVersion = 0;
    testPasswordHash = await bcrypt.hash("valid-password-123", 4);
    await fetch(`${baseUrl}/api/auth/password-reset-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "athlete@example.com" }),
    });
    const adminToken = jwt.sign(
        { sub: "2", role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "1h", issuer: "sscs-api", audience: "sscs-web" },
    );
    const adminHeaders = {
        Cookie: `sscs_session=${adminToken}`,
        "Content-Type": "application/json",
    };
    const approval = await fetch(`${baseUrl}/api/admin/password-reset-requests/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "approved" }),
    });
    const oldCode = (await approval.json()).resetCode;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const rejected = await fetch(`${baseUrl}/api/auth/password-reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "athlete@example.com",
                code: `wrong-code-${attempt}`,
                password: "valid-password-123",
            }),
        });
        assert.equal(rejected.status, 400);
    }

    const lockedCodeResponse = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            code: oldCode,
            password: "valid-password-123",
        }),
    });
    assert.equal(lockedCodeResponse.status, 400);
    assert.equal(storedPasswordResetRequests[0].failed_attempts, 5);
    assert.equal(storedPasswordResetRequests[0].reset_code_hash, null);

    const replacement = await fetch(`${baseUrl}/api/admin/password-reset-requests/1`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ status: "regenerate" }),
    });
    assert.equal(replacement.status, 200);
    const newCode = (await replacement.json()).resetCode;
    assert.notEqual(newCode, oldCode);
    assert.equal(storedPasswordResetRequests[0].failed_attempts, 0);

    const successfulReset = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "athlete@example.com",
            code: newCode,
            password: "new-valid-password-456",
        }),
    });
    assert.equal(successfulReset.status, 200);
    assert.ok(storedPasswordResetAudit.some((event) => event.event_type === "code_locked"));
    assert.ok(storedPasswordResetAudit.some((event) => event.event_type === "reset_completed"));
});
