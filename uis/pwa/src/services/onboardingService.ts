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

export const onboardingService = {
  keys: KEYS,

  saveOnboardingData(data: OnboardingData): void {
    localStorage.setItem(KEYS.onboardingData, JSON.stringify(data));
  },

  getOnboardingData(): OnboardingData | null {
    const raw = localStorage.getItem(KEYS.onboardingData);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as OnboardingData;
    } catch {
      return null;
    }
  },

  setAccountType(accountType: string): void {
    localStorage.setItem(KEYS.accountType, accountType);
  },

  getAccountType(): string {
    return localStorage.getItem(KEYS.accountType) || "individual";
  },

  setBvn(bvn: string): void {
    if (bvn.trim()) {
      localStorage.setItem(KEYS.bvn, bvn.trim());
      return;
    }
    localStorage.removeItem(KEYS.bvn);
  },

  getBvn(): string {
    return localStorage.getItem(KEYS.bvn) || "";
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
    localStorage.removeItem(KEYS.onboardingData);
    localStorage.removeItem(KEYS.accountType);
    localStorage.removeItem(KEYS.bvn);
    localStorage.removeItem(KEYS.address);
    localStorage.removeItem(KEYS.city);
    localStorage.removeItem(KEYS.state);
    localStorage.removeItem(KEYS.postalCode);
  },

  verifyBvnLocally(bvn: string): { valid: boolean; message: string } {
    if (!/^\d{11}$/.test(bvn)) {
      return { valid: false, message: "BVN must be 11 digits" };
    }

    if (bvn.startsWith("0000")) {
      return {
        valid: false,
        message: "Invalid BVN. Please check and try again.",
      };
    }

    return { valid: true, message: "BVN verified successfully" };
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

    const response = await api.post<CustomerCreateResponse>(
      "/orchestrator/customer",
      payload,
    );
    const verificationUrl =
      response.data.verification ||
      response.data.creation_link ||
      response.data.data?.verification ||
      response.data.data?.creation_link;

    this.clearOnboarding();
    return { verificationUrl };
  },
};
