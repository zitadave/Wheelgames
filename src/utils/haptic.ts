/**
 * Safely triggers Telegram WebApp Haptic Feedback
 */
export function triggerHaptic(type: 'impact' | 'notification' | 'selection', param?: string) {
  try {
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (!tg) return;

    if (type === 'impact') {
      const style = param || 'medium';
      tg.impactOccurred(style);
    } else if (type === 'notification') {
      const state = param || 'success';
      tg.notificationOccurred(state);
    } else if (type === 'selection') {
      tg.selectionChanged();
    }
  } catch (error) {
    console.warn('Haptic feedback failed:', error);
  }
}
