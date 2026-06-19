'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import LobeHubList from './SkillList/LobeHub';
import MarketSkillList from './SkillList/MarketSkills';
import MCPList from './SkillList/MCP';

export enum SkillStoreTab {
  LobeHub = 'lobehub',
  MCP = 'mcp',
  Skills = 'skills',
}

export const SkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const offlineMode = process.env.NEXT_PUBLIC_MASTERLION_OFFLINE_MODE === '1';
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(
    offlineMode ? SkillStoreTab.Skills : SkillStoreTab.LobeHub,
  );
  const [lobehubKeywords, setLobehubKeywords] = useState('');
  const [skillKeywords, setSkillKeywords] = useState('');

  const options: SegmentedOptions = [
    ...(offlineMode
      ? []
      : [{ label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.LobeHub }]),
    { label: t('skillStore.tabs.skills'), value: SkillStoreTab.Skills },
    { label: t('skillStore.tabs.mcp'), value: SkillStoreTab.MCP },
  ];

  const isLobeHub = activeTab === SkillStoreTab.LobeHub;
  const isSkills = activeTab === SkillStoreTab.Skills;
  const isMCP = activeTab === SkillStoreTab.MCP;

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Segmented
            block
            options={options}
            style={{ flex: 1 }}
            value={activeTab}
            variant={'filled'}
            onChange={(v) => setActiveTab(v as SkillStoreTab)}
          />
          <AddSkillButton />
        </Flexbox>
        <Search
          activeTab={activeTab}
          onLobeHubSearch={setLobehubKeywords}
          onSkillSearch={setSkillKeywords}
        />
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
        <Flexbox flex={1} style={{ display: isMCP ? 'flex' : 'none', overflow: 'auto' }}>
          <MCPList />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
