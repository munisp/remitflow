import { useState, useEffect } from 'react';
import Geolocation from '@react-native-community/geolocation';
export const useLocation = () => {
  const [location, setLocation] = useState<any>(null);
  useEffect(() => {
    Geolocation.getCurrentPosition(pos => setLocation(pos.coords));
  }, []);
  return location;
};