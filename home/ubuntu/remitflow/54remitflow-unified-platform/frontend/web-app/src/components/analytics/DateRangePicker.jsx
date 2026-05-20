import React, { useState } from 'react';
import { TextField, Button } from '@mui/material';

const DateRangePicker = ({ onDateChange }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleApply = () => {
    onDateChange(startDate, endDate);
  };

  return (
    <div>
      <TextField
        label="Start Date"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="End Date"
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
      />
      <Button onClick={handleApply} variant="contained">Apply</Button>
    </div>
  );
};

export default DateRangePicker;
