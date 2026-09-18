import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

export type TaskEventType = 'PhoneCall' | 'WhatsappCall' | 'WhatsappChat' | 'JeenmateChat' | 'Self';

export interface CRMTask {
  id: string;
  customer_id?: string | null;
  customer_name: string;
  customer_phone: string;
  original_message: string;
  staff_note: string;
  due_date: string;
  status: 'pending' | 'completed';
  created_at?: string;
  updated_at?: string;
  user_id?: number;
  assigned_to_id?: number;
  assigned_to_name?: string;
  assigned_to_email?: string;
  created_by_id?: number;
  created_by_name?: string;
  assigned_by_id?: number;
  assigned_by_name?: string;
  event_type?: TaskEventType;
}

interface TaskCounts {
  total: number;
  pending: number;
  assigned: number;
  completed: number;
}

const computeCounts = (tasks: CRMTask[]): TaskCounts => ({
  total: tasks.length,
  pending: tasks.filter((t) => t.status === 'pending').length,
  assigned: tasks.filter((t) => Boolean(t.assigned_to_name) && t.status !== 'completed').length,
  completed: tasks.filter((t) => t.status === 'completed').length,
});

interface TaskState {
  tasks: CRMTask[];
  counts: TaskCounts;
  teamMembers: TeamMember[];
  filter: 'all' | 'pending' | 'assigned' | 'completed';
  selectedCustomer: string | null;
  searchQuery: string;
  isLoading: boolean;
  isRefreshing: boolean;

  fetchTasks: () => Promise<void>;
  fetchTeamMembers: () => Promise<void>;
  setFilter: (filter: 'all' | 'pending' | 'assigned' | 'completed') => void;
  setSearchQuery: (query: string) => void;
  setSelectedCustomer: (customer: string | null) => void;
  addTask: (task: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    originalMessage?: string;
    staffNote?: string;
    dueDate?: string;
    assignedToUserId?: number | null;
    eventType?: TaskEventType;
  }) => Promise<boolean>;
  assignTask: (taskId: string, assignedToUserId: number) => Promise<{ success: boolean; message: string }>;
  toggleTaskStatus: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  clearCompletedTasks: () => Promise<void>;
  resetTasks: () => void;
}

const STORAGE_KEY_TASKS = '@jeenmate_tasks_cache';
const STORAGE_KEY_MEMBERS = '@jeenmate_team_members_cache';

