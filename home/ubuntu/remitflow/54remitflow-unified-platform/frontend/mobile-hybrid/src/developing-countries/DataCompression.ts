// DataCompressionManager.ts - Compress data for low bandwidth
import { Platform } from 'react-native';
import pako from 'pako';

interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  timeTaken: number;
}

export class DataCompressionManager {
  private static instance: DataCompressionManager;
  private compressionEnabled: boolean = true;
  private minSizeForCompression: number = 1024; // 1KB

  private constructor() {}

  static getInstance(): DataCompressionManager {
    if (!DataCompressionManager.instance) {
      DataCompressionManager.instance = new DataCompressionManager();
    }
    return DataCompressionManager.instance;
  }

  async compressData(data: any): Promise<{ compressed: string; stats: CompressionStats }> {
    const startTime = Date.now();
    const jsonString = JSON.stringify(data);
    const originalSize = new Blob([jsonString]).size;
    
    // Skip compression for small payloads
    if (originalSize < this.minSizeForCompression) {
      return {
        compressed: jsonString,
        stats: {
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1.0,
          timeTaken: Date.now() - startTime
        }
      };
    }
    
    try {
      // Convert string to Uint8Array
      const uint8Array = new TextEncoder().encode(jsonString);
      
      // Compress using gzip
      const compressed = pako.gzip(uint8Array, { level: 6 });
      
      // Convert to base64 for transmission
      const base64 = this.arrayBufferToBase64(compressed);
      const compressedSize = new Blob([base64]).size;
      
      const stats: CompressionStats = {
        originalSize,
        compressedSize,
        compressionRatio: originalSize / compressedSize,
        timeTaken: Date.now() - startTime
      };
      
      console.log(`[Compression] Compressed ${originalSize} bytes to ${compressedSize} bytes (${(stats.compressionRatio * 100).toFixed(1)}% reduction)`);
      
      return { compressed: base64, stats };
    } catch (error) {
      console.error('[Compression] Failed to compress data:', error);
      return {
        compressed: jsonString,
        stats: {
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1.0,
          timeTaken: Date.now() - startTime
        }
      };
    }
  }

  async decompressData(compressedData: string): Promise<any> {
    try {
      // Convert base64 to Uint8Array
      const uint8Array = this.base64ToArrayBuffer(compressedData);
      
      // Decompress
      const decompressed = pako.ungzip(uint8Array);
      
      // Convert back to string
      const jsonString = new TextDecoder().decode(decompressed);
      
      return JSON.parse(jsonString);
    } catch (error) {
      // If decompression fails, assume it's uncompressed JSON
      console.warn('[Compression] Decompression failed, treating as uncompressed:', error);
      return JSON.parse(compressedData);
    }
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Compress images for low bandwidth
  async compressImage(imageUri: string, quality: number = 0.6): Promise<string> {
    // This would integrate with react-native-image-resizer or similar
    console.log(`[Compression] Compressing image: ${imageUri} at quality ${quality}`);
    // Implementation would go here
    return imageUri;
  }

  setCompressionEnabled(enabled: boolean): void {
    this.compressionEnabled = enabled;
    console.log(`[Compression] Compression ${enabled ? 'enabled' : 'disabled'}`);
  }

  setMinSizeForCompression(bytes: number): void {
    this.minSizeForCompression = bytes;
    console.log(`[Compression] Min size for compression set to ${bytes} bytes`);
  }
}
