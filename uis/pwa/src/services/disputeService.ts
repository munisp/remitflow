import { api } from "./api";

export interface Dispute {
  id: string;
  userId: string;
  transactionId: string;
  category:
    | "unauthorized_transaction"
    | "incorrect_amount"
    | "service_not_received"
    | "duplicate_charge"
    | "other";
  subject: string;
  description: string;
  disputedAmount: number;
  status: "pending" | "under_review" | "resolved" | "rejected" | "escalated";
  priority: "low" | "medium" | "high";
  resolutionNotes?: string;
  resolvedAt?: Date;
  attachments: string[];
  createdAt: Date;
  updatedAt?: Date;
}

export class DisputeService {
  // Get all disputes for the current user
  async getAllDisputes(): Promise<Dispute[]> {
    try {
      const response = await api.get("/dispute/api/v1/disputes");

      if (response.status === 200) {
        const responseData = response.data as
          | Record<string, unknown>
          | unknown[];

        // API returns array directly
        if (Array.isArray(responseData)) {
          return responseData.map((json) =>
            this.parseDispute(json as Record<string, unknown>),
          );
        }

        // Or wrapped in data property
        const dataObj = responseData as Record<string, unknown>;
        const disputesList = (dataObj.data ||
          dataObj.disputes ||
          []) as unknown[];

        if (!Array.isArray(disputesList)) {
          console.warn("Unexpected disputes response format:", responseData);
          return [];
        }

        return disputesList.map((json) =>
          this.parseDispute(json as Record<string, unknown>),
        );
      } else {
        throw new Error("Failed to fetch disputes");
      }
    } catch (error: unknown) {
      console.error("Error fetching disputes:", error);
      throw new Error("Failed to fetch disputes");
    }
  }

  // Get a specific dispute by ID
  async getDisputeById(id: string): Promise<Dispute> {
    try {
      const response = await api.get(`/dispute/dispute/${id}`);

      if (response.status === 200) {
        const data = response.data as Record<string, unknown>;
        const disputeData = (data.data || data) as Record<string, unknown>;
        return this.parseDispute(disputeData);
      } else {
        throw new Error("Failed to fetch dispute details");
      }
    } catch (error: unknown) {
      console.error("Error fetching dispute:", error);
      throw new Error("Failed to fetch dispute details");
    }
  }

  // Create a new dispute
  async createDispute(data: {
    transactionId: string;
    disputeType: string;
    description: string;
  }): Promise<Dispute> {
    try {
      const requestData = {
        transaction_id: data.transactionId,
        dispute_type: data.disputeType,
        description: data.description,
      };

      const response = await api.post("/dispute/api/v1/disputes", requestData);

      if (response.status === 200 || response.status === 201) {
        const responseData = response.data as Record<string, unknown>;
        // Handle different response structures
        const disputeData = (responseData.data ||
          responseData.dispute ||
          responseData) as Record<string, unknown>;

        // If we have dispute data, try to parse it
        if (disputeData && (disputeData.id || disputeData.dispute_id)) {
          return this.parseDispute(disputeData);
        }

        // If dispute was created but we can't parse it, return a minimal dispute object
        return {
          id: String(disputeData?.id || disputeData?.dispute_id || "unknown"),
          userId: String(
            disputeData?.user_id ||
              disputeData?.userId ||
              disputeData?.customer_id ||
              "",
          ),
          transactionId: data.transactionId,
          category: "other",
          subject: data.disputeType,
          description: data.description,
          disputedAmount: 0,
          status: "pending",
          priority: "medium",
          attachments: [],
          createdAt: new Date(),
        };
      } else {
        throw new Error("Failed to create dispute");
      }
    } catch (error: unknown) {
      // Handle parsing error - dispute was created successfully
      if (
        error instanceof Error &&
        error.message.includes("Cannot read properties")
      ) {
        return {
          id: "unknown",
          userId: "",
          transactionId: data.transactionId,
          category: "other",
          subject: data.disputeType,
          description: data.description,
          disputedAmount: 0,
          status: "pending",
          priority: "medium",
          attachments: [],
          createdAt: new Date(),
        };
      }
      console.error("Error creating dispute:", error);
      throw new Error("Failed to create dispute");
    }
  }

  // Update dispute
  async updateDispute(
    id: string,
    data: {
      subject?: string;
      description?: string;
      category?: string;
      attachments?: string[];
    },
  ): Promise<Dispute> {
    try {
      const updateData: Record<string, unknown> = {};
      if (data.subject) updateData.subject = data.subject;
      if (data.description) updateData.description = data.description;
      if (data.category) updateData.category = data.category;
      if (data.attachments) updateData.attachments = data.attachments;

      const response = await api.put(`/dispute/dispute/${id}`, updateData);

      if (response.status === 200) {
        const responseData = response.data as Record<string, unknown>;
        const disputeData = (responseData.data || responseData) as Record<
          string,
          unknown
        >;
        return this.parseDispute(disputeData);
      } else {
        throw new Error("Failed to update dispute");
      }
    } catch (error: unknown) {
      console.error("Error updating dispute:", error);
      throw new Error("Failed to update dispute");
    }
  }

