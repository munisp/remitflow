import React, { useState } from 'react';
import { Grid, Paper, Typography } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import DateRangePicker from './DateRangePicker';

const AnalyticsDashboard = () => {
  const [data, setData] = useState([]);

  const handleDateChange = (startDate, endDate) => {
    // Simulate fetching data for the selected date range
    const mockData = [
      { date: '2023-10-01', transactions: 100, volume: 50000 },
      { date: '2023-10-15', transactions: 150, volume: 75000 },
      { date: '2023-10-30', transactions: 120, volume: 60000 },
    ];
    setData(mockData);
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <DateRangePicker onDateChange={handleDateChange} />
      </Grid>
      <Grid item xs={12} md={6}>
        <Paper style={{ padding: '20px' }}>
          <Typography variant="h6">Transaction Volume</Typography>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="volume" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      </Grid>
      <Grid item xs={12} md={6}>
        <Paper style={{ padding: '20px' }}>
          <Typography variant="h6">Number of Transactions</Typography>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="transactions" stroke="#82ca9d" />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      </Grid>
    </Grid>
  );
};

export default AnalyticsDashboard;

