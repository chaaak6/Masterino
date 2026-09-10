/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type AutoResumePathConsentOptions,
  useAutoResumePathConsent,
} from './AutoResumePathConsent';
import type { StructuredPathConsentRequest } from './PathConsent';

const AutoResumePathConsent = (props: AutoResumePathConsentOptions) => {
  useAutoResumePathConsent(props);
  return null;
};

const request: StructuredPathConsentRequest = {
  actualCwd: '/work/app',
  deviceId: 'device-1',
  modes: ['read'],
  operationId: 'operation-1',
  primaryCwd: '/work/app',
  requestedPath: '/private/tmp/report.xlsx',
  topicId: 'topic-1',
  version: 1,
};

describe('AutoResumePathConsent', () => {
  it('resumes a persisted structured path request exactly once in auto-run mode', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);

    const view = render(
      <StrictMode>
        <AutoResumePathConsent
          isUserStateInit
          approvalMode="auto-run"
          approve={approve}
          assistantGroupId="group-1"
          messageId="message-auto-once"
          request={request}
          toolCallId="tool-auto-once"
        />
      </StrictMode>,
    );

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenCalledWith('message-auto-once', 'group-1');

    view.unmount();
    render(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="auto-run"
        approve={approve}
        assistantGroupId="group-1"
        messageId="message-auto-once"
        request={request}
        toolCallId="tool-auto-once"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['manual mode', { approvalMode: 'manual' as const, request }],
    ['allow-list mode', { approvalMode: 'allow-list' as const, request }],
    ['uninitialized settings', { approvalMode: 'auto-run' as const, isUserStateInit: false, request }],
    ['generic intervention', { approvalMode: 'auto-run' as const, request: undefined }],
  ])('does not resume %s', async (_label, overrides) => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const props: AutoResumePathConsentOptions = {
      approvalMode: overrides.approvalMode ?? 'auto-run',
      approve,
      assistantGroupId: 'group-1',
      isUserStateInit: 'isUserStateInit' in overrides ? overrides.isUserStateInit : true,
      messageId: `message-${_label}`,
      request: 'request' in overrides ? overrides.request : request,
      toolCallId: `tool-${_label}`,
    };

    render(<AutoResumePathConsent {...props} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve).not.toHaveBeenCalled();
  });

  it('waits for a temporary message to become durable before resuming', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="auto-run"
        approve={approve}
        assistantGroupId="group-1"
        messageId="tmp_path-consent"
        request={request}
        toolCallId="tool-durable"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve).not.toHaveBeenCalled();

    view.rerender(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="auto-run"
        approve={approve}
        assistantGroupId="group-1"
        messageId="message-durable"
        request={request}
        toolCallId="tool-durable"
      />,
    );

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
  });

  it('resumes when the initialized local setting changes from manual to auto-run', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="manual"
        approve={approve}
        assistantGroupId="group-1"
        messageId="message-mode-transition"
        request={request}
        toolCallId="tool-mode-transition"
      />,
    );

    expect(approve).not.toHaveBeenCalled();

    view.rerender(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="auto-run"
        approve={approve}
        assistantGroupId="group-1"
        messageId="message-mode-transition"
        request={request}
        toolCallId="tool-mode-transition"
      />,
    );

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
  });

  it('does not auto-resume a credential path card in auto-run mode', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);

    render(
      <AutoResumePathConsent
        isUserStateInit
        approvalMode="auto-run"
        approve={approve}
        assistantGroupId="group-1"
        messageId="message-credential"
        request={{ ...request, requestedPath: '/workspace/.env' }}
        toolCallId="tool-credential"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve).not.toHaveBeenCalled();
  });
});
