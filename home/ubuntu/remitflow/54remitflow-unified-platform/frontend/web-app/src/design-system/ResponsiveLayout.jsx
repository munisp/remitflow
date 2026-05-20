import React from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const ResponsiveLayout = ({ mobileComponent, desktopComponent }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return isMobile ? mobileComponent : desktopComponent;
};

export default ResponsiveLayout;
