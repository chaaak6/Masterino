'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

import { AddLocalMcpContext } from './localMcpNavigation';
import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import DeviceLocalMcpPanel, {
  type DeviceLocalMcpPanelProps,
} from './SkillList/DeviceLocalMcpPanel';
import LobeHubList from './SkillList/LobeHub';
import MarketSkillList from './SkillList/MarketSkills';
import MCPList from './SkillList/MCP';

export enum SkillStoreTab {
  LobeHub = 'lobehub',
  MCP = 'mcp',
  Skills = 'skills',
}

export interface SkillStoreOptions {
  onUseLocal?: DeviceLocalMcpPanelProps['onUse'];
  openLocal?: boolean;
  setup?: Pick<
    DeviceLocalMcpPanelProps,
    'draft' | 'onClose' | 'onSaved' | 'onSavingChange' | 'setupServerUrl' | 'setupUserId'
  >;
}

export const SkillStoreContent = ({
  onLocalEditingChange,
  onLocalOpened,
  onUseLocal,
  openLocal,
  setup,
}: SkillStoreOptions & {
  onLocalEditingChange?: (editing: boolean) => void;
  onLocalOpened?: () => void;
}) => {
  const { t } = useTranslation('setting');
  const offlineMode = process.env.NEXT_PUBLIC_MASTERLION_OFFLINE_MODE === '1';
  const [selectedTab, setActiveTab] = useState<SkillStoreTab>(
    isDesktop && openLocal
      ? SkillStoreTab.MCP
      : offlineMode
        ? SkillStoreTab.Skills
        : SkillStoreTab.LobeHub,
  );
  const [selectedScope, setScope] = useState(isDesktop && openLocal ? 'local' : 'server');
  const [visitedLocal, setVisitedLocal] = useState(Boolean(isDesktop && openLocal));
  const [visitedMarket, setVisitedMarket] = useState(!isDesktop || !openLocal);
  const [addOpen, setAddOpen] = useState(Boolean(setup));
  const [lobehubKeywords, setLobehubKeywords] = useState('');
  const [skillKeywords, setSkillKeywords] = useState('');

  const options: SegmentedOptions = [
    ...(offlineMode ? [] : [{ label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub }]),
    { label: t('skillStore.tabs.skills'), value: SkillStoreTab.Skills },
    { label: t('skillStore.tabs.mcp'), value: SkillStoreTab.MCP },
  ];

  const activeTab = setup ? SkillStoreTab.MCP : selectedTab;
  const scope = setup ? 'local' : selectedScope;
  const isLobeHub = activeTab === SkillStoreTab.LobeHub;
  const isSkills = activeTab === SkillStoreTab.Skills;
  const isMCP = activeTab === SkillStoreTab.MCP;
  const isLocal = isDesktop && isMCP && scope === 'local';

  const openAddLocal = () => {
    onLocalEditingChange?.(true);
    onLocalOpened?.();
    setActiveTab(SkillStoreTab.MCP);
    setScope('local');
    setVisitedLocal(true);
    setAddOpen(true);
  };
  const closeAddLocal = useCallback(() => setAddOpen(false), []);

  return (
    <AddLocalMcpContext.Provider value={isDesktop ? openAddLocal : undefined}>
      <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Segmented
              block
              disabled={Boolean(setup)}
              options={options}
              style={{ flex: 1 }}
              value={activeTab}
              variant={'filled'}
              onChange={(v) => {
                setVisitedMarket(true);
                setActiveTab(v as SkillStoreTab);
                setScope('server');
              }}
            />
            {!isLocal && <AddSkillButton />}
          </Flexbox>
          {isDesktop && isMCP && (
            <Segmented
              aria-label={t('skillStore.tabs.mcp')}
              disabled={Boolean(setup)}
              size="small"
              style={{ alignSelf: 'start' }}
              value={scope}
              options={[
                { label: t('deviceLocalMcp.serverTab'), value: 'server' },
                { label: t('deviceLocalMcp.localTab'), value: 'local' },
              ]}
              onChange={(value) => {
                setScope(value === 'local' ? 'local' : 'server');
                if (value === 'local') {
                  onLocalOpened?.();
                  setVisitedLocal(true);
                } else {
                  setVisitedMarket(true);
                }
              }}
            />
          )}
          <div hidden={isLocal}>
            <Search
              activeTab={activeTab}
              onLobeHubSearch={setLobehubKeywords}
              onSkillSearch={setSkillKeywords}
            />
          </div>
        </Flexbox>
        <Flexbox height={496} style={{ marginBlockEnd: -12, marginInline: -16 }}>
          {visitedMarket && (
            <>
              {!offlineMode && (
                <Flexbox
                  flex={1}
                  style={{ display: isLobeHub ? 'flex' : 'none', overflow: 'auto' }}
                >
                  <LobeHubList keywords={lobehubKeywords} />
                </Flexbox>
              )}
              <Flexbox flex={1} style={{ display: isSkills ? 'flex' : 'none', overflow: 'auto' }}>
                <MarketSkillList keywords={skillKeywords} />
              </Flexbox>
              <Flexbox
                flex={1}
                style={{ display: isMCP && !isLocal ? 'flex' : 'none', overflow: 'auto' }}
              >
                <MCPList />
              </Flexbox>
            </>
          )}
          {(visitedLocal || setup) && (
            <Flexbox
              flex={1}
              style={{ display: isLocal ? 'flex' : 'none', minHeight: 0, overflow: 'auto' }}
            >
              <DeviceLocalMcpPanel
                addOpen={Boolean(setup) || addOpen}
                key={setup ? 'setup' : 'management'}
                onAdd={openAddLocal}
                onClose={closeAddLocal}
                onEditingChange={setup ? undefined : onLocalEditingChange}
                onUse={onUseLocal}
                visible={isLocal}
                {...setup}
              />
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    </AddLocalMcpContext.Provider>
  );
};
