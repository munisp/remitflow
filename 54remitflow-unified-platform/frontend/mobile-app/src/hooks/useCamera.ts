import { useState } from 'react';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
export const useCamera = () => {
  const [image, setImage] = useState<any>(null);
  const takePhoto = () => launchCamera({ mediaType: 'photo' }, (res) => res.assets && setImage(res.assets[0]));
  const pickImage = () => launchImageLibrary({ mediaType: 'photo' }, (res) => res.assets && setImage(res.assets[0]));
  return { image, takePhoto, pickImage };
};