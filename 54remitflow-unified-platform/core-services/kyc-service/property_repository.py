"""
Property Transaction KYC Repository Layer
Database operations for property transactions using SQLAlchemy
"""

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
from decimal import Decimal
import logging

from property_models import (
    PropertyParty, PropertyTransaction, PropertySourceOfFunds,
    PropertyBankStatement, PropertyIncomeDocument, PropertyPurchaseAgreement,
    PropertyTransactionAuditLog, PartyRoleEnum, SourceOfFundsEnum,
    TransactionStatusEnum, PropertyVerificationStatusEnum,
    IncomeDocumentTypeEnum, VALID_STATUS_TRANSITIONS
)

logger = logging.getLogger(__name__)


class StateTransitionError(Exception):
    """Raised when an invalid state transition is attempted"""
    pass


class PropertyPartyRepository:
    """Repository for PropertyParty operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, **kwargs) -> PropertyParty:
        """Create a new property party"""
        party = PropertyParty(**kwargs)
        self.db.add(party)
        self.db.commit()
        self.db.refresh(party)
        return party
    
    def get_by_id(self, party_id: str) -> Optional[PropertyParty]:
        """Get party by ID"""
        return self.db.query(PropertyParty).filter(PropertyParty.id == party_id).first()
    
    def get_by_user_id(self, user_id: str) -> List[PropertyParty]:
        """Get all parties for a user"""
        return self.db.query(PropertyParty).filter(PropertyParty.user_id == user_id).all()
    
    def get_by_bvn(self, bvn: str) -> Optional[PropertyParty]:
        """Get party by BVN"""
        return self.db.query(PropertyParty).filter(PropertyParty.bvn == bvn).first()
    
    def update_kyc_status(
        self,
        party: PropertyParty,
        status: PropertyVerificationStatusEnum,
        verified_by: str
    ) -> PropertyParty:
        """Update party KYC status"""
        party.kyc_status = status
        party.kyc_verified_at = datetime.utcnow()
        party.kyc_verified_by = verified_by
        party.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(party)
        return party
    
    def update_screening_results(
        self,
        party: PropertyParty,
        screening_result_id: str,
        sanctions_clear: bool,
        pep_clear: bool
    ) -> PropertyParty:
        """Update party screening results from compliance service"""
        party.screening_result_id = screening_result_id
        party.sanctions_clear = sanctions_clear
        party.pep_clear = pep_clear
        party.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(party)
        return party


class PropertyTransactionRepository:
    """Repository for PropertyTransaction operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(
        self,
        buyer_id: str,
        property_type: str,
        property_address: str,
        purchase_price: Decimal,
        currency: str = "NGN"
    ) -> PropertyTransaction:
        """Create a new property transaction"""
        transaction = PropertyTransaction(
            buyer_id=buyer_id,
            property_type=property_type,
            property_address=property_address,
            purchase_price=purchase_price,
            currency=currency,
            status=TransactionStatusEnum.BUYER_KYC_PENDING,
            status_history=[{
                "status": TransactionStatusEnum.INITIATED.value,
                "timestamp": datetime.utcnow().isoformat(),
                "note": "Transaction initiated"
            }]
        )
        self.db.add(transaction)
        self.db.commit()
        self.db.refresh(transaction)
        return transaction
    
    def get_by_id(self, transaction_id: str) -> Optional[PropertyTransaction]:
        """Get transaction by ID"""
        return self.db.query(PropertyTransaction).filter(
            PropertyTransaction.id == transaction_id
        ).first()
    
    def get_by_reference(self, reference_number: str) -> Optional[PropertyTransaction]:
        """Get transaction by reference number"""
        return self.db.query(PropertyTransaction).filter(
            PropertyTransaction.reference_number == reference_number
        ).first()
    
    def get_by_buyer(self, buyer_id: str) -> List[PropertyTransaction]:
        """Get all transactions for a buyer"""
        return self.db.query(PropertyTransaction).filter(
            PropertyTransaction.buyer_id == buyer_id
        ).order_by(PropertyTransaction.created_at.desc()).all()
    
    def get_by_status(
        self,
        status: TransactionStatusEnum,
        limit: int = 100
    ) -> List[PropertyTransaction]:
        """Get transactions by status"""
        return self.db.query(PropertyTransaction).filter(
            PropertyTransaction.status == status
        ).order_by(PropertyTransaction.created_at).limit(limit).all()
    
    def get_pending_review(self, limit: int = 100) -> List[PropertyTransaction]:
        """Get transactions pending compliance review"""
        return self.db.query(PropertyTransaction).filter(
            PropertyTransaction.status == TransactionStatusEnum.UNDER_REVIEW
        ).order_by(PropertyTransaction.created_at).limit(limit).all()
    
    def transition_status(
        self,
        transaction: PropertyTransaction,
        new_status: TransactionStatusEnum,
        note: str,
        actor_id: Optional[str] = None
    ) -> PropertyTransaction:
        """Transition transaction to a new status with state machine enforcement"""
        current_status = transaction.status
        
        # Validate transition
        valid_next_states = VALID_STATUS_TRANSITIONS.get(current_status, [])
        if new_status not in valid_next_states:
            raise StateTransitionError(
                f"Invalid transition from {current_status.value} to {new_status.value}. "
                f"Valid transitions: {[s.value for s in valid_next_states]}"
            )
        
        # Update status
        old_status = transaction.status
        transaction.status = new_status
        transaction.updated_at = datetime.utcnow()
        
        # Add to history
        history_entry = {
            "status": new_status.value,
            "timestamp": datetime.utcnow().isoformat(),
            "note": note,
            "previous_status": old_status.value
        }
        if actor_id:
            history_entry["actor_id"] = actor_id
        
        if transaction.status_history is None:
            transaction.status_history = []
        transaction.status_history.append(history_entry)
        
        # Set timestamps for terminal states
        if new_status == TransactionStatusEnum.APPROVED:
            transaction.approved_at = datetime.utcnow()
        elif new_status == TransactionStatusEnum.COMPLETED:
            transaction.completed_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(transaction)
        return transaction
    
    def add_seller(self, transaction: PropertyTransaction, seller_id: str) -> PropertyTransaction:
        """Add seller to transaction"""
        transaction.seller_id = seller_id
        transaction.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(transaction)
        return transaction
    
    def update_compliance_results(
        self,
        transaction: PropertyTransaction,
        aml_passed: bool,
        sanctions_passed: bool,
        pep_passed: bool,
        compliance_case_id: Optional[str] = None
    ) -> PropertyTransaction:
        """Update compliance check results"""
        transaction.aml_check_passed = aml_passed
        transaction.sanctions_check_passed = sanctions_passed
        transaction.pep_check_passed = pep_passed
        transaction.compliance_case_id = compliance_case_id
        transaction.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(transaction)
        return transaction
    
    def update_risk_score(
        self,
        transaction: PropertyTransaction,
        risk_score: int,
        risk_flags: List[str]
    ) -> PropertyTransaction:
        """Update risk score and flags"""
        transaction.risk_score = min(risk_score, 100)
        transaction.risk_flags = risk_flags
        transaction.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(transaction)
        return transaction
    
    def get_checklist(self, transaction: PropertyTransaction) -> Dict[str, Any]:
        """Get KYC checklist status for transaction"""
        buyer = transaction.buyer
        seller = transaction.seller
        
        return {
            "transaction_id": transaction.id,
            "reference_number": transaction.reference_number,
            "status": transaction.status.value,
            "requirements": {
                "buyer_government_id": {
                    "required": True,
                    "status": "complete" if buyer and buyer.kyc_status == PropertyVerificationStatusEnum.APPROVED else "pending",
                    "description": "Government issued ID of buyer"
                },
                "seller_government_id": {
                    "required": True,
                    "status": "complete" if seller and seller.kyc_status == PropertyVerificationStatusEnum.APPROVED else "pending",
                    "description": "Government issued ID of seller (counterparty)"
                },
                "source_of_funds": {
                    "required": True,
                    "status": "complete" if transaction.source_of_funds_verified else "pending",
                    "description": "Declaration and verification of source of funds"
                },
                "bank_statements_3_months": {
                    "required": True,
                    "status": "complete" if transaction.bank_statements_cover_3_months and transaction.bank_statements_verified else "pending",
                    "description": "Three months of bank statements showing regular income"
                },
                "income_document": {
                    "required": True,
                    "status": "complete" if transaction.income_verified else "pending",
                    "description": "W-2, PAYE, or similar income verification document"
                },
                "purchase_agreement": {
                    "required": True,
                    "status": "complete" if transaction.purchase_agreement_verified else "pending",
                    "description": "Signed purchase agreement with buyer/seller info, property details, transaction terms"
                }
            },
            "compliance_checks": {
                "aml_check": transaction.aml_check_passed,
                "sanctions_check": transaction.sanctions_check_passed,
                "pep_check": transaction.pep_check_passed
            },
            "risk_assessment": {
                "risk_score": transaction.risk_score,
                "risk_flags": transaction.risk_flags
            },
            "ready_for_approval": all([
                buyer and buyer.kyc_status == PropertyVerificationStatusEnum.APPROVED,
                seller and seller.kyc_status == PropertyVerificationStatusEnum.APPROVED,
                transaction.source_of_funds_verified,
                transaction.bank_statements_cover_3_months,
                transaction.income_verified,
                transaction.purchase_agreement_verified
            ])
        }


