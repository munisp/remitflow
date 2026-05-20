import React from 'react';
import { CircularProgress, Typography, Alert } from '@mui/material';

const ProcessingScreen = ({ status, error }) => {
  return (
    <div style={{ textAlign: 'center' }}>
      {status === 'processing' && <CircularProgress />}
      <Typography variant="h6">
        {status === 'processing' && 'Processing transaction...'}
        {status === 'error' && 'Transaction Failed'}
      </Typography>
      {status === 'error' && <Alert severity="error">{error}</Alert>}
    </div>
  );
};

export default ProcessingScreen;

