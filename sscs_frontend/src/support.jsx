import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDate } from "./api";
import { useAuth } from "./auth";
import { ErrorNotice, Loading } from "./components";

function SupportMessageList({ messages, currentUserId, listRef }) {
    return <div className="support-message-list" aria-live="polite" ref={listRef}>
        {messages.map((message) => {
            const ownMessage = String(message.sender_id) === String(currentUserId);
            return <article className={`support-message${ownMessage ? " is-own" : ""}`} key={message.id}>
                <div className="support-message-meta">
                    <strong>{ownMessage ? "You" : message.sender_role === "admin" ? "SSCS Support" : message.sender_username}</strong>
                    <time dateTime={message.sent_at}>{formatDate(message.sent_at)}</time>
                </div>
                <p>{message.body}</p>
            </article>;
        })}
    </div>;
}

function SupportComposer({ onSend, sending }) {
    const [body, setBody] = useState("");

    async function submit(event) {
        event.preventDefault();
        const message = body.trim();
        if (!message) return;
        if (await onSend(message)) setBody("");
    }

    return <form className="support-composer" onSubmit={submit}>
        <label htmlFor="support-message">Message</label>
        <textarea
            id="support-message"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="Write a message to SSCS support…"
            required
        />
        <div className="support-composer-footer">
            <small>{body.length}/5000</small>
            <button className="button" type="submit" disabled={sending || !body.trim()}>
                {sending ? "Sending…" : "Send message"}
            </button>
        </div>
    </form>;
}

export function SupportInboxPage() {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [status, setStatus] = useState("open");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const messageListRef = useRef(null);
    const shouldScrollMessagesRef = useRef(false);

    const loadMessages = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const result = await api("/support/messages");
            const messageList = messageListRef.current;
            if (!messageList
                || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 48) {
                shouldScrollMessagesRef.current = true;
            }
            setMessages(result.messages);
            setStatus(result.status);
            setError("");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadMessages(true);
        const interval = window.setInterval(() => void loadMessages(), 10000);
        return () => window.clearInterval(interval);
    }, [loadMessages]);

    useEffect(() => {
        const messageList = messageListRef.current;
        if (messageList && shouldScrollMessagesRef.current) {
            messageList.scrollTop = messageList.scrollHeight;
            shouldScrollMessagesRef.current = false;
        }
    }, [messages]);

    async function sendMessage(body) {
        setSending(true);
        setError("");
        try {
            const { message } = await api("/support/messages", { method: "POST", body: { body } });
            shouldScrollMessagesRef.current = true;
            setMessages((current) => [...current, message]);
            setStatus("open");
            window.dispatchEvent(new Event("sscs:refresh-admin-alerts"));
        } catch (requestError) {
            setError(requestError.message);
            return false;
        } finally {
            setSending(false);
        }
        return true;
    }

    return <section className="support-inbox-page">
        <header className="support-page-heading">
            <p className="eyebrow">SSCS SUPPORT</p>
            <h1>Contact the administrator</h1>
            <p>Send a private message to the SSCS administration team. Your conversation stays in your account.</p>
        </header>
        <ErrorNotice error={error} />
        <section className="support-chat-panel" aria-label="Support conversation">
            <div className="support-chat-heading">
                <div><strong>Administrator support</strong><small>Private conversation · {user?.role === "scout" ? "Scout / Agency" : user?.role}</small></div>
                <span className={`support-status is-${status}`}>{status === "resolved" ? "Resolved" : "Open"}</span>
            </div>
            {loading ? <Loading label="Loading support conversation…" /> : messages.length
                ? <SupportMessageList messages={messages} currentUserId={user.id} listRef={messageListRef} />
                : error ? null : <div className="support-empty-state">
                    <strong>How can we help?</strong>
                    <p>Send a message to start a conversation with the SSCS administrator.</p>
                </div>}
            <SupportComposer onSend={sendMessage} sending={sending} />
        </section>
    </section>;
}

