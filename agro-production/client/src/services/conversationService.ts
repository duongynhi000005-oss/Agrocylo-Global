"use client";

import api, { ApiError } from "@/lib/apiClient";

export interface Message {
  id: string;
  conversationId: string;
  senderAddress: string;
  content: string;
  isRead?: boolean;
  createdAt: string;
  deletedAt?: string | null;
}

export interface Conversation {
  id: string;
  campaignId: string;
  investorAddress: string;
  farmerAddress: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export interface MessageListResponse {
  messages: Message[];
  nextCursor?: string;
}

/**
 * Fetch the conversation associated with a specific campaign for the authenticated user.
 * Server endpoint: GET /campaigns/:campaignId/conversation
 */
export async function getCampaignConversation(
  campaignId: string,
): Promise<Conversation | null> {
  return api.get<Conversation | null>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
  );
}

/**
 * Initiate/create a campaign conversation.
 * Server endpoint: POST /campaigns/:campaignId/conversation
 */
export async function createCampaignConversation(
  campaignId: string,
): Promise<Conversation> {
  return api.post<Conversation>(
    `/campaigns/${encodeURIComponent(campaignId)}/conversation`,
  );
}

/**
 * Fetch paginated message history for a conversation.
 * Server endpoint: GET /conversations/:id/messages?cursor=...&limit=...
 */
export async function getConversationMessages(
  conversationId: string,
  params?: { cursor?: string; limit?: number },
): Promise<MessageListResponse> {
  const query = new URLSearchParams();
  if (params?.cursor) {
    query.set("cursor", params.cursor);
  }
  if (params?.limit) {
    query.set("limit", String(params.limit));
  }
  const qs = query.toString() ? `?${query.toString()}` : "";
  return api.get<MessageListResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${qs}`,
  );
}

/**
 * Send a message within a conversation.
 * Server endpoint: POST /conversations/:id/messages
 */
export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<Message> {
  return api.post<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content },
  );
}

// Backward-compatible stubs for legacy callers
export async function getConversations(): Promise<Conversation[]> {
  throw new ApiError(404, "Endpoint GET /conversations does not exist on server. Use getCampaignConversation.");
}

export async function getConversation(): Promise<Conversation> {
  throw new ApiError(404, "Endpoint GET /conversations/:id does not exist on server. Use getCampaignConversation.");
}

export async function createOrGetConversation(
  campaignId: string,
): Promise<Conversation> {
  return createCampaignConversation(campaignId);
}
