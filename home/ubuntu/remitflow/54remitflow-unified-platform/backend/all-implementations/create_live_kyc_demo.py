#!/usr/bin/env python3
"""
Live Multi-Jurisdiction KYC Demo for US-Based Nigerians
Comprehensive 5-phase onboarding flow demonstration
"""

from flask import Flask, render_template_string, request, jsonify, session
import json
import time
import random
from datetime import datetime
import uuid

app = Flask(__name__)
app.secret_key = 'kyc_demo_secret_key_2024'

# Demo data for realistic simulation
DEMO_DATA = {
    "ssn_database": {
        "123-45-6789": {"valid": True, "name": "Adebayo Johnson", "state": "TX"},
        "987-65-4321": {"valid": True, "name": "Chioma Okafor", "state": "NY"},
        "555-12-3456": {"valid": True, "name": "Emeka Nwankwo", "state": "CA"}
    },
    "nin_database": {
        "12345678901": {"valid": True, "name": "Adebayo Johnson", "state": "Lagos"},
        "98765432109": {"valid": True, "name": "Chioma Okafor", "state": "Anambra"},
        "55512345678": {"valid": True, "name": "Emeka Nwankwo", "state": "Imo"}
    },
    "bvn_database": {
        "22123456789": {"valid": True, "bank": "First Bank", "account_status": "Active"},
        "22987654321": {"valid": True, "bank": "GTBank", "account_status": "Active"},
        "22555123456": {"valid": True, "bank": "Access Bank", "account_status": "Active"}
    }
}

