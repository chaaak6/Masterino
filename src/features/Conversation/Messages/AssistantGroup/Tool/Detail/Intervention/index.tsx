import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { isDesktop } from '@lobechat/const';
import { safeParseJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { localFileService } from '@/services/electron/localFileService';
import { projectWorkspaceService } from '@/services/projectWorkspace';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStore } from '../../../../../store';
import Arguments from '../Arguments';
import ApprovalActions from './ApprovalActions';
import { useAutoResumePathConsent } from './AutoResumePathConsent';
import {
  isCustomInteractionIdentifier,
  isHeteroInteractionIdentifier,
  prepareCustomInteractionSubmit,
  recordCustomInteractionResolution,
} from './customInteractionHandlers';
import Fallback from './Fallback';
import KeyValueEditor from './KeyValueEditor';
import PathConsent, {
  parseStructuredPathConsentRequest,
  type PathConsentSelection,
  WORKSPACE_PATH_CONSENT_METADATA_KEY,
} from './PathConsent';
import { coordinatePathConsentApproval, PathConsentResolutionError } from './pathConsentDecision';
import SecurityBlacklistWarning from './SecurityBlacklistWarning';

export type { ApprovalMode } from '@/store/user/slices/settings/selectors';

interface InterventionProps {
  actionsPortalTarget?: HTMLDivElement | null;
  apiName: string;
  assistantGroupId?: string;
  id: string;
  identifier: string;
  requestArgs: string;
  toolCallId: string;
}

