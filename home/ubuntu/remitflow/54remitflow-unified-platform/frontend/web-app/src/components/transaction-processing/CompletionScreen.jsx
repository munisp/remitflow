import React from 'react';
import { Button, Typography, Paper } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const CompletionScreen = ({ onReset }) => {
  return (
    <Paper elevation={3} style={{ padding: '20px', textAlign: 'center' }}>
      <CheckCircleIcon style={{ fontSize: 60, color: 'green' }} />
      <Typography variant="h5">Transaction Complete</Typography>
      <Typography>Your transaction has been successfully processed.</Typography>
      <Button onClick={onReset} variant="contained" color="primary" style={{ marginTop: '20px' }}>
        New Transaction
      </Button>
    </Paper>
  );
};

export default CompletionScreen;

