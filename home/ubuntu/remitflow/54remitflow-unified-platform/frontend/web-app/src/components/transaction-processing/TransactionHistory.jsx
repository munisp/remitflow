import React, { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, TextField, Button } from '@mui/material';

const TransactionHistory = () => {
  const [transactions, setTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    // Simulate fetching transaction data
    const mockTransactions = [
      { id: 1, date: '2023-10-27', description: 'Payment for services', amount: -500, currency: 'USD' },
      { id: 2, date: '2023-10-26', description: 'Salary deposit', amount: 3000, currency: 'USD' },
      { id: 3, date: '2023-10-25', description: 'Online purchase', amount: -150, currency: 'USD' },
    ];
    setTransactions(mockTransactions);
    setFilteredTransactions(mockTransactions);
  }, []);

  const handleFilterChange = (e) => {
    setFilter(e.target.value);
  };

  const handleFilter = () => {
    const filtered = transactions.filter(t => 
      t.description.toLowerCase().includes(filter.toLowerCase())
    );
    setFilteredTransactions(filtered);
  };

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8,"
      + ["ID", "Date", "Description", "Amount", "Currency"].join(",") + "\n"
      + filteredTransactions.map(t => `${t.id},${t.date},"${t.description}",${t.amount},${t.currency}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "transactions.csv");
    document.body.appendChild(link);
    link.click();
  };

  return (
    <div>
      <TextField label="Filter by description" value={filter} onChange={handleFilterChange} />
      <Button onClick={handleFilter}>Filter</Button>
      <Button onClick={handleExport}>Export as CSV</Button>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredTransactions.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.date}</TableCell>
                <TableCell>{row.description}</TableCell>
                <TableCell align="right">{row.amount} {row.currency}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
};

export default TransactionHistory;

