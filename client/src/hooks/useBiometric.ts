/**
 * useBiometric — Web Authentication API hook for biometric auth.
 * Supports Face ID, fingerprint, and platform authenticators.
 */
import { useState, useEffect, useCallback } from "react";

interface BiometricState {
  isAvailable: boolean;
  isEnrolled: boolean;
  isVerifying: boolean;
}

export function useBiometric() {
  const [state, setState] = useState<BiometricState>({
    isAvailable: false,
    isEnrolled: false,
    isVerifying: false,
  });

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    try {
      if (
        typeof window === "undefined" ||
        !window.PublicKeyCredential ||
        !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
      ) {
        return;
      }
      const available =
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      const enrolled = localStorage.getItem("remitflow_biometric_enrolled") === "true";
      setState((s) => ({ ...s, isAvailable: available, isEnrolled: enrolled }));
    } catch {
      // Silently fail — biometric not supported
    }
  };

  const enroll = useCallback(async (userId: string, userName: string) => {
    if (!state.isAvailable) return false;
    try {
      setState((s) => ({ ...s, isVerifying: true }));
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "RemitFlow", id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(userId),
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },
            { alg: -257, type: "public-key" },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
          },
          timeout: 60000,
        },
      });

      if (credential) {
        localStorage.setItem("remitflow_biometric_enrolled", "true");
        localStorage.setItem(
          "remitflow_biometric_credential_id",
          btoa(
            String.fromCharCode(
              ...Array.from(new Uint8Array((credential as PublicKeyCredential).rawId))
            )
          )
        );
        setState((s) => ({ ...s, isEnrolled: true, isVerifying: false }));
        return true;
      }
      setState((s) => ({ ...s, isVerifying: false }));
      return false;
    } catch {
      setState((s) => ({ ...s, isVerifying: false }));
      return false;
    }
  }, [state.isAvailable]);

  const verify = useCallback(async () => {
    if (!state.isAvailable || !state.isEnrolled) return false;
    try {
      setState((s) => ({ ...s, isVerifying: true }));
      const credId = localStorage.getItem("remitflow_biometric_credential_id");
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: credId
            ? [
                {
                  id: Uint8Array.from(atob(credId), (c) => c.charCodeAt(0)),
                  type: "public-key",
                },
              ]
            : [],
          userVerification: "required",
          timeout: 60000,
        },
      });

      setState((s) => ({ ...s, isVerifying: false }));
      return !!assertion;
    } catch {
      setState((s) => ({ ...s, isVerifying: false }));
      return false;
    }
  }, [state.isAvailable, state.isEnrolled]);

  const unenroll = useCallback(() => {
    localStorage.removeItem("remitflow_biometric_enrolled");
    localStorage.removeItem("remitflow_biometric_credential_id");
    setState((s) => ({ ...s, isEnrolled: false }));
  }, []);

  return {
    ...state,
    enroll,
    verify,
    unenroll,
  };
}
