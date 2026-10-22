"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { getAccessToken } from "@/lib/authToken";
import {
  sendMessage as sendMessageApi,
  getConversationMessages,
  type Conversation,
  type Message,
} from "@/services/conversationService";

interface MessageThreadProps {
  conversation: Conversation;
  currentWallet: string;
  sessionToken?: string;
}

export default function MessageThread({
  conversation,
  currentWallet,
  sessionToken,
}: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>(conversation.messages || []);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reloadHistoryCount, setReloadHistoryCount] = useState(0);

  const [pendingMessage, setPendingMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const token = sessionToken || getAccessToken() || "";

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Fetch initial message history on conversation mount or ID change
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await getConversationMessages(conversation.id);
        if (active) {
          setMessages(response.messages);
          setNextCursor(response.nextCursor);
          setHistoryError(null);
        }
      } catch (err) {
        if (active) {
          setHistoryError(err instanceof Error ? err.message : "Failed to load messages");
        }
      } finally {
        if (active) {
          setLoadingHistory(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [conversation.id, reloadHistoryCount]);

  const retryHistory = useCallback(() => {
    setLoadingHistory(true);
    setReloadHistoryCount((c) => c + 1);
  }, []);

  // Scroll to bottom when messages initially load or after a new send
  useEffect(() => {
    if (!loadingHistory && !loadingOlder) {
      scrollToBottom();
    }
  }, [messages.length, loadingHistory, loadingOlder, scrollToBottom]);

  // Handle loading older messages with cursor pagination
  const handleLoadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const response = await getConversationMessages(conversation.id, {
        cursor: nextCursor,
      });
      setMessages((prev) => [...response.messages, ...prev]);
      setNextCursor(response.nextCursor);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleWebSocketMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "message.received") {
        const newMessage = msg.payload as Message;
        if (
          newMessage &&
          typeof newMessage === "object" &&
          "conversationId" in newMessage &&
          newMessage.conversationId === conversation.id
        ) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });
        }
      }
    },
    [conversation.id],
  );

  const socketOptions = useMemo(() => ({ token }), [token]);
  useWebSocket(handleWebSocketMessage, socketOptions);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingMessage.trim()) return;

    const messageContent = pendingMessage;
    setPendingMessage("");
    setSending(true);
    setSendError(null);

    try {
      const newMessage = await sendMessageApi(conversation.id, messageContent);
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });
      scrollToBottom();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send message");
      setPendingMessage(messageContent);
    } finally {
      setSending(false);
    }
  };

  const otherParticipant =
    currentWallet.toLowerCase() === conversation.investorAddress.toLowerCase()
      ? conversation.farmerAddress
      : conversation.investorAddress;

  return (
    <div className="flex flex-col h-full bg-background" data-testid="message-thread">
      {/* Header */}
      <div className="border-b border-border p-4 bg-surface">
        <p className="text-sm text-muted truncate">
          Chat with: <span className="font-semibold text-foreground">{otherParticipant}</span>
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="messages-container">
        {nextCursor && (
          <div className="flex justify-center pb-2">
            <button
              onClick={() => void handleLoadOlder()}
              disabled={loadingOlder}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {loadingOlder ? "Loading older messages..." : "Load older messages"}
            </button>
          </div>
        )}

        {loadingHistory ? (
          <div className="flex items-center justify-center h-full text-muted" role="status">
            <div className="animate-spin rounded-full h-6 w-6 border border-primary border-t-transparent mr-2" />
            <p className="text-sm">Loading message history...</p>
          </div>
        ) : historyError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <p className="text-sm text-error mb-2">{historyError}</p>
            <button
              onClick={retryHistory}
              className="text-xs px-3 py-1 bg-surface border border-border rounded hover:bg-muted"
            >
              Retry loading history
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p className="text-center">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine =
              msg.senderAddress.toLowerCase() === currentWallet.toLowerCase();
            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xs px-3 py-2 rounded-lg ${
                    isMine
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface border border-border text-foreground"
                  }`}
                >
                  <p className="text-sm break-words">{msg.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSendMessage}
        className="border-t border-border p-4 bg-surface space-y-2"
      >
        {sendError && <p className="text-sm text-error">{sendError}</p>}
        <div className="flex gap-2">
          <input
            type="text"
            value={pendingMessage}
            onChange={(e) => setPendingMessage(e.target.value)}
            placeholder="Type a message..."
            disabled={sending}
            maxLength={5000}
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !pendingMessage.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        <p className="text-xs text-muted text-right">
          {pendingMessage.length}/5000
        </p>
      </form>
    </div>
  );
}
