import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { createStore, Provider } from '@/features/ChatInput/store';

import InputCompletionErrorAlert from './InputCompletionErrorAlert';

const setup = () => {
  const store = createStore({
    inputCompletionError: { message: 'Upstream rejected input completion' },
  });
  render(
    <Provider createStore={() => store}>
      <MemoryRouter>
        <Routes>
          <Route element={<InputCompletionErrorAlert />} path="/" />
          <Route element={<div>Service model settings</div>} path="/settings/service-model" />
          <Route element={<div>Page not found</div>} path="*" />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
};

describe('Input completion paused alert', () => {
  it('opens the service model settings when the user clicks settings', () => {
    setup();
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByText('Service model settings')).toBeInTheDocument();
  });

  it('clears the paused error when the user retries', () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'input.inputCompletionError.retry' }));
    expect(store.getState().inputCompletionError).toBeUndefined();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
