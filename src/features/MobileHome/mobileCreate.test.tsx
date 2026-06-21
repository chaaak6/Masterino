/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { disableMobileCreateItem } from './mobileCreate';

describe('disableMobileCreateItem', () => {
  it('keeps the menu item visible, disabled, and labeled as coming soon', () => {
    const originalClick = vi.fn();
    const item = disableMobileCreateItem(
      {
        key: 'newAgent',
        label: '创建助手',
        onClick: originalClick,
      } as any,
      '敬请期待',
    ) as any;

    render(<>{item.label}</>);

    item.onClick({ domEvent: { stopPropagation: vi.fn() } });

    expect(item.key).toBe('newAgent');
    expect(item.disabled).toBe(true);
    expect(screen.getByText('创建助手')).toBeInTheDocument();
    expect(screen.getByText('敬请期待')).toBeInTheDocument();
    expect(originalClick).not.toHaveBeenCalled();
  });
});
