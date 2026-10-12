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
  await db.insert(users).values([
    { id: owner, fullName: 'Admin A' },
    { id: secondAdmin, fullName: 'Admin B' },
  ]);
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, secondAdmin));
  if (originalSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
  else process.env.KEY_VAULTS_SECRET = originalSecret;
});
describe('Managed API Keys', () => {
  it('Given a managed Key, Then personal list, update and delete operations cannot affect it while authentication still works', async () => {
    const managed = new ManagedApiKeyModel(db);
    const personal = new ApiKeyModel(db, owner);
    const shared = await managed.create(owner, { name: 'Shared company key' });
    const own = await personal.create({ name: 'Personal key' });
    const secret = await managed.reveal(shared.id);
    expect((await personal.query()).map((key) => key.id)).toEqual([own.id]);
    expect(await personal.findById(shared.id)).toBeUndefined();
    await personal.update(shared.id, { enabled: false });
    await personal.delete(shared.id);
    await personal.deleteAll();
    expect((await managed.list({ page: 1, pageSize: 20 })).items).toHaveLength(1);
    expect(await personal.validateKey(secret)).toBe(true);
    await personal.updateLastUsed(shared.id);
    expect((await managed.list({ page: 1, pageSize: 20 })).items[0].lastUsedAt).toBeInstanceOf(
      Date,
    );
    expect(await personal.query()).toHaveLength(0);
  });
  it('Given an admin creates a managed Key, Then it is shared as metadata, encrypted at rest and authenticates as its owner', async () => {
    const model = new ManagedApiKeyModel(db);
    const created = await model.create(owner, {
      name: 'Community import',
      description: 'MCP and Skill submissions',
    });
    const list = await model.list({ page: 1, pageSize: 20 });
    expect(list.items[0]).toMatchObject({
      id: created.id,
      ownerUserId: owner,
      ownerName: 'Admin A',
      description: 'MCP and Skill submissions',
    });
    expect(list.items[0]).not.toHaveProperty('key');
    expect(list.items[0]).not.toHaveProperty('keyHash');
    const plain = await model.reveal(created.id);
    expect(plain).toMatch(/^sk-lh-/);
    const stored = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, created.id) });
    expect(stored!.key).not.toBe(plain);
    expect(await new ApiKeyModel(db, owner).validateKey(plain)).toBe(true);
  });
  it('Given two admin owners, Then the catalog shares managed metadata but excludes and protects personal Keys', async () => {
    const model = new ManagedApiKeyModel(db);
    const first = await model.create(owner, { name: 'First key' });
    const second = await model.create(secondAdmin, { name: 'Second key' });
    const personal = await new ApiKeyModel(db, owner).create({ name: 'Personal key' });
    const list = await model.list({ page: 1, pageSize: 20 });
    expect(list.total).toBe(2);
    expect(list.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    await expect(model.reveal(personal.id)).rejects.toThrow('Managed API key not found');
    await expect(model.setEnabled(personal.id, false)).rejects.toThrow('Managed API key not found');
    await expect(model.delete(personal.id)).rejects.toThrow('Managed API key not found');
    expect((await new ApiKeyModel(db, owner).findById(personal.id))!.enabled).toBe(true);
  });
  it('When a managed Key is disabled, enabled and deleted, Then the original authentication follows each state', async () => {
    const model = new ManagedApiKeyModel(db);
    const created = await model.create(owner, { name: 'Toggle test' });
    const plain = await model.reveal(created.id);
    const original = new ApiKeyModel(db, owner);
    await model.setEnabled(created.id, false);
    expect(await original.validateKey(plain)).toBe(false);
    await model.setEnabled(created.id, true);
    expect(await original.validateKey(plain)).toBe(true);
    await model.delete(created.id);
    expect(await original.validateKey(plain)).toBe(false);
  });
  it('Given a purpose and expiry, Then search and pagination preserve their metadata', async () => {
    const model = new ManagedApiKeyModel(db);
    const expiresAt = new Date('2099-01-01T00:00:00Z');
    await model.create(owner, { name: 'Import agent', description: 'Skill deployment', expiresAt });
    await model.create(secondAdmin, { name: 'Other agent' });
    const result = await model.list({ page: 1, pageSize: 1, q: 'deployment' });
    expect(result.total).toBe(1);
    expect(result.items[0].expiresAt).toEqual(expiresAt);
    expect((await model.list({ page: 2, pageSize: 1, q: 'deployment' })).items).toHaveLength(0);
  });
});
