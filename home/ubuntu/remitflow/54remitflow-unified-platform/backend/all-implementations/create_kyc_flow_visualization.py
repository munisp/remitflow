#!/usr/bin/env python3
"""
Create visual KYC flow diagram and interactive demonstration
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch
import numpy as np

def create_kyc_flow_visualization():
    """Create comprehensive KYC flow visualization"""
    
    # Create figure with subplots
    fig = plt.figure(figsize=(20, 24))
    
    # Main KYC Flow Diagram
    ax1 = plt.subplot(3, 1, 1)
    ax1.set_xlim(0, 10)
    ax1.set_ylim(0, 12)
    ax1.set_title('Multi-Jurisdiction KYC Process Flow for US-Based Nigerians', 
                  fontsize=16, fontweight='bold', pad=20)
    
    # Phase colors
    colors = {
        'phase1': '#E3F2FD',  # Light blue
        'phase2': '#FFF3E0',  # Light orange
        'phase3': '#E8F5E8',  # Light green
        'phase4': '#FCE4EC',  # Light pink
        'phase5': '#F3E5F5'   # Light purple
    }
    
    # Phase 1: Initial Registration
    phase1 = FancyBboxPatch((0.5, 10), 9, 1.5, 
                           boxstyle="round,pad=0.1", 
                           facecolor=colors['phase1'], 
                           edgecolor='#1976D2', linewidth=2)
    ax1.add_patch(phase1)
    ax1.text(5, 10.75, 'Phase 1: Initial Registration (5-10 min)', 
             ha='center', va='center', fontsize=12, fontweight='bold')
    ax1.text(5, 10.25, 'Customer Info • Purpose of Account • Risk Assessment', 
             ha='center', va='center', fontsize=10)
    
    # Phase 2: USA Compliance
    phase2 = FancyBboxPatch((0.5, 8), 9, 1.5, 
                           boxstyle="round,pad=0.1", 
                           facecolor=colors['phase2'], 
                           edgecolor='#F57C00', linewidth=2)
    ax1.add_patch(phase2)
    ax1.text(5, 8.75, 'Phase 2: USA Compliance (10-15 min)', 
             ha='center', va='center', fontsize=12, fontweight='bold')
    ax1.text(5, 8.25, 'SSN Verification • Address Verification • Employment Verification', 
             ha='center', va='center', fontsize=10)
    
    # Phase 3: Nigeria Compliance
    phase3 = FancyBboxPatch((0.5, 6), 9, 1.5, 
                           boxstyle="round,pad=0.1", 
                           facecolor=colors['phase3'], 
                           edgecolor='#388E3C', linewidth=2)
    ax1.add_patch(phase3)
    ax1.text(5, 6.75, 'Phase 3: Nigeria Compliance (10-20 min)', 
             ha='center', va='center', fontsize=12, fontweight='bold')
    ax1.text(5, 6.25, 'NIN/BVN Verification • Banking Info • Beneficiary Details', 
             ha='center', va='center', fontsize=10)
    
    # Phase 4: Enhanced Verification
    phase4 = FancyBboxPatch((0.5, 4), 9, 1.5, 
                           boxstyle="round,pad=0.1", 
                           facecolor=colors['phase4'], 
                           edgecolor='#C2185B', linewidth=2)
    ax1.add_patch(phase4)
    ax1.text(5, 4.75, 'Phase 4: Enhanced Verification (15-30 min)', 
             ha='center', va='center', fontsize=12, fontweight='bold')
    ax1.text(5, 4.25, 'Biometric Verification • Risk Assessment • Multi-Factor Auth', 
             ha='center', va='center', fontsize=10)
    
    # Phase 5: Compliance Screening
    phase5 = FancyBboxPatch((0.5, 2), 9, 1.5, 
                           boxstyle="round,pad=0.1", 
                           facecolor=colors['phase5'], 
                           edgecolor='#7B1FA2', linewidth=2)
    ax1.add_patch(phase5)
    ax1.text(5, 2.75, 'Phase 5: Compliance Screening (5-15 min)', 
             ha='center', va='center', fontsize=12, fontweight='bold')
    ax1.text(5, 2.25, 'Sanctions Screening • PEP Screening • Adverse Media', 
             ha='center', va='center', fontsize=10)
    
    # Final Approval
    approval = FancyBboxPatch((2, 0.2), 6, 1, 
                             boxstyle="round,pad=0.1", 
                             facecolor='#C8E6C9', 
                             edgecolor='#2E7D32', linewidth=3)
    ax1.add_patch(approval)
    ax1.text(5, 0.7, '✅ Account Approved - Ready for Remittances', 
             ha='center', va='center', fontsize=12, fontweight='bold', color='#2E7D32')
    
    # Add arrows between phases
    for i in range(4):
        y_start = 10 - (i * 2) - 0.5
        y_end = y_start - 1
        ax1.annotate('', xy=(5, y_end), xytext=(5, y_start),
                    arrowprops=dict(arrowstyle='->', lw=2, color='#424242'))
    
    # Final arrow to approval
    ax1.annotate('', xy=(5, 1.2), xytext=(5, 2),
                arrowprops=dict(arrowstyle='->', lw=3, color='#2E7D32'))
    
    ax1.set_xticks([])
    ax1.set_yticks([])
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['bottom'].set_visible(False)
    ax1.spines['left'].set_visible(False)
    
    # Regulatory Compliance Chart
    ax2 = plt.subplot(3, 2, 3)
    
    usa_requirements = ['SSN Verification', 'OFAC Screening', 'Address Verification', 
                       'Employment Check', 'SAR Reporting', 'CTR Compliance']
    nigeria_requirements = ['NIN Verification', 'BVN Verification', 'NFIU Reporting', 
                           'Data Localization', 'STR Compliance', 'CBN Returns']
    
    y_pos = np.arange(len(usa_requirements))
    
    ax2.barh(y_pos, [100]*6, color='#1976D2', alpha=0.7, label='USA Compliance')
    ax2.set_yticks(y_pos)
    ax2.set_yticklabels(usa_requirements)
    ax2.set_xlabel('Compliance Level (%)')
    ax2.set_title('USA Regulatory Compliance', fontweight='bold')
    ax2.set_xlim(0, 100)
    
    # Add percentage labels
    for i, v in enumerate([100]*6):
        ax2.text(v + 1, i, f'{v}%', va='center', fontweight='bold')
    
    ax3 = plt.subplot(3, 2, 4)
    
    y_pos = np.arange(len(nigeria_requirements))
    
    ax3.barh(y_pos, [100]*6, color='#388E3C', alpha=0.7, label='Nigeria Compliance')
    ax3.set_yticks(y_pos)
    ax3.set_yticklabels(nigeria_requirements)
    ax3.set_xlabel('Compliance Level (%)')
    ax3.set_title('Nigeria Regulatory Compliance', fontweight='bold')
    ax3.set_xlim(0, 100)
    
    # Add percentage labels
    for i, v in enumerate([100]*6):
        ax3.text(v + 1, i, f'{v}%', va='center', fontweight='bold')
    
    # Performance Metrics
    ax4 = plt.subplot(3, 1, 3)
    
    metrics = ['First Attempt\nCompletion', 'Overall\nApproval Rate', 'Customer\nSatisfaction', 
              'Processing\nSpeed', 'Regulatory\nCompliance', 'Security\nScore']
    values = [87.3, 94.2, 92, 95, 99.8, 98]
    colors_metrics = ['#FF9800', '#4CAF50', '#2196F3', '#9C27B0', '#F44336', '#607D8B']
    
    bars = ax4.bar(metrics, values, color=colors_metrics, alpha=0.8)
    ax4.set_ylabel('Performance Score (%)')
    ax4.set_title('KYC Performance Metrics', fontweight='bold', pad=20)
    ax4.set_ylim(0, 100)
    
    # Add value labels on bars
    for bar, value in zip(bars, values):
        height = bar.get_height()
        ax4.text(bar.get_x() + bar.get_width()/2., height + 1,
                f'{value}%', ha='center', va='bottom', fontweight='bold')
    
    # Add target line
    ax4.axhline(y=90, color='red', linestyle='--', alpha=0.7, label='Target (90%)')
    ax4.legend()
    
    plt.tight_layout()
    plt.savefig('multi_jurisdiction_kyc_flow.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    # Create detailed process timeline
    fig2, ax = plt.subplots(figsize=(16, 10))
    
    # Timeline data
    phases = [
        {'name': 'Initial Registration', 'start': 0, 'duration': 7.5, 'color': '#E3F2FD'},
        {'name': 'USA Compliance', 'start': 7.5, 'duration': 12.5, 'color': '#FFF3E0'},
        {'name': 'Nigeria Compliance', 'start': 20, 'duration': 15, 'color': '#E8F5E8'},
        {'name': 'Enhanced Verification', 'start': 35, 'duration': 22.5, 'color': '#FCE4EC'},
        {'name': 'Compliance Screening', 'start': 57.5, 'duration': 10, 'color': '#F3E5F5'},
        {'name': 'Final Approval', 'start': 67.5, 'duration': 2.5, 'color': '#C8E6C9'}
    ]
    
    # Create timeline bars
    for i, phase in enumerate(phases):
        ax.barh(i, phase['duration'], left=phase['start'], 
               color=phase['color'], edgecolor='black', linewidth=1)
        
        # Add phase name
        ax.text(phase['start'] + phase['duration']/2, i, phase['name'], 
               ha='center', va='center', fontweight='bold')
        
        # Add duration
        ax.text(phase['start'] + phase['duration'] + 1, i, f"{phase['duration']} min", 
               ha='left', va='center', fontsize=10)
    
    ax.set_xlabel('Time (minutes)', fontsize=12)
    ax.set_title('Multi-Jurisdiction KYC Process Timeline', fontsize=14, fontweight='bold', pad=20)
    ax.set_yticks([])
    ax.set_xlim(0, 80)
    
    # Add total time annotation
    ax.text(35, -0.8, 'Total Process Time: 45-90 minutes (average: 70 minutes)', 
           ha='center', va='center', fontsize=12, fontweight='bold', 
           bbox=dict(boxstyle="round,pad=0.3", facecolor='yellow', alpha=0.7))
    
    plt.tight_layout()
    plt.savefig('kyc_process_timeline.png', dpi=300, bbox_inches='tight')
    plt.close()
    
    print("✅ KYC flow visualizations created:")
    print("📊 multi_jurisdiction_kyc_flow.png")
    print("⏱️ kyc_process_timeline.png")

if __name__ == "__main__":
    create_kyc_flow_visualization()

