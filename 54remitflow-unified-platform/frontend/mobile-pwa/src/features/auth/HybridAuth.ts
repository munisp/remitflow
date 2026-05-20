
import { NativeBiometric } from '@capgo/capacitor-native-biometric';

export class HybridAuth {
  async emailPasswordLogin(email: string, password: string): Promise<any> {
    const response = await fetch('https://api.remittance.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    if (data.token) {
      await this.storeCredentials(email, password);
      return data;
    }
    throw new Error('Invalid credentials');
  }

  async biometricLogin(): Promise<any> {
    try {
      const result = await NativeBiometric.isAvailable();
      if (!result.isAvailable) {
        throw new Error('Biometric not available');
      }

      const verified = await NativeBiometric.verifyIdentity({
        reason: 'Authenticate to continue',
        title: 'Biometric Authentication',
      });

      if (verified) {
        const credentials = await NativeBiometric.getCredentials({ server: 'remittance' });
        return this.emailPasswordLogin(credentials.username, credentials.password);
      }
      throw new Error('Authentication failed');
    } catch (error) {
      throw error;
    }
  }

  private async storeCredentials(username: string, password: string): Promise<void> {
    await NativeBiometric.setCredentials({
      username,
      password,
      server: 'remittance',
    });
  }
}
