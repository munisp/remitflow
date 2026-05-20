import React, { useState } from 'react';
import { TextField, Button } from '@mui/material';

const PersonalInformationForm = ({ onNext }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onNext(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <TextField name="firstName" label="First Name" value={formData.firstName} onChange={handleChange} fullWidth required />
      <TextField name="lastName" label="Last Name" value={formData.lastName} onChange={handleChange} fullWidth required />
      <TextField name="email" label="Email" type="email" value={formData.email} onChange={handleChange} fullWidth required />
      <TextField name="phone" label="Phone Number" value={formData.phone} onChange={handleChange} fullWidth required />
      <Button type="submit" variant="contained" color="primary">Next</Button>
    </form>
  );
};

export default PersonalInformationForm;

