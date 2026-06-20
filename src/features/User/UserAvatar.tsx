'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { type AvatarProps } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useMemo } from 'react';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  clickable: css`
    position: relative;
    transition: all 200ms ease-out 0s;

    &::before {
      content: '';

      position: absolute;
      transform: skewX(-45deg) translateX(-400%);

      overflow: hidden;

      box-sizing: border-box;
      width: 25%;
      height: 100%;

      background: rgb(255 255 255 / 50%);

      transition: all 200ms ease-out 0s;
    }

    &:hover {
      box-shadow: 0 0 0 2px ${cssVar.colorPrimary};

      &::before {
        transform: skewX(-45deg) translateX(400%);
      }
    }
  `,
}));

const CHINESE_INITIAL_OVERRIDES: Record<string, string> = {
  陈: 'C',
};

const getAvatarInitial = (name?: string | null) => {
  const firstChar = name?.trim().charAt(0);
  if (!firstChar) return undefined;

  const mapped = CHINESE_INITIAL_OVERRIDES[firstChar];
  if (mapped) return mapped;

  const asciiInitial = firstChar.match(/[a-z]/i)?.[0];
  return (asciiInitial || firstChar).toUpperCase();
};

export interface UserAvatarProps extends AvatarProps {
  /**
   * Override the avatar URL/emoji — used when the component is acting as a
   * generic "active identity" avatar (e.g. showing the active team workspace
   * in the header). Falls back to the signed-in user's avatar when omitted.
   */
  avatarOverride?: string;
  clickable?: boolean;
  /** Override the alt text / fallback initial. */
  nameOverride?: string;
}

const UserAvatar = ({
  ref,
  size = 40,
  background,
  clickable,
  className,
  style,
  avatarOverride,
  nameOverride,
  ...rest
}: UserAvatarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const [avatar, nickName, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);

  const isSignedIn = useUserStore(authSelectors.isLogin);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);

  // Process avatar URL for desktop environment
  const userAvatarUrl = useMemo(() => {
    if (!isSignedIn) return DEFAULT_USER_AVATAR_URL;
    if (!avatar) return;

    // If in desktop environment and avatar starts with /, prepend the remote server URL
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) {
      return remoteServerUrl + avatar;
    }

    return avatar;
  }, [isSignedIn, avatar, remoteServerUrl]);

  // When a `nameOverride` is provided, the component is in "non-user identity"
  // mode (e.g. active team workspace). Stay inside that identity — don't fall
  // through to the signed-in user's avatar/name, or the icon and the label
  // will disagree. When `nameOverride` is absent, keep the original user flow.
  const displayName = nameOverride || nickName || username;
  const avatarValue = nameOverride
    ? avatarOverride || getAvatarInitial(nameOverride)
    : avatarOverride || userAvatarUrl || getAvatarInitial(displayName);
  const altText = nameOverride || (isSignedIn ? nickName || username || 'User' : BRANDING_NAME);

  return (
    <Avatar
      alt={altText}
      avatar={avatarValue}
      background={background}
      className={clickable ? styles.clickable : className}
      ref={ref}
      shape={'square'}
      size={size}
      style={{ color: cssVar.colorText, flex: 'none', ...style }}
      {...rest}
    />
  );
};

export default UserAvatar;
