import React from 'react';
import { Button, Typography, Paper, CircularProgress } from '@mui/material';

const OnboardingConfirmation = ({ data, onConfirm, onBack, kybStatus }) => {
  return (
    <Paper elevation={3} style={{ padding: '20px' }}>
      <Typography variant="h5">Confirm Onboarding</Typography>
      <Typography>First Name: {data.firstName}</Typography>
      <Typography>Last Name: {data.lastName}</Typography>
      <Typography>Email: {data.email}</Typography>
      <Typography>Phone: {data.phone}</Typography>
      {kybStatus === 'processing' && <CircularProgress />}
      {kybStatus === 'success' && <Typography color="green">KYB Verification Successful</Typography>}
      {kybStatus === 'error' && <Typography color="red">KYB Verification Failed</Typography>}
      <Button onClick={onBack}>Back</Button>
      <Button onClick={onConfirm} variant="contained" color="primary" disabled={kybStatus === 'processing'}>
        Confirm and Initiate KYB
      </Button>
    </Paper>
  );
};

export default OnboardingConfirmation;