  // Delete dispute
  async deleteDispute(
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.delete(`/dispute/dispute/${id}`);

      if (response.status === 200) {
        return {
          success: true,
          message: "Dispute deleted successfully",
        };
      } else {
        return {
          success: false,
          message: "Failed to delete dispute",
        };
      }
    } catch (error: unknown) {
      console.error("Error deleting dispute:", error);
      return {
        success: false,
        message: "Error deleting dispute",
      };
    }
  }

  // Add comment to dispute
  async addComment(disputeId: string, comment: string): Promise<void> {
    try {
      const response = await api.post(
        `/dispute/dispute/${disputeId}/comments`,
        {
          comment,
        },
      );

      if (response.status !== 200 && response.status !== 201) {
        throw new Error("Failed to add comment");
      }
    } catch (error: unknown) {
      console.error("Error adding comment:", error);
      throw new Error("Failed to add comment");
    }
  }

  // Get dispute comments
  async getDisputeComments(
    disputeId: string,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const response = await api.get(`/dispute/dispute/${disputeId}/comments`);

      if (response.status === 200) {
        const data = response.data as Record<string, unknown>;
        return (data.data || data.comments || []) as unknown[] as Array<
          Record<string, unknown>
        >;
      } else {
        throw new Error("Failed to fetch comments");
      }
    } catch (error: unknown) {
      console.error("Error fetching comments:", error);
      throw new Error("Failed to fetch comments");
    }
  }

  // Cancel dispute
  async cancelDispute(id: string): Promise<Dispute> {
    try {
      const response = await api.post(`/dispute/dispute/${id}/cancel`);

      if (response.status === 200) {
        const data = response.data as Record<string, unknown>;
        const disputeData = (data.data || data) as Record<string, unknown>;
        return this.parseDispute(disputeData);
      } else {
        throw new Error("Failed to cancel dispute");
      }
    } catch (error: unknown) {
      console.error("Error canceling dispute:", error);
      throw new Error("Failed to cancel dispute");
    }
  }

  // Escalate dispute
  async escalateDispute(id: string, reason?: string): Promise<Dispute> {
    try {
      const requestData: Record<string, unknown> = {};
      if (reason) requestData.reason = reason;

      const response = await api.post(
        `/dispute/dispute/${id}/escalate`,
        requestData,
      );

      if (response.status === 200) {
        const data = response.data as Record<string, unknown>;
        const disputeData = (data.data || data) as Record<string, unknown>;
        return this.parseDispute(disputeData);
      } else {
        throw new Error("Failed to escalate dispute");
      }
    } catch (error: unknown) {
      console.error("Error escalating dispute:", error);
      throw new Error("Failed to escalate dispute");
    }
  }

  // Upload attachment
  async uploadAttachment(disputeId: string, filePath: string): Promise<string> {
    try {
      const response = await api.post(`/dispute/${disputeId}/attachments`, {
        file_path: filePath,
      });

      if (response.status === 200 || response.status === 201) {
        const data = response.data as Record<string, unknown>;
        const attachmentData = (data.data || data) as Record<string, unknown>;
        return (attachmentData?.url ||
          attachmentData?.file_url ||
          "") as string;
      } else {
        throw new Error("Failed to upload attachment");
      }
    } catch (error: unknown) {
      console.error("Error uploading attachment:", error);
      throw new Error("Failed to upload attachment");
    }
  }

  // Helper method to map dispute_type to category
  private mapDisputeTypeToCategory(disputeType: string): Dispute["category"] {
    const typeMap: Record<string, Dispute["category"]> = {
      UNAUTHORIZED: "unauthorized_transaction",
      INSURANCE: "other",
      INCORRECT_AMOUNT: "incorrect_amount",
      SERVICE_NOT_RECEIVED: "service_not_received",
      DUPLICATE: "duplicate_charge",
      OTHER: "other",
    };
    return typeMap[disputeType] || "other";
  }

  // Helper method to map API status to Dispute status
  private mapStatus(apiStatus: string): Dispute["status"] {
    const statusMap: Record<string, Dispute["status"]> = {
      open: "pending",
      pending: "pending",
      under_review: "under_review",
      review: "under_review",
      resolved: "resolved",
      rejected: "rejected",
      escalated: "escalated",
    };
    return statusMap[apiStatus.toLowerCase()] || "pending";
  }

  // Helper method to get display subject from dispute type
  private getSubjectFromDisputeType(disputeType: string): string {
    const typeMap: Record<string, string> = {
      UNAUTHORIZED: "Unauthorized Transaction",
      INSURANCE: "Insurance Dispute",
      INCORRECT_AMOUNT: "Incorrect Amount",
      SERVICE_NOT_RECEIVED: "Service Not Received",
      DUPLICATE: "Duplicate Charge",
      OTHER: "Other Dispute",
    };
    return typeMap[disputeType] || disputeType;
  }

  // Helper method to parse dispute from JSON
  private parseDispute(json: Record<string, unknown>): Dispute {
    const disputeType = (json.dispute_type ||
      json.category ||
      "OTHER") as string;
    const apiStatus = (json.status || "open") as string;

    return {
      id: String(json.dispute_id || json.id || ""),
      userId: (json.customer_id || json.user_id || json.userId || "") as string,
      transactionId: (json.transaction_id ||
        json.transactionId ||
        "") as string,
      category: json.category
        ? (json.category as Dispute["category"])
        : this.mapDisputeTypeToCategory(disputeType),
      subject: (json.subject ||
        this.getSubjectFromDisputeType(disputeType)) as string,
      description: (json.description || "") as string,
      disputedAmount: (json.amount ||
        json.disputed_amount ||
        json.disputedAmount ||
        0) as number,
      status: this.mapStatus(apiStatus),
      priority: (json.priority || "medium") as Dispute["priority"],
      resolutionNotes: (json.resolution ||
        json.resolution_notes ||
        json.resolutionNotes) as string | undefined,
      resolvedAt: json.resolved_at
        ? new Date(json.resolved_at as string)
        : undefined,
      attachments: (json.attachments || []) as string[],
      createdAt: new Date(
        (json.created_at ||
          json.createdAt ||
          new Date().toISOString()) as string,
      ),
      updatedAt: json.updated_at
        ? new Date(json.updated_at as string)
        : undefined,
    };
  }
}

export const disputeService = new DisputeService();
