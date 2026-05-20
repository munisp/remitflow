import React, { useState, useEffect } from 'react';
import { TextField, Button, Paper, List, ListItem, ListItemText } from '@mui/material';
import { useWebSocket } from './useWebSocket'; // Custom hook for WebSocket

const Chat = ({ channel }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const { lastMessage, sendMessage } = useWebSocket(`wss://your-websocket-url/${channel}`);

  useEffect(() => {
    if (lastMessage) {
      setMessages([...messages, lastMessage]);
    }
  }, [lastMessage]);

  const handleSendMessage = () => {
    sendMessage({ text: newMessage });
    setNewMessage('');
  };

  return (
    <Paper style={{ padding: '20px' }}>
      <List>
        {messages.map((msg, index) => (
          <ListItem key={index}>
            <ListItemText primary={msg.text} />
          </ListItem>
        ))}
      </List>
      <TextField value={newMessage} onChange={(e) => setNewMessage(e.target.value)} fullWidth />
      <Button onClick={handleSendMessage} variant="contained" color="primary">Send</Button>
    </Paper>
  );
};

export default Chat;

