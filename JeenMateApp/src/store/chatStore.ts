import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { getSocket } from '../services/socket';
import { useAuthStore } from './authStore';

const STORAGE_KEY_CONVS = '@jeenmate_conversations_cache_v2';

export interface CallMetadata {
  isCall?: boolean;
  status?: 'unknown' | 'answered' | 'missed' | 'rejected' | string;
  callType?: 'incoming' | 'outgoing' | string;
  mediaType?: 'voice' | 'video' | string;
  duration?: number | null;
  whatsappCallId?: string | null;
  isImage?: boolean;
  mediaUrl?: string | null;
  thumbnail?: string | null;
  caption?: string | null;
  [key: string]: any;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: 'staff' | '';
  text: string;
  timestamp: string;
  whatsapp_timestamp?: number | null;
  status: 'sent' | 'delivered' | 'read' | 'pending' | 'sending' | 'failed';
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

export interface SendMediaPayload {
  mediaType?: 'image' | 'video' | 'document';
  uri?: string;
  base64?: string;
  type?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  caption?: string;
}

export type SendImagePayload = SendMediaPayload;

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
  fetchConversations: (accountId?: number) => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  fetchOlderMessages: (conversationId: string) => Promise<number>;
  sendMessage: (conversationId: string, text: string, mediaPayload?: SendMediaPayload) => Promise<boolean>;
  setActiveConversation: (conversation: Conversation | null) => void;
  setSearchQuery: (query: string) => void;
  setSyncStatus: (status: WhatsAppSyncStatus) => void;
  syncWhatsAppChats: () => Promise<{ success: boolean; message: string }>;
  setupSocketListeners: () => void;
}

export const resolveMediaUrl = (url?: string | null): string | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://')
  ) {
    return trimmed;
  }
  const { serverUrl } = useAuthStore.getState();
  const cleanBase = (serverUrl || '').replace(/\/+$/, '');
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return cleanBase ? `${cleanBase}${cleanPath}` : trimmed;
};

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

