import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { getSocket } from '../services/socket';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: 'staff' | 'customer';
  text: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  whatsapp_message_id?: string | null;
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

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: ChatMessage[];
  searchQuery: string;
  isLoading: boolean;
  isSending: boolean;
  isSyncing: boolean;
  whatsappStatus: 'online' | 'waiting' | 'offline';
  isSocketListening: boolean;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => Promise<boolean>;
  setActiveConversation: (conversation: Conversation | null) => void;
  setSearchQuery: (query: string) => void;
  syncWhatsAppChats: () => Promise<{ success: boolean; message: string }>;
  setupSocketListeners: () => void;
}

const STORAGE_KEY_CONVS = '@jeenmate_conversations_cache_v2';

const parseTime = (t?: string) => {
  if (!t) return 0;
  const str = !t.includes('T') && !t.endsWith('Z') ? `${t.replace(' ', 'T')}Z` : t;
  const d = new Date(str);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

export const sortConversations = (convs: Conversation[]): Conversation[] => {
  return [...convs].sort((a, b) => {
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
  whatsappStatus: 'online',
  isSocketListening: false,

  fetchConversations: async () => {
    try {
      set({ isLoading: true });
      const res = await apiClient.get('/api/conversations');
      if (res.data && res.data.success) {
        const sorted = sortConversations(res.data.data);
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
      } catch (err) {}
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (conversationId: string) => {
    try {
      set({ isLoading: true });
      const res = await apiClient.get(`/api/conversations/${conversationId}/messages`);
      if (res.data && res.data.success) {
        const rawMsgs: ChatMessage[] = res.data.data || [];
        const sortedMsgs = [...rawMsgs].sort((a, b) => {
          const timeA = parseTime(a.timestamp);
          const timeB = parseTime(b.timestamp);
          return timeA - timeB;
        });

        set({
          messages: sortedMsgs,
          isLoading: false,
        });

        // Clear unread count locally for this conversation
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, unread_count: 0 } : c
          ),
        }));

        // Join socket room
        const socket = getSocket();
        socket.emit('join_conversation', conversationId);
      }
    } catch (e) {
      console.log('[ChatStore] Message fetch failed');
      set({ messages: [], isLoading: false });
    }
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
      status: 'sent',
    };

    // Optimistic UI update — add message & push conversation to top of list
    set((state) => {
      const updatedMessages = [...state.messages, optimisticMessage];
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
          messages: state.messages.map((m) => (m.id === localMsgId ? saved : m)),
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
    set({ isSyncing: true });
    try {
      const res = await apiClient.post('/api/whatsapp/sync');
      await get().fetchConversations();
      return { success: true, message: res.data?.message || 'Chats synced successfully!' };
    } catch (err: any) {
      return { success: false, message: err.response?.data?.message || 'Sync failed: WhatsApp offline' };
    } finally {
      set({ isSyncing: false });
    }
  },

  setupSocketListeners: () => {
    if (get().isSocketListening) return;
    const socket = getSocket();

    socket.on('new_message', (payload: { conversationId: string; message: ChatMessage }) => {
      const { activeConversation, conversations } = get();

      // Skip outgoing (staff-sent) messages — already shown optimistically via sendMessage().
      if (payload.message.sender === 'staff') return;

      if (activeConversation && activeConversation.id === payload.conversationId) {
        set((state) => {
          const exists = state.messages.some((m) => m.id === payload.message.id);
          if (exists) return state;
          const updated = [...state.messages, payload.message].sort((a, b) => {
            return parseTime(a.timestamp) - parseTime(b.timestamp);
          });
          return { messages: updated };
        });
      }

      const existsInList = conversations.some((c) => c.id === payload.conversationId);
      if (!existsInList) {
        get().fetchConversations();
        return;
      }

      // Update conversation list preview & increment unread if not open
      set((state) => {
        const updatedConvs = state.conversations.map((c) => {
          if (c.id === payload.conversationId) {
            const isCurrentChat = activeConversation?.id === payload.conversationId;
            return {
              ...c,
              last_message: payload.message.text,
              last_message_at: payload.message.timestamp,
              unread_count: isCurrentChat ? 0 : c.unread_count + 1,
            };
          }
          return c;
        });
        return { conversations: sortConversations(updatedConvs) };
      });
    });

    socket.on('conversation_updated', (updatedConv: Conversation) => {
      set((state) => {
        const exists = state.conversations.some((c) => c.id === updatedConv.id);
        let updatedList: Conversation[];
        if (exists) {
          updatedList = state.conversations.map((c) => (c.id === updatedConv.id ? updatedConv : c));
        } else {
          updatedList = [updatedConv, ...state.conversations];
        }
        return { conversations: sortConversations(updatedList) };
      });
    });

    socket.on('whatsapp_status', (statusData: { status: 'online' | 'waiting' | 'offline' }) => {
      if (statusData?.status) {
        set({ whatsappStatus: statusData.status });
      }
    });

    set({ isSocketListening: true });
  },
}));
