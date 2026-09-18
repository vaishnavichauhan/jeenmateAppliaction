import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { getSocket } from '../services/socket';

export interface CallMetadata {
  isCall: boolean;
  status: 'unknown' | 'answered' | 'missed' | 'rejected';
  callType: 'incoming' | 'outgoing';
  mediaType: 'voice' | 'video';
  duration: number | null;
  whatsappCallId?: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: 'staff' | '';
  text: string;
  timestamp: string;
  whatsapp_timestamp?: number | null;
  status: 'sent' | 'delivered' | 'read' | 'pending' | 'failed';
  whatsapp_message_id?: string | null;
  message_type?: string;
  metadata?: CallMetadata | null;
}

export interface Conversation {
  id: string;
  phone_number: string;
  customer_name: string;
  unread_count: number;
  last_message: string;
  last_message_at: string;
  avatar?: string;
  status?: string;
  is_pinned?: boolean | number;
}

export type WhatsAppSyncStatus = 'idle' | 'initializing' | 'syncing' | 'ready' | 'error';

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: ChatMessage[];
  searchQuery: string;
  isLoading: boolean;
  isSending: boolean;
  isSyncing: boolean;
  syncStatus: WhatsAppSyncStatus;
  syncProgress: { total: number; completed: number } | null;
  whatsappStatus: 'online' | 'waiting' | 'offline';
  isSocketListening: boolean;
  hasMoreMessages: boolean;
  isLoadingOlder: boolean;

  clearMessages: () => void;
  resetChatState: () => Promise<void>;
  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  fetchOlderMessages: (conversationId: string) => Promise<number>;
  sendMessage: (conversationId: string, text: string) => Promise<boolean>;
  setActiveConversation: (conversation: Conversation | null) => void;
  setSearchQuery: (query: string) => void;
  setSyncStatus: (status: WhatsAppSyncStatus) => void;
  syncWhatsAppChats: () => Promise<{ success: boolean; message: string }>;
  setupSocketListeners: () => void;
}

const STORAGE_KEY_CONVS = '@jeenmate_conversations_cache_v2';