export const deduplicateMessages = (rawMsgs: ChatMessage[]): ChatMessage[] => {
  const seenIds = new Set<string>();
  const seenWaIds = new Set<string>();
  const uniqueMsgs: ChatMessage[] = [];

  for (const m of rawMsgs) {
    if (!m.id) continue;
    if (seenIds.has(String(m.id))) continue;
    if (m.whatsapp_message_id && seenWaIds.has(m.whatsapp_message_id)) continue;

    const mTime = getMessageTime(m);
    const mIsImage = m.message_type === 'image' || !!m.metadata?.isImage || !!m.metadata?.mediaUrl || (m.text && (m.text.startsWith('data:image') || m.text.startsWith('/9j/') || m.text === 'Images' || m.text === '📷 Photo' || m.text === 'Image'));

    // Check for duplicate image within 15 seconds from same sender
    if (mIsImage) {
      const existingImgIdx = uniqueMsgs.findIndex(
        (prev) => {
          const prevTime = getMessageTime(prev);
          const prevIsImage = prev.message_type === 'image' || !!prev.metadata?.isImage || !!prev.metadata?.mediaUrl || (prev.text && (prev.text.startsWith('data:image') || prev.text.startsWith('/9j/') || prev.text === 'Images' || prev.text === '📷 Photo' || prev.text === 'Image'));
          return prevIsImage && prev.sender === m.sender && Math.abs(prevTime - mTime) < 15000;
        }
      );

      if (existingImgIdx >= 0) {
        const existing = uniqueMsgs[existingImgIdx];
        const existingUrl = existing.metadata?.mediaUrl || (existing.text && existing.text.startsWith('data:image') ? existing.text : '');
        const currentUrl = m.metadata?.mediaUrl || (m.text && m.text.startsWith('data:image') ? m.text : '');

        const existingHasFullMedia = existingUrl && !existingUrl.includes('/9j/') && existingUrl.length > 5000;
        const newHasFullMedia = currentUrl && !currentUrl.includes('/9j/') && currentUrl.length > 5000;

        // Keep the version with the sharp high-resolution media
        if (newHasFullMedia || !existingHasFullMedia) {
          uniqueMsgs[existingImgIdx] = {
            ...existing,
            ...m,
            metadata: {
              ...(existing.metadata || {}),
              ...(m.metadata || {}),
              mediaUrl: currentUrl || existingUrl || null
            }
          };
        }
        seenIds.add(String(m.id));
        if (m.whatsapp_message_id) seenWaIds.add(m.whatsapp_message_id);
        continue;
      }
    }

    // Check if this is an outgoing duplicate of an already added outgoing message with same text within 5 seconds
    if (m.sender === 'staff' && m.text) {
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

  return [...uniqueMsgs].sort((a, b) => {
    const timeA = getMessageTime(a);
    const timeB = getMessageTime(b);
    if (timeA !== timeB) return timeA - timeB;
    const idA = typeof a.id === 'number' ? a.id : parseInt(String(a.id), 10) || 0;
    const idB = typeof b.id === 'number' ? b.id : parseInt(String(b.id), 10) || 0;
    return idA - idB;
  });
};

export const sortMessages = (msgs: ChatMessage[]): ChatMessage[] => {
  return deduplicateMessages(msgs);
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

  fetchConversations: async (accountId?: number) => {
    const targetAccountId = accountId || require('./whatsappStore').useWhatsAppStore.getState().selectedAccountId;
    const cacheKey = targetAccountId ? `${STORAGE_KEY_CONVS}_acc_${targetAccountId}` : STORAGE_KEY_CONVS;
    
    // 1. Load from cache immediately if memory is empty for 0ms instant display
    if (get().conversations.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached).filter((c: any) => !c.id?.startsWith('conv_00'));
          if (parsed.length > 0 && get().conversations.length === 0) {
            set({ conversations: sortConversations(parsed) });
          }
        }
      } catch (_) {}
    }

    const hasData = get().conversations.length > 0;
    if (!hasData) {
      set({ isLoading: true });
    }

    try {
      const res = await apiClient.get('/api/conversations', {
        params: targetAccountId ? { accountId: targetAccountId } : {},
      });
      if (res.data && res.data.success) {
        const sorted = sortConversations(res.data.data);
        console.log(`[ChatStore] Conversations fetched for account ${targetAccountId}: ${sorted.length}`);
        set({ conversations: sorted, isLoading: false });
        await AsyncStorage.setItem(cacheKey, JSON.stringify(sorted));
        return;
      }
    } catch (e) {
      console.log(`[ChatStore] Error fetching conversations for account ${targetAccountId}`);
      if (get().conversations.length === 0) {
        try {
          const cached = await AsyncStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached).filter((c: any) => !c.id?.startsWith('conv_00'));
            set({ conversations: sortConversations(parsed) });
          }
        } catch (_) {}
      }
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (conversationId: string) => {
    const msgCacheKey = `@jeenmate_msgs_${conversationId}`;
    
    // 1. Load cached messages immediately if available for instant display
    if (get().messages.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(msgCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            set({ messages: sortMessages(parsed), isLoading: false });
          }
        }
      } catch (_) {}
    }

    const hasCached = get().messages.length > 0;
    if (!hasCached) {
      set({ isLoading: true });
    }

    try {
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

        AsyncStorage.setItem(msgCacheKey, JSON.stringify(sortedMsgs)).catch(() => {});

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

  sendMessage: async (conversationId: string, text: string, mediaPayload?: SendMediaPayload) => {
    const trimmedText = (text || '').trim();
    if (!trimmedText && !mediaPayload) return false;
    set({ isSending: true });

    const localMsgId = `msg_staff_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const isMedia = Boolean(mediaPayload);
    const mediaType = mediaPayload?.mediaType || (mediaPayload ? 'image' : 'text');

    let defaultPlaceholder = '📷 Photo';
    if (mediaType === 'video') defaultPlaceholder = '🎥 Video';
    else if (mediaType === 'document') defaultPlaceholder = mediaPayload?.fileName || '📄 Document';

    const displayText = isMedia ? (trimmedText || mediaPayload?.caption || defaultPlaceholder) : trimmedText;

    const optimisticMessage: ChatMessage = {
      id: localMsgId,
      conversation_id: conversationId,
      sender: 'staff',
      text: displayText,
      timestamp,
      whatsapp_timestamp: Date.now(),
      status: 'sending',
      message_type: isMedia ? mediaType : 'text',
      metadata: isMedia ? ({
        isImage: mediaType === 'image',
        isVideo: mediaType === 'video',
        isDocument: mediaType === 'document',
        mediaUrl: mediaPayload?.uri || (mediaPayload?.base64 ? `data:${mediaPayload.type || 'image/jpeg'};base64,${mediaPayload.base64}` : ''),
        filename: mediaPayload?.fileName,
        fileSize: mediaPayload?.fileSize,
        duration: mediaPayload?.duration,
        mimetype: mediaPayload?.type,
        caption: trimmedText || mediaPayload?.caption || '',
      } as any) : undefined,
    };

    // Optimistic UI update — add message & push conversation to top of list
    set((state) => {
      const updatedMessages = sortMessages([...state.messages, optimisticMessage]);
      const updatedConvs = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, last_message: displayText, last_message_at: timestamp } : c
      );
      return {
        messages: updatedMessages,
        conversations: sortConversations(updatedConvs),
      };
    });

    try {
      let res;
      // If we have a local file uri on device, use FormData multipart for maximum reliability and low memory
      if (mediaPayload && mediaPayload.uri && (mediaPayload.uri.startsWith('file://') || mediaPayload.uri.startsWith('content://') || mediaPayload.uri.startsWith('/'))) {
        const formData = new FormData();
        if (trimmedText) formData.append('text', trimmedText);
        if (mediaPayload.caption || trimmedText) formData.append('caption', mediaPayload.caption || trimmedText);
        formData.append('mediaType', mediaType);
        if (mediaPayload.fileName) formData.append('filename', mediaPayload.fileName);
        if (mediaPayload.fileSize) formData.append('fileSize', String(mediaPayload.fileSize));
        if (mediaPayload.duration) formData.append('duration', String(mediaPayload.duration));
        if (mediaPayload.type) formData.append('mimetype', mediaPayload.type);

        const fileObj = {
          uri: mediaPayload.uri,
          type: mediaPayload.type || (mediaType === 'video' ? 'video/mp4' : (mediaType === 'document' ? 'application/pdf' : 'image/jpeg')),
          name: mediaPayload.fileName || (mediaType === 'video' ? 'video.mp4' : (mediaType === 'document' ? 'document.pdf' : 'image.jpg')),
        };
        formData.append('file', fileObj as any);

        res = await apiClient.post(`/api/conversations/${conversationId}/messages`, formData);
      } else {
        // Fallback to JSON payload
        const payload: any = {
          text: trimmedText,
        };

        if (mediaPayload) {
          const rawB64 = mediaPayload.base64 || '';
          const dataUrl = rawB64 ? (rawB64.startsWith('data:') ? rawB64 : `data:${mediaPayload.type || 'image/jpeg'};base64,${rawB64}`) : mediaPayload.uri;
          if (mediaType === 'image') payload.image = dataUrl;
          else if (mediaType === 'video') payload.video = dataUrl;
          else if (mediaType === 'document') payload.document = dataUrl;
          else payload.file = dataUrl;

          payload.mediaType = mediaType;
          payload.caption = trimmedText || mediaPayload.caption;
          payload.mimetype = mediaPayload.type || (mediaType === 'video' ? 'video/mp4' : (mediaType === 'document' ? 'application/pdf' : 'image/jpeg'));
          payload.filename = mediaPayload.fileName || (mediaType === 'video' ? 'video.mp4' : (mediaType === 'document' ? 'document.pdf' : 'photo.jpg'));
          if (mediaPayload.fileSize) payload.fileSize = mediaPayload.fileSize;
          if (mediaPayload.duration) payload.duration = mediaPayload.duration;
        }

        res = await apiClient.post(`/api/conversations/${conversationId}/messages`, payload);
      }

      if (res.data && res.data.success) {
        const saved = res.data.data;
        set((state) => ({
          messages: sortMessages(
            state.messages.map((m) => {
              if (m.id === localMsgId) {
                const optMeta = typeof optimisticMessage.metadata === 'string' ? JSON.parse(optimisticMessage.metadata) : (optimisticMessage.metadata || {});
                const savedMeta = typeof saved.metadata === 'string' ? JSON.parse(saved.metadata) : (saved.metadata || {});
                const mergedMeta = {
                  ...optMeta,
                  ...savedMeta,
                  mediaUrl: savedMeta.mediaUrl || optMeta.mediaUrl || null,
                };
                return {
                  ...optimisticMessage,
                  ...saved,
                  metadata: mergedMeta,
                };
              }
              return m;
            })
          ),
        }));
      }
      return true;
    } catch (e: any) {
      console.warn('[ChatStore] Message send error:', e?.response?.data || e?.message || e);
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
    const selectedAccountId = require('./whatsappStore').useWhatsAppStore.getState().selectedAccountId;
    const syncUrl = selectedAccountId ? `/api/whatsapp/accounts/${selectedAccountId}/sync` : '/api/whatsapp/sync';
    try {
      const res = await apiClient.post(syncUrl);
      await get().fetchConversations(selectedAccountId);
      return { success: true, message: res.data?.message || 'Chats synced successfully!' };
    } catch (err: any) {
      set({ syncStatus: 'error' });
      return { success: false, message: err.response?.data?.message || 'Sync failed: WhatsApp offline' };
    } finally {
      set({ isSyncing: false });
    }
  },

  setupSocketListeners: () => {
    const socket = getSocket();

    // 1. WhatsApp Sync Status Listener
    socket.off('whatsapp_sync_status');
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
    socket.off('new_message');
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
            // Replace existing or optimistic version, preserving mediaUrl if already present
            const prev = state.messages[existingIdx];
            const prevMeta = typeof prev.metadata === 'string' ? JSON.parse(prev.metadata) : (prev.metadata || {});
            const rawMeta = typeof rawMsg.metadata === 'string' ? JSON.parse(rawMsg.metadata) : (rawMsg.metadata || {});
            const mergedMeta = {
              ...prevMeta,
              ...rawMeta,
              mediaUrl: rawMeta.mediaUrl || prevMeta.mediaUrl || null,
            };
            updated = [...state.messages];
            updated[existingIdx] = {
              ...prev,
              ...rawMsg,
              metadata: mergedMeta,
            };
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
    socket.off('conversation_updated');
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

    socket.off('whatsapp_status');
    socket.on('whatsapp_status', (statusData: { status: 'online' | 'waiting' | 'offline' }) => {
      if (statusData?.status) {
        set({ whatsappStatus: statusData.status });
      }
    });

    // 4. Message Status Updated Listener (sending -> sent / failed)
    socket.off('message_status_updated');
    socket.on('message_status_updated', (payload: { conversationId: string; messageId: number | string; status: 'sending' | 'sent' | 'failed'; whatsappMessageId?: string }) => {
      if (!payload || !payload.messageId) return;
      set((state) => {
        const updatedMsgs = state.messages.map((m) => {
          if (String(m.id) === String(payload.messageId)) {
            return {
              ...m,
              status: payload.status,
              whatsapp_message_id: payload.whatsappMessageId || m.whatsapp_message_id,
            };
          }
          return m;
        });
        return { messages: updatedMsgs };
      });
    });

    set({ isSocketListening: true });
  },
}));
