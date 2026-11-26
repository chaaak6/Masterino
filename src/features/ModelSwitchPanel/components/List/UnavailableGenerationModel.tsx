import { Flexbox, Text } from '@lobehub/ui';
import { DropdownMenuItem } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';

const UnavailableGenerationModel = ({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string;
}) => (
  <DropdownMenuItem disabled style={{ marginBlock: 1, marginInline: 4, padding: 8 }}>
    <Flexbox gap={4}>
      {children}
      <Text fontSize={12} type="secondary">
        {reason}
      </Text>
    </Flexbox>
  </DropdownMenuItem>
);

export default UnavailableGenerationModel;
