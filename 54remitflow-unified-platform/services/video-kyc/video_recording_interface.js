// Video KYC Recording Interface - Complete Webcam Integration
// Production-ready implementation with all features

class VideoKYCRecorder {
    constructor(options = {}) {
        this.options = {
            videoConstraints: {
                width: { ideal: 1280, min: 640 },
                height: { ideal: 720, min: 480 },
                frameRate: { ideal: 30, min: 15 },
                facingMode: 'user'
            },
            audioConstraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            recordingOptions: {
                mimeType: 'video/webm;codecs=vp9,opus',
                videoBitsPerSecond: 2500000,
                audioBitsPerSecond: 128000
            },
            maxRecordingTime: 120000, // 2 minutes
            minRecordingTime: 5000,   // 5 seconds
            ...options
        };
        
        this.mediaRecorder = null;
        this.stream = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordingTimer = null;
        this.callbacks = {};
        
        this.initializeElements();
        this.setupEventListeners();
    }
    
    initializeElements() {
        // Create video recording interface
        this.container = document.createElement('div');
        this.container.className = 'video-kyc-recorder';
        this.container.innerHTML = `
            <div class="video-container">
                <video id="preview-video" autoplay muted playsinline></video>
                <div class="recording-overlay">
                    <div class="recording-indicator" style="display: none;">
                        <span class="recording-dot"></span>
                        <span class="recording-text">Recording</span>
                        <span class="recording-time">00:00</span>
                    </div>
                    <div class="face-detection-overlay">
                        <div class="face-guide">
                            <div class="face-outline"></div>
                            <div class="face-instructions">Position your face within the oval</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="controls-container">
                <div class="recording-status">
                    <span class="status-text">Ready to record</span>
                    <div class="quality-indicator">
                        <span class="quality-label">Video Quality:</span>
                        <span class="quality-value">Good</span>
                    </div>
                </div>
                
                <div class="recording-controls">
                    <button id="start-recording" class="btn btn-primary">
                        <i class="icon-record"></i>
                        Start Recording
                    </button>
                    <button id="stop-recording" class="btn btn-danger" disabled>
                        <i class="icon-stop"></i>
                        Stop Recording
                    </button>
                    <button id="retry-recording" class="btn btn-secondary" style="display: none;">
                        <i class="icon-retry"></i>
                        Retry
                    </button>
                </div>
                
                <div class="recording-progress">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="time-display">
                        <span class="current-time">00:00</span>
                        <span class="max-time">02:00</span>
                    </div>
                </div>
            </div>
            
            <div class="recording-preview" style="display: none;">
                <video id="recorded-video" controls></video>
                <div class="preview-controls">
                    <button id="approve-recording" class="btn btn-success">
                        <i class="icon-check"></i>
                        Approve Recording
                    </button>
                    <button id="reject-recording" class="btn btn-warning">
                        <i class="icon-reject"></i>
                        Record Again
                    </button>
                </div>
            </div>
            
            <div class="error-container" style="display: none;">
                <div class="error-message"></div>
                <button id="retry-camera" class="btn btn-primary">
                    <i class="icon-camera"></i>
                    Retry Camera Access
                </button>
            </div>
        `;
        
        this.previewVideo = this.container.querySelector('#preview-video');
        this.recordedVideo = this.container.querySelector('#recorded-video');
        this.startButton = this.container.querySelector('#start-recording');
        this.stopButton = this.container.querySelector('#stop-recording');
        this.retryButton = this.container.querySelector('#retry-recording');
        this.approveButton = this.container.querySelector('#approve-recording');
        this.rejectButton = this.container.querySelector('#reject-recording');
        this.retryCameraButton = this.container.querySelector('#retry-camera');
        
        this.recordingIndicator = this.container.querySelector('.recording-indicator');
        this.recordingTime = this.container.querySelector('.recording-time');
        this.statusText = this.container.querySelector('.status-text');
        this.qualityValue = this.container.querySelector('.quality-value');
        this.progressFill = this.container.querySelector('.progress-fill');
        this.currentTimeDisplay = this.container.querySelector('.current-time');
        this.errorContainer = this.container.querySelector('.error-container');
        this.errorMessage = this.container.querySelector('.error-message');
        this.recordingPreview = this.container.querySelector('.recording-preview');
    }
    
