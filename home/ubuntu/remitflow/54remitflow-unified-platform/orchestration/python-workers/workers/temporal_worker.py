

# ============================================================================
# NEW ACTIVITIES FOR JOURNEYS 2, 3, 4, 7, 8
# ============================================================================

@activity.defn(name="ProcessBiometricWithArcFace")
async def process_biometric_with_arcface(input_data: dict) -> dict:
    """
    Process biometric data using ArcFace for embedding generation.
    Journey 2: Biometric Authentication Setup
    """
    logger.info(f"Processing biometric with ArcFace: {input_data['biometric_type']}")
    
    try:
        # Simulate ArcFace processing (in production, call actual ArcFace service)
        biometric_data = input_data['biometric_data']
        biometric_type = input_data['biometric_type']
        
        # Generate embedding vector (512-dimensional for ArcFace)
        import numpy as np
        embedding_vector = np.random.rand(512).tolist()  # Placeholder
        
        # Calculate quality score
        quality_score = 0.85  # Placeholder (would be actual quality metric)
        
        return {
            "success": True,
            "embedding_vector": embedding_vector,
            "quality_score": quality_score,
            "biometric_type": biometric_type
        }
    except Exception as e:
        logger.error(f"ArcFace processing failed: {str(e)}")
        raise

@activity.defn(name="QueryBillAmount")
async def query_bill_amount(input_data: dict) -> dict:
    """
    Query bill amount from biller API.
    Journey 8: Bill Payment
    """
    logger.info(f"Querying bill amount for biller: {input_data['biller_id']}")
    
    try:
        biller_id = input_data['biller_id']
        account_number = input_data['account_number']
        
        # Call biller API via Dapr (placeholder)
        # In production, this would call actual biller APIs
        from decimal import Decimal
        
        # Simulate bill query
        bill_amount = Decimal("15000.00")  # NGN 15,000
        
        return {
            "success": True,
            "amount": str(bill_amount),
            "currency": "NGN",
            "due_date": "2025-11-30",
            "biller_reference": f"BILL-{account_number}-{int(time.time())}"
        }
    except Exception as e:
        logger.error(f"Bill query failed: {str(e)}")
        return {
            "success": False,
            "reason": str(e)
        }

@activity.defn(name="CalculateBillPaymentFee")
async def calculate_bill_payment_fee(input_data: dict) -> dict:
    """
    Calculate fee for bill payment.
    Journey 8: Bill Payment
    """
    logger.info(f"Calculating bill payment fee for category: {input_data['biller_category']}")
    
    try:
        from decimal import Decimal
        
        amount = Decimal(str(input_data['amount']))
        category = input_data['biller_category']
        
        # Fee structure (example)
        fee_rates = {
            "utility": Decimal("0.01"),  # 1%
            "telecom": Decimal("0.005"), # 0.5%
            "cable": Decimal("0.01"),    # 1%
            "internet": Decimal("0.01"),  # 1%
        }
        
        fee_rate = fee_rates.get(category, Decimal("0.015"))  # Default 1.5%
        fee = amount * fee_rate
        
        # Minimum fee
        min_fee = Decimal("50.00")
        if fee < min_fee:
            fee = min_fee
        
        # Maximum fee
        max_fee = Decimal("1000.00")
        if fee > max_fee:
            fee = max_fee
        
        return {
            "fee": str(fee),
            "fee_rate": str(fee_rate),
            "currency": input_data['currency']
        }
    except Exception as e:
        logger.error(f"Fee calculation failed: {str(e)}")
        raise

@activity.defn(name="CalculateNextExecution")
async def calculate_next_execution(input_data: dict) -> dict:
    """
    Calculate next execution time for recurring payment.
    Journey 7: Scheduled Recurring Payment
    """
    logger.info(f"Calculating next execution for schedule: {input_data['schedule']}")
    
    try:
        from croniter import croniter
        from datetime import datetime
        
        schedule = input_data['schedule']
        last_run = datetime.fromisoformat(input_data.get('last_run', datetime.now().isoformat()))
        
        # Calculate next run time
        cron = croniter(schedule, last_run)
        next_time = cron.get_next(datetime)
        
        return {
            "next_time": next_time.isoformat(),
            "schedule": schedule
        }
    except Exception as e:
        logger.error(f"Next execution calculation failed: {str(e)}")
        raise

@activity.defn(name="ValidateCronSchedule")
async def validate_cron_schedule(input_data: dict) -> dict:
    """
    Validate cron schedule expression.
    Journey 7: Scheduled Recurring Payment
    """
    logger.info(f"Validating cron schedule: {input_data['schedule']}")
    
    try:
        from croniter import croniter
        
        schedule = input_data['schedule']
        
        # Try to parse the cron expression
        if croniter.is_valid(schedule):
            return {
                "valid": True,
                "schedule": schedule
            }
        else:
            return {
                "valid": False,
                "reason": "Invalid cron expression format"
            }
    except Exception as e:
        return {
            "valid": False,
            "reason": str(e)
        }

