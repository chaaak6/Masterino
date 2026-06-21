/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MobileCreateButton from './MobileCreateButton';

const dropdownItemsMock = vi.hoisted(() => vi.fn());
const createAgentClickMock = vi.hoisted(() => vi.fn());
const createGroupClickMock = vi.hoisted(() => vi.fn());
const createPlatformAgentMenuItemMock = vi.hoisted(() => vi.fn<() => any>(() => null));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <button type="button">create</button>,
  DropdownMenu: ({ children, items }: { children: React.ReactNode; items: any[] }) => {
    dropdownItemsMock(items);
    return (
      <div>
        {children}
        {items.map((item) => (
          <div data-disabled={String(item.disabled)} key={item.key}>
            {item.label}
          </div>
        ))}
      </div>
    );
  },
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/icons', () => ({
  CreateBotIcon: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'mobileCreate.comingSoon' ? '敬请期待' : key),
  }),
}));

vi.mock('@/routes/(main)/home/_layout/hooks', () => ({
  useCreateMenuItems: () => ({
    createAgentMenuItem: () => ({
      key: 'newAgent',
      label: '创建助手',
      onClick: createAgentClickMock,
    }),
    createGroupChatMenuItem: () => ({
      key: 'newGroupChat',
      label: '创建群组',
      onClick: createGroupClickMock,
    }),
    createPlatformAgentMenuItem: createPlatformAgentMenuItemMock,
    isLoading: false,
  }),
}));

describe('MobileCreateButton', () => {
  beforeEach(() => {
    createPlatformAgentMenuItemMock.mockReturnValue(null);
    dropdownItemsMock.mockClear();
  });

  it('renders create assistant and group entries as disabled coming-soon actions', () => {
    render(<MobileCreateButton />);

    const items = dropdownItemsMock.mock.calls.at(-1)?.[0] as any[];

    expect(items.map((item) => item.key)).toEqual(['newAgent', 'newGroupChat']);
    expect(items.every((item) => item.disabled)).toBe(true);
    expect(screen.getByText('创建助手')).toBeInTheDocument();
    expect(screen.getByText('创建群组')).toBeInTheDocument();
    expect(screen.getAllByText('敬请期待')).toHaveLength(2);
  });

  it('keeps platform agent menu item unchanged when it is available', () => {
    createPlatformAgentMenuItemMock.mockReturnValue({
      key: 'newPlatformAgent',
      label: '创建设备助手',
    });

    render(<MobileCreateButton />);

    const items = dropdownItemsMock.mock.calls.at(-1)?.[0] as any[];

    expect(items.map((item) => item.key ?? item.type)).toEqual([
      'newAgent',
      'newGroupChat',
      'divider',
      'newPlatformAgent',
    ]);
    expect(items[0].disabled).toBe(true);
    expect(items[1].disabled).toBe(true);
    expect(items[3].disabled).toBeUndefined();
    expect(screen.getByText('创建设备助手')).toBeInTheDocument();
  });
});
