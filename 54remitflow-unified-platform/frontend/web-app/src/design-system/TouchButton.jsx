import React from 'react';
import { Button } from '@mui/material';

const TouchButton = (props) => {
  return (
    <Button
      {...props}
      style={{
        ...props.style,
        minHeight: '48px', // Minimum touch target size
        minWidth: '48px',
      }}
    />
  );
};

export default TouchButton;