# KYC Demo HTML Template
KYC_DEMO_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nigerian Remittance Platform - Multi-Jurisdiction KYC Demo</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 16px;
            opacity: 0.9;
        }
        
        .progress-container {
            padding: 20px 30px;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 15px;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #2E7D32);
            transition: width 0.5s ease;
        }
        
        .phase-indicators {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .phase-indicator {
            display: flex;
            flex-direction: column;
            align-items: center;
            font-size: 12px;
        }
        
        .phase-circle {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: #e9ecef;
            color: #6c757d;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-bottom: 5px;
            transition: all 0.3s ease;
        }
        
        .phase-circle.active {
            background: #4CAF50;
            color: white;
        }
        
        .phase-circle.completed {
            background: #2E7D32;
            color: white;
        }
        
        .content {
            padding: 30px;
        }
        
        .phase-content {
            display: none;
        }
        
        .phase-content.active {
            display: block;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s ease;
        }
        
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: #4CAF50;
        }
        
        .form-row {
            display: flex;
            gap: 15px;
        }
        
        .form-row .form-group {
            flex: 1;
        }
        
        .btn {
            background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            width: 100%;
            margin-top: 20px;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(76, 175, 80, 0.3);
        }
        
        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        .verification-status {
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            font-weight: 600;
        }
        
        .verification-status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .verification-status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .verification-status.processing {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        
        .document-upload {
            border: 2px dashed #4CAF50;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            background: #f8fff8;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .document-upload:hover {
            background: #f0fff0;
            border-color: #2E7D32;
        }
        
        .document-upload.dragover {
            background: #e8f5e8;
            border-color: #1B5E20;
        }
        
        .biometric-capture {
            text-align: center;
            padding: 30px;
            background: #f8f9fa;
            border-radius: 8px;
            margin: 20px 0;
        }
        
        .camera-preview {
            width: 300px;
            height: 200px;
            background: #333;
            border-radius: 8px;
            margin: 20px auto;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 18px;
        }
        
        .compliance-check {
            display: flex;
            align-items: center;
            padding: 10px;
            margin: 10px 0;
            border-radius: 8px;
            background: #f8f9fa;
        }
        
        .compliance-check.passed {
            background: #d4edda;
            color: #155724;
        }
        
        .compliance-check.failed {
            background: #f8d7da;
            color: #721c24;
        }
        
        .check-icon {
            margin-right: 10px;
            font-size: 18px;
        }
        
        .final-summary {
            background: #e8f5e8;
            border: 2px solid #4CAF50;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            margin: 20px 0;
        }
        
        .final-summary h3 {
            color: #2E7D32;
            margin-bottom: 15px;
            font-size: 24px;
        }
        
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        
        .stat-item {
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #2E7D32;
        }
        
        .stat-label {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        
        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #4CAF50;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .demo-note {
            background: #e3f2fd;
            border: 1px solid #2196F3;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            font-size: 14px;
            color: #1565C0;
        }
        
        .demo-note strong {
            color: #0D47A1;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>💸 Nigerian Remittance Platform</h1>
            <p>Multi-Jurisdiction KYC for US-Based Nigerians</p>
        </div>
        
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>
            <div class="phase-indicators">
                <div class="phase-indicator">
                    <div class="phase-circle active" id="phase1Circle">1</div>
                    <span>Registration</span>
                </div>
                <div class="phase-indicator">
                    <div class="phase-circle" id="phase2Circle">2</div>
                    <span>USA Compliance</span>
                </div>
                <div class="phase-indicator">
                    <div class="phase-circle" id="phase3Circle">3</div>
                    <span>Nigeria Compliance</span>
                </div>
                <div class="phase-indicator">
                    <div class="phase-circle" id="phase4Circle">4</div>
                    <span>Verification</span>
                </div>
                <div class="phase-indicator">
                    <div class="phase-circle" id="phase5Circle">5</div>
                    <span>Screening</span>
                </div>
            </div>
        </div>
        
        <div class="content">
            <!-- Phase 1: Initial Registration -->
            <div class="phase-content active" id="phase1">
                <h2>Phase 1: Initial Registration</h2>
                <p>Welcome! Let's start your diaspora remittance account setup.</p>
                
                <div class="demo-note">
                    <strong>Demo Note:</strong> This is a demonstration of the multi-jurisdiction KYC process. 
                    Use the pre-filled demo data or enter your own information to see how the system works.
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>First Name</label>
                        <input type="text" id="firstName" placeholder="Adebayo" value="Adebayo">
                    </div>
                    <div class="form-group">
                        <label>Last Name</label>
                        <input type="text" id="lastName" placeholder="Johnson" value="Johnson">
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Date of Birth</label>
                        <input type="date" id="dateOfBirth" value="1985-03-15">
                    </div>
                    <div class="form-group">
                        <label>Nationality</label>
                        <select id="nationality">
                            <option value="Nigerian">Nigerian</option>
                            <option value="Dual">Dual Citizen (US/Nigeria)</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>US Residential Address</label>
                    <input type="text" id="usAddress" placeholder="123 Main St, Houston, TX 77001" value="123 Main St, Houston, TX 77001">
                </div>
                
                <div class="form-group">
                    <label>Nigerian Address (if applicable)</label>
                    <input type="text" id="nigerianAddress" placeholder="45 Victoria Island, Lagos, Nigeria" value="45 Victoria Island, Lagos, Nigeria">
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>US Phone Number</label>
                        <input type="tel" id="usPhone" placeholder="+1 (555) 123-4567" value="+1 (555) 123-4567">
                    </div>
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="email" placeholder="adebayo.johnson@email.com" value="adebayo.johnson@email.com">
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Primary Purpose of Account</label>
                    <select id="accountPurpose">
                        <option value="remittances">Personal Remittances to Family</option>
                        <option value="business">Business Payments</option>
                        <option value="investment">Investment Transfers</option>
                        <option value="education">Education Payments</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Expected Monthly Transfer Volume</label>
                    <select id="monthlyVolume">
                        <option value="under_1000">Under $1,000</option>
                        <option value="1000_5000">$1,000 - $5,000</option>
                        <option value="5000_10000">$5,000 - $10,000</option>
                        <option value="over_10000">Over $10,000</option>
                    </select>
                </div>
                
                <button class="btn" onclick="nextPhase(2)">Continue to USA Compliance</button>
            </div>
            
            <!-- Phase 2: USA Compliance -->
            <div class="phase-content" id="phase2">
                <h2>Phase 2: USA Compliance Verification</h2>
                <p>We need to verify your US identity and legal status for FinCEN compliance.</p>
                
                <div class="demo-note">
                    <strong>Demo SSN:</strong> Use 123-45-6789 for successful verification demo.
                </div>
                
                <div class="form-group">
                    <label>Social Security Number (SSN)</label>
                    <input type="text" id="ssn" placeholder="123-45-6789" value="123-45-6789" maxlength="11">
                </div>
                
                <div class="form-group">
                    <label>US Driver's License or State ID Number</label>
                    <input type="text" id="driverLicense" placeholder="DL123456789" value="DL123456789">
                </div>
                
                <div class="form-group">
                    <label>State of Issue</label>
                    <select id="stateOfIssue">
                        <option value="TX">Texas</option>
                        <option value="NY">New York</option>
                        <option value="CA">California</option>
                        <option value="FL">Florida</option>
                        <option value="IL">Illinois</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Employment Status</label>
                    <select id="employmentStatus">
                        <option value="employed">Employed Full-time</option>
                        <option value="self_employed">Self-employed</option>
                        <option value="student">Student</option>
                        <option value="retired">Retired</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Annual Income Range</label>
                    <select id="incomeRange">
                        <option value="under_50k">Under $50,000</option>
                        <option value="50k_100k">$50,000 - $100,000</option>
                        <option value="100k_200k">$100,000 - $200,000</option>
                        <option value="over_200k">Over $200,000</option>
                    </select>
                </div>
                
                <div class="document-upload" onclick="document.getElementById('addressProof').click()">
                    <p>📄 Upload Address Verification Document</p>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;">
                        Utility bill, bank statement, or lease agreement (last 3 months)
                    </p>
                    <input type="file" id="addressProof" style="display: none;" accept=".pdf,.jpg,.png">
                </div>
                
                <button class="btn" onclick="verifyUSACompliance()">Verify USA Identity</button>
                
                <div id="usaVerificationStatus"></div>
            </div>
            
            <!-- Phase 3: Nigeria Compliance -->
            <div class="phase-content" id="phase3">
                <h2>Phase 3: Nigeria Compliance Verification</h2>
                <p>Now we'll verify your Nigerian identity and banking information for CBN compliance.</p>
                
                <div class="demo-note">
                    <strong>Demo NIN:</strong> Use 12345678901 and <strong>BVN:</strong> 22123456789 for successful verification.
                </div>
                
                <div class="form-group">
                    <label>National Identification Number (NIN)</label>
                    <input type="text" id="nin" placeholder="12345678901" value="12345678901" maxlength="11">
                </div>
                
                <div class="form-group">
                    <label>Nigerian Passport Number</label>
                    <input type="text" id="passportNumber" placeholder="A12345678" value="A12345678">
                </div>
                
                <div class="form-group">
                    <label>Bank Verification Number (BVN)</label>
                    <input type="text" id="bvn" placeholder="22123456789" value="22123456789" maxlength="11">
                </div>
                
                <div class="form-group">
                    <label>Primary Nigerian Bank</label>
                    <select id="nigerianBank">
                        <option value="first_bank">First Bank of Nigeria</option>
                        <option value="gtbank">Guaranty Trust Bank</option>
                        <option value="access_bank">Access Bank</option>
                        <option value="zenith_bank">Zenith Bank</option>
                        <option value="uba">United Bank for Africa</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Nigerian Account Number</label>
                    <input type="text" id="nigerianAccount" placeholder="0123456789" value="0123456789" maxlength="10">
                </div>
                
                <div class="form-group">
                    <label>State of Origin</label>
                    <select id="stateOfOrigin">
                        <option value="lagos">Lagos</option>
                        <option value="kano">Kano</option>
                        <option value="rivers">Rivers</option>
                        <option value="oyo">Oyo</option>
                        <option value="kaduna">Kaduna</option>
                        <option value="anambra">Anambra</option>
                    </select>
                </div>
                
                <h3 style="margin-top: 30px; margin-bottom: 15px;">Primary Beneficiary Information</h3>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Beneficiary Full Name</label>
                        <input type="text" id="beneficiaryName" placeholder="Folake Johnson" value="Folake Johnson">
                    </div>
                    <div class="form-group">
                        <label>Relationship</label>
                        <select id="relationship">
                            <option value="spouse">Spouse</option>
                            <option value="parent">Parent</option>
                            <option value="child">Child</option>
                            <option value="sibling">Sibling</option>
                            <option value="relative">Other Relative</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Beneficiary Phone Number</label>
                    <input type="tel" id="beneficiaryPhone" placeholder="+234 803 123 4567" value="+234 803 123 4567">
                </div>
                
                <button class="btn" onclick="verifyNigeriaCompliance()">Verify Nigeria Identity</button>
                
                <div id="nigeriaVerificationStatus"></div>
            </div>
            
            <!-- Phase 4: Enhanced Verification -->
            <div class="phase-content" id="phase4">
                <h2>Phase 4: Enhanced Biometric Verification</h2>
                <p>For security and compliance, we need to capture your biometric data.</p>
                
                <div class="biometric-capture">
                    <h3>Facial Recognition Verification</h3>
                    <div class="camera-preview" id="cameraPreview">
                        📷 Camera Preview
                    </div>
                    <button class="btn" onclick="capturePhoto()" style="width: auto; margin: 10px;">Capture Photo</button>
                    <button class="btn" onclick="simulateLivenessCheck()" style="width: auto; margin: 10px;">Liveness Check</button>
                </div>
                
                <div class="form-group">
                    <label>Create 6-Digit Security PIN</label>
                    <input type="password" id="securityPin" placeholder="••••••" maxlength="6">
                </div>
                
                <div class="form-group">
                    <label>Confirm Security PIN</label>
                    <input type="password" id="confirmPin" placeholder="••••••" maxlength="6">
                </div>
                
                <div class="form-group">
                    <label>Security Question</label>
                    <select id="securityQuestion">
                        <option value="mother_maiden">What is your mother's maiden name?</option>
                        <option value="first_school">What was the name of your first school?</option>
                        <option value="childhood_friend">What is the name of your childhood best friend?</option>
                        <option value="birth_city">In what city were you born?</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Security Answer</label>
                    <input type="text" id="securityAnswer" placeholder="Your answer">
                </div>
                
                <button class="btn" onclick="completeEnhancedVerification()">Complete Verification</button>
                
                <div id="biometricVerificationStatus"></div>
            </div>
            
            <!-- Phase 5: Compliance Screening -->
            <div class="phase-content" id="phase5">
                <h2>Phase 5: Final Compliance Screening</h2>
                <p>Running final compliance checks against global databases...</p>
                
                <div id="complianceChecks">
                    <div class="compliance-check" id="ofacCheck">
                        <span class="check-icon">⏳</span>
                        <span>OFAC Sanctions Screening</span>
                    </div>
                    <div class="compliance-check" id="pepCheck">
                        <span class="check-icon">⏳</span>
                        <span>Politically Exposed Person (PEP) Check</span>
                    </div>
                    <div class="compliance-check" id="adverseMediaCheck">
                        <span class="check-icon">⏳</span>
                        <span>Adverse Media Screening</span>
                    </div>
                    <div class="compliance-check" id="riskAssessment">
                        <span class="check-icon">⏳</span>
                        <span>Comprehensive Risk Assessment</span>
                    </div>
                    <div class="compliance-check" id="finalApproval">
                        <span class="check-icon">⏳</span>
                        <span>Final Approval Decision</span>
                    </div>
                </div>
                
                <button class="btn" onclick="runComplianceScreening()" id="screeningBtn">Start Compliance Screening</button>
                
                <div id="finalResults"></div>
            </div>
        </div>
    </div>

    <script>
        let currentPhase = 1;
        let startTime = new Date();
        
        function updateProgress() {
            const progress = (currentPhase - 1) * 20;
            document.getElementById('progressFill').style.width = progress + '%';
            
            // Update phase indicators
            for (let i = 1; i <= 5; i++) {
                const circle = document.getElementById(`phase${i}Circle`);
                if (i < currentPhase) {
                    circle.className = 'phase-circle completed';
                } else if (i === currentPhase) {
                    circle.className = 'phase-circle active';
                } else {
                    circle.className = 'phase-circle';
                }
            }
        }
        
        function nextPhase(phase) {
            // Hide current phase
            document.getElementById(`phase${currentPhase}`).classList.remove('active');
            
            // Show next phase
            currentPhase = phase;
            document.getElementById(`phase${currentPhase}`).classList.add('active');
            
            updateProgress();
        }
        
        function showStatus(elementId, type, message) {
            const element = document.getElementById(elementId);
            element.innerHTML = `<div class="verification-status ${type}">${message}</div>`;
        }
        
        function verifyUSACompliance() {
            const ssn = document.getElementById('ssn').value;
            showStatus('usaVerificationStatus', 'processing', 
                '<span class="loading-spinner"></span>Verifying SSN with Experian/Equifax...');
            
            setTimeout(() => {
                if (ssn === '123-45-6789') {
                    showStatus('usaVerificationStatus', 'success', 
                        '✅ USA Identity Verified Successfully!<br>' +
                        '• SSN validation: PASSED<br>' +
                        '• Address verification: PASSED<br>' +
                        '• OFAC screening: CLEAR<br>' +
                        '• Employment verification: PASSED');
                    
                    setTimeout(() => {
                        nextPhase(3);
                    }, 2000);
                } else {
                    showStatus('usaVerificationStatus', 'error', 
                        '❌ Verification failed. Please check your SSN and try again.');
                }
            }, 3000);
        }
        
        function verifyNigeriaCompliance() {
            const nin = document.getElementById('nin').value;
            const bvn = document.getElementById('bvn').value;
            
            showStatus('nigeriaVerificationStatus', 'processing', 
                '<span class="loading-spinner"></span>Verifying NIN with NIMC and BVN with CBN...');
            
            setTimeout(() => {
                if (nin === '12345678901' && bvn === '22123456789') {
                    showStatus('nigeriaVerificationStatus', 'success', 
                        '✅ Nigeria Identity Verified Successfully!<br>' +
                        '• NIN validation: PASSED<br>' +
                        '• BVN verification: PASSED<br>' +
                        '• Bank account validation: ACTIVE<br>' +
                        '• Beneficiary verification: CONFIRMED');
                    
                    setTimeout(() => {
                        nextPhase(4);
                    }, 2000);
                } else {
                    showStatus('nigeriaVerificationStatus', 'error', 
                        '❌ Verification failed. Please check your NIN and BVN.');
                }
            }, 4000);
        }
        
        function capturePhoto() {
            document.getElementById('cameraPreview').innerHTML = '📸 Photo Captured!';
            setTimeout(() => {
                document.getElementById('cameraPreview').innerHTML = '✅ Face Match: 98.7%';
            }, 1500);
        }
        
        function simulateLivenessCheck() {
            document.getElementById('cameraPreview').innerHTML = '👁️ Liveness Check...';
            setTimeout(() => {
                document.getElementById('cameraPreview').innerHTML = '✅ Liveness Confirmed';
            }, 2000);
        }
        
        function completeEnhancedVerification() {
            const pin = document.getElementById('securityPin').value;
            const confirmPin = document.getElementById('confirmPin').value;
            
            if (pin !== confirmPin) {
                showStatus('biometricVerificationStatus', 'error', '❌ PINs do not match.');
                return;
            }
            
            showStatus('biometricVerificationStatus', 'processing', 
                '<span class="loading-spinner"></span>Processing biometric verification...');
            
            setTimeout(() => {
                showStatus('biometricVerificationStatus', 'success', 
                    '✅ Enhanced Verification Complete!<br>' +
                    '• Facial recognition: 98.7% match<br>' +
                    '• Liveness detection: PASSED<br>' +
                    '• Document-to-face match: CONFIRMED<br>' +
                    '• Security setup: COMPLETE');
                
                setTimeout(() => {
                    nextPhase(5);
                }, 2000);
            }, 3000);
        }
        
        function runComplianceScreening() {
            document.getElementById('screeningBtn').disabled = true;
            
            const checks = ['ofacCheck', 'pepCheck', 'adverseMediaCheck', 'riskAssessment', 'finalApproval'];
            const checkNames = ['OFAC', 'PEP', 'Adverse Media', 'Risk Assessment', 'Final Approval'];
            
            checks.forEach((checkId, index) => {
                setTimeout(() => {
                    const element = document.getElementById(checkId);
                    element.classList.add('passed');
                    element.querySelector('.check-icon').textContent = '✅';
                    
                    if (index === checks.length - 1) {
                        setTimeout(() => {
                            showFinalResults();
                        }, 1000);
                    }
                }, (index + 1) * 1500);
            });
        }
        
        function showFinalResults() {
            const endTime = new Date();
            const totalTime = Math.round((endTime - startTime) / 1000 / 60);
            
            const resultsHtml = `
                <div class="final-summary">
                    <h3>🎉 KYC Verification Complete!</h3>
                    <p>Your diaspora remittance account has been successfully approved.</p>
                    
                    <div class="summary-stats">
                        <div class="stat-item">
                            <div class="stat-value">${totalTime}</div>
                            <div class="stat-label">Minutes</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">94.2%</div>
                            <div class="stat-label">Success Rate</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">5/5</div>
                            <div class="stat-label">Phases Complete</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">100%</div>
                            <div class="stat-label">Compliance</div>
                        </div>
                    </div>
                    
                    <p><strong>Account Features Unlocked:</strong></p>
                    <ul style="text-align: left; margin: 15px 0;">
                        <li>✅ USA to Nigeria transfers via PAPSS (2-5 minutes)</li>
                        <li>✅ Stablecoin conversion (USDC/USDT to NGN)</li>
                        <li>✅ Virtual card for Nigeria spending</li>
                        <li>✅ Multi-language support (8 Nigerian languages)</li>
                        <li>✅ 0.3% transfer fees (vs 7.5% Western Union)</li>
                        <li>✅ Real-time exchange rates</li>
                    </ul>
                    
                    <button class="btn" onclick="window.open('/dashboard', '_blank')" style="width: auto; margin: 10px;">
                        🚀 Start Sending Money
                    </button>
                    <button class="btn" onclick="location.reload()" style="width: auto; margin: 10px; background: #6c757d;">
                        🔄 Try Demo Again
                    </button>
                </div>
            `;
            
            document.getElementById('finalResults').innerHTML = resultsHtml;
            document.getElementById('progressFill').style.width = '100%';
        }
        
        // Initialize
        updateProgress();
    </script>
</body>
</html>
"""

@app.route('/')
def kyc_demo():
    """Main KYC demo page"""
    return render_template_string(KYC_DEMO_HTML)

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({"service": "kyc_demo", "status": "healthy"})

@app.route('/api/verify-ssn', methods=['POST'])
def verify_ssn():
    """Simulate SSN verification"""
    data = request.get_json()
    ssn = data.get('ssn', '')
    
    # Simulate processing time
    time.sleep(2)
    
    if ssn in DEMO_DATA['ssn_database']:
        return jsonify({
            "success": True,
            "message": "SSN verified successfully",
            "data": DEMO_DATA['ssn_database'][ssn]
        })
    else:
        return jsonify({
            "success": False,
            "message": "SSN verification failed"
        })

@app.route('/api/verify-nin', methods=['POST'])
def verify_nin():
    """Simulate NIN verification"""
    data = request.get_json()
    nin = data.get('nin', '')
    
    # Simulate processing time
    time.sleep(3)
    
    if nin in DEMO_DATA['nin_database']:
        return jsonify({
            "success": True,
            "message": "NIN verified successfully",
            "data": DEMO_DATA['nin_database'][nin]
        })
    else:
        return jsonify({
            "success": False,
            "message": "NIN verification failed"
        })

@app.route('/api/verify-bvn', methods=['POST'])
def verify_bvn():
    """Simulate BVN verification"""
    data = request.get_json()
    bvn = data.get('bvn', '')
    
    # Simulate processing time
    time.sleep(2)
    
    if bvn in DEMO_DATA['bvn_database']:
        return jsonify({
            "success": True,
            "message": "BVN verified successfully",
            "data": DEMO_DATA['bvn_database'][bvn]
        })
    else:
        return jsonify({
            "success": False,
            "message": "BVN verification failed"
        })

@app.route('/api/compliance-screening', methods=['POST'])
def compliance_screening():
    """Simulate compliance screening"""
    data = request.get_json()
    
    # Simulate comprehensive screening
    time.sleep(5)
    
    screening_results = {
        "ofac_screening": {"status": "CLEAR", "confidence": 99.8},
        "pep_screening": {"status": "CLEAR", "confidence": 98.5},
        "adverse_media": {"status": "CLEAR", "confidence": 97.2},
        "risk_assessment": {"score": 15, "level": "LOW", "confidence": 96.8},
        "final_decision": {"approved": True, "confidence": 98.1}
    }
    
    return jsonify({
        "success": True,
        "message": "Compliance screening completed",
        "results": screening_results
    })

@app.route('/dashboard')
def dashboard():
    """Redirect to main platform dashboard"""
    return """
    <html>
    <head>
        <title>Nigerian Remittance Platform - Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #2E7D32; font-size: 24px; margin-bottom: 30px; }
            .features { text-align: left; max-width: 600px; margin: 0 auto; }
            .feature { margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 8px; }
        </style>
    </head>
    <body>
        <h1>🎉 Welcome to Your Diaspora Remittance Account!</h1>
        <div class="success">KYC Verification Complete - Account Active</div>
        
        <div class="features">
            <h2>Available Features:</h2>
            <div class="feature">
                <strong>💸 Send Money to Nigeria</strong><br>
                Transfer funds via PAPSS in 2-5 minutes with 0.3% fees
            </div>
            <div class="feature">
                <strong>🪙 Stablecoin Conversion</strong><br>
                Convert USDC/USDT to NGN at real-time rates
            </div>
            <div class="feature">
                <strong>💳 Virtual Nigeria Card</strong><br>
                Spend in Nigeria using your US-funded account
            </div>
            <div class="feature">
                <strong>🌍 Multi-Language Support</strong><br>
                Interface available in 8 Nigerian languages
            </div>
            <div class="feature">
                <strong>📊 Real-Time Tracking</strong><br>
                Monitor all transfers with live status updates
            </div>
        </div>
        
        <p style="margin-top: 30px;">
            <a href="/" style="color: #2E7D32; text-decoration: none;">← Back to KYC Demo</a>
        </p>
    </body>
    </html>
    """

if __name__ == '__main__':
    print("🌍 Starting Multi-Jurisdiction KYC Demo Server...")
    print("🎯 Demo Features:")
    print("• Complete 5-phase KYC process")
    print("• USA compliance (FinCEN/BSA)")
    print("• Nigeria compliance (CBN/NFIU)")
    print("• Biometric verification")
    print("• Real-time compliance screening")
    print("• Interactive user interface")
    print("=" * 50)
    print("📱 Access the demo at: http://localhost:3007")
    print("🔧 Health check: http://localhost:3007/health")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=3007, debug=False)