class PropertySourceOfFundsRepository:
    """Repository for PropertySourceOfFunds operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, transaction_id: str, **kwargs) -> PropertySourceOfFunds:
        """Create source of funds declaration"""
        sof = PropertySourceOfFunds(transaction_id=transaction_id, **kwargs)
        
        # Add risk flags based on source
        risk_flags = []
        if sof.primary_source == SourceOfFundsEnum.GIFT:
            risk_flags.append("gift_requires_donor_verification")
        if sof.primary_source == SourceOfFundsEnum.OTHER:
            risk_flags.append("unspecified_source_requires_review")
        sof.risk_flags = risk_flags
        
        self.db.add(sof)
        self.db.commit()
        self.db.refresh(sof)
        return sof
    
    def get_by_id(self, sof_id: str) -> Optional[PropertySourceOfFunds]:
        """Get source of funds by ID"""
        return self.db.query(PropertySourceOfFunds).filter(
            PropertySourceOfFunds.id == sof_id
        ).first()
    
    def get_by_transaction(self, transaction_id: str) -> Optional[PropertySourceOfFunds]:
        """Get source of funds for a transaction"""
        return self.db.query(PropertySourceOfFunds).filter(
            PropertySourceOfFunds.transaction_id == transaction_id
        ).first()
    
    def verify(
        self,
        sof: PropertySourceOfFunds,
        status: PropertyVerificationStatusEnum,
        verified_by: str,
        notes: Optional[str] = None
    ) -> PropertySourceOfFunds:
        """Verify source of funds"""
        sof.status = status
        sof.verified_at = datetime.utcnow()
        sof.verified_by = verified_by
        sof.reviewer_notes = notes
        self.db.commit()
        self.db.refresh(sof)
        return sof


class PropertyBankStatementRepository:
    """Repository for PropertyBankStatement operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, transaction_id: str, party_id: str, **kwargs) -> PropertyBankStatement:
        """Create bank statement record"""
        # Mask account number
        account_number = kwargs.get('account_number', '')
        if len(account_number) >= 4:
            kwargs['account_number'] = f"****{account_number[-4:]}"
        
        statement = PropertyBankStatement(
            transaction_id=transaction_id,
            party_id=party_id,
            **kwargs
        )
        self.db.add(statement)
        self.db.commit()
        self.db.refresh(statement)
        return statement
    
    def get_by_id(self, statement_id: str) -> Optional[PropertyBankStatement]:
        """Get statement by ID"""
        return self.db.query(PropertyBankStatement).filter(
            PropertyBankStatement.id == statement_id
        ).first()
    
    def get_by_transaction(self, transaction_id: str) -> List[PropertyBankStatement]:
        """Get all statements for a transaction"""
        return self.db.query(PropertyBankStatement).filter(
            PropertyBankStatement.transaction_id == transaction_id
        ).order_by(PropertyBankStatement.statement_start_date).all()
    
    def validate_coverage(self, transaction_id: str) -> Dict[str, Any]:
        """Validate that bank statements cover at least 3 months"""
        statements = self.get_by_transaction(transaction_id)
        
        if not statements:
            return {
                "valid": False,
                "message": "No bank statements provided",
                "coverage_days": 0,
                "required_days": 90
            }
        
        # Find earliest and latest dates
        all_dates = []
        for stmt in statements:
            all_dates.append(stmt.statement_start_date)
            all_dates.append(stmt.statement_end_date)
        
        earliest = min(all_dates)
        latest = max(all_dates)
        coverage_days = (latest - earliest).days
        
        # Check if statements are recent (within last 6 months)
        today = date.today()
        if latest < today - timedelta(days=180):
            return {
                "valid": False,
                "message": "Bank statements are too old (must be within last 6 months)",
                "coverage_days": coverage_days,
                "required_days": 90,
                "latest_statement_date": latest.isoformat()
            }
        
        # Check 3-month coverage
        if coverage_days >= 90:
            return {
                "valid": True,
                "message": f"Bank statements cover {coverage_days} days (minimum 90 required)",
                "coverage_days": coverage_days,
                "required_days": 90,
                "date_range": f"{earliest.isoformat()} to {latest.isoformat()}"
            }
        
        return {
            "valid": False,
            "message": f"Bank statements only cover {coverage_days} days (minimum 90 required)",
            "coverage_days": coverage_days,
            "required_days": 90,
            "gap_days": 90 - coverage_days
        }
    
    def verify(
        self,
        statement: PropertyBankStatement,
        status: PropertyVerificationStatusEnum,
        verified_by: str
    ) -> PropertyBankStatement:
        """Verify bank statement"""
        statement.status = status
        statement.verified_at = datetime.utcnow()
        statement.verified_by = verified_by
        self.db.commit()
        self.db.refresh(statement)
        return statement


