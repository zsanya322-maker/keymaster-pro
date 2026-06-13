export const triggerToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('keymaster-toast', { detail: { message, type } }));
  }
};