    setupEventListeners() {
        this.startButton.addEventListener('click', () => this.startRecording());
        this.stopButton.addEventListener('click', () => this.stopRecording());
        this.retryButton.addEventListener('click', () => this.retryRecording());
        this.approveButton.addEventListener('click', () => this.approveRecording());
        this.rejectButton.addEventListener('click', () => this.rejectRecording());
        this.retryCameraButton.addEventListener('click', () => this.initializeCamera());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isRecording) {
                e.preventDefault();
                this.startRecording();
            } else if (e.code === 'Escape' && this.isRecording) {
                e.preventDefault();
                this.stopRecording();
            }
        });
    }
    
    async initializeCamera() {
        try {
            this.hideError();
            this.updateStatus('Initializing camera...');
            
            // Request camera and microphone permissions
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: this.options.videoConstraints,
                audio: this.options.audioConstraints
            });
            
            this.previewVideo.srcObject = this.stream;
            
            // Wait for video to load
            await new Promise((resolve) => {
                this.previewVideo.onloadedmetadata = resolve;
            });
            
            this.updateStatus('Camera ready');
            this.startButton.disabled = false;
            this.monitorVideoQuality();
            
            this.triggerCallback('cameraInitialized', { stream: this.stream });
            
        } catch (error) {
            console.error('Camera initialization failed:', error);
            this.showError('Camera access failed. Please ensure camera permissions are granted.');
            this.triggerCallback('cameraError', { error });
        }
    }
    
    async startRecording() {
        try {
            if (!this.stream) {
                await this.initializeCamera();
            }
            
            this.recordedChunks = [];
            
            // Initialize MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.stream, this.options.recordingOptions);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                this.showError('Recording failed. Please try again.');
                this.triggerCallback('recordingError', { error: event.error });
            };
            
            // Start recording
            this.mediaRecorder.start(1000); // Collect data every second
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            // Update UI
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.recordingIndicator.style.display = 'flex';
            this.updateStatus('Recording in progress...');
            
            // Start timer
            this.startRecordingTimer();
            
            // Auto-stop after max time
            setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            }, this.options.maxRecordingTime);
            
            this.triggerCallback('recordingStarted', {
                startTime: this.recordingStartTime
            });
            
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showError('Failed to start recording. Please try again.');
            this.triggerCallback('recordingError', { error });
        }
    }
    
    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            return;
        }
        
        const recordingDuration = Date.now() - this.recordingStartTime;
        
        if (recordingDuration < this.options.minRecordingTime) {
            this.showError(`Recording must be at least ${this.options.minRecordingTime / 1000} seconds long.`);
            return;
        }
        
        this.mediaRecorder.stop();
        this.isRecording = false;
        
        // Update UI
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.recordingIndicator.style.display = 'none';
        this.updateStatus('Processing recording...');
        
        // Stop timer
        this.stopRecordingTimer();
        
        this.triggerCallback('recordingStopped', {
            duration: recordingDuration
        });
    }
    
    processRecording() {
        try {
            // Create blob from recorded chunks
            const blob = new Blob(this.recordedChunks, {
                type: this.options.recordingOptions.mimeType
            });
            
            // Create URL for preview
            const videoURL = URL.createObjectURL(blob);
            this.recordedVideo.src = videoURL;
            
            // Show preview
            this.recordingPreview.style.display = 'block';
            this.updateStatus('Recording complete. Please review.');
            
            // Calculate recording metadata
            const metadata = {
                size: blob.size,
                duration: Date.now() - this.recordingStartTime,
                mimeType: blob.type,
                timestamp: new Date().toISOString(),
                quality: this.getCurrentQuality()
            };
            
            this.triggerCallback('recordingProcessed', {
                blob,
                videoURL,
                metadata
            });
            
        } catch (error) {
            console.error('Failed to process recording:', error);
            this.showError('Failed to process recording. Please try again.');
            this.triggerCallback('processingError', { error });
        }
    }
    
    approveRecording() {
        const blob = new Blob(this.recordedChunks, {
            type: this.options.recordingOptions.mimeType
        });
        
        const metadata = {
            size: blob.size,
            duration: Date.now() - this.recordingStartTime,
            mimeType: blob.type,
            timestamp: new Date().toISOString(),
            quality: this.getCurrentQuality(),
            approved: true
        };
        
        this.triggerCallback('recordingApproved', {
            blob,
            metadata
        });
        
        this.updateStatus('Recording approved and ready for processing.');
    }
    
    rejectRecording() {
        this.recordingPreview.style.display = 'none';
        this.updateStatus('Ready to record');
        
        // Clean up
        if (this.recordedVideo.src) {
            URL.revokeObjectURL(this.recordedVideo.src);
            this.recordedVideo.src = '';
        }
        
        this.recordedChunks = [];
        
        this.triggerCallback('recordingRejected');
    }
    
    retryRecording() {
        this.rejectRecording();
        this.startRecording();
    }
    
    startRecordingTimer() {
        this.recordingTimer = setInterval(() => {
            const elapsed = Date.now() - this.recordingStartTime;
            const remaining = this.options.maxRecordingTime - elapsed;
            
            this.recordingTime.textContent = this.formatTime(elapsed);
            this.currentTimeDisplay.textContent = this.formatTime(elapsed);
            
            // Update progress bar
            const progress = (elapsed / this.options.maxRecordingTime) * 100;
            this.progressFill.style.width = `${Math.min(progress, 100)}%`;
            
            // Warning when time is running out
            if (remaining < 10000) { // 10 seconds
                this.recordingIndicator.classList.add('warning');
            }
            
        }, 100);
    }
    
    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        this.recordingIndicator.classList.remove('warning');
    }
    
    monitorVideoQuality() {
        // Monitor video quality metrics
        setInterval(() => {
            if (this.stream) {
                const videoTrack = this.stream.getVideoTracks()[0];
                if (videoTrack) {
                    const settings = videoTrack.getSettings();
                    const quality = this.calculateQuality(settings);
                    this.qualityValue.textContent = quality;
                    this.qualityValue.className = `quality-value quality-${quality.toLowerCase()}`;
                }
            }
        }, 2000);
    }
    
    calculateQuality(settings) {
        const { width, height, frameRate } = settings;
        
        if (width >= 1280 && height >= 720 && frameRate >= 25) {
            return 'Excellent';
        } else if (width >= 960 && height >= 540 && frameRate >= 20) {
            return 'Good';
        } else if (width >= 640 && height >= 480 && frameRate >= 15) {
            return 'Fair';
        } else {
            return 'Poor';
        }
    }
    
    getCurrentQuality() {
        if (this.stream) {
            const videoTrack = this.stream.getVideoTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                return this.calculateQuality(settings);
            }
        }
        return 'Unknown';
    }
    
    formatTime(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    updateStatus(message) {
        this.statusText.textContent = message;
    }
    
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorContainer.style.display = 'block';
    }
    
    hideError() {
        this.errorContainer.style.display = 'none';
    }
    
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    
    triggerCallback(event, data = {}) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Callback error for event ${event}:`, error);
                }
            });
        }
    }
    
    destroy() {
        // Clean up resources
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }
        
        if (this.recordedVideo.src) {
            URL.revokeObjectURL(this.recordedVideo.src);
        }
        
        this.callbacks = {};
    }
    
    // Public API methods
    mount(element) {
        element.appendChild(this.container);
        this.initializeCamera();
    }
    
    unmount() {
        this.destroy();
        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
    
    getRecordingData() {
        if (this.recordedChunks.length > 0) {
            return new Blob(this.recordedChunks, {
                type: this.options.recordingOptions.mimeType
            });
        }
        return null;
    }
    
    isSupported() {
        return !!(navigator.mediaDevices && 
                 navigator.mediaDevices.getUserMedia && 
                 window.MediaRecorder);
    }
}

// CSS Styles for Video KYC Recorder
const videoKYCStyles = `
.video-kyc-recorder {
    max-width: 600px;
    margin: 0 auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.video-container {
    position: relative;
    background: #000;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 20px;
}

#preview-video, #recorded-video {
    width: 100%;
    height: auto;
    display: block;
}

