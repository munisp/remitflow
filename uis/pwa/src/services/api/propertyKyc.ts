/**
 * Domain module: propertyKyc — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  Bank,
  BankStatement,
  BankStatementRequest,
  BankStatementValidation,
  CreatePartyRequest,
  CreatePropertyTransactionRequest,
  FlowDocumentation,
  IncomeDocument,
  IncomeDocumentRequest,
  Party,
  PropertyTransaction,
  PropertyTransactionChecklist,
  PurchaseAgreement,
  PurchaseAgreementRequest,
  PurchaseAgreementValidation,
  SourceOfFunds,
  SourceOfFundsRequest,
  Transaction,
} from "./types";

// Property Transaction KYC Service
export const propertyKycService = {
  // Party Management
  createParty: (data: CreatePartyRequest) =>
    api.post<Party>("/property-kyc/parties", data),

  getParty: (partyId: string) =>
    api.get<Party>(`/property-kyc/parties/${partyId}`),

  verifyParty: (partyId: string, verifiedBy: string) =>
    api.put<Party>(`/property-kyc/parties/${partyId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Transaction Management
  createTransaction: (data: CreatePropertyTransactionRequest) =>
    api.post<PropertyTransaction>("/property-kyc/transactions", data),

  getTransaction: (transactionId: string) =>
    api.get<PropertyTransaction>(`/property-kyc/transactions/${transactionId}`),

  addSeller: (transactionId: string, sellerId: string) =>
    api.post<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/add-seller`,
      { seller_id: sellerId },
    ),

  // Source of Funds
  submitSourceOfFunds: (transactionId: string, data: SourceOfFundsRequest) =>
    api.post<SourceOfFunds>(
      `/property-kyc/transactions/${transactionId}/source-of-funds`,
      data,
    ),

  verifySourceOfFunds: (sofId: string, verifiedBy: string) =>
    api.put<SourceOfFunds>(`/property-kyc/source-of-funds/${sofId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Bank Statements
  uploadBankStatement: (transactionId: string, data: BankStatementRequest) =>
    api.post<BankStatement>(
      `/property-kyc/transactions/${transactionId}/bank-statements`,
      data,
    ),

  validateBankStatements: (transactionId: string) =>
    api.get<BankStatementValidation>(
      `/property-kyc/transactions/${transactionId}/bank-statements/validate`,
    ),

  // Income Documents
  uploadIncomeDocument: (transactionId: string, data: IncomeDocumentRequest) =>
    api.post<IncomeDocument>(
      `/property-kyc/transactions/${transactionId}/income-documents`,
      data,
    ),

  verifyIncomeDocument: (docId: string, verifiedBy: string) =>
    api.put<IncomeDocument>(`/property-kyc/income-documents/${docId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Purchase Agreement
  uploadPurchaseAgreement: (
    transactionId: string,
    data: PurchaseAgreementRequest,
  ) =>
    api.post<PurchaseAgreement>(
      `/property-kyc/transactions/${transactionId}/purchase-agreement`,
      data,
    ),

  validatePurchaseAgreement: (agreementId: string) =>
    api.post<PurchaseAgreementValidation>(
      `/property-kyc/purchase-agreements/${agreementId}/validate`,
    ),

  verifyPurchaseAgreement: (agreementId: string, verifiedBy: string) =>
    api.put<PurchaseAgreement>(
      `/property-kyc/purchase-agreements/${agreementId}/verify`,
      { verified_by: verifiedBy },
    ),

  // Transaction Flow
  getChecklist: (transactionId: string) =>
    api.get<PropertyTransactionChecklist>(
      `/property-kyc/transactions/${transactionId}/checklist`,
    ),

  submitForReview: (transactionId: string) =>
    api.post<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/submit-for-review`,
    ),

  approveTransaction: (
    transactionId: string,
    reviewerId: string,
    notes?: string,
  ) =>
    api.put<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/approve`,
      { reviewer_id: reviewerId, notes },
    ),

  rejectTransaction: (
    transactionId: string,
    reviewerId: string,
    reason: string,
  ) =>
    api.put<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/reject`,
      { reviewer_id: reviewerId, reason },
    ),

  // Flow Documentation
  getFlowDocumentation: () =>
    api.get<FlowDocumentation>("/property-kyc/flow-documentation"),
};
