export const trackEvent = (event: string, properties?: any) => {
  console.log('Analytics:', event, properties);
};
export const trackScreen = (screen: string) => {
  console.log('Screen:', screen);
};