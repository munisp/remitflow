/**
 * Card Service - Integration with Core Banking Card Service
 * Matches customer banking implementation
 */

import { api } from "./api";

export enum CardType {
  DEBIT = "debit",
  CREDIT = "credit",
  VIRTUAL = "virtual",
}

export enum CardStatus {
  ACTIVE = "active",
  BLOCKED = "blocked",
  FROZEN = "frozen",
  LOST = "lost",
}

export interface Card {
  id: string;
  userId: string;
  accountId: string;
  cardType: string;
  cardNumber: string;
  maskedCardNumber: string;
  expiryDate: string;
  cvv?: string;
  status: string;
  issuedAt: Date;
  activatedAt?: Date;
  blockedAt?: Date;
  dailyLimit?: number;
  monthlyLimit?: number;
  nameOnCard?: string;
  name_on_card?: string;
}

export interface VirtualCard {
  id: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  cardType: string;
  currency: string;
  balance: number;
  limit: number;
  status: "active" | "frozen" | "expired";
  createdAt: string;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  merchant: string;
  status: string;
  createdAt: string;
}

// Card Service - Matches customer banking API
export const cardService = {
  /**
   * Issue a new card
   */
  async issueCard(params: {
    accountId: string;
    cardType: string;
    nameOnCard: string;
  }): Promise<{ success: boolean; message: string; data?: Card }> {
    try {
      const response = await api.post(`/card/api/v1/cards/issue`, {
        account_id: String(params.accountId),
        card_type: params.cardType,
        name_on_card: params.nameOnCard,
      });

      const data = response.data as {
        success?: boolean;
        message?: string;
        data?: any;
      };
      if (
        data.success === true ||
        response.status === 200 ||
        response.status === 201
      ) {
        return {
          success: true,
          message: data.message || "Card issued successfully",
          data: data.data || data,
        };
      } else {
        return {
          success: false,
          message: data.message || "Card issuance failed",
        };
      }
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      return {
        success: false,
        message:
          err.response?.data?.message || err.message || "Error issuing card",
      };
    }
  },

  /**
   * Get all customer cards
   */
  async getCustomerCards(): Promise<{
    success: boolean;
    data?: Card[];
    message?: string;
  }> {
    try {
      const response = await api.get(`/card/api/v1/cards/customer`);

      if (response.status === 200 || response.status === 201) {
        const responseData = response.data as
          | { cards?: any[]; data?: any[]; message?: string }
          | any[];
        let cardsData: any[] = [];

        if (Array.isArray(responseData)) {
          cardsData = responseData;
        } else if (responseData.cards && Array.isArray(responseData.cards)) {
          cardsData = responseData.cards;
        } else if (responseData.data && Array.isArray(responseData.data)) {
          cardsData = responseData.data;
        }

        const mappedCards: Card[] = cardsData.map((card: any) => ({
          id: String(card.card_id || card.id || ""),
          userId: card.customer_id || "",
          accountId: String(card.account_id || ""),
          cardType: card.card_type || "virtual",
          cardNumber: card.card_number || "",
          maskedCardNumber: card.card_number || card.maskedCardNumber || "",
          expiryDate: card.expiry_date || card.expiryDate || "",
          cvv: card.cvv || "***",
          status: card.status || "active",
          issuedAt: card.created_at ? new Date(card.created_at) : new Date(),
          activatedAt: card.activated_at
            ? new Date(card.activated_at)
            : undefined,
          blockedAt: card.blocked_at ? new Date(card.blocked_at) : undefined,
          dailyLimit: card.daily_limit,
          monthlyLimit: card.monthly_limit,
          nameOnCard: card.name_on_card || "",
          name_on_card: card.name_on_card || "",
        }));

        return {
          success: true,
          data: mappedCards,
        };
      } else {
        const data = response.data as { message?: string };
        return {
          success: false,
          message: data.message || "Failed to fetch cards",
        };
      }
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      return {
        success: false,
        message:
          err.response?.data?.message || err.message || "Error fetching cards",
      };
    }
  },

  /**
   * Set card PIN
   */
  async setCardPin(
    cardId: string,
    pin: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`/card/api/v1/cards/${cardId}/set-pin`, {
        pin: String(pin),
      });

      const data = response.data as { success?: boolean; message?: string };
      if (
        data.success === true ||
        response.status === 200 ||
        response.status === 201
      ) {
        return {
          success: true,
          message: data.message || "PIN set successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to set PIN",
        };
      }
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      return {
        success: false,
        message:
          err.response?.data?.message || err.message || "Error setting PIN",
      };
    }
  },

  /**
   * Block a card
   */
  async blockCard(
    cardId: string,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`/card/api/v1/cards/${cardId}/block`, {
        reason,
      });

      const data = response.data as { success?: boolean; message?: string };
      if (data.success === true || response.status === 200) {
        return {
          success: true,
          message: data.message || "Card blocked successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to block card",
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Error blocking card",
      };
    }
  },

  /**
   * Unblock a card
   */
  async unblockCard(
    cardId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`/card/api/v1/cards/${cardId}/unblock`);

      const data = response.data as { success?: boolean; message?: string };
      if (data.success === true || response.status === 200) {
        return {
          success: true,
          message: data.message || "Card unblocked successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to unblock card",
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Error unblocking card",
      };
    }
  },

  /**
   * Freeze a card
   */
  async freezeCard(
    cardId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`/card/api/v1/cards/${cardId}/freeze`);

      const data = response.data as { success?: boolean; message?: string };
      if (
        data.success === true ||
        response.status === 200 ||
        response.status === 201
      ) {
        return {
          success: true,
          message: data.message || "Card frozen successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to freeze card",
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Error freezing card",
      };
    }
  },

  /**
   * Unfreeze a card
   */
  async unfreezeCard(
    cardId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`/card/api/v1/cards/${cardId}/unfreeze`);

      const data = response.data as { success?: boolean; message?: string };
      if (
        data.success === true ||
        response.status === 200 ||
        response.status === 201
      ) {
        return {
          success: true,
          message: data.message || "Card unfrozen successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to unfreeze card",
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Error unfreezing card",
      };
    }
  },

  /**
   * Update card limits
   */
  async updateCardLimits(
    cardId: string,
    dailyLimit?: number,
    monthlyLimit?: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.put(`/card/api/v1/cards/${cardId}/limits`, {
        daily_limit: dailyLimit,
        monthly_limit: monthlyLimit,
      });

      const data = response.data as { success?: boolean; message?: string };
      if (data.success === true || response.status === 200) {
        return {
          success: true,
          message: data.message || "Card limits updated successfully",
        };
      } else {
        return {
          success: false,
          message: data.message || "Failed to update card limits",
        };
      }
    } catch (error: unknown) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Error updating card limits",
      };
    }
  },
};

export default cardService;
