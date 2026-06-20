import { BRANDING_NAME } from '@lobechat/business-const';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { useUserStore } from '@/store/user';

import UserAvatar from '../UserAvatar';

vi.mock('zustand/traditional');

describe('UserAvatar', () => {
  it('should show the username and avatar are displayed when the user is logged in', async () => {
    const mockAvatar = 'https://example.com/avatar.png';
    const mockUsername = 'teeeeeestuser';

    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { avatar: mockAvatar, id: 'abc', username: mockUsername },
      });
    });

    render(<UserAvatar />);

    expect(screen.getByAltText(mockUsername)).toBeInTheDocument();
    expect(screen.getByAltText(mockUsername)).toHaveAttribute('src', mockAvatar);
  });

  it('should show default avatar when the user is logged in but have no custom avatar', () => {
    const mockUsername = 'testuser';

    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { id: 'bbb', username: mockUsername },
      });
    });

    render(<UserAvatar />);
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('uses the pinyin initial for a Chinese display name when no avatar is set', () => {
    act(() => {
      useUserStore.setState({
        isSignedIn: true,
        user: { fullName: '陈灿', id: 'ccc', username: 'chen-can' },
      });
    });

    render(<UserAvatar />);

    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('should show LobeChat and default avatar when the user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false, user: undefined });
    });

    render(<UserAvatar />);
    expect(screen.getByAltText(BRANDING_NAME)).toBeInTheDocument();
    expect(screen.getByAltText(BRANDING_NAME)).toHaveAttribute('src', DEFAULT_USER_AVATAR_URL);
  });
});
