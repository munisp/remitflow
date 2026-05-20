#!/usr/bin/env python3
"""
Simplified UI/UX Improvements Deployment
Quick deployment with live demo
"""

import os
import json
import time
import sqlite3
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn

# Create FastAPI app
app = FastAPI(title="UI/UX Improvements Demo")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class VerificationRequest(BaseModel):
    user_id: str
    email: str
    phone: str = None
    method: str = "email"
    fallback: bool = False

class VerificationVerifyRequest(BaseModel):
    code_id: str
    code: str
    user_id: str

# Database setup
def init_db():
    """Initialize demo database"""
    conn = sqlite3.connect("/home/ubuntu/demo.db")
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS verification_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            code TEXT NOT NULL,
            method TEXT NOT NULL,
            contact TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            verified BOOLEAN DEFAULT FALSE,
            attempts INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS delivery_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            message TEXT NOT NULL,
            provider TEXT,
            status TEXT DEFAULT 'pending',
            delivered_at TIMESTAMP,
            error TEXT,
            attempts INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    conn.close()

def get_db():
    return sqlite3.connect("/home/ubuntu/demo.db")

# Initialize database
init_db()

# API Routes
@app.post("/api/v1/verification/send")
async def send_verification_code(request: VerificationRequest):
    """Send verification code with demo simulation"""
    
    # Generate demo code
    code = "123456"  # Fixed for demo
    
    # Store in database
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO verification_codes 
        (user_id, code, method, contact, expires_at, verified, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        request.user_id,
        code,
        request.method,
        request.email if request.method == "email" else request.phone,
        datetime.now() + timedelta(minutes=10),
        False,
        0
    ))
    
    code_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Simulate sending delay
    time.sleep(1)
    
    return {
        "success": True,
        "message": f"Demo verification code sent via {request.method}",
        "code_id": str(code_id),
        "expires_in": 600,
        "method": request.method,
        "fallback": request.fallback,
        "demo_note": f"Demo code is: {code}"
    }

