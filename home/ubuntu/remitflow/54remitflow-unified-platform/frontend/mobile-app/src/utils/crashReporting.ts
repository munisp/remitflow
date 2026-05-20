export const logError = (error: Error, context?: any) => {
  console.error('Error:', error, context);
};
export const logBreadcrumb = (message: string, data?: any) => {
  console.log('Breadcrumb:', message, data);
};