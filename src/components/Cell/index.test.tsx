import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Cell from './index';

describe('Cell', () => {
  it('renders disabled cells with right-side text and blocks clicks', () => {
    const onClick = vi.fn();

    render(<Cell disabled extra="敬请期待" label="获取APP" onClick={onClick} />);

    const cell = screen.getByRole('button', { name: /获取APP/ });

    expect(cell).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('敬请期待')).toBeInTheDocument();

    fireEvent.click(cell);

    expect(onClick).not.toHaveBeenCalled();
  });
});
