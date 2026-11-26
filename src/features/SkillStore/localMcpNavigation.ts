import { createContext } from 'react';

export const AddLocalMcpContext = createContext<(() => void) | undefined>(undefined);
