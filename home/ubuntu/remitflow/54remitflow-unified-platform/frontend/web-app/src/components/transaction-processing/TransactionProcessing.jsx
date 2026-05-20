import React, { useState, useEffect } from 'react';
import { Stepper, Step, StepLabel, Button, CircularProgress, Alert } from '@mui/material';
import TransactionDetailsForm from './TransactionDetailsForm';
import ConfirmationScreen from './ConfirmationScreen';
import ProcessingScreen from './ProcessingScreen';
import CompletionScreen from './CompletionScreen';

const steps = ['Transaction Details', 'Confirmation', 'Processing', 'Completion'];

const TransactionProcessing = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [transactionData, setTransactionData] = useState(null);
  const [processingStatus, setProcessingStatus] = useState('idle');
  const [error, setError] = useState(null);

  const handleNext = (data) => {
    setTransactionData(data);
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleConfirm = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
    setProcessingStatus('processing');

    // Simulate API call
    setTimeout(() => {
      const isSuccess = Math.random() > 0.2; // 80% success rate
      if (isSuccess) {
        setProcessingStatus('success');
        setActiveStep((prevActiveStep) => prevActiveStep + 1);
      } else {
        setProcessingStatus('error');
        setError('Transaction failed. Please try again.');
      }
    }, 3000);
  };

  const handleReset = () => {
    setActiveStep(0);
    setTransactionData(null);
    setProcessingStatus('idle');
    setError(null);
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return <TransactionDetailsForm onNext={handleNext} />;
      case 1:
        return <ConfirmationScreen data={transactionData} onConfirm={handleConfirm} onBack={handleBack} />;
      case 2:
        return <ProcessingScreen status={processingStatus} error={error} />;
      case 3:
        return <CompletionScreen onReset={handleReset} />;
      default:
        return 'Unknown step';
    }
  };

  return (
    <div>
      <Stepper activeStep={activeStep}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <div>
        {getStepContent(activeStep)}
      </div>
    </div>
  );
};

export default TransactionProcessing;

