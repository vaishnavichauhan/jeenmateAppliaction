import { Platform, PermissionsAndroid } from 'react-native';
import CallLogs from 'react-native-call-log';

export interface DeviceCallLogItem {
  id: string;
  customerName: string;
  phoneNumber: string;
  callType: 'incoming' | 'outgoing' | 'missed';
  mediaType: 'voice' | 'video';
  timestamp: string;
  duration?: string;
  rawTimestamp: number;
}

function formatCallDuration(secondsStr?: string | number): string | undefined {
  if (!secondsStr) return undefined;
  const totalSeconds = parseInt(String(secondsStr), 10);
  if (isNaN(totalSeconds) || totalSeconds <= 0) return undefined;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatCallDate(rawTime?: string | number): { dateStr: string; rawTimestamp: number } {
  const ts = typeof rawTime === 'string' ? parseInt(rawTime, 10) : (typeof rawTime === 'number' ? rawTime : Date.now());
  const validTs = isNaN(ts) ? Date.now() : ts;
  const callDate = new Date(validTs);

  const now = new Date();
  const isToday = callDate.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = callDate.toDateString() === yesterday.toDateString();

  const timeString = callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let dateStr = '';
  if (isToday) {
    dateStr = `Today, ${timeString}`;
  } else if (isYesterday) {
    dateStr = `Yesterday, ${timeString}`;
  } else {
    const month = callDate.toLocaleString('default', { month: 'short' });
    const day = callDate.getDate();
    dateStr = `${day} ${month}, ${timeString}`;
  }

  return { dateStr, rawTimestamp: validTs };
}

export async function requestAndroidCallLogPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      {
        title: 'Call Log Permission Required',
        message: 'jeenMate needs access to your Android call history to sync phone call logs directly in the app.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Grant Access',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('[CallLogService] Permission request error:', err);
    return false;
  }
}

export async function fetchAndroidCallLogs(limit: number = 50): Promise<DeviceCallLogItem[]> {
  if (Platform.OS !== 'android') {
    return [];
  }

  try {
    const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
    if (!hasPermission) {
      const granted = await requestAndroidCallLogPermission();
      if (!granted) {
        return [];
      }
    }

    const rawLogs = await CallLogs.load(limit);
    if (!Array.isArray(rawLogs)) {
      return [];
    }

    return rawLogs.map((log: any, index: number) => {
      const rawType = String(log.type || '').toUpperCase();
      let callType: 'incoming' | 'outgoing' | 'missed' = 'incoming';
      if (rawType.includes('OUTGOING')) {
        callType = 'outgoing';
      } else if (rawType.includes('MISSED') || rawType.includes('REJECTED') || rawType.includes('BLOCKED')) {
        callType = 'missed';
      }

      const phoneNumber = log.phoneNumber || log.number || 'Unknown';
      const name = log.name || log.cachedName || phoneNumber;
      const { dateStr, rawTimestamp } = formatCallDate(log.timestamp || log.dateTime);
      const durationStr = formatCallDuration(log.duration);

      return {
        id: `device_ph_${index}_${rawTimestamp}`,
        customerName: name,
        phoneNumber: phoneNumber,
        callType: callType,
        mediaType: 'voice',
        timestamp: dateStr,
        duration: durationStr,
        rawTimestamp: rawTimestamp,
      };
    });
  } catch (err) {
    console.error('[CallLogService] Error fetching call logs:', err);
    return [];
  }
}
