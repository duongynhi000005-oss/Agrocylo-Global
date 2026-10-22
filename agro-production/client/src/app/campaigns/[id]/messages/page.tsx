"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { loadWalletSession } from "@/lib/walletSession";
import { getAccessToken } from "@/lib/authToken";
import { isApiError } from "@/lib/apiClient";
import {
  getCampaignConversation,
  createCampaignConversation,
  type Conversation,
} from "@/services/conversationService";
import MessageThread from "@/components/MessageThread";

type PageState =
  | { kind: "unauthenticated" }
  | { kind: "loading" }
  | { kind: "unauthorized"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; conversation: Conversation };

export default function MessagesPage() {
  const params = useParams();
  const campaignId = (params?.id as string) || "";

  const session = useMemo(() => loadWalletSession(), []);
  const token = useMemo(() => getAccessToken(), []);

  const [reloadCount, setReloadCount] = useState(0);
  const [startingConversation, setStartingConversation] = useState(false);
  const [createdConversation, setCreatedConversation] = useState<Conversation | null>(null);

  const initialKind = !session?.address || !token ? "unauthenticated" : "loading";
  const [state, setState] = useState<PageState>({ kind: initialKind });

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setReloadCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!session?.address || !token || !campaignId) {
      return;
    }

    let active = true;

    async function fetchData() {
      try {
        const data = await getCampaignConversation(campaignId);
        if (!active) return;
        if (data) {
          setState({ kind: "ready", conversation: data });
        } else {
          setState({ kind: "empty" });
        }
      } catch (err) {
        if (!active) return;
        if (isApiError(err)) {
          if (err.status === 401) {
            setState({
              kind: "unauthorized",
              message: "Your session has expired. Please reconnect your wallet.",
            });
          } else if (err.status === 403) {
            setState({
              kind: "forbidden",
              message:
                (err.body as { detail?: string })?.detail ||
                "Only the campaign farmer and investors can access campaign conversations.",
            });
          } else {
            setState({
              kind: "error",
              message: err.message || "Failed to load conversation",
            });
          }
        } else {
          setState({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to load conversation",
          });
        }
      }
    }

    void fetchData();

    return () => {
      active = false;
    };
  }, [campaignId, session?.address, token, reloadCount]);

  const handleStartConversation = async () => {
    if (!campaignId) return;
    setStartingConversation(true);
    try {
      const newConversation = await createCampaignConversation(campaignId);
      setCreatedConversation(newConversation);
      setState({ kind: "ready", conversation: newConversation });
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) {
          setState({
            kind: "unauthorized",
            message: "Your session has expired. Please reconnect your wallet.",
          });
        } else if (err.status === 403) {
          setState({
            kind: "forbidden",
            message:
              (err.body as { detail?: string })?.detail ||
              "Only campaign investors can initiate conversations with the farmer.",
          });
        } else {
          setState({
            kind: "error",
            message:
              (err.body as { detail?: string })?.detail ||
              err.message ||
              "Failed to start conversation.",
          });
        }
      } else {
        setState({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Failed to start conversation.",
        });
      }
    } finally {
      setStartingConversation(false);
    }
  };

  // State 1: Unauthenticated
  if (state.kind === "unauthenticated" || !session?.address || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted">Please connect your wallet to view messages.</p>
      </div>
    );
  }

  // State 2: Loading
  if (state.kind === "loading") {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen"
        role="status"
        aria-live="polite"
      >
        <div className="animate-spin rounded-full h-8 w-8 border border-primary border-t-transparent mb-2" />
        <p className="text-sm text-muted">Loading conversation...</p>
      </div>
    );
  }

  // State 3: Expired Session / 401
  if (state.kind === "unauthorized") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md p-6 bg-surface border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-error mb-2">Session Expired</h3>
          <p className="text-muted text-sm mb-4">{state.message}</p>
          <button
            onClick={retry}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // State 4: Forbidden / 403
  if (state.kind === "forbidden") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md p-6 bg-surface border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-error mb-2">Access Forbidden</h3>
          <p className="text-muted text-sm mb-4">{state.message}</p>
          <button
            onClick={retry}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // State 5: Generic Error with Retry
  if (state.kind === "error") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md p-6 bg-surface border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold text-error mb-2">Error Loading Conversation</h3>
          <p className="text-muted text-sm mb-4">{state.message}</p>
          <button
            onClick={retry}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // State 6: Empty state (No conversation yet)
  if (state.kind === "empty" && !createdConversation) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md p-6 bg-surface border border-border rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold mb-2">No Conversation Yet</h3>
          <p className="text-muted text-sm mb-4">
            There is no active conversation for this campaign. Investors can start one below.
          </p>
          <button
            onClick={() => void handleStartConversation()}
            disabled={startingConversation}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {startingConversation ? "Starting..." : "Start Conversation"}
          </button>
        </div>
      </div>
    );
  }

  // State 7: Active conversation
  const activeConversation = createdConversation || (state.kind === "ready" ? state.conversation : null);
  if (!activeConversation) return null;

  return (
    <div className="h-screen bg-background">
      <MessageThread
        conversation={activeConversation}
        currentWallet={session.address}
        sessionToken={token}
      />
    </div>
  );
}