class PropertyIncomeDocumentRepository:
    """Repository for PropertyIncomeDocument operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, transaction_id: str, party_id: str, **kwargs) -> PropertyIncomeDocument:
        """Create income document record"""
        doc = PropertyIncomeDocument(
            transaction_id=transaction_id,
            party_id=party_id,
            **kwargs
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc
    
    def get_by_id(self, doc_id: str) -> Optional[PropertyIncomeDocument]:
        """Get document by ID"""
        return self.db.query(PropertyIncomeDocument).filter(
            PropertyIncomeDocument.id == doc_id
        ).first()
    
    def get_by_transaction(self, transaction_id: str) -> List[PropertyIncomeDocument]:
        """Get all income documents for a transaction"""
        return self.db.query(PropertyIncomeDocument).filter(
            PropertyIncomeDocument.transaction_id == transaction_id
        ).all()
    
    def verify(
        self,
        doc: PropertyIncomeDocument,
        status: PropertyVerificationStatusEnum,
        verified_by: str
    ) -> PropertyIncomeDocument:
        """Verify income document"""
        doc.status = status
        doc.verified_at = datetime.utcnow()
        doc.verified_by = verified_by
        self.db.commit()
        self.db.refresh(doc)
        return doc
    
    def all_verified(self, transaction_id: str) -> bool:
        """Check if all income documents for a transaction are verified"""
        docs = self.get_by_transaction(transaction_id)
        if not docs:
            return False
        return all(d.status == PropertyVerificationStatusEnum.APPROVED for d in docs)


class PropertyPurchaseAgreementRepository:
    """Repository for PropertyPurchaseAgreement operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, transaction_id: str, **kwargs) -> PropertyPurchaseAgreement:
        """Create purchase agreement record"""
        agreement = PropertyPurchaseAgreement(
            transaction_id=transaction_id,
            **kwargs
        )
        self.db.add(agreement)
        self.db.commit()
        self.db.refresh(agreement)
        return agreement
    
    def get_by_id(self, agreement_id: str) -> Optional[PropertyPurchaseAgreement]:
        """Get agreement by ID"""
        return self.db.query(PropertyPurchaseAgreement).filter(
            PropertyPurchaseAgreement.id == agreement_id
        ).first()
    
    def get_by_transaction(self, transaction_id: str) -> Optional[PropertyPurchaseAgreement]:
        """Get agreement for a transaction"""
        return self.db.query(PropertyPurchaseAgreement).filter(
            PropertyPurchaseAgreement.transaction_id == transaction_id
        ).first()
    
    def validate_parties(
        self,
        agreement: PropertyPurchaseAgreement,
        buyer: PropertyParty,
        seller: PropertyParty
    ) -> Dict[str, Any]:
        """Validate that agreement parties match KYC records"""
        issues = []
        
        def normalize(name: str) -> str:
            return name.lower().strip().replace("  ", " ")
        
        buyer_full_name = f"{buyer.first_name} {buyer.last_name}"
        seller_full_name = f"{seller.first_name} {seller.last_name}"
        
        # Check buyer name
        buyer_match = normalize(agreement.buyer_name) == normalize(buyer_full_name)
        if not buyer_match:
            issues.append(f"Buyer name mismatch: Agreement has '{agreement.buyer_name}', KYC has '{buyer_full_name}'")
        
        # Check seller name
        seller_match = normalize(agreement.seller_name) == normalize(seller_full_name)
        if not seller_match:
            issues.append(f"Seller name mismatch: Agreement has '{agreement.seller_name}', KYC has '{seller_full_name}'")
        
        # Check signatures
        if not agreement.buyer_signed:
            issues.append("Buyer signature missing")
        if not agreement.seller_signed:
            issues.append("Seller signature missing")
        
        # Check dates
        if agreement.buyer_signature_date and agreement.seller_signature_date:
            if agreement.buyer_signature_date > date.today() or agreement.seller_signature_date > date.today():
                issues.append("Signature dates cannot be in the future")
        
        # Update agreement with validation results
        agreement.buyer_info_matches_kyc = buyer_match
        agreement.seller_info_matches_kyc = seller_match
        self.db.commit()
        
        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "buyer_name_match": buyer_match,
            "seller_name_match": seller_match,
            "both_signed": agreement.buyer_signed and agreement.seller_signed
        }
    
    def verify(
        self,
        agreement: PropertyPurchaseAgreement,
        status: PropertyVerificationStatusEnum,
        verified_by: str,
        rejection_reason: Optional[str] = None
    ) -> PropertyPurchaseAgreement:
        """Verify purchase agreement"""
        agreement.status = status
        agreement.verified_at = datetime.utcnow()
        agreement.verified_by = verified_by
        if status == PropertyVerificationStatusEnum.REJECTED:
            agreement.rejection_reason = rejection_reason
        self.db.commit()
        self.db.refresh(agreement)
        return agreement


