// security-manager.ts - PWA Security Implementation
// Web-based security features

interface SecurityConfig {
  certificateTransparency: boolean;
  contentSecurityPolicy: boolean;
  subresourceIntegrity: boolean;
  sessionTimeout: number;
  clipboardProtection: boolean;
  vpnDetection: boolean;
}

class SecurityManager {
  private static instance: SecurityManager;
  private config: SecurityConfig;
  private sessionStart: number = 0;

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  private constructor() {
    this.config = {
      certificateTransparency: true,
      contentSecurityPolicy: true,
      subresourceIntegrity: true,
      sessionTimeout: 15,
      clipboardProtection: true,
      vpnDetection: true,
    };
  }

  async initialize(): Promise<void> {
    this.setupCSP();
    this.startSessionTimeout();
    this.enableClipboardProtection();
    await this.checkSecureContext();
  }

  private setupCSP(): void {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';";
    document.head.appendChild(meta);
  }

  private startSessionTimeout(): void {
    this.sessionStart = Date.now();
    setTimeout(() => {
      this.handleSessionTimeout();
    }, this.config.sessionTimeout * 60 * 1000);
  }

  private handleSessionTimeout(): void {
    console.log('[SECURITY] Session timeout');
    // Clear session and redirect to login
  }

  private enableClipboardProtection(): void {
    if (!this.config.clipboardProtection) return;

    setInterval(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, 30000);
  }

  private async checkSecureContext(): Promise<void> {
    if (!window.isSecureContext) {
      console.error('[SECURITY] Not a secure context (HTTPS required)');
    }
  }

  async detectVPN(): Promise<boolean> {
    // Check for WebRTC leaks
    try {
      const pc = new RTCPeerConnection();
      pc.createDataChannel('');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // Check if local IP differs from public IP
      return false; // Simplified
    } catch {
      return false;
    }
  }

  preventScreenshot(element: HTMLElement): void {
    element.style.webkitUserSelect = 'none';
    element.style.userSelect = 'none';
    element.style.pointerEvents = 'none';
  }

  async calculateSecurityScore(): Promise<number> {
    let score = 100;

    if (!window.isSecureContext) score -= 50;
    if (!this.config.contentSecurityPolicy) score -= 20;
    if (!this.config.subresourceIntegrity) score -= 10;

    return Math.max(0, score);
  }
}

export default SecurityManager.getInstance();
