#!/usr/bin/env python3
"""
Update onboarding demo to reflect Nigerian Remittance Platform branding
"""

import re

def update_onboarding_demo():
    """Update the onboarding demo with remittance platform branding"""
    
    demo_file = "/home/ubuntu/create_onboarding_flow_demo.py"
    
    # Read current content
    with open(demo_file, 'r') as f:
        content = f.read()
    
    # Update branding
    replacements = {
        "Nigerian Banking Platform": "Nigerian Remittance Platform",
        "🏦 NBP": "💸 NRP",
        "Banking Platform": "Remittance Platform",
        "banking platform": "remittance platform",
        "Optimized Onboarding": "Diaspora Onboarding",
        "Enter your Nigerian phone number to get started": "Enter your phone number for diaspora remittance account",
        "Take a selfie to verify your identity": "Take a selfie for cross-border compliance",
        "Your account has been successfully created": "Your diaspora remittance account is ready!",
        "Access Dashboard": "Start Sending Money"
    }
    
    for old_text, new_text in replacements.items():
        content = content.replace(old_text, new_text)
    
    # Update the title and descriptions
    content = re.sub(
        r'<title>.*?</title>',
        '<title>Nigerian Remittance Platform - Diaspora Onboarding</title>',
        content
    )
    
    # Write updated content
    with open(demo_file, 'w') as f:
        f.write(content)
    
    print("✅ Onboarding demo updated with remittance platform branding")

if __name__ == "__main__":
    update_onboarding_demo()