.recording-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
}

.recording-indicator {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    align-items: center;
    background: rgba(255, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 500;
}

.recording-dot {
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    margin-right: 8px;
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.face-detection-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

.face-guide {
    text-align: center;
}

.face-outline {
    width: 200px;
    height: 250px;
    border: 3px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    margin: 0 auto 10px;
    position: relative;
}

.face-instructions {
    color: white;
    background: rgba(0, 0, 0, 0.7);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 14px;
}

.controls-container {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 20px;
}

.recording-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
}

.status-text {
    font-weight: 500;
    color: #333;
}

.quality-indicator {
    font-size: 14px;
}

.quality-value {
    font-weight: 500;
    margin-left: 5px;
}

.quality-excellent { color: #28a745; }
.quality-good { color: #17a2b8; }
.quality-fair { color: #ffc107; }
.quality-poor { color: #dc3545; }

.recording-controls {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 15px;
}

.btn {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s;
}

.btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.btn-primary {
    background: #007bff;
    color: white;
}

.btn-primary:hover:not(:disabled) {
    background: #0056b3;
}

.btn-danger {
    background: #dc3545;
    color: white;
}

.btn-danger:hover:not(:disabled) {
    background: #c82333;
}

.btn-secondary {
    background: #6c757d;
    color: white;
}

.btn-success {
    background: #28a745;
    color: white;
}

.btn-warning {
    background: #ffc107;
    color: #212529;
}

.recording-progress {
    margin-top: 15px;
}

.progress-bar {
    width: 100%;
    height: 6px;
    background: #e9ecef;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
}

.progress-fill {
    height: 100%;
    background: #007bff;
    transition: width 0.1s;
}

.time-display {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #6c757d;
}

.recording-preview {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 12px;
    text-align: center;
}

.preview-controls {
    margin-top: 15px;
    display: flex;
    gap: 10px;
    justify-content: center;
}

.error-container {
    background: #f8d7da;
    color: #721c24;
    padding: 15px;
    border-radius: 8px;
    text-align: center;
    margin-bottom: 20px;
}

.error-message {
    margin-bottom: 10px;
}

.recording-indicator.warning {
    background: rgba(255, 193, 7, 0.9);
    color: #212529;
}
`;

// Inject styles
if (!document.getElementById('video-kyc-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'video-kyc-styles';
    styleSheet.textContent = videoKYCStyles;
    document.head.appendChild(styleSheet);
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoKYCRecorder;
} else if (typeof window !== 'undefined') {
    window.VideoKYCRecorder = VideoKYCRecorder;
}

