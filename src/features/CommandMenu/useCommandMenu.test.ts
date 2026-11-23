import { expect, it } from 'vitest';

import { getSearchAvailability } from './useCommandMenu';

it('limits the loading indicator to an active device lookup or debounce', () => {
  const current = {
    debouncePending: false,
    deviceMissing: true,
    isDeviceLoading: true,
    requested: true,
  };

  expect(getSearchAvailability(current)).toBe('loading');
  expect(getSearchAvailability({ ...current, isDeviceLoading: false })).toBe('deviceUnavailable');
  expect(getSearchAvailability({ ...current, requested: false })).toBe('idle');
  expect(getSearchAvailability({ ...current, deviceMissing: false, debouncePending: true })).toBe(
    'loading',
  );
  expect(getSearchAvailability({ ...current, deviceMissing: false })).toBe('ready');
});
