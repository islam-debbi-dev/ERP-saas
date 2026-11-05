'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiConfigTestResult,
  AiProviderConfigDto,
  AiProviderConfigInput,
  AiTenantConfigResponse,
  AssistantConversationDetailDto,
  AssistantConversationPage,
  AssistantLink,
  AssistantStatusDto,
  AssistantStreamEvent,
  AssistantToolName,
  ErrorCode,
} from '@erp/shared';
import { api, ApiError } from './api-client';

/** The in-app assistant (phase 30). */
export const assistantKeys = {
  status: ['assistant', 'status'] as const,
  conversations: ['assistant', 'conversations'] as const,
  config: ['assistant', 'config'] as const,
};

export function useAssistantStatus(enabled: boolean) {
  return useQuery({
    queryKey: assistantKeys.status,
    queryFn: ({ signal }) => api.request<AssistantStatusDto>('/assistant/status', { signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useConversations(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: assistantKeys.conversations,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.request<AssistantConversationPage>(
        `/assistant/conversations?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.request<void>(`/assistant/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantKeys.conversations }),
  });
}

export function useTenantAiConfig() {
  return useQuery({
    queryKey: assistantKeys.config,
    queryFn: ({ signal }) => api.request<AiTenantConfigResponse>('/assistant/config', { signal }),
  });
}

export function saveTenantAiConfig(body: AiProviderConfigInput) {
  return api.request<AiProviderConfigDto>('/assistant/config', { method: 'PUT', body });
}

export function testTenantAiConfig(body: AiProviderConfigInput) {
  return api.request<AiConfigTestResult>('/assistant/config/test', { method: 'POST', body });
}

export interface ChatMessage {
  /** Local until the API gives the stored id. */
  key: string;
  id: string | null;
  role: 'USER' | 'ASSISTANT';
  content: string;
  links: AssistantLink[];
  useful: boolean | null;
  truncated: boolean;
}

export interface ChatFailure {
  code: ErrorCode | 'NETWORK' | 'INTERNAL_ERROR';
  /** The first day of next month, on a spent quota. */
  resetDate: string | null;
}

let localKey = 0;
const nextKey = () => `local-${(localKey += 1)}`;

function newMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { key: nextKey(), id: null, role, content, links: [], useful: null, truncated: false };
}

function failureOf(err: unknown): ChatFailure {
  if (!(err instanceof ApiError)) return { code: 'INTERNAL_ERROR', resetDate: null };
  const details = err.details as { resetDate?: string } | undefined;
  return { code: err.code as ChatFailure['code'], resetDate: details?.resetDate ?? null };
}

/** One conversation on screen: what was said, what is streaming, what went wrong. */
export function useAssistantChat() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<AssistantToolName | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  /** Changes the answer being written, always the last message. */
  const patchAnswer = useCallback((patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m, i) => (i === list.length - 1 ? patch(m) : m)));
  }, []);

  const apply = useCallback(
    (event: AssistantStreamEvent) => {
      switch (event.type) {
        case 'conversation':
          setConversationId(event.conversationId);
          break;
        case 'text':
          setTool(null);
          patchAnswer((m) => ({ ...m, content: m.content + event.delta }));
          break;
        case 'replace':
          setTool(null);
          patchAnswer((m) => ({ ...m, content: event.text }));
          break;
        case 'tool':
          setTool(event.name);
          break;
        case 'links':
          patchAnswer((m) => ({ ...m, links: event.links }));
          break;
        case 'done':
          patchAnswer((m) => ({ ...m, id: event.messageId, truncated: event.truncated }));
          break;
        case 'error':
          setFailure({ code: event.code, resetDate: null });
          break;
      }
    },
    [patchAnswer],
  );

  /** Resolves false when nothing came back, so the screen can give the question back. */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const abort = new AbortController();
      controller.current = abort;
      const isNew = conversationId === null;
      setFailure(null);
      setStreaming(true);
      setMessages((list) => [...list, newMessage('USER', text), newMessage('ASSISTANT', '')]);
      let failed = false;
      let answered = false;
      try {
        await api.stream(
          '/assistant/chat',
          {
            body: { message: text, ...(conversationId ? { conversationId } : {}) },
            signal: abort.signal,
          },
          (data) => {
            const event = JSON.parse(data) as AssistantStreamEvent;
            if (event.type === 'error') failed = true;
            if (event.type === 'text' || event.type === 'replace') answered = true;
            apply(event);
          },
        );
      } catch (err) {
        if (!abort.signal.aborted) {
          failed = true;
          setFailure(failureOf(err));
        }
      }
      setStreaming(false);
      setTool(null);
      void queryClient.invalidateQueries({ queryKey: assistantKeys.conversations });
      if (answered) return true;
      // No empty bubble. After a failure the API forgot the question, and a new
      // conversation with it; after a stop it kept them.
      setMessages((list) => list.slice(0, failed ? -2 : -1));
      if (failed && isNew) setConversationId(null);
      return !failed;
    },
    [apply, conversationId, queryClient],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setMessages([]);
    setConversationId(null);
    setFailure(null);
  }, []);

  const open = useCallback(async (id: string) => {
    controller.current?.abort();
    setFailure(null);
    try {
      const detail = await api.request<AssistantConversationDetailDto>(
        `/assistant/conversations/${id}`,
      );
      setConversationId(detail.id);
      setMessages(
        detail.messages.map((m) => ({
          key: m.id,
          id: m.id,
          role: m.role,
          content: m.content,
          links: m.links,
          useful: m.useful,
          truncated: false,
        })),
      );
    } catch (err) {
      setFailure(failureOf(err));
    }
  }, []);

  const rate = useCallback(async (messageId: string, useful: boolean) => {
    setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, useful } : m)));
    await api
      .request<void>(`/assistant/messages/${messageId}/feedback`, {
        method: 'POST',
        body: { useful },
      })
      .catch(() => undefined);
  }, []);

  return { messages, conversationId, streaming, tool, failure, send, stop, reset, open, rate };
}
