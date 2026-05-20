import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw,
  ArrowLeft,
  Info,
  FileImage,
  Smartphone,
  Settings
} from 'lucide-react';

interface CameraPermissionOptimizationProps {
  onImageCapture: (imageData: string, metadata: any) => void;
  onBack: () => void;
  acceptedFormats?: string[];
  maxFileSize?: number; // in MB
}

interface CaptureMetadata {
  timestamp: string;
  method: 'camera' | 'upload';
  fileSize: number;
  dimensions?: { width: number; height: number };
  quality?: number;
}

const CameraPermissionOptimization: React.FC<CameraPermissionOptimizationProps> = ({
  onImageCapture,
  onBack,
  acceptedFormats = ['image/jpeg', 'image/png', 'image/webp'],
  maxFileSize = 10
}) => {
  const [step, setStep] = useState<'permission' | 'capture' | 'upload' | 'preview'>('permission');
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [imageMetadata, setImageMetadata] = useState<CaptureMetadata | null>(null);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    detectDeviceCapabilities();
    checkInitialPermissionStatus();
  }, []);

  const detectDeviceCapabilities = () => {
    const info = {
      hasCamera: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
      supportsFileAPI: !!(window.File && window.FileReader && window.FileList && window.Blob),
      userAgent: navigator.userAgent
    };
    setDeviceInfo(info);
  };

  const checkInitialPermissionStatus = async () => {
    if (!navigator.permissions) {
      setPermissionStatus('unknown');
      return;
    }

    try {
      const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
      setPermissionStatus(result.state as any);
      
      result.addEventListener('change', () => {
        setPermissionStatus(result.state as any);
      });
    } catch (error) {
      setPermissionStatus('unknown');
    }
  };

  const requestCameraPermission = async () => {
    setIsLoading(true);
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Prefer back camera
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setPermissionStatus('granted');
      setStep('capture');
    } catch (error: any) {
      console.error('Camera permission error:', error);
      
      if (error.name === 'NotAllowedError') {
        setPermissionStatus('denied');
        setError('Camera permission was denied. Please enable camera access in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        setError('No camera found on this device. Please use the file upload option.');
      } else if (error.name === 'NotSupportedError') {
        setError('Camera is not supported on this device. Please use the file upload option.');
      } else {
        setError('Failed to access camera. Please try the file upload option.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to base64
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    // Calculate file size
    const base64Length = imageData.length - 'data:image/jpeg;base64,'.length;
    const fileSize = (base64Length * 3) / 4 / 1024 / 1024; // Convert to MB

    const metadata: CaptureMetadata = {
      timestamp: new Date().toISOString(),
      method: 'camera',
      fileSize: fileSize,
      dimensions: { width: canvas.width, height: canvas.height },
      quality: 0.8
    };

    setCapturedImage(imageData);
    setImageMetadata(metadata);
    setStep('preview');

    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError('');

    // Validate file type
    if (!acceptedFormats.includes(file.type)) {
      setError(`Please select a valid image file (${acceptedFormats.join(', ')})`);
      setIsLoading(false);
      return;
    }

    // Validate file size
    const fileSizeMB = file.size / 1024 / 1024;
    if (fileSizeMB > maxFileSize) {
      setError(`File size must be less than ${maxFileSize}MB`);
      setIsLoading(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target?.result as string;
      
      // Create image to get dimensions
      const img = new Image();
      img.onload = () => {
        const metadata: CaptureMetadata = {
          timestamp: new Date().toISOString(),
          method: 'upload',
          fileSize: fileSizeMB,
          dimensions: { width: img.width, height: img.height }
        };

        setCapturedImage(imageData);
        setImageMetadata(metadata);
        setStep('preview');
        setIsLoading(false);
      };
      img.src = imageData;
    };

    reader.onerror = () => {
      setError('Failed to read the selected file');
      setIsLoading(false);
    };

    reader.readAsDataURL(file);
  };

  const confirmImage = () => {
    if (capturedImage && imageMetadata) {
      onImageCapture(capturedImage, imageMetadata);
    }
  };

  const retakePhoto = () => {
    setCapturedImage('');
    setImageMetadata(null);
    setStep('permission');
  };

  const openBrowserSettings = () => {
    if (deviceInfo?.isIOS) {
      alert('To enable camera access on iOS:\n1. Go to Settings > Safari > Camera\n2. Select "Allow" or "Ask"\n3. Refresh this page');
    } else {
      alert('To enable camera access:\n1. Click the camera icon in your browser address bar\n2. Select "Allow"\n3. Or go to browser settings and enable camera for this site');
    }
  };

  const TroubleshootingGuide = () => (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg"
    >
      <h4 className="font-semibold text-blue-900 mb-3 flex items-center">
        <Info className="w-4 h-4 mr-2" />
        Troubleshooting Camera Issues
      </h4>
      
      <div className="space-y-3 text-sm text-blue-800">
        <div>
          <strong>Camera Permission Denied:</strong>
          <ul className="list-disc list-inside ml-4 mt-1">
            <li>Click the camera icon in your browser address bar</li>
            <li>Select "Allow" for camera access</li>
            <li>Refresh the page after changing permissions</li>
          </ul>
        </div>
        
        <div>
          <strong>No Camera Found:</strong>
          <ul className="list-disc list-inside ml-4 mt-1">
            <li>Check if your device has a camera</li>
            <li>Ensure no other apps are using the camera</li>
            <li>Try using the file upload option instead</li>
          </ul>
        </div>
        
        <div>
          <strong>Camera Not Working:</strong>
          <ul className="list-disc list-inside ml-4 mt-1">
            <li>Try refreshing the page</li>
            <li>Check your browser settings</li>
            <li>Use a different browser if issues persist</li>
          </ul>
        </div>
        
        {deviceInfo?.isIOS && (
          <div>
            <strong>iOS Specific:</strong>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li>Go to Settings > Safari > Camera</li>
              <li>Select "Allow" or "Ask"</li>
              <li>Some iOS versions may require using Safari browser</li>
            </ul>
          </div>
        )}
      </div>
      
      <button
        onClick={openBrowserSettings}
        className="mt-3 text-blue-600 hover:text-blue-800 font-medium flex items-center"
      >
        <Settings className="w-4 h-4 mr-1" />
        Open Browser Settings
      </button>
    </motion.div>
  );

  if (step === 'permission') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg"
      >
        <div className="flex items-center mb-6">
          <button
            onClick={onBack}
            className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Document Capture</h2>
        </div>

        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Camera className="w-8 h-8 text-purple-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Take a Photo of Your ID
          </h3>
          <p className="text-gray-600">
            We'll help you capture a clear photo of your identification document
          </p>
        </div>

        <div className="space-y-4">
          {deviceInfo?.hasCamera && (
            <button
              onClick={requestCameraPermission}
              disabled={isLoading}
              className="w-full p-4 border-2 border-purple-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex items-center">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
                  <Camera className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Use Camera</h3>
                  <p className="text-sm text-gray-600">
                    {permissionStatus === 'granted' ? 'Camera ready' : 
                     permissionStatus === 'denied' ? 'Permission denied' :
                     'Take a photo with your camera'}
                  </p>
                </div>
              </div>
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                <Upload className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Upload File</h3>
                <p className="text-sm text-gray-600">
                  Select an image from your device
                </p>
              </div>
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFormats.join(',')}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {isLoading && (
          <div className="mt-6 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-purple-600 mr-2" />
            <span className="text-gray-600">
              {step === 'capture' ? 'Starting camera...' : 'Processing image...'}
            </span>
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg"
            >
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-600 mr-2 mt-0.5" />
                <div>
                  <span className="text-red-700 text-sm">{error}</span>
                  {permissionStatus === 'denied' && (
                    <button
                      onClick={() => setShowTroubleshooting(!showTroubleshooting)}
                      className="block mt-2 text-red-600 hover:text-red-800 font-medium text-sm"
                    >
                      Show troubleshooting guide
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTroubleshooting && <TroubleshootingGuide />}
        </AnimatePresence>

        {deviceInfo && (
          <div className="mt-6 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              Device: {deviceInfo.isMobile ? 'Mobile' : 'Desktop'} | 
              Camera: {deviceInfo.hasCamera ? 'Available' : 'Not found'} |
              File API: {deviceInfo.supportsFileAPI ? 'Supported' : 'Not supported'}
            </p>
          </div>
        )}
      </motion.div>
    );
  }

  if (step === 'capture') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg"
      >
        <div className="flex items-center mb-6">
          <button
            onClick={() => {
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
              }
              setStep('permission');
            }}
            className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Capture Document</h2>
        </div>

        <div className="relative mb-6">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-gray-100"
            style={{ aspectRatio: '4/3' }}
          />
          
          {/* Overlay guide */}
          <div className="absolute inset-4 border-2 border-white border-dashed rounded-lg flex items-center justify-center">
            <div className="text-white text-center bg-black bg-opacity-50 p-2 rounded">
              <FileImage className="w-6 h-6 mx-auto mb-1" />
              <p className="text-sm">Position your ID here</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={capturePhoto}
            className="w-full bg-purple-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-purple-700 transition-colors flex items-center justify-center"
          >
            <Camera className="w-5 h-5 mr-2" />
            Capture Photo
          </button>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Make sure your document is clearly visible and well-lit
            </p>
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
    );
  }

  if (step === 'preview') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg"
      >
        <div className="flex items-center mb-6">
          <button
            onClick={retakePhoto}
            className="mr-4 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Review Image</h2>
        </div>

        <div className="mb-6">
          <div className="relative">
            <img
              src={capturedImage}
              alt="Captured document"
              className="w-full rounded-lg border-2 border-gray-200"
            />
            <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          
          {imageMetadata && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Method:</span>
                  <span className="ml-2 font-medium capitalize">{imageMetadata.method}</span>
                </div>
                <div>
                  <span className="text-gray-600">Size:</span>
                  <span className="ml-2 font-medium">{imageMetadata.fileSize.toFixed(1)}MB</span>
                </div>
                {imageMetadata.dimensions && (
                  <>
                    <div>
                      <span className="text-gray-600">Width:</span>
                      <span className="ml-2 font-medium">{imageMetadata.dimensions.width}px</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Height:</span>
                      <span className="ml-2 font-medium">{imageMetadata.dimensions.height}px</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={confirmImage}
            className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center"
          >
            <CheckCircle className="w-5 h-5 mr-2" />
            Use This Image
          </button>

          <button
            onClick={retakePhoto}
            className="w-full border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
          >
            Retake Photo
          </button>
        </div>
      </motion.div>
    );
  }

  return null;
};

export default CameraPermissionOptimization;