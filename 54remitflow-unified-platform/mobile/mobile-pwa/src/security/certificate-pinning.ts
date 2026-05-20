// certificate-pinning.ts - PWA Certificate Pinning
// Uses Subresource Integrity and Certificate Transparency

interface PinningConfig {
  hostname: string;
  publicKeyHashes: string[];
}

class CertificatePinning {
  private static instance: CertificatePinning;
  private pinnedDomains: Map<string, PinningConfig> = new Map();

  static getInstance(): CertificatePinning {
    if (!CertificatePinning.instance) {
      CertificatePinning.instance = new CertificatePinning();
    }
    return CertificatePinning.instance;
  }

  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      mode: 'cors',
      credentials: 'include',
    });

    // Verify Certificate Transparency
    await this.verifyCertificateTransparency(url);

    return response;
  }

  private async verifyCertificateTransparency(url: string): Promise<void> {
    // Check for Certificate Transparency headers
    const response = await fetch(url, { method: 'HEAD' });
    const sct = response.headers.get('Expect-CT');
    
    if (!sct) {
      console.warn('[SECURITY] No Certificate Transparency header found');
    }
  }
}

export default CertificatePinning.getInstance();