export const parseTime = (t?: string | number): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t > 1e11 ? t : t * 1000;
  const str = String(t).trim();
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    return num > 1e11 ? num : num * 1000;
  }
  const normalized = str.includes('T') || str.endsWith('Z')
    ? (str.endsWith('Z') ? str : `${str}Z`)
    : `${str.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d.getTime();
  const dRaw = new Date(str);
  return isNaN(dRaw.getTime()) ? 0 : dRaw.getTime();
};

export const getMessageTime = (m: ChatMessage): number => {
  if (m.whatsapp_timestamp && Number(m.whatsapp_timestamp) > 0) {
    return Number(m.whatsapp_timestamp);
  }
  return parseTime(m.timestamp);
};

export const sortMessages = (msgs: ChatMessage[]): ChatMessage[] => {
  return [...msgs].sort((a, b) => {
    const timeA = getMessageTime(a);
    const timeB = getMessageTime(b);
    if (timeA !== timeB) return timeA - timeB;
    const idA = typeof a.id === 'number' ? a.id : parseInt(String(a.id), 10) || 0;
    const idB = typeof b.id === 'number' ? b.id : parseInt(String(b.id), 10) || 0;
    return idA - idB;
  });
};

export const deduplicateConversations = (convs: Conversation[]): Conversation[] => {
  const byPhoneOrId = new Map<string, Conversation>();

  convs.forEach((c) => {
    const rawPhone = (c.phone_number || '').replace(/[^0-9]/g, '');
    const isGroup = (c.phone_number || '').startsWith('group-');
    const key = isGroup
      ? c.phone_number
      : (rawPhone.length >= 10 ? rawPhone.slice(-10) : (c.id || rawPhone));

    const existing = byPhoneOrId.get(key);
    if (!existing) {
      byPhoneOrId.set(key, c);
    } else {
      const existingTime = parseTime(existing.last_message_at);
      const currentTime = parseTime(c.last_message_at);
      if (currentTime >= existingTime) {
        byPhoneOrId.set(key, c);
      }
    }
  });

  return Array.from(byPhoneOrId.values());
};

export const sortConversations = (convs: Conversation[]): Conversation[] => {
  const uniqueConvs = deduplicateConversations(convs);
  return [...uniqueConvs].sort((a, b) => {
    const pinA = a.is_pinned ? 1 : 0;
    const pinB = b.is_pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    const timeA = parseTime(a.last_message_at);
    const timeB = parseTime(b.last_message_at);
    return timeB - timeA;
  });
};

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  searchQuery: '',
  isLoading: false,
  isSending: false,
  isSyncing: false,
  syncStatus: 'idle',
  syncProgress: null,
  whatsappStatus: 'online',
  isSocketListening: false,
  hasMoreMessages: true,
  isLoadingOlder: false,

  clearMessages: () => {
    set({ messages: [], isLoading: false });
  },

  resetChatState: async () => {
    set({
      conversations: [],
      activeConversation: null,
      messages: [],
      searchQuery: '',
      isLoading: false,
      isSending: false,
      isSyncing: false,
      syncStatus: 'idle',
      syncProgress: null,
      hasMoreMessages: true,
      isLoadingOlder: false,
    });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY_CONVS);
    } catch (e) {
      console.log('[ChatStore] Error clearing conversations cache:', e);
    }
  },

  setSyncStatus: (syncStatus: WhatsAppSyncStatus) => {
    set({ syncStatus });
  },

  fetchConversations: async () => {
    try {
      set({ isLoading: true });
      const res = await apiClient.get('/api/conversations');
      if (res.data && res.data.success) {
        const sorted = sortConversations(res.data.data);
        console.log(`[ChatStore] Conversations fetched: ${sorted.length} | syncStatus: ${get().syncStatus}`);
        set({ conversations: sorted, isLoading: false });
        await AsyncStorage.setItem(STORAGE_KEY_CONVS, JSON.stringify(sorted));
        return;
      }
    } catch (e) {
      console.log('[ChatStore] Loading cached conversations');
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_CONVS);
        if (cached) {
          const parsed = JSON.parse(cached).filter((c: any) => !c.id?.startsWith('conv_00'));
          set({ conversations: sortConversations(parsed) });
        }
      } catch (err) { }
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (conversationId: string) => {
    try {
      // Clear previous conversation messages immediately and show loader
      set({ isLoading: true, messages: [] });
      const res = await apiClient.get(`/api/conversations/${conversationId}/messages`, {
        params: { limit: 30 },
      });
      if (res.data && res.data.success) {
        const rawMsgs: ChatMessage[] = res.data.data || [];

        // Deduplicate messages by ID, whatsapp_message_id, and near-simultaneous staff messages
        const seenIds = new Set<string>();
        const seenWaIds = new Set<string>();
        const uniqueMsgs: ChatMessage[] = [];

        for (const m of rawMsgs) {
          if (!m.id) continue;
          if (seenIds.has(String(m.id))) continue;
          if (m.whatsapp_message_id && seenWaIds.has(m.whatsapp_message_id)) continue;

          // Check if this is an outgoing duplicate of an already added outgoing message with same text within 5 seconds
          if (m.sender === 'staff' && m.text) {
            const mTime = getMessageTime(m);
            const isDuplicateStaff = uniqueMsgs.some(
              (prev) =>
                prev.sender === 'staff' &&
                prev.text === m.text &&
                Math.abs(getMessageTime(prev) - mTime) < 5000
            );
            if (isDuplicateStaff) {
              continue;
            }
          }

          seenIds.add(String(m.id));
          if (m.whatsapp_message_id) seenWaIds.add(m.whatsapp_message_id);
          uniqueMsgs.push(m);
        }

        const sortedMsgs = sortMessages(uniqueMsgs);

        set({
          messages: sortedMsgs,
          hasMoreMessages: res.data.hasMore !== false,
          isLoading: false,
        });

        // Update conversation last_message and clear unread count in conversations list
        const lastM = sortedMsgs.length > 0 ? sortedMsgs[sortedMsgs.length - 1] : null;
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id === conversationId) {
              const updatedObj = res.data.conversation ? { ...c, ...res.data.conversation } : c;
              return {
                ...updatedObj,
                unread_count: 0,
                last_message: lastM ? (lastM.text || (lastM as any).message || updatedObj.last_message) : updatedObj.last_message,
                last_message_at: lastM ? (lastM.timestamp || updatedObj.last_message_at) : updatedObj.last_message_at,
              };
            }
            return c;
          }),
        }));

        // Join socket room
        const socket = getSocket();
        socket.emit('join_conversation', conversationId);
      }
    } catch (e) {
      console.log('[ChatStore] Message fetch failed');
      set({ messages: [], isLoading: false, hasMoreMessages: true });
    }
  },

  fetchOlderMessages: async (conversationId: string): Promise<number> => {
    const currentMessages = get().messages;
    if (currentMessages.length === 0 || get().isLoadingOlder) {
      return 0;
    }

    try {
      set({ isLoadingOlder: true });

      // Find the oldest message timestamp currently displayed
      const oldestMsg = currentMessages[0];
      const beforeTimestamp = oldestMsg?.whatsapp_timestamp || oldestMsg?.timestamp;

      const res = await apiClient.get(`/api/conversations/${conversationId}/messages`, {
        params: {
          before: beforeTimestamp,
          limit: 30,
        },
      });

      if (res.data && res.data.success) {
        const rawOlderMsgs: ChatMessage[] = res.data.data || [];
        const existingIds = new Set(currentMessages.map((m) => String(m.id)));
        const existingWaIds = new Set(
          currentMessages.filter((m) => m.whatsapp_message_id).map((m) => m.whatsapp_message_id!)
        );

        if (rawOlderMsgs.length === 0) {
          set({ hasMoreMessages: false, isLoadingOlder: false });
          return 0;
        }

        const newOlder = rawOlderMsgs.filter((m) => {
          if (!m.id) return false;
          if (existingIds.has(String(m.id))) return false;
          if (m.whatsapp_message_id && existingWaIds.has(m.whatsapp_message_id)) return false;
          if (m.sender === 'staff' && m.text) {
            const mTime = getMessageTime(m);
            const isDuplicateStaff = currentMessages.some(
              (prev) =>
                prev.sender === 'staff' &&
                prev.text === m.text &&
                Math.abs(getMessageTime(prev) - mTime) < 5000
            );
            if (isDuplicateStaff) return false;
          }
          return true;
        });

        if (newOlder.length === 0) {
          set({ hasMoreMessages: false, isLoadingOlder: false });
          return 0;
        }

        const sortedCombined = sortMessages([...newOlder, ...currentMessages]);

        set({
          messages: sortedCombined,
          hasMoreMessages: res.data.hasMore ?? true,
          isLoadingOlder: false,
        });

        return newOlder.length;
      }
    } catch (err) {
      console.log('[ChatStore] fetchOlderMessages failed:', err);
    } finally {
      set({ isLoadingOlder: false });
    }
    return 0;
  },

  sendMessage: async (conversationId: string, text: string) => {
    if (!text.trim()) return false;
    set({ isSending: true });

    const localMsgId = `msg_staff_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const optimisticMessage: ChatMessage = {
      id: localMsgId,
      conversation_id: conversationId,
      sender: 'staff',
      text: text.trim(),
      timestamp,
      whatsapp_timestamp: Date.now(),
      status: 'sent',
    };

    // Optimistic UI update — add message & push conversation to top of list
    set((state) => {
      const updatedMessages = sortMessages([...state.messages, optimisticMessage]);
      const updatedConvs = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, last_message: text.trim(), last_message_at: timestamp } : c
      );
      return {
        messages: updatedMessages,
        conversations: sortConversations(updatedConvs),
      };
    });

    try {
      const res = await apiClient.post(`/api/conversations/${conversationId}/messages`, {
        text: text.trim(),
      });

      if (res.data && res.data.success) {
        const saved = res.data.data;
        set((state) => ({
          messages: sortMessages(state.messages.map((m) => (m.id === localMsgId ? saved : m))),
        }));
      }
      return true;
    } catch (e) {
      console.warn('[ChatStore] Message sent locally (offline)');
      return true;
    } finally {
      set({ isSending: false });
    }
  },

  setActiveConversation: (conversation) => {
    set({ activeConversation: conversation });
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
  },

  syncWhatsAppChats: async () => {
    set({ isSyncing: true, syncStatus: 'syncing' });
    try {
      const res = await apiClient.post('/api/whatsapp/sync');
      await get().fetchConversations();
      return { success: true, message: res.data?.message || 'Chats synced successfully!' };
    } catch (err: any) {
      set({ syncStatus: 'error' });
      return { success: false, message: err.response?.data?.message || 'Sync failed: WhatsApp offline' };
    } finally {
      set({ isSyncing: false });
    }
  },

  setupSocketListeners: () => {
    if (get().isSocketListening) return;
    const socket = getSocket();

    // 1. WhatsApp Sync Status Listener
    socket.on('whatsapp_sync_status', (data: { userId?: number; status: WhatsAppSyncStatus; totalChats?: number; completed?: number }) => {
      if (data && data.status) {
        console.log(`[ChatStore:Socket] Sync status updated: ${data.status} (${data.completed || 0}/${data.totalChats || 0})`);
        set({
          syncStatus: data.status,
          syncProgress: data.totalChats ? { total: data.totalChats, completed: data.completed || 0 } : null,
        });
        if (data.status === 'ready') {
          get().fetchConversations();
        }
      }
    });

    // 2. New Message Listener
    socket.on('new_message', (payload: { conversationId: string; message: ChatMessage }) => {
      const { activeConversation, conversations } = get();
      const rawMsg = payload.message;
      if (!rawMsg) return;

      const msgText = rawMsg.text || (rawMsg as any).message || '';
      const msgTimestamp = rawMsg.timestamp || new Date().toISOString();
      const msgWaTime = getMessageTime(rawMsg);

      if (activeConversation && String(activeConversation.id) === String(payload.conversationId)) {
        set((state) => {
          // Check if message already exists by ID or whatsapp_message_id
          const existingIdx = state.messages.findIndex(
            (m) =>
              (rawMsg.id && String(m.id) === String(rawMsg.id)) ||
              (rawMsg.whatsapp_message_id &&
                m.whatsapp_message_id &&
                m.whatsapp_message_id === rawMsg.whatsapp_message_id) ||
              (rawMsg.sender === 'staff' &&
                String(m.id).startsWith('msg_staff_') &&
                (m.text === msgText || (m as any).message === msgText))
          );

          let updated: ChatMessage[];
          if (existingIdx >= 0) {
            // Replace existing or optimistic version
            updated = [...state.messages];
            updated[existingIdx] = rawMsg;
          } else {
            updated = [...state.messages, rawMsg];
          }

          return { messages: sortMessages(updated) };
        });
      }

      const existsInList = conversations.some((c) => String(c.id) === String(payload.conversationId));
      if (!existsInList) {
        get().fetchConversations();
        return;
      }

      // Update conversation list preview & increment unread if not currently viewing
      set((state) => {
        const updatedConvs = state.conversations.map((c) => {
          if (String(c.id) === String(payload.conversationId)) {
            const isCurrentChat = activeConversation && String(activeConversation.id) === String(payload.conversationId);
            const currentLastTime = parseTime(c.last_message_at);

            // Timestamp-aware: only update last_message if the new message is newer or equal
            const shouldUpdatePreview = msgWaTime >= currentLastTime || !c.last_message;

            return {
              ...c,
              last_message: shouldUpdatePreview ? msgText : c.last_message,
              last_message_at: shouldUpdatePreview ? msgTimestamp : c.last_message_at,
              unread_count: isCurrentChat ? 0 : (c.unread_count || 0) + (rawMsg.sender === 'staff' ? 0 : 1),
            };
          }
          return c;
        });
        return { conversations: sortConversations(updatedConvs) };
      });
    });

    // 3. Conversation Updated Listener (handles sync signals & individual conversation updates)
    socket.on('conversation_updated', (payload: any) => {
      if (!payload) return;

      // Handle batch sync update signals
      if (payload.synced || payload.priorityDone || payload.warmupComplete || payload.backgroundChunk) {
        console.log('[ChatStore:Socket] Received sync conversation update signal. Refreshing conversation list...');
        get().fetchConversations();
        return;
      }

      // Handle single conversation object update
      if (payload.id) {
        set((state) => {
          const exists = state.conversations.some((c) => String(c.id) === String(payload.id));
          let updatedList: Conversation[];
          if (exists) {
            updatedList = state.conversations.map((c) => (String(c.id) === String(payload.id) ? { ...c, ...payload } : c));
          } else {
            updatedList = [payload as Conversation, ...state.conversations];
          }
          return { conversations: sortConversations(updatedList) };
        });
      }
    });

    socket.on('whatsapp_status', (statusData: { status: 'online' | 'waiting' | 'offline' }) => {
      if (statusData?.status) {
        set({ whatsappStatus: statusData.status });
      }
    });

    set({ isSocketListening: true });
  },
}));
