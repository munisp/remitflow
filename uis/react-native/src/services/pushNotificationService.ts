/**
 * pushNotificationService.ts
 * Handles FCM push notifications for RemitFlow React Native app.
 * Install: pnpm add @react-native-firebase/app @react-native-firebase/messaging
 */

import messaging from "@react-native-firebase/messaging";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform, PermissionsAndroid } from "react-native";

const FCM_TOKEN_KEY = "@remitflow:fcm_token";

/**
 * Request push notification permission from the user.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "ios") {
    const authStatus = await messaging().requestPermission();
    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    );
  }
  if (Platform.OS === "android" && Platform.Version >= 33) {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}

/**
 * Get the FCM device token and cache it locally.
 */
export async function getFCMToken(): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (cached) return cached;
    const token = await messaging().getToken();
    if (token) await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
    return token;
  } catch {
    return null;
  }
}

/**
 * Register the FCM token with the RemitFlow backend.
 */
export async function registerPushToken(
  apiBaseUrl: string,
  sessionCookie: string,
  deviceName: string
): Promise<boolean> {
  try {
    const token = await getFCMToken();
    if (!token) return false;
    const res = await fetch(`${apiBaseUrl}/api/trpc/pushNotifications.register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `app_session_id=${sessionCookie}`,
      },
      body: JSON.stringify({
        json: {
          endpoint: token,
          p256dh: "fcm",
          auth: "fcm",
          deviceName,
          platform: Platform.OS,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Set up foreground notification handler.
 */
export function setupForegroundHandler(
  onNotification: (title: string, body: string, data: Record<string, any>) => void
): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    const title = remoteMessage.notification?.title ?? "RemitFlow";
    const body = remoteMessage.notification?.body ?? "";
    const data = (remoteMessage.data as Record<string, any>) ?? {};
    onNotification(title, body, data);
  });
}

/**
 * Set up background/quit state notification handler.
 * Call this at app startup (outside React tree).
 */
export function setupBackgroundHandler(): void {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log("[Push] Background message:", remoteMessage.messageId);
  });
}

/**
 * Handle notification tap (app opened from notification).
 */
export function onNotificationOpenedApp(
  onOpen: (data: Record<string, any>) => void
): () => void {
  return messaging().onNotificationOpenedApp((remoteMessage) => {
    if (remoteMessage.data) onOpen(remoteMessage.data as Record<string, any>);
  });
}

/**
 * Check if app was launched from a notification (cold start).
 */
export async function getInitialNotification(): Promise<Record<string, any> | null> {
  const remoteMessage = await messaging().getInitialNotification();
  return remoteMessage?.data ? (remoteMessage.data as Record<string, any>) : null;
}
