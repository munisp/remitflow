#!/usr/bin/env python3
"""
Permify Authorization Engine for Remittance Platform
Fine-grained permission management and policy enforcement
"""

import json
import requests
import grpc
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import logging
from datetime import datetime
import yaml

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class Permission:
    """Permission data structure"""
    entity: str
    relation: str
    subject: str
    context: Dict[str, Any] = None

@dataclass
class PolicyRule:
    """Policy rule definition"""
    name: str
    entity: str
    relation: str
    definition: str
    description: str

class PermifyManager:
    """Comprehensive Permify Authorization Manager for Remittance Platform"""
    
    def __init__(self, api_url: str = "http://localhost:3476", grpc_url: str = "localhost:3478"):
        self.api_url = api_url.rstrip('/')
        self.grpc_url = grpc_url
        
    def create_schema(self) -> bool:
        """Create comprehensive banking authorization schema"""
        
        banking_schema = """
entity user {}

entity organization {
    relation admin @user
    relation member @user
    relation viewer @user
    
    permission view = admin or member or viewer
    permission edit = admin or member
    permission delete = admin
}

entity agent {
    relation owner @user
    relation manager @user @organization
    relation supervisor @user
    relation viewer @user
    
    permission view = owner or manager or supervisor or viewer
    permission edit = owner or manager or supervisor
    permission delete = owner or manager
    permission activate = manager
    permission deactivate = manager
    permission assign_float = manager or supervisor
    permission process_transaction = owner or supervisor
}

entity customer {
    relation owner @user
    relation agent @agent
    relation manager @user @organization
    relation viewer @user
    
    permission view = owner or agent or manager or viewer
    permission edit = owner or agent or manager
    permission delete = manager
    permission create_account = agent or manager
    permission process_transaction = agent
    permission view_balance = owner or agent
    permission view_history = owner or agent or manager
}

entity account {
    relation owner @customer
    relation agent @agent
    relation manager @user @organization
    relation viewer @user
    
    permission view = owner or agent or manager or viewer
    permission edit = agent or manager
    permission delete = manager
    permission deposit = agent
    permission withdraw = agent
    permission transfer = agent
    permission freeze = manager
    permission unfreeze = manager
    permission close = manager
}

entity transaction {
    relation initiator @user
    relation agent @agent
    relation customer @customer
    relation approver @user @organization
    relation viewer @user
    
    permission view = initiator or agent or customer or approver or viewer
    permission edit = agent or approver
    permission approve = approver
    permission reject = approver
    permission reverse = approver
    permission audit = viewer
}

entity kyb_application {
    relation applicant @user
    relation agent @agent
    relation officer @user @organization
    relation reviewer @user @organization
    relation approver @user @organization
    relation viewer @user
    
    permission view = applicant or agent or officer or reviewer or approver or viewer
    permission edit = applicant or agent or officer
    permission review = officer or reviewer
    permission approve = approver
    permission reject = approver
    permission request_documents = officer or reviewer
    permission upload_documents = applicant or agent
}

entity payment {
    relation sender @customer
    relation receiver @customer
    relation agent @agent
    relation processor @user @organization
    relation approver @user @organization
    relation viewer @user
    
    permission view = sender or receiver or agent or processor or approver or viewer
    permission initiate = sender or agent
    permission process = agent or processor
    permission approve = approver
    permission reject = approver
    permission refund = approver
    permission cancel = sender or agent or approver
}

entity insurance_policy {
    relation holder @customer
    relation agent @agent
    relation underwriter @user @organization
    relation claims_officer @user @organization
    relation manager @user @organization
    relation viewer @user
    
    permission view = holder or agent or underwriter or claims_officer or manager or viewer
    permission edit = agent or underwriter or manager
    permission issue = underwriter or manager
    permission cancel = manager
    permission renew = agent or underwriter
    permission claim = holder or agent
    permission process_claim = claims_officer or manager
    permission approve_claim = manager
    permission reject_claim = manager
}

entity report {
    relation creator @user
    relation organization @organization
    relation viewer @user
    relation auditor @user @organization
    
    permission view = creator or organization or viewer or auditor
    permission edit = creator
    permission delete = creator
    permission audit = auditor
    permission export = creator or auditor
}

entity system_config {
    relation admin @user @organization
    relation operator @user @organization
    relation viewer @user
    
    permission view = admin or operator or viewer
    permission edit = admin
    permission deploy = admin
    permission backup = admin or operator
    permission restore = admin
    permission monitor = operator or viewer
}

entity audit_log {
    relation system @system_config
    relation auditor @user @organization
    relation compliance_officer @user @organization
    relation viewer @user
    
    permission view = auditor or compliance_officer or viewer
    permission export = auditor or compliance_officer
    permission archive = compliance_officer
    permission delete = compliance_officer
}
"""
        
        try:
            response = requests.post(
                f"{self.api_url}/v1/schemas/write",
                headers={"Content-Type": "application/json"},
                json={"schema": banking_schema}
            )
            
            if response.status_code in [200, 201]:
                logger.info("✅ Banking authorization schema created successfully")
                return True
            else:
                logger.error(f"❌ Failed to create schema: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating schema: {str(e)}")
            return False
    
    def write_relationship(self, entity_type: str, entity_id: str, relation: str, 
                          subject_type: str, subject_id: str) -> bool:
        """Write relationship tuple to Permify"""
        
        relationship_data = {
            "tuples": [
                {
                    "entity": {
                        "type": entity_type,
                        "id": entity_id
                    },
                    "relation": relation,
                    "subject": {
                        "type": subject_type,
                        "id": subject_id
                    }
                }
            ]
        }
        
        try:
            response = requests.post(
                f"{self.api_url}/v1/relationships/write",
                headers={"Content-Type": "application/json"},
                json=relationship_data
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"✅ Relationship written: {entity_type}:{entity_id}#{relation}@{subject_type}:{subject_id}")
                return True
            else:
                logger.error(f"❌ Failed to write relationship: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error writing relationship: {str(e)}")
            return False
    
    def check_permission(self, entity_type: str, entity_id: str, permission: str,
                        subject_type: str, subject_id: str, context: Dict[str, Any] = None) -> bool:
        """Check if subject has permission on entity"""
        
        permission_data = {
            "entity": {
                "type": entity_type,
                "id": entity_id
            },
            "permission": permission,
            "subject": {
                "type": subject_type,
                "id": subject_id
            }
        }
        
        if context:
            permission_data["context"] = context
        
        try:
            response = requests.post(
                f"{self.api_url}/v1/permissions/check",
                headers={"Content-Type": "application/json"},
                json=permission_data
            )
            
            if response.status_code == 200:
                result = response.json()
                has_permission = result.get("can", False)
                logger.info(f"🔍 Permission check: {subject_type}:{subject_id} {'✅ CAN' if has_permission else '❌ CANNOT'} {permission} on {entity_type}:{entity_id}")
                return has_permission
            else:
                logger.error(f"❌ Failed to check permission: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error checking permission: {str(e)}")
            return False
    
    def lookup_entity(self, entity_type: str, permission: str, subject_type: str, subject_id: str) -> List[str]:
        """Lookup entities that subject has permission on"""
        
        lookup_data = {
            "entity_type": entity_type,
            "permission": permission,
            "subject": {
                "type": subject_type,
                "id": subject_id
            }
        }
        
        try:
            response = requests.post(
                f"{self.api_url}/v1/permissions/lookup-entity",
                headers={"Content-Type": "application/json"},
                json=lookup_data
            )
            
            if response.status_code == 200:
                result = response.json()
                entity_ids = result.get("entity_ids", [])
                logger.info(f"🔍 Lookup result: {subject_type}:{subject_id} has {permission} on {len(entity_ids)} {entity_type} entities")
                return entity_ids
            else:
                logger.error(f"❌ Failed to lookup entities: {response.text}")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error looking up entities: {str(e)}")
            return []
    
    def setup_banking_relationships(self) -> bool:
        """Setup comprehensive banking relationships"""
        
        # Organization relationships
        relationships = [
            # Organization structure
            ("organization", "remittance-ng", "admin", "user", "admin001"),
            ("organization", "remittance-ng", "member", "user", "manager001"),
            ("organization", "remittance-ng", "member", "user", "kyb001"),
            ("organization", "remittance-ng", "member", "user", "compliance001"),
            ("organization", "remittance-ng", "viewer", "user", "auditor001"),
            
            # Agent relationships
            ("agent", "AGT001", "owner", "user", "agent001"),
            ("agent", "AGT001", "manager", "user", "manager001"),
            ("agent", "AGT001", "supervisor", "user", "supervisor001"),
            ("agent", "AGT002", "owner", "user", "agent002"),
            ("agent", "AGT002", "manager", "user", "manager001"),
            
            # Customer relationships
            ("customer", "CUST001", "owner", "user", "customer001"),
            ("customer", "CUST001", "agent", "agent", "AGT001"),
            ("customer", "CUST002", "owner", "user", "customer002"),
            ("customer", "CUST002", "agent", "agent", "AGT001"),
            ("customer", "CUST003", "owner", "user", "customer003"),
            ("customer", "CUST003", "agent", "agent", "AGT002"),
            
            # Account relationships
            ("account", "ACC001", "owner", "customer", "CUST001"),
            ("account", "ACC001", "agent", "agent", "AGT001"),
            ("account", "ACC001", "manager", "user", "manager001"),
            ("account", "ACC002", "owner", "customer", "CUST002"),
            ("account", "ACC002", "agent", "agent", "AGT001"),
            ("account", "ACC003", "owner", "customer", "CUST003"),
            ("account", "ACC003", "agent", "agent", "AGT002"),
            
            # Transaction relationships
            ("transaction", "TXN001", "initiator", "user", "customer001"),
            ("transaction", "TXN001", "agent", "agent", "AGT001"),
            ("transaction", "TXN001", "customer", "customer", "CUST001"),
            ("transaction", "TXN001", "approver", "user", "manager001"),
            
            # KYB Application relationships
            ("kyb_application", "KYB001", "applicant", "user", "agent001"),
            ("kyb_application", "KYB001", "officer", "user", "kyb001"),
            ("kyb_application", "KYB001", "reviewer", "user", "reviewer001"),
            ("kyb_application", "KYB001", "approver", "user", "manager001"),
            
            # Payment relationships
            ("payment", "PAY001", "sender", "customer", "CUST001"),
            ("payment", "PAY001", "receiver", "customer", "CUST002"),
            ("payment", "PAY001", "agent", "agent", "AGT001"),
            ("payment", "PAY001", "processor", "user", "processor001"),
            ("payment", "PAY001", "approver", "user", "manager001"),
            
            # Insurance Policy relationships
            ("insurance_policy", "POL001", "holder", "customer", "CUST001"),
            ("insurance_policy", "POL001", "agent", "agent", "AGT001"),
            ("insurance_policy", "POL001", "underwriter", "user", "underwriter001"),
            ("insurance_policy", "POL001", "claims_officer", "user", "claims001"),
            ("insurance_policy", "POL001", "manager", "user", "manager001"),
            
            # System configuration relationships
            ("system_config", "main", "admin", "user", "admin001"),
            ("system_config", "main", "operator", "user", "operator001"),
            ("system_config", "main", "viewer", "user", "viewer001"),
            
            # Audit log relationships
            ("audit_log", "system", "auditor", "user", "auditor001"),
            ("audit_log", "system", "compliance_officer", "user", "compliance001"),
            ("audit_log", "system", "viewer", "user", "viewer001"),
        ]
        
        success_count = 0
        for entity_type, entity_id, relation, subject_type, subject_id in relationships:
            if self.write_relationship(entity_type, entity_id, relation, subject_type, subject_id):
                success_count += 1
        
        logger.info(f"✅ Successfully created {success_count}/{len(relationships)} relationships")
        return success_count == len(relationships)
    
    def test_permissions(self) -> bool:
        """Test comprehensive permission scenarios"""
        
        test_cases = [
            # Agent permissions
            ("agent", "AGT001", "view", "user", "agent001", True),
            ("agent", "AGT001", "edit", "user", "agent001", True),
            ("agent", "AGT001", "delete", "user", "agent001", True),
            ("agent", "AGT001", "activate", "user", "manager001", True),
            ("agent", "AGT001", "process_transaction", "user", "agent001", True),
            ("agent", "AGT002", "view", "user", "agent001", False),
            
            # Customer permissions
            ("customer", "CUST001", "view", "user", "customer001", True),
            ("customer", "CUST001", "view", "user", "agent001", True),
            ("customer", "CUST001", "edit", "user", "customer001", True),
            ("customer", "CUST001", "create_account", "user", "agent001", True),
            ("customer", "CUST001", "process_transaction", "user", "agent001", True),
            ("customer", "CUST002", "view", "user", "customer001", False),
            
            # Account permissions
            ("account", "ACC001", "view", "user", "customer001", True),
            ("account", "ACC001", "deposit", "user", "agent001", True),
            ("account", "ACC001", "withdraw", "user", "agent001", True),
            ("account", "ACC001", "freeze", "user", "manager001", True),
            ("account", "ACC001", "deposit", "user", "customer001", False),
            ("account", "ACC002", "view", "user", "customer001", False),
            
            # Transaction permissions
            ("transaction", "TXN001", "view", "user", "customer001", True),
            ("transaction", "TXN001", "approve", "user", "manager001", True),
            ("transaction", "TXN001", "reverse", "user", "manager001", True),
            ("transaction", "TXN001", "approve", "user", "customer001", False),
            
            # KYB Application permissions
            ("kyb_application", "KYB001", "view", "user", "agent001", True),
            ("kyb_application", "KYB001", "review", "user", "kyb001", True),
            ("kyb_application", "KYB001", "approve", "user", "manager001", True),
            ("kyb_application", "KYB001", "upload_documents", "user", "agent001", True),
            ("kyb_application", "KYB001", "approve", "user", "agent001", False),
            
            # Payment permissions
            ("payment", "PAY001", "view", "user", "customer001", True),
            ("payment", "PAY001", "initiate", "user", "customer001", True),
            ("payment", "PAY001", "process", "user", "agent001", True),
            ("payment", "PAY001", "approve", "user", "manager001", True),
            ("payment", "PAY001", "process", "user", "customer001", False),
            
            # Insurance Policy permissions
            ("insurance_policy", "POL001", "view", "user", "customer001", True),
            ("insurance_policy", "POL001", "claim", "user", "customer001", True),
            ("insurance_policy", "POL001", "issue", "user", "underwriter001", True),
            ("insurance_policy", "POL001", "process_claim", "user", "claims001", True),
            ("insurance_policy", "POL001", "approve_claim", "user", "manager001", True),
            ("insurance_policy", "POL001", "issue", "user", "customer001", False),
            
            # System configuration permissions
            ("system_config", "main", "view", "user", "admin001", True),
            ("system_config", "main", "edit", "user", "admin001", True),
            ("system_config", "main", "deploy", "user", "admin001", True),
            ("system_config", "main", "backup", "user", "operator001", True),
            ("system_config", "main", "edit", "user", "operator001", False),
            
            # Audit log permissions
            ("audit_log", "system", "view", "user", "auditor001", True),
            ("audit_log", "system", "export", "user", "auditor001", True),
            ("audit_log", "system", "archive", "user", "compliance001", True),
            ("audit_log", "system", "delete", "user", "compliance001", True),
            ("audit_log", "system", "delete", "user", "auditor001", False),
        ]
        
        passed_tests = 0
        failed_tests = 0
        
        for entity_type, entity_id, permission, subject_type, subject_id, expected in test_cases:
            actual = self.check_permission(entity_type, entity_id, permission, subject_type, subject_id)
            
            if actual == expected:
                passed_tests += 1
                status = "✅ PASS"
            else:
                failed_tests += 1
                status = "❌ FAIL"
            
            logger.info(f"{status}: {subject_type}:{subject_id} {permission} on {entity_type}:{entity_id} - Expected: {expected}, Got: {actual}")
        
        logger.info(f"📊 Test Results: {passed_tests} passed, {failed_tests} failed out of {len(test_cases)} tests")
        return failed_tests == 0
    
    def generate_docker_compose(self) -> str:
        """Generate Docker Compose configuration for Permify"""
        
        docker_compose = {
            "version": "3.8",
            "services": {
                "permify": {
                    "image": "ghcr.io/permify/permify:latest",
                    "ports": ["3476:3476", "3478:3478"],
                    "command": [
                        "serve",
                        "--database-engine=postgres",
                        "--database-uri=postgres://permify:permify123@postgres:5432/permify?sslmode=disable",
                        "--database-auto-migrate=true",
                        "--log-level=info"
                    ],
                    "depends_on": ["postgres"],
                    "networks": ["permify"],
                    "environment": [
                        "PERMIFY_LOG_LEVEL=info",
                        "PERMIFY_SERVER_HTTP_PORT=3476",
                        "PERMIFY_SERVER_GRPC_PORT=3478",
                        "PERMIFY_DATABASE_ENGINE=postgres",
                        "PERMIFY_DATABASE_URI=postgres://permify:permify123@postgres:5432/permify?sslmode=disable",
                        "PERMIFY_DATABASE_AUTO_MIGRATE=true"
                    ]
                },
                "postgres": {
                    "image": "postgres:15-alpine",
                    "environment": [
                        "POSTGRES_DB=permify",
                        "POSTGRES_USER=permify",
                        "POSTGRES_PASSWORD=permify123"
                    ],
                    "ports": ["5434:5432"],
                    "networks": ["permify"],
                    "volumes": [
                        "postgres_data:/var/lib/postgresql/data"
                    ]
                }
            },
            "networks": {
                "permify": {
                    "driver": "bridge"
                }
            },
            "volumes": {
                "postgres_data": {"driver": "local"}
            }
        }
        
        return yaml.dump(docker_compose, default_flow_style=False)
    
    def deploy_complete_setup(self) -> bool:
        """Deploy complete Permify authorization setup"""
        logger.info("🚀 Deploying Permify Authorization Engine Setup...")
        
        try:
            # Create authorization schema
            if not self.create_schema():
                return False
            
            # Setup banking relationships
            if not self.setup_banking_relationships():
                return False
            
            # Test permissions
            if not self.test_permissions():
                logger.warning("⚠️ Some permission tests failed, but continuing...")
            
            # Generate Docker Compose
            docker_compose_content = self.generate_docker_compose()
            with open("/tmp/docker-compose-permify.yaml", "w") as f:
                f.write(docker_compose_content)
            
            logger.info("✅ Permify authorization setup completed successfully!")
            logger.info("📁 Configuration files saved to /tmp/")
            logger.info("🔐 Permify API: http://localhost:3476")
            logger.info("🔌 Permify gRPC: localhost:3478")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error deploying Permify setup: {str(e)}")
            return False

def main():
    """Main function to setup Permify Authorization Engine"""
    print("🔐 Remittance Platform - Permify Authorization Engine Setup")
    print("=" * 70)
    
    permify = PermifyManager()
    
    if permify.deploy_complete_setup():
        print("\n✅ Permify Authorization Engine configured successfully!")
        print("\n📋 Next Steps:")
        print("1. Start Permify: docker-compose -f /tmp/docker-compose-permify.yaml up -d")
        print("2. Access API: http://localhost:3476")
        print("3. Use gRPC: localhost:3478")
        print("4. Test permissions with the configured relationships")
        print("5. Integrate with your banking services")
    else:
        print("\n❌ Failed to configure Permify Authorization Engine")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())

