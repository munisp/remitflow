import React, { useState } from 'react';
import { Button, CircularProgress, Alert } from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { useOlmocr } from './useOlmocr'; // Custom hook for OLMOCR integration

const DocumentUpload = ({ onNext, onBack }) => {
  const [files, setFiles] = useState([]);
  const { ocrStatus, processDocument } = useOlmocr();

  const onDrop = (acceptedFiles) => {
    setFiles(acceptedFiles);
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  const handleUpload = async () => {
    if (files.length > 0) {
      const ocrResult = await processDocument(files[0]);
      onNext({ documents: files, ocrResult });
    }
  };

  return (
    <div>
      <div {...getRootProps({ className: 'dropzone' })} style={{ border: '2px dashed gray', padding: '20px', textAlign: 'center' }}>
        <input {...getInputProps()} />
        <p>Drag 'n' drop some files here, or click to select files</p>
      </div>
      <ul>
        {files.map(file => <li key={file.path}>{file.path} - {file.size} bytes</li>)}
      </ul>
      <Button onClick={onBack}>Back</Button>
      <Button onClick={handleUpload} variant="contained" color="primary" disabled={ocrStatus === 'processing'}>
        {ocrStatus === 'processing' ? <CircularProgress size={24} /> : 'Upload and Process'}
      </Button>
      {ocrStatus === 'error' && <Alert severity="error">OCR processing failed.</Alert>}
    </div>
  );
};

export default DocumentUpload;

