import { useState } from 'react';

export const useOlmocr = () => {
  const [ocrStatus, setOcrStatus] = useState('idle');

  const processDocument = async (file) => {
    setOcrStatus('processing');
    // Simulate API call to OLMOCR
    console.log('Processing document with OLMOCR:', file.name);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const isSuccess = Math.random() > 0.1;
    if (isSuccess) {
      setOcrStatus('success');
      return { text: 'Extracted text from document.' };
    } else {
      setOcrStatus('error');
      return null;
    }
  };

  return { ocrStatus, processDocument };
};
