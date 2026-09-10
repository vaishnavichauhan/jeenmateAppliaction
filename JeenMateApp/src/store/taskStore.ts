import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';

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
}

interface TaskCounts {
  total: number;
  pending: number;
  completed: number;
}

interface TaskState {
  tasks: CRMTask[];
  counts: TaskCounts;
  filter: 'all' | 'pending' | 'completed';
  selectedCustomer: string | null;
  searchQuery: string;
  isLoading: boolean;
  isRefreshing: boolean;

  fetchTasks: () => Promise<void>;
  setFilter: (filter: 'all' | 'pending' | 'completed') => void;
  setSearchQuery: (query: string) => void;
  setSelectedCustomer: (customer: string | null) => void;
  addTask: (task: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    originalMessage?: string;
    staffNote?: string;
    dueDate?: string;
  }) => Promise<boolean>;
  toggleTaskStatus: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  clearCompletedTasks: () => Promise<void>;
}

const STORAGE_KEY_TASKS = '@jeenmate_tasks_cache';

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  counts: {
    total: 0,
    pending: 0,
    completed: 0,
  },
  filter: 'all',
  selectedCustomer: null,
  searchQuery: '',
  isLoading: false,
  isRefreshing: false,

  fetchTasks: async () => {
    try {
      set({ isRefreshing: true });
      const res = await apiClient.get('/api/tasks');
      if (res.data && res.data.success) {
        const tasks: CRMTask[] = res.data.data;
        const counts = res.data.counts || {
          total: tasks.length,
          pending: tasks.filter((t) => t.status === 'pending').length,
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
            counts: {
              total: tasks.length,
              pending: tasks.filter((t) => t.status === 'pending').length,
              completed: tasks.filter((t) => t.status === 'completed').length,
            },
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

  addTask: async (newTaskData) => {
    const localId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newTask: CRMTask = {
      id: localId,
      customer_id: newTaskData.customerId || null,
      customer_name: newTaskData.customerName,
      customer_phone: newTaskData.customerPhone,
      original_message: newTaskData.originalMessage || '',
      staff_note: newTaskData.staffNote || '',
      due_date: newTaskData.dueDate || new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Optimistic update
    const updatedTasks = [newTask, ...get().tasks];
    set({
      tasks: updatedTasks,
      counts: {
        total: updatedTasks.length,
        pending: updatedTasks.filter((t) => t.status === 'pending').length,
        completed: updatedTasks.filter((t) => t.status === 'completed').length,
      },
    });

    try {
      await apiClient.post('/api/tasks', newTaskData);
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updatedTasks));
      return true;
    } catch (err) {
      console.warn('[TaskStore] Task saved locally offline');
      await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updatedTasks));
      return true;
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
      counts: {
        total: updated.length,
        pending: updated.filter((t) => t.status === 'pending').length,
        completed: updated.filter((t) => t.status === 'completed').length,
      },
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
      counts: {
        total: updated.length,
        pending: updated.filter((t) => t.status === 'pending').length,
        completed: updated.filter((t) => t.status === 'completed').length,
      },
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
      counts: {
        total: updated.length,
        pending: updated.length,
        completed: 0,
      },
    });

    for (const id of completedIds) {
      try {
        await apiClient.delete(`/api/tasks/${id}`);
      } catch (e) {}
    }
    await AsyncStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(updated));
  },
}));
