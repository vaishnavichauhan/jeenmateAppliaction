import { create } from 'zustand';
import { Platform } from 'react-native';
import apiClient from '../services/api';
import { getSocket } from '../services/socket';
import { useAuthStore } from './authStore';

export interface Colleague {
  id: number;
  name: string;
  email: string;
  role: string;
  last_message?: string | null;
  last_message_time?: string | null;
  unread_count?: number;
}

export interface InternalChatMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  message_text: string;
  media_urls?: string[] | null;
  message_type?: 'text' | 'image' | 'video' | 'document' | 'media';
  is_read: number;
  created_at: string;
  sender_name?: string;
  receiver_name?: string;
}

export interface SelectedMedia {
  uri: string;
  fileName?: string;
  type?: string;
  fileSize?: number;
  duration?: number;
  mediaType?: 'image' | 'video' | 'document';
}

export type SelectedImage = SelectedMedia;

interface InternalChatState {
  colleagues: Colleague[];
  activeColleague: Colleague | null;
  messages: InternalChatMessage[];
  isLoadingColleagues: boolean;
  isLoadingMessages: boolean;
  isSending: boolean;
  isSocketListening: boolean;
  isColleagueTyping: boolean;

  fetchColleagues: () => Promise<void>;
  fetchMessages: (colleagueId: number) => Promise<void>;
  sendMessage: (receiverId: number, text?: string, mediaFiles?: SelectedMedia[]) => Promise<boolean>;
  setActiveColleague: (colleague: Colleague | null) => void;
  sendTypingIndicator: (receiverId: number, isTyping: boolean) => void;
  setupSocketListeners: () => void;
  clearActiveChat: () => void;
}

