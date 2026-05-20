import { Linking } from 'react-native';
export const handleDeepLink = (url: string, navigation: any) => {
  const route = url.replace(/.*?:\/\//g, '');
  const [screen, ...params] = route.split('/');
  navigation.navigate(screen, { params });
};
export const initDeepLinking = (navigation: any) => {
  Linking.addEventListener('url', ({ url }) => handleDeepLink(url, navigation));
};