import { createHash } from 'node:crypto';

import { Given, Then, When } from '@cucumber/cucumber';
import { type APIResponse, expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';

const requireEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live file-access BDD`);
  return value;
};

const responseFrom = (world: CustomWorld): APIResponse => {
  const response = world.context.fileAccessResponse as APIResponse | undefined;
  if (!response) throw new Error('No file access response is available');
  return response;
};

const redirectFrom = (world: CustomWorld) => {
  const location = responseFrom(world).headers().location;
  if (!location) throw new Error('The file response did not include a Location header');
  return new URL(location);
};

Given('a private file fixture is configured for browser access', function (this: CustomWorld) {
  const fileId = requireEnv('FILE_ACCESS_TEST_FILE_ID');
  this.context.fileAccessPath = `/f/${encodeURIComponent(fileId)}`;
  this.context.expectedFileSha256 = requireEnv('FILE_ACCESS_TEST_SHA256');
  this.context.expectedPublicBucketHost = requireEnv('FILE_ACCESS_PUBLIC_BUCKET_HOST');
});

When(
  'I request the stable file URL without following redirects',
  async function (this: CustomWorld) {
    this.context.fileAccessResponse = await this.page.request.get(this.context.fileAccessPath, {
      maxRedirects: 0,
    });
  },
);

When(
  'I request the stable file URL as a download without following redirects',
  async function (this: CustomWorld) {
    this.context.fileAccessResponse = await this.page.request.get(
      `${this.context.fileAccessPath}?download=1`,
      { maxRedirects: 0 },
    );
  },
);

Then('the file response status should be {int}', function (this: CustomWorld, status: number) {
  expect(responseFrom(this).status()).toBe(status);
});

Then(
  'the redirect host should equal the configured public bucket host',
  function (this: CustomWorld) {
    expect(redirectFrom(this).hostname).toBe(this.context.expectedPublicBucketHost);
  },
);

Then('the redirect host should not contain {string}', function (this: CustomWorld, value: string) {
  expect(redirectFrom(this).hostname).not.toContain(value);
});

Then('the signed redirect should request attachment disposition', function (this: CustomWorld) {
  expect(redirectFrom(this).searchParams.get('response-content-disposition')).toContain(
    'attachment;',
  );
});

When('I follow the signed file redirect', async function (this: CustomWorld) {
  this.context.fileAccessResponse = await this.page.request.get(redirectFrom(this).href);
});

Then('OSS should return the configured fixture content', async function (this: CustomWorld) {
  const response = responseFrom(this);
  expect([200, 206]).toContain(response.status());
  const digest = createHash('sha256')
    .update(await response.body())
    .digest('hex');
  expect(digest).toBe(this.context.expectedFileSha256);
});

Then('the OSS response should use attachment disposition', function (this: CustomWorld) {
  expect(responseFrom(this).headers()['content-disposition']).toContain('attachment;');
});
