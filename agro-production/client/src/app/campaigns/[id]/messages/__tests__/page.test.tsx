import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MessagesPage from "../page";
import { setAccessToken } from "@/lib/authToken";
import { loadWalletSession } from "@/lib/walletSession";
import { ApiError } from "@/lib/apiClient";
import * as conversationService from "@/services/conversationService";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "campaign-test-123" }),
}));

vi.mock("@/lib/walletSession", () => ({
  loadWalletSession: vi.fn(),
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}));

const mockConversation: conversationService.Conversation = {
  id: "conv-100",
  campaignId: "campaign-test-123",
  farmerAddress: "GFARMER111111111111111111111111111111111111111111111111111",
  investorAddress: "GINVESTOR22222222222222222222222222222222222222222222222222",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockMessages: conversationService.Message[] = [
  {
    id: "msg-1",
    conversationId: "conv-100",
    senderAddress: "GFARMER111111111111111111111111111111111111111111111111111",
    content: "Welcome to the campaign updates!",
    createdAt: new Date("2026-10-20T10:00:00Z").toISOString(),
  },
  {
    id: "msg-2",
    conversationId: "conv-100",
    senderAddress: "GINVESTOR22222222222222222222222222222222222222222222222222",
    content: "Thank you! Excited for this harvest.",
    createdAt: new Date("2026-10-20T10:05:00Z").toISOString(),
  },
];

describe("Campaign Messages Page (#1256)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccessToken(null);
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("renders connect wallet message when no session or token is available", () => {
    render(<MessagesPage />);
    expect(
      screen.getByText(/please connect your wallet to view messages/i),
    ).toBeInTheDocument();
  });

  it("opens without infinite spinner and renders empty state when no conversation exists", async () => {
    setAccessToken("valid-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GINVESTOR22222222222222222222222222222222222222222222222222",
      connectedAt: Date.now(),
    });

    const getSpy = vi
      .spyOn(conversationService, "getCampaignConversation")
      .mockResolvedValueOnce(null);

    render(<MessagesPage />);

    // Shows loading initially
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Resolves to empty state, no infinite spinner
    await waitFor(() => {
      expect(screen.getByText(/no conversation yet/i)).toBeInTheDocument();
    });

    expect(getSpy).toHaveBeenCalledWith("campaign-test-123");
    expect(
      screen.getByRole("button", { name: /start conversation/i }),
    ).toBeInTheDocument();
  });

  it("allows starting a conversation from the empty state", async () => {
    setAccessToken("valid-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GINVESTOR22222222222222222222222222222222222222222222222222",
      connectedAt: Date.now(),
    });

    vi.spyOn(conversationService, "getCampaignConversation").mockResolvedValueOnce(null);
    const createSpy = vi
      .spyOn(conversationService, "createCampaignConversation")
      .mockResolvedValueOnce(mockConversation);
    vi.spyOn(conversationService, "getConversationMessages").mockResolvedValueOnce({
      messages: [],
    });

    render(<MessagesPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /start conversation/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /start conversation/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("campaign-test-123");
      expect(screen.getByTestId("message-thread")).toBeInTheDocument();
    });
  });

  it("loads message history and allows sending a message", async () => {
    setAccessToken("valid-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GINVESTOR22222222222222222222222222222222222222222222222222",
      connectedAt: Date.now(),
    });

    vi.spyOn(conversationService, "getCampaignConversation").mockResolvedValueOnce(
      mockConversation,
    );
    const historySpy = vi
      .spyOn(conversationService, "getConversationMessages")
      .mockResolvedValueOnce({
        messages: mockMessages,
        nextCursor: "msg-older-cursor",
      });
    const sendSpy = vi.spyOn(conversationService, "sendMessage").mockResolvedValueOnce({
      id: "msg-3",
      conversationId: "conv-100",
      senderAddress: "GINVESTOR22222222222222222222222222222222222222222222222222",
      content: "Can we get an update on irrigation?",
      createdAt: new Date().toISOString(),
    });

    render(<MessagesPage />);

    // Verifies conversation loads and history endpoint is called
    await waitFor(() => {
      expect(screen.getByText("Welcome to the campaign updates!")).toBeInTheDocument();
      expect(screen.getByText("Thank you! Excited for this harvest.")).toBeInTheDocument();
    });

    expect(historySpy).toHaveBeenCalledWith("conv-100");

    // Cursor pagination button is present
    expect(screen.getByText(/load older messages/i)).toBeInTheDocument();

    // Type and send a new message
    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    fireEvent.change(input, { target: { value: "Can we get an update on irrigation?" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith("conv-100", "Can we get an update on irrigation?");
      expect(
        screen.getByText("Can we get an update on irrigation?"),
      ).toBeInTheDocument();
    });
  });

  it("renders distinct 401 Session Expired state with retry button", async () => {
    setAccessToken("expired-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GINVESTOR22222222222222222222222222222222222222222222222222",
      connectedAt: Date.now(),
    });

    vi.spyOn(conversationService, "getCampaignConversation").mockRejectedValueOnce(
      new ApiError(401, "Unauthorized"),
    );

    render(<MessagesPage />);

    await waitFor(() => {
      expect(screen.getByText("Session Expired")).toBeInTheDocument();
      expect(
        screen.getByText(/your session has expired\. please reconnect your wallet\./i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("renders distinct 403 Forbidden state with retry button", async () => {
    setAccessToken("valid-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GSTRANGER333333333333333333333333333333333333333333333333333",
      connectedAt: Date.now(),
    });

    vi.spyOn(conversationService, "getCampaignConversation").mockRejectedValueOnce(
      new ApiError(403, "Forbidden", {
        detail: "Only farmer or investors can access campaign conversations",
      }),
    );

    render(<MessagesPage />);

    await waitFor(() => {
      expect(screen.getByText("Access Forbidden")).toBeInTheDocument();
      expect(
        screen.getByText(/only farmer or investors can access campaign conversations/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("renders retryable error state on unexpected failure and retries", async () => {
    setAccessToken("valid-jwt-token");
    (loadWalletSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      address: "GINVESTOR22222222222222222222222222222222222222222222222222",
      connectedAt: Date.now(),
    });

    const getSpy = vi
      .spyOn(conversationService, "getCampaignConversation")
      .mockRejectedValueOnce(new Error("Network connection dropped"))
      .mockResolvedValueOnce(mockConversation);

    vi.spyOn(conversationService, "getConversationMessages").mockResolvedValueOnce({
      messages: [],
    });

    render(<MessagesPage />);

    await waitFor(() => {
      expect(screen.getByText("Error Loading Conversation")).toBeInTheDocument();
      expect(screen.getByText(/network connection dropped/i)).toBeInTheDocument();
    });

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("message-thread")).toBeInTheDocument();
    });
  });
});
