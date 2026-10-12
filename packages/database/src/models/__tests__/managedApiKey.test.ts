// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDB } from '../../core/getTestDB';
import { apiKeys, users } from '../../schemas';
import { ApiKeyModel } from '../apiKey';
import { ManagedApiKeyModel } from '../managedApiKey';

const db = await getTestDB();
const owner = 'managed-key-admin-a';
const secondAdmin = 'managed-key-admin-b';
let originalSecret: string | undefined;
beforeEach(async () => {
  originalSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';
  await db.insert(users).values([{ id: owner, fullName: 'Admin A' }, { id: secondAdmin, fullName: 'Admin B' }]);
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, secondAdmin));
  if (originalSecret === undefined) delete process.env.KEY_VAULTS_SECRET; else process.env.KEY_VAULTS_SECRET = originalSecret;
});
describe('Managed API Keys', () => {
  it('Given an admin creates a managed Key, Then it is shared as metadata, encrypted at rest and authenticates as its owner', async () => {
    const model = new ManagedApiKeyModel(db);
    const created = await model.create(owner, { name: 'Community import', description: 'MCP and Skill submissions' });
    const list = await model.list({ page: 1, pageSize: 20 });
    expect(list.items[0]).toMatchObject({ id: created.id, ownerUserId: owner, ownerName: 'Admin A', description: 'MCP and Skill submissions' });
    expect(list.items[0]).not.toHaveProperty('key');
    expect(list.items[0]).not.toHaveProperty('keyHash');
    const plain = await model.reveal(created.id);
    expect(plain).toMatch(/^sk-lh-/);
    const stored = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, created.id) });
    expect(stored!.key).not.toBe(plain);
    expect(await new ApiKeyModel(db, owner).validateKey(plain)).toBe(true);
  });
});
