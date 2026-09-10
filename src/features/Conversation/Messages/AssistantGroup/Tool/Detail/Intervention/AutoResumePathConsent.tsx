'use client';

import { useEffect } from 'react';

import type { ApprovalMode } from '@/store/user/slices/settings/selectors';

import type { StructuredPathConsentRequest } from './PathConsent';

export interface AutoResumePathConsentOptions {
  approvalMode: ApprovalMode;
  approve: (messageId: string, assistantGroupId: string) => Promise<void>;
  assistantGroupId?: string;
  isUserStateInit: boolean;
  messageId: string;
  request?: StructuredPathConsentRequest;
  toolCallId: string;
}

// React StrictMode and message-list remounts must not replay the same persisted tool call.
// Message/tool-call ids are durable and globally unique for the lifetime of the renderer.
const autoResumedCalls = new Set<string>();

/**
 * Compatibility bridge for path-consent cards that were persisted before the user switched to
 * auto-run (or before auto-run reached the filesystem boundary). This deliberately does not
 * create either an operation or topic grant: the current approval mode authorizes this execution,
 * while grants remain an optional path-memory feature for manual/allow-list modes.
 */
export const useAutoResumePathConsent = ({
  approvalMode,
  approve,
  assistantGroupId,
  isUserStateInit,
  messageId,
  request,
  toolCallId,
}: AutoResumePathConsentOptions) => {
  useEffect(() => {
    if (
      !isUserStateInit ||
      approvalMode !== 'auto-run' ||
      !request ||
      messageId.startsWith('tmp_')
    )
      return;

    const callKey = `${messageId}:${toolCallId}`;
    if (autoResumedCalls.has(callKey)) return;

    autoResumedCalls.add(callKey);
    void approve(messageId, assistantGroupId ?? '').catch((error) => {
      // Leave the card actionable on failure and permit a later remount/mode transition to retry.
      autoResumedCalls.delete(callKey);
      console.error('[AutoResumePathConsent] Failed to resume persisted path consent:', error);
    });
  }, [approvalMode, approve, assistantGroupId, isUserStateInit, messageId, request, toolCallId]);
};