class PropertyAuditLogRepository:
    """Repository for PropertyTransactionAuditLog operations"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def log(
        self,
        transaction_id: str,
        action: str,
        action_type: str,
        actor_id: Optional[str] = None,
        actor_type: Optional[str] = None,
        old_status: Optional[str] = None,
        new_status: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[Dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        correlation_id: Optional[str] = None
    ) -> PropertyTransactionAuditLog:
        """Create audit log entry"""
        log_entry = PropertyTransactionAuditLog(
            transaction_id=transaction_id,
            action=action,
            action_type=action_type,
            actor_id=actor_id,
            actor_type=actor_type,
            old_status=old_status,
            new_status=new_status,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            ip_address=ip_address,
            user_agent=user_agent,
            correlation_id=correlation_id
        )
        self.db.add(log_entry)
        self.db.commit()
        self.db.refresh(log_entry)
        return log_entry
    
    def get_by_transaction(
        self,
        transaction_id: str,
        limit: int = 100
    ) -> List[PropertyTransactionAuditLog]:
        """Get audit logs for a transaction"""
        return self.db.query(PropertyTransactionAuditLog).filter(
            PropertyTransactionAuditLog.transaction_id == transaction_id
        ).order_by(PropertyTransactionAuditLog.created_at.desc()).limit(limit).all()
    
    def get_by_action(
        self,
        action: str,
        limit: int = 100
    ) -> List[PropertyTransactionAuditLog]:
        """Get audit logs by action type"""
        return self.db.query(PropertyTransactionAuditLog).filter(
            PropertyTransactionAuditLog.action == action
        ).order_by(PropertyTransactionAuditLog.created_at.desc()).limit(limit).all()