export function AdminSupportInbox() {
    const { user } = useAuth();
    const [conversations, setConversations] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState("");
    const [messages, setMessages] = useState([]);
    const [status, setStatus] = useState("open");
    const [loading, setLoading] = useState(true);
    const [threadLoading, setThreadLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const messageListRef = useRef(null);
    const shouldScrollMessagesRef = useRef(false);
    const selectedUserIdRef = useRef("");
    const threadRequestIdRef = useRef(0);

    const selectConversation = useCallback((userId) => {
        const nextUserId = userId ? String(userId) : "";
        if (selectedUserIdRef.current !== nextUserId) {
            selectedUserIdRef.current = nextUserId;
            threadRequestIdRef.current += 1;
            setMessages([]);
            setStatus("open");
            setThreadLoading(Boolean(nextUserId));
            shouldScrollMessagesRef.current = true;
        }
        setSelectedUserId(nextUserId);
    }, []);

    const loadConversations = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const result = await api("/admin/support/conversations");
            setConversations(result.conversations);
            setError("");
            const currentUserId = selectedUserIdRef.current;
            const nextUserId = (
                currentUserId && result.conversations.some((conversation) => String(conversation.user_id) === currentUserId)
                    ? currentUserId
                    : result.conversations[0] ? String(result.conversations[0].user_id) : ""
            );
            selectConversation(nextUserId);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, [selectConversation]);

    const loadThread = useCallback(async (userId, showLoading = false, forceScroll = false) => {
        if (!userId) return;
        const requestedUserId = String(userId);
        if (selectedUserIdRef.current !== requestedUserId) return;
        const requestId = ++threadRequestIdRef.current;
        if (showLoading) setThreadLoading(true);
        try {
            const result = await api(`/admin/support/conversations/${userId}/messages`);
            if (requestId !== threadRequestIdRef.current
                || selectedUserIdRef.current !== requestedUserId) return;
            const messageList = messageListRef.current;
            if (forceScroll || !messageList
                || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 48) {
                shouldScrollMessagesRef.current = true;
            }
            setMessages(result.messages);
            setStatus(result.status);
            setConversations((current) => current.map((conversation) => (
                String(conversation.user_id) === requestedUserId
                    ? { ...conversation, unread_count: 0 }
                    : conversation
            )));
        } catch (requestError) {
            if (requestId === threadRequestIdRef.current
                && selectedUserIdRef.current === requestedUserId) {
                setError(requestError.message);
            }
        } finally {
            if (requestId === threadRequestIdRef.current
                && selectedUserIdRef.current === requestedUserId) {
                setThreadLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        void loadConversations(true);
        const interval = window.setInterval(() => void loadConversations(), 15000);
        return () => window.clearInterval(interval);
    }, [loadConversations]);

    useEffect(() => {
        if (!selectedUserId) {
            setMessages([]);
            setThreadLoading(false);
            return undefined;
        }
        void loadThread(selectedUserId, true);
        const interval = window.setInterval(() => void loadThread(selectedUserId), 10000);
        return () => {
            window.clearInterval(interval);
            if (selectedUserIdRef.current === selectedUserId) {
                threadRequestIdRef.current += 1;
            }
        };
    }, [loadThread, selectedUserId]);

    useEffect(() => {
        const messageList = messageListRef.current;
        if (messageList && shouldScrollMessagesRef.current) {
            messageList.scrollTop = messageList.scrollHeight;
            shouldScrollMessagesRef.current = false;
        }
    }, [messages]);

    async function sendReply(body) {
        if (!selectedUserId) return;
        setSending(true);
        setError("");
        try {
            await api(`/admin/support/conversations/${selectedUserId}/messages`, {
                method: "POST",
                body: { body },
            });
            await Promise.all([loadThread(selectedUserId, false, true), loadConversations()]);
        } catch (requestError) {
            setError(requestError.message);
            return false;
        } finally {
            setSending(false);
        }
        return true;
    }

    async function updateStatus(nextStatus) {
        if (!selectedUserId) return;
        const requestedUserId = selectedUserId;
        setError("");
        try {
            const result = await api(`/admin/support/conversations/${requestedUserId}`, {
                method: "PATCH",
                body: { status: nextStatus },
            });
            setConversations((current) => current.map((conversation) => (
                String(conversation.user_id) === requestedUserId
                    ? { ...conversation, status: result.conversation.status }
                    : conversation
            )));
            if (selectedUserIdRef.current === requestedUserId) {
                setStatus(result.conversation.status);
            }
            await loadConversations();
        } catch (requestError) {
            if (selectedUserIdRef.current === requestedUserId) {
                setError(requestError.message);
            }
        }
    }

    const selected = conversations.find((conversation) => String(conversation.user_id) === selectedUserId);

    return <section className="admin-users admin-directory admin-support-inbox" id="support-inbox">
        <div className="admin-directory-heading">
            <div><p className="admin-kicker"><span /> USER CARE</p><h2>Support messages</h2><p>Private conversations from athletes and Scout/Agency accounts.</p></div>
            <div className="admin-record-count"><strong>{error && conversations.length === 0 ? "—" : conversations.length.toString().padStart(2, "0")}</strong><span>SUPPORT<br />THREADS</span></div>
        </div>
        <ErrorNotice error={error} />
        {loading ? <Loading label="Loading support inbox…" /> : <div className="admin-support-layout">
            <nav className="admin-support-conversations" aria-label="Support conversations">
                {conversations.map((conversation) => <button
                    className={`admin-support-conversation${String(conversation.user_id) === selectedUserId ? " is-selected" : ""}`}
                    type="button"
                    key={conversation.user_id}
                    onClick={() => selectConversation(conversation.user_id)}
                >
                    <span className="admin-support-conversation-top"><strong>{conversation.display_name}</strong>{conversation.unread_count > 0 && <span className="support-unread-count">{conversation.unread_count}</span>}</span>
                    <span className="admin-support-role">{conversation.role === "scout" ? "Scout / Agency" : conversation.role} · {conversation.username}</span>
                    <span className="admin-support-preview">{conversation.latest_message || "No messages yet"}</span>
                    <span className="admin-support-conversation-bottom"><time>{conversation.latest_message_at ? formatDate(conversation.latest_message_at) : formatDate(conversation.created_at)}</time><span className={`support-status is-${conversation.status}`}>{conversation.status}</span></span>
                </button>)}
                {!conversations.length && !error && <div className="support-empty-state"><strong>No support conversations yet</strong><p>New messages from users will appear here.</p></div>}
            </nav>
            <div className="admin-support-thread">
                {selected ? <>
                    <div className="support-chat-heading">
                        <div><strong>{selected.display_name}</strong><small>{selected.role === "scout" ? "Scout / Agency" : selected.role} · @{selected.username}</small></div>
                        <button className="button button-outline button-compact" type="button" onClick={() => updateStatus(status === "resolved" ? "open" : "resolved")}>
                            {status === "resolved" ? "Reopen" : "Mark resolved"}
                        </button>
                    </div>
                    {threadLoading ? <Loading label="Loading conversation…" /> : messages.length
                        ? <SupportMessageList messages={messages} currentUserId={user?.id} listRef={messageListRef} />
                        : error ? null : <div className="support-empty-state"><strong>No messages in this conversation</strong></div>}
                    <SupportComposer onSend={sendReply} sending={sending} />
                </> : <div className="support-empty-state"><strong>Select a conversation</strong><p>Choose a user from the support inbox to view and reply.</p></div>}
            </div>
        </div>}
    </section>;
}