export const useInternalChatStore = create<InternalChatState>((set, get) => ({
  colleagues: [],
  activeColleague: null,
  messages: [],
  isLoadingColleagues: false,
  isLoadingMessages: false,
  isSending: false,
  isSocketListening: false,
  isColleagueTyping: false,

  fetchColleagues: async () => {
    try {
      set({ isLoadingColleagues: true });
      const res = await apiClient.get('/api/internal-chat/users');
      if (res.data?.success) {
        set({ colleagues: res.data.data || [] });
      }
    } catch (err: any) {
      console.warn('[InternalChat] Fetch colleagues error:', err?.message);
    } finally {
      set({ isLoadingColleagues: false });
    }
  },

  fetchMessages: async (colleagueId: number) => {
    try {
      set({ isLoadingMessages: true });
      const res = await apiClient.get(`/api/internal-chat/messages/${colleagueId}`);
      if (res.data?.success) {
        set({ messages: res.data.data || [] });

        // Update local colleague unread count to 0
        set((state) => ({
          colleagues: state.colleagues.map((c) =>
            c.id === colleagueId ? { ...c, unread_count: 0 } : c
          ),
        }));
      }
    } catch (err: any) {
      console.warn('[InternalChat] Fetch messages error:', err?.message);
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (receiverId: number, text?: string, mediaFiles?: SelectedMedia[]) => {
    const trimmed = (text || '').trim();
    const hasMedia = mediaFiles && mediaFiles.length > 0;

    if (!trimmed && !hasMedia) return false;

    set({ isSending: true });
    try {
      let resData: any = null;
      if (hasMedia) {
        const formData = new FormData();
        formData.append('receiver_id', String(receiverId));
        if (trimmed) {
          formData.append('message_text', trimmed);
        }

        mediaFiles.forEach((file, idx) => {
          let uri = file.uri;
          if (Platform.OS === 'ios') {
            uri = uri.replace('file://', '');
          }
          const defaultName =
            file.mediaType === 'video'
              ? `video_${Date.now()}_${idx}.mp4`
              : file.mediaType === 'document'
              ? `doc_${Date.now()}_${idx}.pdf`
              : `image_${Date.now()}_${idx}.jpg`;

          const defaultType =
            file.mediaType === 'video'
              ? 'video/mp4'
              : file.mediaType === 'document'
              ? 'application/pdf'
              : 'image/jpeg';

          formData.append('images', {
            uri,
            name: file.fileName || defaultName,
            type: file.type || defaultType,
          } as any);
        });

        const { token, serverUrl } = useAuthStore.getState();
        const base = (serverUrl || (Platform.OS === 'android' ? 'http://192.168.1.3:5001' : 'http://localhost:5001')).replace(/\/+$/, '');
        const targetEndpoint = `${base}/api/internal-chat/messages`;

        console.log('[InternalChatStore] Sending media to:', targetEndpoint, 'count:', mediaFiles.length);
        const uploadRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        });

        resData = await uploadRes.json();
        console.log('[InternalChatStore] Upload response:', resData);
      } else {
        const res = await apiClient.post('/api/internal-chat/messages', {
          receiver_id: receiverId,
          message_text: trimmed,
        });
        resData = res.data;
      }

      if (resData?.success && resData.data) {
        const newMsg: InternalChatMessage = resData.data;
        let defaultMediaBadge = '📷 Photo';
        if (mediaFiles && mediaFiles.some((m) => m.mediaType === 'video')) defaultMediaBadge = '🎥 Video';
        else if (mediaFiles && mediaFiles.some((m) => m.mediaType === 'document')) defaultMediaBadge = '📄 Document';

        const summaryText =
          trimmed ||
          (newMsg.media_urls && newMsg.media_urls.length > 1
            ? `${defaultMediaBadge} (${newMsg.media_urls.length})`
            : defaultMediaBadge);

        set((state) => {
          // Avoid duplicate if socket already added it
          const exists = state.messages.some((m) => m.id === newMsg.id);
          const updatedMessages = exists ? state.messages : [...state.messages, newMsg];

          // Update colleague list preview
          const updatedColleagues = state.colleagues.map((c) =>
            c.id === receiverId
              ? { ...c, last_message: summaryText, last_message_time: newMsg.created_at }
              : c
          );

          return {
            messages: updatedMessages,
            colleagues: updatedColleagues,
          };
        });
        return true;
      }
      return false;
    } catch (err: any) {
      console.warn('[InternalChat] Send message error:', err?.message || err);
      return false;
    } finally {
      set({ isSending: false });
    }
  },

  setActiveColleague: (colleague: Colleague | null) => {
    const prevColleague = get().activeColleague;
    const socket = getSocket();
    const { user } = useAuthStore.getState();

    // Leave previous room if any
    if (prevColleague && user?.id) {
      socket.emit('leave_internal_chat', {
        myUserId: user.id,
        targetUserId: prevColleague.id,
      });
    }

    set({ activeColleague: colleague, messages: [], isColleagueTyping: false });

    // Join new room
    if (colleague && user?.id) {
      socket.emit('join_internal_chat', {
        myUserId: user.id,
        targetUserId: colleague.id,
      });
      get().fetchMessages(colleague.id);
    }
  },

  sendTypingIndicator: (receiverId: number, isTyping: boolean) => {
    const socket = getSocket();
    const { user } = useAuthStore.getState();
    if (!user?.id) return;

    if (isTyping) {
      socket.emit('internal_typing_start', {
        myUserId: user.id,
        targetUserId: receiverId,
        userName: user.name || 'Colleague',
      });
    } else {
      socket.emit('internal_typing_stop', {
        myUserId: user.id,
        targetUserId: receiverId,
      });
    }
  },

  setupSocketListeners: () => {
    const socket = getSocket();
    const { user } = useAuthStore.getState();
    if (user?.id) {
      socket.emit('join_user_channel', user.id);
    }

    // When a new message arrives in active room
    socket.off('new_internal_message');
    socket.on('new_internal_message', (msg: InternalChatMessage) => {
      const { activeColleague, messages, colleagues } = get();

      // If active conversation matches either sender or receiver
      const isForActive =
        activeColleague &&
        (msg.sender_id === activeColleague.id || msg.receiver_id === activeColleague.id);

      if (isForActive) {
        const alreadyExists = messages.some((m) => m.id === msg.id);
        if (!alreadyExists) {
          set({ messages: [...messages, msg] });
        }
      }

      // Update inbox colleague summary
      const otherUserId =
        String(msg.sender_id) === String(user?.id) ? msg.receiver_id : msg.sender_id;
      const summaryText =
        msg.message_text ||
        (msg.media_urls && msg.media_urls.length > 1
          ? `📷 ${msg.media_urls.length} Photos`
          : '📷 Photo');

      set({
        colleagues: colleagues.map((c) => {
          if (c.id === otherUserId) {
            const isIncoming = msg.sender_id === otherUserId;
            const incUnread = isIncoming && (!activeColleague || activeColleague.id !== otherUserId);
            return {
              ...c,
              last_message: summaryText,
              last_message_time: msg.created_at,
              unread_count: incUnread ? (c.unread_count || 0) + 1 : c.unread_count || 0,
            };
          }
          return c;
        }),
      });
    });

    // When inbox update arrives
    socket.off('internal_inbox_update');
    socket.on('internal_inbox_update', (msg: InternalChatMessage) => {
      const { activeColleague, colleagues } = get();
      const otherUserId =
        String(msg.sender_id) === String(user?.id) ? msg.receiver_id : msg.sender_id;
      const summaryText =
        msg.message_text ||
        (msg.media_urls && msg.media_urls.length > 1
          ? `📷 ${msg.media_urls.length} Photos`
          : '📷 Photo');

      set({
        colleagues: colleagues.map((c) => {
          if (c.id === otherUserId) {
            const isIncoming = msg.sender_id === otherUserId;
            const incUnread = isIncoming && (!activeColleague || activeColleague.id !== otherUserId);
            return {
              ...c,
              last_message: summaryText,
              last_message_time: msg.created_at,
              unread_count: incUnread ? (c.unread_count || 0) + 1 : c.unread_count || 0,
            };
          }
          return c;
        }),
      });
    });

    // Typing indicators
    socket.off('internal_user_typing');
    socket.on('internal_user_typing', ({ senderId }: { senderId: number }) => {
      const { activeColleague } = get();
      if (activeColleague && activeColleague.id === senderId) {
        set({ isColleagueTyping: true });
      }
    });

    socket.off('internal_user_stopped_typing');
    socket.on('internal_user_stopped_typing', ({ senderId }: { senderId: number }) => {
      const { activeColleague } = get();
      if (activeColleague && activeColleague.id === senderId) {
        set({ isColleagueTyping: false });
      }
    });

    set({ isSocketListening: true });
  },

  clearActiveChat: () => {
    const { activeColleague } = get();
    const socket = getSocket();
    const { user } = useAuthStore.getState();

    if (activeColleague && user?.id) {
      socket.emit('leave_internal_chat', {
        myUserId: user.id,
        targetUserId: activeColleague.id,
      });
    }

    set({ activeColleague: null, messages: [], isColleagueTyping: false });
  },
}));
