import React, { useState } from 'react';
import { Stepper, Step, StepLabel, Button } from '@mui/material';
import PersonalInformationForm from './PersonalInformationForm';
import DocumentUpload from './DocumentUpload';
import OnboardingConfirmation from './OnboardingConfirmation';
import { useKYBVerification } from './useKYBVerification';

const steps = ['Personal Information', 'Document Upload', 'Confirmation'];

const CustomerOnboarding = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [customerData, setCustomerData] = useState({});
  const { kybStatus, initiateKyb } = useKYBVerification();

  const handleNext = (data) => {
    setCustomerData({ ...customerData, ...data });
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleConfirm = () => {
    initiateKyb(customerData);
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return <PersonalInformationForm onNext={handleNext} />;
      case 1:
        return <DocumentUpload onNext={handleNext} onBack={handleBack} />;
      case 2:
        return <OnboardingConfirmation data={customerData} onConfirm={handleConfirm} onBack={handleBack} kybStatus={kybStatus} />;
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

export default CustomerOnboarding;

