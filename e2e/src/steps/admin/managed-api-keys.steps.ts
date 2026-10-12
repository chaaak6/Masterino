import { AfterAll, Given, Then, When, setDefaultTimeout } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import superjson from 'superjson';

setDefaultTimeout(60_000);
const base = process.env.ADMIN_ACCEPTANCE_URL || 'https://admin-mlai-test.bielcrystal.com';
const prefix = `bdd-managed-${Date.now()}`;
let primary = '';
let secondary = '';
let employee = '';
let managedId = '';
let personalId = '';
let secret = '';
let expiry: Date;
let rejected: number;
async function rpc(name: string, input: unknown, auth = primary, query = false, cookie = false) {
  const serialized = JSON.stringify(superjson.serialize(input));
  const response = await fetch(
    `${base}/trpc/lambda/${name}${query ? `?input=${encodeURIComponent(serialized)}` : ''}`,
    {
      method: query ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': base,
        [cookie ? 'Cookie' : 'X-API-Key']: auth,
      },
      ...(!query && { body: serialized }),
    },
  );
  const body = await response.json();
  return {
    status: response.status,
    data: body.result?.data ? superjson.deserialize<any>(body.result.data) : undefined,
  };
}
async function login(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': base },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, 'Fixture login must succeed');
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
Given('two administrators and a regular employee in the test environment', async () => {
  const env = fs.readFileSync(process.env.COMMUNITY_CLI_CREDENTIALS!, 'utf8');
  primary = /^export LOBEHUB_CLI_API_KEY=(.+)$/m.exec(env)![1];
  const credentials = JSON.parse(
    fs.readFileSync(process.env.ADMIN_ACCEPTANCE_CREDENTIALS!, 'utf8'),
  );
  secondary = await login(credentials.admin, credentials.password);
  employee = await login(credentials.employee, credentials.password);
  assert.equal((await rpc('admin.me', undefined, secondary, true, true)).status, 200);
});
When('the first administrator creates a named Key with purpose and expiry', async () => {
  expiry = new Date(Date.now() + 3_600_000);
  const result = await rpc('admin.managedApiKeys.create', {
    name: prefix,
    description: 'Disposable BDD acceptance',
    expiresAt: expiry,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.data), ['id']);
  managedId = result.data.id;
});
Then('the other administrator can find its metadata without receiving its secret', async () => {
  const result = await rpc(
    'admin.managedApiKeys.list',
    { page: 1, pageSize: 20, q: prefix },
    secondary,
    true,
    true,
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 1);
  const row = result.data.items[0];
  assert.equal(row.id, managedId);
  assert.equal(row.description, 'Disposable BDD acceptance');
  assert.equal(row.expiresAt.getTime(), expiry.getTime());
  assert.ok(row.ownerName);
  assert.ok(!('key' in row) && !('keyHash' in row));
});
Then('the other administrator can reveal a working owner-bound credential', async () => {
  const result = await rpc(
    'admin.managedApiKeys.reveal',
    { id: managedId },
    secondary,
    false,
    true,
  );
  assert.equal(result.status, 200);
  secret = result.data.key;
  assert.ok(secret.startsWith('sk-lh-'));
  const original = await rpc('admin.me', undefined, primary, true);
  const created = await rpc('admin.me', undefined, secret, true);
  assert.equal(created.status, 200);
  assert.ok(original.data.userId === created.data.userId);
});
Then('the owner cannot change or remove the shared Key through personal settings', async () => {
  const lookup = await rpc('apiKey.getApiKeyById', { id: managedId }, primary, true);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data, undefined);
  assert.equal(
    (await rpc('apiKey.updateApiKey', { id: managedId, value: { enabled: false } })).status,
    200,
  );
  assert.equal((await rpc('apiKey.deleteApiKey', { id: managedId })).status, 200);
  assert.equal((await rpc('admin.me', undefined, secret, true)).status, 200);
});
When('the other administrator stops the disposable Key', async () => {
  assert.equal(
    (
      await rpc(
        'admin.managedApiKeys.setEnabled',
        { id: managedId, enabled: false },
        secondary,
        false,
        true,
      )
    ).status,
    200,
  );
});
Then('the credential cannot authenticate', async () => {
  assert.equal((await rpc('admin.me', undefined, secret, true)).status, 401);
});
When('the other administrator resumes the disposable Key', async () => {
  assert.equal(
    (
      await rpc(
        'admin.managedApiKeys.setEnabled',
        { id: managedId, enabled: true },
        secondary,
        false,
        true,
      )
    ).status,
    200,
  );
});
Then('the credential can authenticate again', async () => {
  assert.equal((await rpc('admin.me', undefined, secret, true)).status, 200);
});
When('the other administrator deletes the disposable Key', async () => {
  assert.equal(
    (await rpc('admin.managedApiKeys.delete', { id: managedId }, secondary, false, true)).status,
    200,
  );
});
Then('its credential and metadata are no longer available', async () => {
  assert.equal((await rpc('admin.me', undefined, secret, true)).status, 401);
  assert.equal((await rpc('admin.managedApiKeys.reveal', { id: managedId })).status, 404);
  assert.equal(
    (await rpc('admin.managedApiKeys.list', { page: 1, pageSize: 20, q: prefix }, primary, true))
      .data.total,
    0,
  );
  managedId = '';
});
Given('a personal Key created through the existing API', async () => {
  const result = await rpc(
    'apiKey.createApiKey',
    { name: `${prefix}-personal`, expiresAt: null },
    secondary,
    false,
    true,
  );
  assert.equal(result.status, 200);
  personalId = result.data.id;
});
Then(
  'the personal Key is absent from the managed directory and cannot be managed there',
  async () => {
    assert.equal(
      (await rpc('admin.managedApiKeys.list', { page: 1, pageSize: 20, q: prefix }, primary, true))
        .data.total,
      0,
    );
    for (const [name, input] of [
      ['reveal', { id: personalId }],
      ['setEnabled', { id: personalId, enabled: false }],
      ['delete', { id: personalId }],
    ] as const)
      assert.equal((await rpc(`admin.managedApiKeys.${name}`, input)).status, 404);
    const result = await rpc('apiKey.getApiKeyById', { id: personalId }, secondary, true, true);
    assert.equal(result.status, 200);
    assert.equal(result.data.enabled, true);
  },
);
Then('an employee cannot list create reveal stop or delete managed Keys', async () => {
  for (const [name, input, query] of [
    ['list', { page: 1, pageSize: 20 }, true],
    ['create', { name: prefix }, false],
    ['reveal', { id: personalId }, false],
    ['setEnabled', { id: personalId, enabled: false }, false],
    ['delete', { id: personalId }, false],
  ] as const)
    assert.equal(
      (await rpc(`admin.managedApiKeys.${name}`, input, employee, query, true)).status,
      403,
    );
});
Then('the original administrator CLI credential still works', async () => {
  assert.equal((await rpc('admin.me', undefined, primary, true)).status, 200);
});
When('an administrator requests a Key with a past expiry', async () => {
  rejected = (await rpc('admin.managedApiKeys.create', { name: prefix, expiresAt: new Date(0) }))
    .status;
});
Then('validation rejects the request without creating a Key', async () => {
  assert.equal(rejected, 400);
  assert.equal(
    (await rpc('admin.managedApiKeys.list', { page: 1, pageSize: 20, q: prefix }, primary, true))
      .data.total,
    0,
  );
});
AfterAll(async () => {
  if (managedId)
    assert.equal((await rpc('admin.managedApiKeys.delete', { id: managedId })).status, 200);
  if (personalId)
    assert.equal(
      (await rpc('apiKey.deleteApiKey', { id: personalId }, secondary, false, true)).status,
      200,
    );
});
