import type { PathAccessMode } from '@lobechat/types/src/executionContext';
import { Alert, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  type PathConsentDecision,
  projectWorkspaceSelectors,
  useProjectWorkspaceStore,
} from '@/store/projectWorkspace';

import { PathConsentResolutionError } from './pathConsentDecision';

export const WORKSPACE_PATH_CONSENT_METADATA_KEY = 'workspacePathConsent' as const;

export interface StructuredPathConsentRequest {
  actualCwd: string;
  deviceId: string;
  modes: PathAccessMode[];
  operationId: string;
  primaryCwd: string;
  requestedPath: string;
  topicId: string;
  version: 1;
  warnings?: Array<{ code: 'MODEL_CWD_OVERRIDDEN'; overridden: true }>;
}

export type PathConsentSelection = Omit<PathConsentDecision, 'at'>;
export type PathConsentDecisionCallback = (
  decision: PathConsentSelection,
) => Promise<PathConsentSelection | void> | PathConsentSelection | void;

const PATH_ACCESS_MODES = new Set<PathAccessMode>(['exec', 'read', 'write']);

/**
 * Accept only runtime-authored, versioned metadata. In particular, this never
 * derives an authorization path from tool arguments, prompts, quotes, code
 * blocks, or attachments.
 */
export const parseStructuredPathConsentRequest = (
  value: unknown,
): StructuredPathConsentRequest | undefined => {
  if (!value || typeof value !== 'object') return;
  const request = value as Partial<StructuredPathConsentRequest>;
  if (
    request.version !== 1 ||
    typeof request.actualCwd !== 'string' ||
    typeof request.deviceId !== 'string' ||
    !request.deviceId ||
    typeof request.operationId !== 'string' ||
    !request.operationId ||
    typeof request.primaryCwd !== 'string' ||
    typeof request.requestedPath !== 'string' ||
    !request.requestedPath ||
    typeof request.topicId !== 'string' ||
    !request.topicId ||
    !Array.isArray(request.modes) ||
    request.modes.length === 0 ||
    !request.modes.every((mode) => PATH_ACCESS_MODES.has(mode))
  ) {
    return;
  }

  const warnings = Array.isArray(request.warnings)
    ? request.warnings.filter(
        (warning): warning is { code: 'MODEL_CWD_OVERRIDDEN'; overridden: true } =>
          !!warning && warning.code === 'MODEL_CWD_OVERRIDDEN' && warning.overridden === true,
      )
    : undefined;

  return {
    actualCwd: request.actualCwd,
    deviceId: request.deviceId,
    modes: [...new Set(request.modes)],
    operationId: request.operationId,
    primaryCwd: request.primaryCwd,
    requestedPath: request.requestedPath,
    topicId: request.topicId,
    version: 1,
    warnings,
  };
};

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
    width: 100%;
  `,
  details: css`
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 12px;

    margin: 0;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    overflow-wrap: anywhere;
    min-width: 0;
    margin: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
  `,
}));

interface PathConsentProps {
  actionsPortalTarget?: HTMLDivElement | null;
  messageId: string;
  onDecision?: PathConsentDecisionCallback;
  request: StructuredPathConsentRequest;
}

/**
 * The callback owns the trusted realpath/grant/resume transaction. A callback
 * may return a canonicalized decision; only that canonical result is recorded.
 * Standalone/test consumers without a callback still record the local choice.
 */
const PathConsent = memo<PathConsentProps>(
  ({ actionsPortalTarget, messageId, onDecision, request }) => {
    const { t } = useTranslation('tool');
    const tw = t as unknown as (key: string) => string;
    const setOperationPathConsent = useProjectWorkspaceStore((s) => s.setOperationPathConsent);
    const recorded = useProjectWorkspaceStore(
      projectWorkspaceSelectors.getOperationPathConsent(messageId),
    );
    const [loadingScope, setLoadingScope] = useState<PathConsentDecision['scope']>();
    const [callbackErrorKey, setCallbackErrorKey] = useState<string>();
    const [coordinationComplete, setCoordinationComplete] = useState(false);

    const decide = useCallback(
      async (scope: PathConsentDecision['scope']) => {
        if (loadingScope) return;
        const decision: PathConsentSelection = {
          actualCwd: request.actualCwd,
          deviceId: request.deviceId,
          modes: request.modes,
          operationId: request.operationId,
          primaryCwd: request.primaryCwd,
          requestedPath: request.requestedPath,
          rootPath: request.requestedPath,
          scope,
          topicId: request.topicId,
        };
        setCallbackErrorKey(undefined);
        setCoordinationComplete(false);
        setLoadingScope(scope);
        try {
          const finalized = await onDecision?.(decision);
          setOperationPathConsent(messageId, finalized ?? decision);
          setCoordinationComplete(!!finalized);
        } catch (error) {
          const key =
            error instanceof PathConsentResolutionError
              ? {
                  PATH_ACCESS_DENIED: 'workspacePathConsent.pathAccessDenied',
                  PATH_NOT_ABSOLUTE: 'workspacePathConsent.pathNotAbsolute',
                  PATH_NOT_FOUND: 'workspacePathConsent.pathNotFound',
                  PATH_UNRESOLVABLE: 'workspacePathConsent.pathUnresolvable',
                }[error.code]
              : 'workspacePathConsent.callbackFailed';
          setCallbackErrorKey(key);
        } finally {
          setLoadingScope(undefined);
        }
      },
      [loadingScope, messageId, onDecision, request, setOperationPathConsent],
    );

    const overridden = request.warnings?.some(
      (warning) => warning.code === 'MODEL_CWD_OVERRIDDEN' && warning.overridden,
    );

    const actions = (
      <div aria-label={tw('workspacePathConsent.actions')} className={styles.actions} role="group">
        <Button
          loading={loadingScope === 'operation'}
          type="primary"
          onClick={() => void decide('operation')}
        >
          {tw('workspacePathConsent.once')}
        </Button>
        <Button loading={loadingScope === 'topic'} onClick={() => void decide('topic')}>
          {tw('workspacePathConsent.topic')}
        </Button>
        <Button danger loading={loadingScope === 'reject'} onClick={() => void decide('reject')}>
          {tw('workspacePathConsent.reject')}
        </Button>
      </div>
    );

    return (
      <Flexbox data-testid="workspace-path-consent" gap={10} paddingInline={16}>
        <Text weight={600}>{tw('workspacePathConsent.title')}</Text>
        <dl className={styles.details}>
          <dt className={styles.label}>{tw('workspacePathConsent.primaryCwd')}</dt>
          <dd className={styles.value}>{request.primaryCwd || '—'}</dd>
          <dt className={styles.label}>{tw('workspacePathConsent.actualCwd')}</dt>
          <dd className={styles.value}>{request.actualCwd || '—'}</dd>
          <dt className={styles.label}>{tw('workspacePathConsent.requestedPath')}</dt>
          <dd className={styles.value}>{request.requestedPath}</dd>
          <dt className={styles.label}>{tw('workspacePathConsent.modes')}</dt>
          <dd className={styles.value}>
            <Flexbox horizontal gap={4} wrap="wrap">
              {request.modes.map((mode) => (
                <Tag key={mode}>{tw(`workspacePathConsent.mode.${mode}`)}</Tag>
              ))}
            </Flexbox>
          </dd>
        </dl>
        {overridden && (
          <Alert
            showIcon
            data-testid="workspace-path-consent-cwd-override"
            title={tw('workspacePathConsent.cwdOverridden')}
            type="warning"
          />
        )}
        <Alert
          showIcon
          data-testid="workspace-path-consent-risk"
          description={tw('workspacePathConsent.notOsSandboxDescription')}
          title={tw('workspacePathConsent.notOsSandbox')}
          type="warning"
        />
        {recorded && (
          <Alert
            data-testid="workspace-path-consent-recorded"
            type="info"
            title={
              recorded.scope === 'reject'
                ? tw(
                    coordinationComplete
                      ? 'workspacePathConsent.rejectedAndResumed'
                      : 'workspacePathConsent.rejectRecorded',
                  )
                : tw(
                    coordinationComplete
                      ? 'workspacePathConsent.approvedAndResumed'
                      : 'workspacePathConsent.recordedNotResumed',
                  )
            }
          />
        )}
        {callbackErrorKey && (
          <Alert showIcon role="alert" title={tw(callbackErrorKey)} type="error" />
        )}
        {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
      </Flexbox>
    );
  },
);

PathConsent.displayName = 'PathConsent';

export default PathConsent;
