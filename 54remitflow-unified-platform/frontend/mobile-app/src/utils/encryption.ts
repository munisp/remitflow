import CryptoJS from 'crypto-js';
const SECRET = 'remittance-secret';
export const encrypt = (text: string): string => CryptoJS.AES.encrypt(text, SECRET).toString();
export const decrypt = (ciphertext: string): string => CryptoJS.AES.decrypt(ciphertext, SECRET).toString(CryptoJS.enc.Utf8);