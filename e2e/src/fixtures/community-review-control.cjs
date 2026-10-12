// Test-only helper, copied into the isolated Market preview. Never ship in a runtime image.
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const { Client } = require('/app/node_modules/pg');

(async () => {
  const [action, identifier] = process.argv.slice(2);
  if (action === 'token') {
    const secret = process.env.MARKET_TRUSTED_CLIENT_SECRET;
    const key = secret.startsWith('lobehub-market_tcs_')
      ? createHash('sha256').update(secret).digest()
      : Buffer.from(secret, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const payload = {
      clientId: process.env.MARKET_TRUSTED_CLIENT_IDS.split(',')[0].trim(),
      userId: 'community-bdd-admin',
      nonce: randomBytes(16).toString('hex'),
      timestamp: Date.now(),
    };
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    console.log(Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64'));
    return;
  }
  if (!['inject', 'remove-fault'].includes(action)) throw new Error('Unknown test action');
  const client = new Client({ connectionString: process.env.MARKET_DATABASE_URL });
  await client.connect();
  try {
    if (action === 'inject') {
      if (!/^bdd-review-[0-9]+-rollback$/.test(identifier))
        throw new Error('Disposable fixture identifier required');
      await client.query(`CREATE OR REPLACE FUNCTION community_bdd_review_fault() RETURNS trigger AS $$
        BEGIN IF EXISTS(SELECT 1 FROM market_resources WHERE id=NEW.resource_id AND identifier='${identifier}')
        THEN RAISE EXCEPTION 'BDD version insertion fault'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
      await client.query(
        'CREATE TRIGGER community_bdd_review_fault BEFORE INSERT ON market_versions FOR EACH ROW EXECUTE FUNCTION community_bdd_review_fault()',
      );
    } else {
      await client.query('DROP TRIGGER IF EXISTS community_bdd_review_fault ON market_versions');
      await client.query('DROP FUNCTION IF EXISTS community_bdd_review_fault()');
    }
  } finally {
    await client.end();
  }
  console.log('Test control complete');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