@activity.defn(name="GenerateTOTPSecret")
async def generate_totp_secret(input_data: dict) -> dict:
    """
    Generate TOTP secret for 2FA.
    Journey 3: Two-Factor Authentication
    """
    logger.info(f"Generating TOTP secret for user: {input_data['user_id']}")
    
    try:
        import pyotp
        import qrcode
        import io
        import base64
        
        user_id = input_data['user_id']
        issuer = input_data.get('issuer', 'Nigerian Remittance Platform')
        
        # Generate secret
        secret = pyotp.random_base32()
        
        # Generate provisioning URI
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(
            name=str(user_id),
            issuer_name=issuer
        )
        
        # Generate QR code
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        return {
            "secret": secret,
            "provisioning_uri": provisioning_uri,
            "qr_code_url": f"data:image/png;base64,{qr_code_base64}"
        }
    except Exception as e:
        logger.error(f"TOTP secret generation failed: {str(e)}")
        raise

@activity.defn(name="VerifyTOTPCode")
async def verify_totp_code(input_data: dict) -> dict:
    """
    Verify TOTP code for 2FA.
    Journey 3: Two-Factor Authentication
    """
    logger.info(f"Verifying TOTP code for user: {input_data['user_id']}")
    
    try:
        import pyotp
        
        user_id = input_data['user_id']
        code = input_data['code']
        
        # In production, retrieve secret from Redis
        # For now, simulate verification
        # secret = await redis_client.get(f"totp:secret:{user_id}")
        
        # Placeholder: Assume code is valid if it's 6 digits
        valid = len(code) == 6 and code.isdigit()
        
        return {
            "valid": valid,
            "user_id": user_id
        }
    except Exception as e:
        logger.error(f"TOTP verification failed: {str(e)}")
        return {
            "valid": False,
            "reason": str(e)
        }

@activity.defn(name="GenerateBackupCodes")
async def generate_backup_codes(input_data: dict) -> dict:
    """
    Generate backup codes for 2FA recovery.
    Journey 3: Two-Factor Authentication
    """
    logger.info(f"Generating backup codes for user: {input_data['user_id']}")
    
    try:
        import secrets
        
        count = input_data.get('count', 10)
        
        # Generate random backup codes
        codes = []
        for _ in range(count):
            code = '-'.join([
                secrets.token_hex(2).upper()
                for _ in range(4)
            ])
            codes.append(code)
        
        return {
            "codes": codes,
            "count": len(codes)
        }
    except Exception as e:
        logger.error(f"Backup codes generation failed: {str(e)}")
        raise

@activity.defn(name="ValidatePassword")
async def validate_password(input_data: dict) -> dict:
    """
    Validate password strength.
    Journey 4: Password Reset
    """
    logger.info("Validating password strength")
    
    try:
        import re
        
        password = input_data['password']
        
        # Password requirements
        min_length = 8
        has_uppercase = bool(re.search(r'[A-Z]', password))
        has_lowercase = bool(re.search(r'[a-z]', password))
        has_digit = bool(re.search(r'\d', password))
        has_special = bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', password))
        
        valid = (
            len(password) >= min_length and
            has_uppercase and
            has_lowercase and
            has_digit and
            has_special
        )
        
        if not valid:
            reasons = []
            if len(password) < min_length:
                reasons.append(f"minimum {min_length} characters")
            if not has_uppercase:
                reasons.append("uppercase letter")
            if not has_lowercase:
                reasons.append("lowercase letter")
            if not has_digit:
                reasons.append("digit")
            if not has_special:
                reasons.append("special character")
            
            reason = "Password must contain: " + ", ".join(reasons)
        else:
            reason = "Password meets all requirements"
        
        return {
            "valid": valid,
            "reason": reason
        }
    except Exception as e:
        logger.error(f"Password validation failed: {str(e)}")
        return {
            "valid": False,
            "reason": str(e)
        }

# Update worker registration to include new activities
async def run_worker():
    """Run the Temporal worker with all activities"""
    client = await Client.connect("localhost:7233")
    
    worker = Worker(
        client,
        task_queue="nigerian-remittance-queue",
        activities=[
            # Existing activities
            detect_fraud,
            verify_kyc_document,
            calculate_credit_score,
            process_analytics_event,
            # New activities for Journeys 2, 3, 4, 7, 8
            process_biometric_with_arcface,
            query_bill_amount,
            calculate_bill_payment_fee,
            calculate_next_execution,
            validate_cron_schedule,
            generate_totp_secret,
            verify_totp_code,
            generate_backup_codes,
            validate_password,
        ],
    )
    
    logger.info("Worker started with all activities")
    await worker.run()

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_worker())
