'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

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
    'draft' | 'onClose' | 'onSaved' | 'onSavingChange' | 'setupUserId'
  >;
}

export const SkillStoreContent = ({ openLocal, onUseLocal, setup }: SkillStoreOptions) => {
  const { t } = useTranslation('setting');
  const offlineMode = process.env.NEXT_PUBLIC_MASTERLION_OFFLINE_MODE === '1';
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(
    isDesktop && openLocal
      ? SkillStoreTab.MCP
      : offlineMode
        ? SkillStoreTab.Skills
        : SkillStoreTab.LobeHub,
  );
  const [scope, setScope] = useState(isDesktop && openLocal ? 'local' : 'server');
  const [visitedLocal, setVisitedLocal] = useState(Boolean(isDesktop && openLocal));
  const [addOpen, setAddOpen] = useState(Boolean(setup));
  const [lobehubKeywords, setLobehubKeywords] = useState('');
  const [skillKeywords, setSkillKeywords] = useState('');

  const options: SegmentedOptions = [
    ...(offlineMode ? [] : [{ label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub }]),
    { label: t('skillStore.tabs.skills'), value: SkillStoreTab.Skills },
    { label: t('skillStore.tabs.mcp'), value: SkillStoreTab.MCP },
  ];

  const isLobeHub = activeTab === SkillStoreTab.LobeHub;
  const isSkills = activeTab === SkillStoreTab.Skills;
  const isMCP = activeTab === SkillStoreTab.MCP;
  const isLocal = isDesktop && isMCP && scope === 'local';

  const openAddLocal = () => {
    setActiveTab(SkillStoreTab.MCP);
    setScope('local');
    setVisitedLocal(true);
    setAddOpen(true);
  };

  return (
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
              setActiveTab(v as SkillStoreTab);
              setScope('server');
            }}
          />
          {!isLocal && <AddSkillButton onAddLocal={isDesktop ? openAddLocal : undefined} />}
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
              if (value === 'local') setVisitedLocal(true);
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
        {!offlineMode && (
          <Flexbox flex={1} style={{ display: isLobeHub ? 'flex' : 'none', overflow: 'auto' }}>
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
        {visitedLocal && (
          <Flexbox
            flex={1}
            style={{ display: isLocal ? 'flex' : 'none', minHeight: 0, overflow: 'auto' }}
          >
            <DeviceLocalMcpPanel
              addOpen={addOpen}
              onAdd={openAddLocal}
              onClose={() => setAddOpen(false)}
              onUse={onUseLocal}
              {...setup}
            />
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
};
