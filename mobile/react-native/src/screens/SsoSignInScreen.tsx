/**
 * RemitFlow — React Native SSO Sign-In Screen
 * Drives the Keycloak PKCE state machine from ssoService:
 * probes availability, opens the system browser for the authorization URL,
 * and surfaces the real result of session verification. When SSO is not
 * configured the screen says so and points at credential sign-in — no
 * placeholder buttons.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SsoState, ssoService } from "../services/ssoService";

export function SsoSignInScreen() {
  const [state, setState] = useState<SsoState>(ssoService.getState());

  useEffect(() => {
    const unsubscribe = ssoService.subscribe(setState);
    void ssoService.probe();
    return unsubscribe;
  }, []);

  const busy =
    state.phase === "probing" ||
    state.phase === "openingBrowser" ||
    state.phase === "completing";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.subtitle}>
        Use your organization single sign-on, or continue with email and
        password.
      </Text>

      {state.phase === "unavailable" && (
        <View style={[styles.banner, styles.bannerNeutral]}>
          <Text style={styles.bannerText}>
            Single sign-on is not available: {state.reason} You can still sign
            in with email and password.
          </Text>
        </View>
      )}

      {state.phase === "awaitingReturn" && (
        <View style={[styles.banner, styles.bannerInfo]}>
          <Text style={styles.bannerText}>
            Complete sign-in in your browser, then return to the app. The
            session will be verified automatically.
          </Text>
        </View>
      )}

      {state.phase === "failed" && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={[styles.bannerText, styles.bannerErrorText]}>
            {state.message}
          </Text>
        </View>
      )}

      {state.phase === "authenticated" ? (
        <View style={[styles.banner, styles.bannerSuccess]}>
          <Text style={styles.bannerSuccessTitle}>Signed in</Text>
          <Text style={styles.bannerText}>
            {state.user.name ? `${state.user.name} · ` : ""}
            {state.user.email}
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.button,
            (busy || state.phase === "unavailable") && styles.buttonDisabled,
          ]}
          disabled={busy || state.phase === "unavailable"}
          onPress={() => {
            if (state.phase === "failed") {
              void ssoService.probe().then((next) => {
                if (next.phase === "ready") void ssoService.initiate();
              });
            } else {
              void ssoService.initiate();
            }
          }}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>
              {state.phase === "failed" ? "Retry single sign-on" : "Sign in with SSO"}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {state.phase === "awaitingReturn" && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => ssoService.reset()}
        >
          <Text style={styles.cancelButtonText}>Cancel sign-in</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 24, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 8, marginBottom: 24 },
  banner: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  bannerNeutral: { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" },
  bannerInfo: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
  bannerError: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  bannerSuccess: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  bannerSuccessTitle: { fontSize: 15, fontWeight: "600", color: "#047857", marginBottom: 2 },
  bannerText: { fontSize: 13, color: "#475569" },
  bannerErrorText: { color: "#b91c1c" },
  button: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  cancelButton: { marginTop: 12, alignItems: "center", paddingVertical: 8 },
  cancelButtonText: { color: "#64748b", fontSize: 13, fontWeight: "500" },
});

export default SsoSignInScreen;