const DEFAULT_MEMBERS: TeamMember[] = [
  { id: 4, name: 'Nakul', email: 'nakul@jeenmate.com', role: 'user', avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=Nakul' },
  { id: 1, name: 'Support Admin', email: 'admin@support.com', role: 'admin', avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=Support%20Admin' },
  { id: 3, name: 'tanamay', email: 'tanamay@jeenmate.com', role: 'user', avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=tanamay' },
];

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  counts: {
    total: 0,
    pending: 0,
    assigned: 0,
    completed: 0,
  },
  teamMembers: DEFAULT_MEMBERS,
  filter: 'all',
  selectedCustomer: null,
  searchQuery: '',
  isLoading: false,
  isRefreshing: false,

  fetchTeamMembers: async () => {
    // 1. Load from cache first if empty
    if (get().teamMembers.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_MEMBERS);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            set({ teamMembers: parsed });
          }
        }
      } catch (err) {}
    }

    // 2. Fetch fresh from backend server
    try {
      const res = await apiClient.get('/api/auth/users');
      if (res.data && res.data.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        set({ teamMembers: res.data.data });
        await AsyncStorage.setItem(STORAGE_KEY_MEMBERS, JSON.stringify(res.data.data));
      }
    } catch (e) {
      console.log('[TaskStore] Error fetching team members', e);
    }
  },

  fetchTasks: async () => {
    // 1. If tasks is empty, load from cache immediately so UI has data and doesn't flicker
    if (get().tasks.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_TASKS);
        if (cached) {
          const cachedTasks: CRMTask[] = JSON.parse(cached).filter((t: any) => !t.id?.startsWith('task_demo_'));
          if (cachedTasks.length > 0 && get().tasks.length === 0) {
            set({
              tasks: cachedTasks,
              counts: computeCounts(cachedTasks),
            });
          }
        }
      } catch (e) {}
    }

    const isInitial = get().tasks.length === 0;
    try {
      if (isInitial) {
        set({ isLoading: true });
      } else {
        set({ isRefreshing: true });
      }
      const res = await apiClient.get('/api/tasks');
      if (res.data && res.data.success) {
        const tasks: CRMTask[] = res.data.data;
        const counts = res.data.counts || {
          total: tasks.length,
          pending: tasks.filter((t) => t.status === 'pending').length,
          assigned: tasks.filter((t) => t.assigned_to_name && t.status !== 'completed').length,
          completed: tasks.filter((t) => t.status === 'completed').length,
        };

        set({ tasks, counts, isRefreshing: false, isLoading: false });
        await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
        return;
      }
    } catch (err) {
      console.log('[TaskStore] Could not fetch remote tasks, using offline cache');
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY_TASKS);
        if (cached) {
          const tasks: CRMTask[] = JSON.parse(cached).filter((t: any) => !t.id?.startsWith('task_demo_'));
          set({
            tasks,
            counts: computeCounts(tasks),
          });
        }
      } catch (e) {}
    } finally {
      set({ isRefreshing: false, isLoading: false });
    }
  },

  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedCustomer: (selectedCustomer) => set({ selectedCustomer }),

  addTask: async (newTaskData: any) => {
    const customerName = (newTaskData.customerName || newTaskData.customer_name || '').trim();
    const customerPhone = (newTaskData.customerPhone || newTaskData.customer_phone || '').trim();
    const originalMessage = newTaskData.originalMessage || newTaskData.original_message || '';
    const staffNote = newTaskData.staffNote || newTaskData.staff_note || '';
    const dueDate = newTaskData.dueDate || newTaskData.due_date || new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0];
    const assignedToUserId = newTaskData.assignedToUserId ?? newTaskData.assigned_to_id ?? newTaskData.assigned_to_user_id ?? null;
    const eventType = newTaskData.eventType || newTaskData.event_type || 'Self';
    const customerId = newTaskData.customerId || newTaskData.customer_id || null;

    if (!customerName || !customerPhone) {
      throw new Error('Customer name and phone number are required.');
    }

    const localId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newTask: CRMTask = {
      id: localId,
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      original_message: originalMessage,
      staff_note: staffNote,
      due_date: dueDate,
      status: 'pending',
      created_at: new Date().toISOString(),
      event_type: eventType,
      assigned_to_id: assignedToUserId,
    };

    // Optimistic update
    const updatedTasks = [newTask, ...get().tasks];
    set({
      tasks: updatedTasks,
      counts: computeCounts(updatedTasks),
    });

    try {
      const res = await apiClient.post('/api/tasks', {
        customerId,
        customerName,
        customerPhone,
        originalMessage,
        staffNote,
        dueDate,
        assignedToUserId,
        eventType,
      });

      if (res.data?.success) {
        await get().fetchTasks();
      } else {
        await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updatedTasks));
      }
      return true;
    } catch (err: any) {
      console.warn('[TaskStore] Saved locally, remote failed:', err?.response?.data || err.message);
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updatedTasks));
      return true;
    }
  },

  assignTask: async (taskId: string, assignedToUserId: number) => {
    try {
      const res = await apiClient.patch(`/api/tasks/${taskId}/assign`, { assignedToUserId });
      if (res.data && res.data.success) {
        await get().fetchTasks();
        return { success: true, message: res.data.message || 'Task assigned successfully' };
      }
      return { success: false, message: res.data?.message || 'Failed to assign task' };
    } catch (err: any) {
      return { success: false, message: err?.response?.data?.message || err.message || 'Failed to assign task' };
    }
  },

  toggleTaskStatus: async (taskId: string) => {
    const { tasks } = get();
    const updated = tasks.map((t) => {
      if (t.id === taskId) {
        return {
          ...t,
          status: (t.status === 'pending' ? 'completed' : 'pending') as 'pending' | 'completed',
        };
      }
      return t;
    });

    set({
      tasks: updated,
      counts: computeCounts(updated),
    });

    try {
      await apiClient.patch(`/api/tasks/${taskId}/toggle`);
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
    } catch (e) {
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
    }
  },

  deleteTask: async (taskId: string) => {
    const { tasks } = get();
    const updated = tasks.filter((t) => t.id !== taskId);

    set({
      tasks: updated,
      counts: computeCounts(updated),
    });

    try {
      await apiClient.delete(`/api/tasks/${taskId}`);
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
    } catch (e) {
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
    }
  },

  clearCompletedTasks: async () => {
    const { tasks } = get();
    const completedIds = tasks.filter((t) => t.status === 'completed').map((t) => t.id);
    const updated = tasks.filter((t) => t.status === 'pending');

    set({
      tasks: updated,
      counts: computeCounts(updated),
    });

    for (const id of completedIds) {
      try {
        await apiClient.delete(`/api/tasks/${id}`);
      } catch (e) {}
    }
    await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
  },

  resetTasks: () => {
    set({
      tasks: [],
      counts: { total: 0, pending: 0, assigned: 0, completed: 0 },
      teamMembers: [],
      searchQuery: '',
      selectedCustomer: null,
      filter: 'all',
      isLoading: false,
      isRefreshing: false,
    });
  },
}));
