import { ModelProvider } from 'model-bank';

const LOCAL_NETWORK_PROVIDERS = new Set<string>([ModelProvider.LMStudio, ModelProvider.Ollama]);

const parseOrigin = (value: string | undefined): string | undefined => {
  if (!value) return;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.username || url.password) return;

    return url.origin;
  } catch {
    return;
  }
};

export const getAllowedModelProviderOrigins = (
  environment: Record<string, string | undefined> = process.env,
): Set<string> => {
  const configured = environment.MODEL_PROVIDER_ALLOWED_ORIGINS?.split(',') ?? [];
  const candidates = [environment.AIHUB_PROXY_URL, ...configured];

  return new Set(
    candidates
      .map((value) => parseOrigin(value?.trim()))
      .filter((value): value is string => Boolean(value)),
  );
};

/**
 * User-controlled provider URLs must never become an unrestricted server-side
 * proxy. Only origins explicitly approved by an administrator are accepted.
 *
 * Local providers are also denied when they rely on their implicit loopback
 * defaults. Development environments can opt in explicitly through
 * MODEL_PROVIDER_ALLOWED_ORIGINS.
 */
export const assertModelProviderEndpointAllowed = ({
  baseURL,
  environment = process.env,
  runtimeProvider,
}: {
  baseURL?: string;
  environment?: Record<string, string | undefined>;
  runtimeProvider: string;
}) => {
  const allowedOrigins = getAllowedModelProviderOrigins(environment);

  if (!baseURL) {
    if (LOCAL_NETWORK_PROVIDERS.has(runtimeProvider)) {
      throw new Error('Model provider endpoint is not approved');
    }

    return;
  }

  const origin = parseOrigin(baseURL);
  if (!origin || !allowedOrigins.has(origin)) {
    throw new Error('Model provider endpoint is not approved');
  }
};