const Intervention = memo<InterventionProps>(
  ({ requestArgs, id, identifier, apiName, toolCallId, assistantGroupId, actionsPortalTarget }) => {
    const approvalMode = useUserStore(toolInterventionSelectors.approvalMode);
    const isUserStateInit = useUserStore((s) => s.isUserStateInit);
    const [isEditing, setIsEditing] = useState(false);
    const updatePluginArguments = useConversationStore((s) => s.updatePluginArguments);

    // Store beforeApprove callbacks from intervention components (support multiple registrations)
    // Use Map with id as key for reliable cleanup
    const beforeApproveCallbacksRef = useRef<Map<string, () => void | Promise<void>>>(new Map());

    // Register a callback to be called before approval
    const registerBeforeApprove = useCallback(
      (callbackId: string, callback: () => void | Promise<void>) => {
        beforeApproveCallbacksRef.current.set(callbackId, callback);
        // Return cleanup function to unregister
        return () => {
          beforeApproveCallbacksRef.current.delete(callbackId);
        };
      },
      [],
    );

    // Handler to be called before approve action - calls all registered callbacks
    const handleBeforeApprove = useCallback(async () => {
      const callbacks = Array.from(beforeApproveCallbacksRef.current.values());
      await Promise.all(callbacks.map((cb) => cb()));
    }, []);

    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!toolCallId) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            await updatePluginArguments(toolCallId, editedObject, true);
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
        }
      },
      [requestArgs, toolCallId, updatePluginArguments],
    );

    // Callback for builtin intervention components to update arguments
    const handleArgsChange = useCallback(
      async (newArgs: unknown) => {
        if (!toolCallId) return;
        await updatePluginArguments(toolCallId, newArgs, true);
      },
      [toolCallId, updatePluginArguments],
    );

    const parsedArgs = useMemo(() => safeParseJSON(requestArgs || '') ?? {}, [requestArgs]);

    const isCustomInteraction = isCustomInteractionIdentifier(identifier, apiName);
    const showFullShellArguments = identifier === 'lobe-local-system' && apiName === 'runCommand';

    const toolMessage = useConversationStore(dataSelectors.getDbMessageById(id));
    const topicId = toolMessage?.topicId;
    const pathConsentRequest = useMemo(() => {
      const pluginState = toolMessage?.pluginState;
      const intervention = toolMessage?.pluginIntervention as Record<string, unknown> | undefined;
      return parseStructuredPathConsentRequest(
        pluginState?.[WORKSPACE_PATH_CONSENT_METADATA_KEY] ??
          intervention?.[WORKSPACE_PATH_CONSENT_METADATA_KEY],
      );
    }, [toolMessage?.pluginIntervention, toolMessage?.pluginState]);
    const submitToolInteraction = useConversationStore((s) => s.submitToolInteraction);
    const skipToolInteraction = useConversationStore((s) => s.skipToolInteraction);
    const cancelToolInteraction = useConversationStore((s) => s.cancelToolInteraction);
    const approveToolCall = useConversationStore((s) => s.approveToolCall);
    const rejectAndContinueToolCall = useConversationStore((s) => s.rejectAndContinueToolCall);
    useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const grantTopicAccess = useProjectWorkspaceStore((s) => s.grantTopicAccess);
    const setOperationPathConsent = useProjectWorkspaceStore((s) => s.setOperationPathConsent);
    // Hetero (CC / Codex) interventions ship the answer back through IPC to a
    // running CLI subprocess instead of starting a fresh `executeClientAgent`
    // turn. Pull the chat-store action lazily so non-hetero interactions stay
    // on the existing path with no behavior change.
    const submitHeteroIntervention = useChatStore((s) => s.submitHeteroIntervention);

    useAutoResumePathConsent({
      approvalMode,
      approve: approveToolCall,
      assistantGroupId,
      isUserStateInit,
      messageId: id,
      request: pathConsentRequest,
      toolCallId,
    });

    const handlePathConsentDecision = useCallback(
      async (decision: PathConsentSelection): Promise<PathConsentSelection> => {
        if (decision.scope === 'reject') {
          setOperationPathConsent(id, decision);
          await rejectAndContinueToolCall(id, 'Workspace path access was rejected');
          return decision;
        }

        return coordinatePathConsentApproval(decision, {
          grantTopicRoot: async (canonicalPath) => {
            const granted = await grantTopicAccess({
              deviceId: decision.deviceId,
              modes: decision.modes,
              requestedVia: {
                messageId: id,
                reason: 'workspace-path-consent',
                toolCallId,
              },
              rootPath: canonicalPath,
              topicId: decision.topicId,
            });
            if (!granted.ok) throw new Error(granted.message || granted.code);
          },
          persistDecision: (canonicalDecision) => setOperationPathConsent(id, canonicalDecision),
          resolveRootPath: async () => {
            if (isDesktop && currentDeviceId === decision.deviceId) {
              const resolved = await localFileService.resolveRealPath({ path: decision.rootPath });
              if (!resolved.success || !resolved.path) {
                throw new PathConsentResolutionError(resolved.errorCode ?? 'PATH_UNRESOLVABLE');
              }
              return resolved.path;
            }
            const resolved = await projectWorkspaceService.resolveRealPath({
              deviceId: decision.deviceId,
              path: decision.rootPath,
            });
            return resolved.path;
          },
          resume: () => approveToolCall(id, assistantGroupId ?? ''),
        });
      },
      [
        approveToolCall,
        assistantGroupId,
        currentDeviceId,
        grantTopicAccess,
        id,
        rejectAndContinueToolCall,
        setOperationPathConsent,
        toolCallId,
      ],
    );

    const handleInteractionAction = useCallback(
      async (
        action:
          | { type: 'submit'; payload: Record<string, unknown> }
          | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
          | { type: 'cancel'; payload?: Record<string, unknown> },
      ) => {
        if (isHeteroInteractionIdentifier(identifier)) {
          await submitHeteroIntervention(id, action.type, action.payload);
          return;
        }
        switch (action.type) {
          case 'submit': {
            const { payload, options } = await prepareCustomInteractionSubmit(
              identifier,
              action.payload,
              {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              },
            );
            await submitToolInteraction(id, payload, options);
            break;
          }
          case 'skip': {
            await recordCustomInteractionResolution(
              identifier,
              'skipped',
              action.payload,
              {
                apiName,
                requestArgs: parsedArgs,
                topicId,
              },
              action.reason,
            );
            await skipToolInteraction(id, action.reason);
            break;
          }
          case 'cancel': {
            await recordCustomInteractionResolution(identifier, 'cancelled', action.payload, {
              apiName,
              requestArgs: parsedArgs,
              topicId,
            });
            await cancelToolInteraction(id);
            break;
          }
        }
      },
      [
        apiName,
        cancelToolInteraction,
        id,
        identifier,
        parsedArgs,
        skipToolInteraction,
        submitHeteroIntervention,
        submitToolInteraction,
        topicId,
      ],
    );

    const BuiltinToolInterventionRender = getBuiltinIntervention(identifier, apiName);

    if (BuiltinToolInterventionRender) {
      if (isEditing)
        return (
          <Suspense fallback={<Arguments arguments={requestArgs} />}>
            <KeyValueEditor
              initialValue={parsedArgs}
              onCancel={handleCancel}
              onFinish={handleFinish}
            />
          </Suspense>
        );

      if (isCustomInteraction) {
        return (
          <Flexbox gap={12}>
            <BuiltinToolInterventionRender
              apiName={apiName}
              args={parsedArgs}
              identifier={identifier}
              interactionMode="custom"
              messageId={id}
              registerBeforeApprove={registerBeforeApprove}
              onArgsChange={handleArgsChange}
              onInteractionAction={handleInteractionAction}
            />
          </Flexbox>
        );
      }

      const actions = pathConsentRequest ? null : (
        <Flexbox horizontal justify={'flex-end'}>
          <ApprovalActions
            apiName={apiName}
            approvalMode={approvalMode}
            assistantGroupId={assistantGroupId}
            identifier={identifier}
            messageId={id}
            toolCallId={toolCallId}
            onBeforeApprove={handleBeforeApprove}
          />
        </Flexbox>
      );

      return (
        <Flexbox gap={12}>
          <SecurityBlacklistWarning args={parsedArgs} />
          {showFullShellArguments && (
            <div data-testid="workspace-shell-full-arguments">
              <Arguments arguments={requestArgs} />
            </div>
          )}
          <BuiltinToolInterventionRender
            apiName={apiName}
            args={parsedArgs}
            identifier={identifier}
            messageId={id}
            registerBeforeApprove={registerBeforeApprove}
            onArgsChange={handleArgsChange}
          />
          {pathConsentRequest && (
            <PathConsent
              actionsPortalTarget={actionsPortalTarget}
              messageId={id}
              request={pathConsentRequest}
              onDecision={handlePathConsentDecision}
            />
          )}
          {!pathConsentRequest &&
            (actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions)}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={12}>
        <SecurityBlacklistWarning args={parsedArgs} />
        {showFullShellArguments && (
          <div data-testid="workspace-shell-full-arguments">
            <Arguments arguments={requestArgs} />
          </div>
        )}
        <Fallback
          actionsPortalTarget={actionsPortalTarget}
          apiName={apiName}
          assistantGroupId={assistantGroupId}
          hideActions={!!pathConsentRequest}
          id={id}
          identifier={identifier}
          requestArgs={requestArgs}
          toolCallId={toolCallId}
        />
        {pathConsentRequest && (
          <PathConsent
            actionsPortalTarget={actionsPortalTarget}
            messageId={id}
            request={pathConsentRequest}
            onDecision={handlePathConsentDecision}
          />
        )}
      </Flexbox>
    );
  },
);

export default Intervention;
