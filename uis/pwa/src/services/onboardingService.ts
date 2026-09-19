import { api } from "./api";

export interface OnboardingData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  uin?: string;
}

export interface CreateCustomerPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  accountType: string;
  address: string;
  city: string;
  state: string;
  postalCode?: string;
  country: string;
  bvn?: string;
  uin?: string;
}

type CustomerCreateResponse = {
  verification?: string;
  creation_link?: string;
  data?: {
    verification?: string;
    creation_link?: string;
  };
};

const KEYS = {
  onboardingData: "onboarding_data",
  accountType: "onboarding_account_type",
  bvn: "onboarding_bvn",
  address: "onboarding_address",
  city: "onboarding_city",
  state: "onboarding_state",
  postalCode: "onboarding_postal_code",
} as const;

/**
 * SECURITY (CLI-001): The plaintext password and BVN collected during
 * onboarding are NEVER written to localStorage/sessionStorage. They live
 * only in these module-level variables for the lifetime of the tab.
 *
 * Residual risk: the values remain in JS heap memory until the onboarding
 * flow completes (clearOnboarding) or the tab closes/reloads — an in-page
 * XSS payload could still read them via the getters below. That window is
 * reduced from "indefinite, on-disk, readable by any script/extension with
 * storage access" to "in-memory, this tab only, cleared on success". This
 * is inherent to any client-side form; full mitigation requires the
 * credential to be submitted immediately rather than carried across the
 * multi-step flow.
 *
 * Legacy purge: earlier builds persisted these keys in localStorage; we
 * remove any stale copies at module load.
 */
let inMemoryOnboardingData: OnboardingData | null = null;
let inMemoryBvn = "";

function purgeLegacySensitiveKeys(): void {
  try {
    localStorage.removeItem(KEYS.onboardingData);
    localStorage.removeItem(KEYS.bvn);
  } catch {
    // Storage unavailable (private mode) — nothing to purge.
  }
}

// Best-effort cleanup when the tab/window is closed or navigated away.
// In-memory state dies with the JS context anyway; this additionally
// purges any legacy persisted copies.
function installUnloadCleanup(): void {
  if (typeof window === "undefined") return;
  const cleanup = () => {
    inMemoryOnboardingData = null;
    inMemoryBvn = "";
    purgeLegacySensitiveKeys();
  };
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
}

purgeLegacySensitiveKeys();
installUnloadCleanup();

export const onboardingService = {
  keys: KEYS,

  saveOnboardingData(data: OnboardingData): void {
    // In-memory only — never persisted (see security note above).
    inMemoryOnboardingData = data;
  },

  getOnboardingData(): OnboardingData | null {
    return inMemoryOnboardingData;
  },

  setAccountType(accountType: string): void {
    localStorage.setItem(KEYS.accountType, accountType);
  },

  getAccountType(): string {
    return localStorage.getItem(KEYS.accountType) || "individual";
  },

  setBvn(bvn: string): void {
    // In-memory only — BVN is sensitive PII, never persisted (CLI-001).
    inMemoryBvn = bvn.trim();
  },

  getBvn(): string {
    return inMemoryBvn;
  },

  setAddress(
    address: string,
    city: string,
    state: string,
    postalCode?: string,
  ): void {
    localStorage.setItem(KEYS.address, address);
    localStorage.setItem(KEYS.city, city);
    localStorage.setItem(KEYS.state, state);
    if (postalCode) {
      localStorage.setItem(KEYS.postalCode, postalCode);
      return;
    }
    localStorage.removeItem(KEYS.postalCode);
  },

  clearOnboarding(): void {
    // Clear in-memory sensitive data first (password + BVN).
    inMemoryOnboardingData = null;
    inMemoryBvn = "";
    localStorage.removeItem(KEYS.onboardingData);
    localStorage.removeItem(KEYS.accountType);
    localStorage.removeItem(KEYS.bvn);
    localStorage.removeItem(KEYS.address);
    localStorage.removeItem(KEYS.city);
    localStorage.removeItem(KEYS.state);
    localStorage.removeItem(KEYS.postalCode);
  },

  /**
   * W13: renamed from `verifyBvnLocally` — this is a client-side FORMAT
   * check only. It does NOT verify the BVN against NIBSS or any registry;
   * real verification happens server-side via `bvnNin.verifyBVN` during KYC.
   */
  checkBvnFormat(bvn: string): { valid: boolean; message: string } {
    if (!/^\d{11}$/.test(bvn)) {
      return { valid: false, message: "BVN must be 11 digits" };
    }

    if (bvn.startsWith("0000")) {
      return {
        valid: false,
        message: "Invalid BVN format. Please check and try again.",
      };
    }

    return {
      valid: true,
      message: "BVN format OK — verified during KYC",
    };
  },

  async createCustomerFromOnboarding(params: {
    address: string;
    city: string;
    state: string;
    postalCode?: string;
  }): Promise<{ verificationUrl?: string }> {
    const onboardingData = this.getOnboardingData();
    if (!onboardingData) {
      throw new Error("Onboarding data not found. Please register again.");
    }

    const accountType = this.getAccountType();
    const bvn = this.getBvn();

    this.setAddress(
      params.address,
      params.city,
      params.state,
      params.postalCode,
    );

    const payload: CreateCustomerPayload = {
      email: onboardingData.email,
      password: onboardingData.password,
      firstName: onboardingData.firstName,
      lastName: onboardingData.lastName,
      phone: onboardingData.phoneNumber,
      accountType,
      address: params.address,
      city: params.city,
      state: params.state,
      postalCode: params.postalCode,
      country: "Nigeria",
      ...(bvn ? { bvn } : {}),
      ...(onboardingData.uin ? { uin: onboardingData.uin } : {}),
    };

    // W13: fail honestly. If the orchestrator endpoint is unreachable or
    // rejects, surface a truthful provisioning error — never fake success.
    let response: { data: CustomerCreateResponse };
    try {
      response = await api.post<CustomerCreateResponse>(
        "/orchestrator/customer",
        payload,
      );
    } catch (err) {
      // Log the underlying transport/server error for debugging, but show
      // the user an honest provisioning failure.
      console.error("[onboarding] customer provisioning failed:", err);
      throw new Error(
        "Account provisioning unavailable — your account could not be created right now. Please contact support or try again later.",
      );
    }
    const verificationUrl =
      response.data.verification ||
      response.data.creation_link ||
      response.data.data?.verification ||
      response.data.data?.creation_link;

    this.clearOnboarding();
    return { verificationUrl };
  },
};
