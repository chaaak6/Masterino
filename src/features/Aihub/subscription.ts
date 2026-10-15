import type { NewApiSubscription } from '@lobechat/types';

export const AIHUB_ACCOUNT_URL = 'https://aihub.bielcrystal.com/wallet';

export const isActiveSubscription = (subscription: NewApiSubscription, now = Date.now() / 1000) =>
  subscription.status === 'active' &&
  subscription.startTime <= now &&
  (subscription.endTime === 0 || subscription.endTime > now);

export const hasNextReset = (subscription: NewApiSubscription) =>
  subscription.nextResetTime > 0 &&
  (subscription.endTime === 0 || subscription.nextResetTime < subscription.endTime);

export const formatSubscriptionDate = (timestamp: number, language: string) =>
  new Date(timestamp * 1000).toLocaleString(language, {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