@app.post("/api/v1/verification/verify")
async def verify_code(request: VerificationVerifyRequest):
    """Verify the provided code"""
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM verification_codes 
        WHERE id = ? AND user_id = ?
    """, (request.code_id, request.user_id))
    
    verification = cursor.fetchone()
    
    if not verification:
        raise HTTPException(status_code=404, detail="Verification code not found")
    
    # For demo, accept "123456" or any 6-digit code
    if request.code == "123456" or (len(request.code) == 6 and request.code.isdigit()):
        cursor.execute("""
            UPDATE verification_codes 
            SET verified = TRUE, updated_at = ?
            WHERE id = ?
        """, (datetime.now(), request.code_id))
        
        conn.commit()
        conn.close()
        
        return {
            "success": True,
            "message": "Verification successful",
            "method": verification[3]  # method column
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid verification code. Try: 123456")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "service": "ui-ux-demo",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/demo/stats")
async def get_demo_stats():
    """Get demo statistics"""
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM verification_codes")
    verification_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM delivery_attempts")
    delivery_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM verification_codes WHERE verified = TRUE")
    verified_count = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        "total_verifications": verification_count,
        "total_deliveries": delivery_count,
        "successful_verifications": verified_count,
        "success_rate": f"{(verified_count / max(verification_count, 1) * 100):.1f}%"
    }

@app.get("/")
async def serve_demo():
    """Serve demo frontend"""
    
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>UI/UX Improvements Live Demo</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            .fade-in { animation: fadeIn 0.5s ease-in; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            .spinner { 
                border: 2px solid #f3f3f3; 
                border-top: 2px solid #3498db; 
                border-radius: 50%; 
                width: 20px; 
                height: 20px; 
                animation: spin 1s linear infinite; 
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen">
        <div class="container mx-auto px-4 py-8">
            <div class="text-center mb-12 fade-in">
                <h1 class="text-4xl font-bold text-gray-900 mb-4">
                    🎯 UI/UX Improvements Live Demo
                </h1>
                <p class="text-xl text-gray-600 max-w-3xl mx-auto">
                    Experience the enhanced onboarding flow with intelligent verification, 
                    multi-provider SMS delivery, and optimized camera permissions.
                </p>
            </div>

            <div class="grid md:grid-cols-3 gap-8 mb-12">
                <div class="bg-white rounded-lg shadow-lg p-6 text-center fade-in">
                    <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                        </svg>
                    </div>
                    <h3 class="text-xl font-semibold text-gray-900 mb-2">
                        Email Backup Verification
                    </h3>
                    <p class="text-gray-600">
                        Smart verification with automatic fallback from SMS to email when needed.
                    </p>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-6 text-center fade-in">
                    <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                        </svg>
                    </div>
                    <h3 class="text-xl font-semibold text-gray-900 mb-2">
                        OTP Delivery Enhancement
                    </h3>
                    <p class="text-gray-600">
                        Multi-provider SMS delivery with intelligent fallback mechanisms.
                    </p>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-6 text-center fade-in">
                    <div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </div>
                    <h3 class="text-xl font-semibold text-gray-900 mb-2">
                        Camera Permission Optimization
                    </h3>
                    <p class="text-gray-600">
                        Intelligent camera access with file upload fallback and troubleshooting.
                    </p>
                </div>
            </div>

            <div class="text-center mb-8">
                <button onclick="startDemo()" class="bg-blue-600 text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-colors">
                    🚀 Start Interactive Demo
                </button>
            </div>

            <div id="demo-area" class="hidden">
                <div class="bg-white rounded-lg shadow-lg p-8">
                    <h2 class="text-2xl font-bold text-gray-900 mb-6">
                        📧 Email Verification Demo
                    </h2>
                    
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                Email Address
                            </label>
                            <input type="email" id="email" value="demo@example.com" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                Phone Number (Optional)
                            </label>
                            <input type="tel" id="phone" value="+2348012345678" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                Verification Method
                            </label>
                            <select id="method" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="email">Email</option>
                                <option value="sms">SMS</option>
                            </select>
                        </div>
                        
                        <button onclick="sendVerification()" 
                                class="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors">
                            Send Verification Code
                        </button>
                    </div>
                    
                    <div id="verification-step" class="hidden mt-8">
                        <h3 class="text-lg font-semibold text-gray-900 mb-4">
                            Enter Verification Code
                        </h3>
                        <div class="space-y-4">
                            <input type="text" id="verification-code" placeholder="123456" maxlength="6"
                                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest">
                            <button onclick="verifyCode()" 
                                    class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                                Verify Code
                            </button>
                            <p class="text-sm text-gray-600 text-center">
                                Demo code: <strong>123456</strong>
                            </p>
                        </div>
                    </div>
                    
                    <div id="success-step" class="hidden mt-8 text-center">
                        <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                        </div>
                        <h3 class="text-xl font-semibold text-green-600 mb-2">
                            Verification Successful!
                        </h3>
                        <p class="text-gray-600">
                            You have successfully completed the enhanced onboarding flow.
                        </p>
                        <button onclick="resetDemo()" 
                                class="mt-4 bg-gray-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-gray-700 transition-colors">
                            Try Again
                        </button>
                    </div>
                    
                    <div id="loading" class="hidden text-center py-4">
                        <div class="spinner mx-auto"></div>
                        <p class="mt-2 text-gray-600">Processing...</p>
                    </div>
                    
                    <div id="error-message" class="hidden mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p class="text-red-700"></p>
                    </div>
                </div>
            </div>

            <div class="mt-12 bg-white rounded-lg shadow-lg p-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">
                    📊 Live Demo Statistics
                </h2>
                <div id="stats" class="grid md:grid-cols-4 gap-4">
                    <div class="text-center">
                        <div class="text-2xl font-bold text-blue-600" id="total-verifications">0</div>
                        <div class="text-sm text-gray-600">Total Verifications</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-green-600" id="successful-verifications">0</div>
                        <div class="text-sm text-gray-600">Successful</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-purple-600" id="total-deliveries">0</div>
                        <div class="text-sm text-gray-600">SMS Deliveries</div>
                    </div>
                    <div class="text-center">
                        <div class="text-2xl font-bold text-orange-600" id="success-rate">0%</div>
                        <div class="text-sm text-gray-600">Success Rate</div>
                    </div>
                </div>
            </div>

            <div class="mt-8 bg-white rounded-lg shadow-lg p-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">
                    🚀 Implementation Highlights
                </h2>
                <div class="grid md:grid-cols-2 gap-6">
                    <div>
                        <h3 class="font-semibold text-gray-900 mb-2">Backend Services</h3>
                        <ul class="text-gray-600 space-y-1">
                            <li>• Go & Python microservices</li>
                            <li>• Multi-provider SMS delivery</li>
                            <li>• Intelligent fallback mechanisms</li>
                            <li>• Real-time notification system</li>
                            <li>• Novu integration for notifications</li>
                        </ul>
                    </div>
                    <div>
                        <h3 class="font-semibold text-gray-900 mb-2">Frontend Features</h3>
                        <ul class="text-gray-600 space-y-1">
                            <li>• React with TypeScript</li>
                            <li>• Animated UI components</li>
                            <li>• Mobile-first responsive design</li>
                            <li>• Progressive enhancement</li>
                            <li>• Real-time statistics</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <script>
            let currentCodeId = null;
            
            function startDemo() {
                document.getElementById('demo-area').classList.remove('hidden');
                document.getElementById('demo-area').scrollIntoView({ behavior: 'smooth' });
                loadStats();
            }
            
            async function sendVerification() {
                const email = document.getElementById('email').value;
                const phone = document.getElementById('phone').value;
                const method = document.getElementById('method').value;
                
                showLoading(true);
                hideError();
                
                try {
                    const response = await fetch('/api/v1/verification/send', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            user_id: 'demo_user_' + Date.now(),
                            email: email,
                            phone: phone,
                            method: method,
                            fallback: false
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        currentCodeId = data.code_id;
                        document.getElementById('verification-step').classList.remove('hidden');
                        document.getElementById('verification-step').scrollIntoView({ behavior: 'smooth' });
                    } else {
                        showError('Failed to send verification code');
                    }
                } catch (error) {
                    showError('Network error: ' + error.message);
                } finally {
                    showLoading(false);
                }
            }
            
            async function verifyCode() {
                const code = document.getElementById('verification-code').value;
                
                if (!code || code.length !== 6) {
                    showError('Please enter a 6-digit code');
                    return;
                }
                
                showLoading(true);
                hideError();
                
                try {
                    const response = await fetch('/api/v1/verification/verify', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            code_id: currentCodeId,
                            code: code,
                            user_id: 'demo_user'
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        document.getElementById('verification-step').classList.add('hidden');
                        document.getElementById('success-step').classList.remove('hidden');
                        document.getElementById('success-step').scrollIntoView({ behavior: 'smooth' });
                        loadStats();
                    } else {
                        showError(data.detail || 'Verification failed');
                    }
                } catch (error) {
                    showError('Network error: ' + error.message);
                } finally {
                    showLoading(false);
                }
            }
            
            function resetDemo() {
                document.getElementById('verification-step').classList.add('hidden');
                document.getElementById('success-step').classList.add('hidden');
                document.getElementById('verification-code').value = '';
                hideError();
                loadStats();
            }
            
            function showLoading(show) {
                document.getElementById('loading').classList.toggle('hidden', !show);
            }
            
            function showError(message) {
                const errorDiv = document.getElementById('error-message');
                errorDiv.querySelector('p').textContent = message;
                errorDiv.classList.remove('hidden');
            }
            
            function hideError() {
                document.getElementById('error-message').classList.add('hidden');
            }
            
            async function loadStats() {
                try {
                    const response = await fetch('/demo/stats');
                    const stats = await response.json();
                    
                    document.getElementById('total-verifications').textContent = stats.total_verifications;
                    document.getElementById('successful-verifications').textContent = stats.successful_verifications;
                    document.getElementById('total-deliveries').textContent = stats.total_deliveries;
                    document.getElementById('success-rate').textContent = stats.success_rate;
                } catch (error) {
                    console.error('Failed to load stats:', error);
                }
            }
            
            // Load initial stats
            loadStats();
            
            // Auto-refresh stats every 30 seconds
            setInterval(loadStats, 30000);
        </script>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html_content)

def main():
    print("🎯 STARTING UI/UX IMPROVEMENTS LIVE DEMO")
    print("=" * 50)
    print("🚀 Demo will be available at: http://localhost:3000")
    print("📊 API endpoints available at: http://localhost:3000/api/v1/")
    print("🔧 Health check: http://localhost:3000/health")
    print("📈 Demo stats: http://localhost:3000/demo/stats")
    print("=" * 50)
    
    uvicorn.run(app, host="0.0.0.0", port=3000)

if __name__ == "__main__":
    main()

