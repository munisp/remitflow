import React from 'react';
import { Button, Typography, Paper } from '@mui/material';

const ConfirmationScreen = ({ data, onConfirm, onBack }) => {
  return (
    <Paper elevation={3} style={{ padding: '20px' }}>
      <Typography variant="h5">Confirm Transaction</Typography>
      <Typography>Amount: {data.amount} {data.currency}</Typography>
      <Typography>Recipient: {data.recipient}</Typography>
      <Typography>Description: {data.description}</Typography>
      <Button onClick={onBack} variant="outlined" style={{ marginRight: '10px' }}>
        Back
      </Button>
      <Button onClick={onConfirm} variant="contained" color="primary">
        Confirm
      </Button>
    </Paper>
  );
};

export default ConfirmationScreen;

