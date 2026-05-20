
import { hashPassword, validateEmail } from '../../utils/security';

export class EmailPasswordAuth {
  async login(email: string, password: string): Promise<any> {
    if (!validateEmail(email)) {
      throw new Error('Invalid email address');
    }

    const hashedPassword = await hashPassword(password);
    const response = await fetch('https://api.remittance.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: hashedPassword }),
    });

    const data = await response.json();
    if (data.token) {
      localStorage.setItem('authToken', data.token);
      return data;
    }
    throw new Error('Invalid credentials');
  }

  async logout(): Promise<void> {
    localStorage.removeItem('authToken');
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('authToken');
  }
}
