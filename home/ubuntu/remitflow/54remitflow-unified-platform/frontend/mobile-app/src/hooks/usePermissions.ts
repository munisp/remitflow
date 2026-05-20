import { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export const usePermissions = (permission: string) => {
  const [granted, setGranted] = useState(false);
  
  useEffect(() => {
    checkPermission();
  }, []);
  
  const checkPermission = async () => {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.check(permission);
      setGranted(result);
    } else {
      setGranted(true);
    }
  };
  
  const requestPermission = async () => {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(permission);
      const isGranted = result === PermissionsAndroid.RESULTS.GRANTED;
      setGranted(isGranted);
      return isGranted;
    }
    return true;
  };
  
  return { granted, requestPermission };
};