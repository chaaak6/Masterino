import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { type LocalConfig, localEnvironment, root } from './config.mjs';
import { verifyDatabaseOwner } from './infrastructure.mjs';
import { refreshedDefaultAgent } from './model-settings.mjs';

export async function migrateLocal(config: LocalConfig) {
  verifyDatabaseOwner(config);
  const client = new pg.Pool({ connectionString: localEnvironment(config).DATABASE_URL });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: path.join(root, 'packages/database/migrations'),
    });
    console.log('Local database migrations passed.');
  } finally {
    await client.end();
  }
}
export async function seedLocal(config: LocalConfig) {
  verifyDatabaseOwner(config);
  const { AiProviderModel } = await import('../../packages/database/src/models/aiProvider');
  const { AiModelModel } = await import('../../packages/database/src/models/aiModel');
  const schema = await import('../../packages/database/src/schemas');
  const { KeyVaultsGateKeeper } = await import('../../apps/server/src/modules/KeyVaultsEncrypt');
  const { eq } = await import('drizzle-orm');
  const client = new pg.Pool({ connectionString: localEnvironment(config).DATABASE_URL });
  try {
    const db = drizzle(client, { schema });
    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, 'developer@masterino.local'),
    });
    if (!user) throw new Error('Development account has not been created by Better Auth.');
    const { CURRENT_ONBOARDING_VERSION } = await import('../../packages/const/src/user');
    if (!user.onboarding?.finishedAt)
      await db
        .update(schema.users)
        .set({
          isOnboarded: true,
          onboarding: { version: CURRENT_ONBOARDING_VERSION, finishedAt: new Date().toISOString() },
        })
        .where(eq(schema.users.id, user.id));
    const provider = new AiProviderModel(db, user.id);
    const existing = await provider.findById('newapi');
    if (
      config.c.AIHUB_API_KEY &&
      (!existing?.keyVaults || process.argv.includes('--refresh-models'))
    ) {
      const vault = await KeyVaultsGateKeeper.initWithEnvKey();
      await provider.updateConfig(
        'newapi',
        { keyVaults: { apiKey: config.c.AIHUB_API_KEY, baseURL: config.c.AIHUB_BASE_URL } },
        vault.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
      await provider.toggleProviderEnabled('newapi', true);
    }
    const models = new AiModelModel(db, user.id);
    const catalog = await models.query();
    for (const [id, type] of [
      [config.c.CHAT_MODEL, 'chat'],
      [config.c.EMBEDDING_MODEL, 'embedding'],
    ]) {
      const current = catalog.find((m) => m.id === id && m.providerId === 'newapi');
      if (!current)
        await models.create({
          id,
          providerId: 'newapi',
          type,
          enabled: true,
          contextWindowTokens: 128000,
          abilities: type === 'chat' ? { functionCall: true, vision: true } : {},
        });
      // The Aihub provider intentionally hides custom models. These configured
      // IDs describe models served by the remote Aihub API, just like its catalog.
      if (!current || process.argv.includes('--refresh-models'))
        await models.update(id, 'newapi', { source: 'remote' });
    }
    const chat = { model: config.c.CHAT_MODEL, provider: 'newapi' };
    const systemAgent = Object.fromEntries(
      [
        'agentMeta',
        'generationTopic',
        'historyCompress',
        'memoryAnalysisAgentConfig',
        'userMemoryPersonaWriter',
        'thread',
        'topic',
      ].map((k) => [k, chat]),
    );
    await db
      .insert(schema.userSettings)
      .values({
        id: user.id,
        defaultAgent: { config: chat },
        general: { telemetry: false, responseLanguage: 'zh-CN' },
        systemAgent,
        memory: { enabled: config.c.MEMORY_ENABLED === '1' },
      })
      .onConflictDoNothing();
    if (process.argv.includes('--refresh-models')) {
      const settings = await db.query.userSettings.findFirst({
        where: eq(schema.userSettings.id, user.id),
      });
      await db
        .update(schema.userSettings)
        .set({
          defaultAgent: refreshedDefaultAgent(settings?.defaultAgent, chat),
          systemAgent,
          memory: { enabled: config.c.MEMORY_ENABLED === '1' },
        })
        .where(eq(schema.userSettings.id, user.id));
    }
    console.log(
      `Local account initialized; model credential ${config.c.AIHUB_API_KEY ? 'configured' : 'missing (edit .local-dev/config.env)'}.`,
    );
  } finally {
    await client.end();
  }
}
