import type { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';
import type { TopicDeletionCandidate, TopicModel } from '@/database/models/topic';
import { normalizeRootPath } from '@/helpers/executionContext';
import type { DeviceGateway } from '@/server/services/deviceGateway';

interface TopicDeletionServiceDependencies {
  deviceGateway: Pick<DeviceGateway, 'cleanupScratchWorkspace'>;
  projectWorkspaceModel: Pick<ProjectWorkspaceModel, 'deleteScratch' | 'findById'>;
  topicModel: Pick<TopicModel, 'delete' | 'findById' | 'listForDeletion'>;
  userId: string;
}

interface TransitionalTopicMetadata {
  boundDeviceId?: string;
  executionSnapshot?: {
    boundDeviceId?: string;
    workspaceId?: string;
    workspaceKind?: string;
  };
  workspaceId?: string;
  workspaceKind?: string;
}

export interface TopicDeletionResult {
  deleted: number;
}

export interface TopicDeletionOptions {
  /** Runs after scratch cleanup succeeds but before the topic FK cascades. */
  beforeDelete?: (topic: Readonly<TopicDeletionCandidate>) => Promise<void>;
  /**
   * Optional owner-supplied atomic database boundary. It must delete the topic
   * and, when provided, the scratch catalog row. Used when related counters or
   * join rows must commit with the topic rather than before it.
   */
  deleteDatabaseRecords?: (
    topic: Readonly<TopicDeletionCandidate>,
    scratchWorkspaceId?: string,
  ) => Promise<void>;
}

export class ScratchWorkspaceCleanupError extends Error {
  readonly code = 'SCRATCH_CLEANUP_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ScratchWorkspaceCleanupError';
  }
}

/**
 * The single topic deletion boundary. Database cascades cannot remove a
 * device-hosted scratch directory, so every single and bulk route goes through
 * this service and deletes candidates one by one. Scratch cleanup is
 * fail-closed: an offline device, incomplete ownership evidence, or a returned
 * root mismatch leaves the current topic and its workspace row intact and
 * surfaces the error to the caller.
 */
export class TopicDeletionService {
  constructor(private readonly deps: TopicDeletionServiceDependencies) {}

  removeAll = async (): Promise<TopicDeletionResult> =>
    this.removeCandidates(await this.deps.topicModel.listForDeletion());

  removeByAgentId = async (agentId: string): Promise<TopicDeletionResult> =>
    this.removeCandidates(await this.deps.topicModel.listForDeletion({ agentId }));

  removeById = async (
    id: string,
    options: TopicDeletionOptions = {},
  ): Promise<TopicDeletionResult> => {
    const topic = await this.deps.topicModel.findById(id);
    return this.removeCandidates(topic ? [topic] : [], options);
  };

  removeByIds = async (ids: string[]): Promise<TopicDeletionResult> =>
    this.removeCandidates(await this.deps.topicModel.listForDeletion({ ids }));

  removeBySessionId = async (sessionId?: string | null): Promise<TopicDeletionResult> =>
    this.removeCandidates(
      await this.deps.topicModel.listForDeletion({ sessionId: sessionId ?? null }),
    );

  private removeCandidates = async (
    topics: readonly TopicDeletionCandidate[],
    options: TopicDeletionOptions = {},
  ): Promise<TopicDeletionResult> => {
    let deleted = 0;

    // Distributed filesystem cleanup cannot share a transaction with the DB.
    // Keep progress deterministic and observable: each candidate is fully
    // cleaned and deleted before the next one starts, and the first failure is
    // returned to the mutation caller instead of silently leaving an orphan.
    for (const topic of topics) {
      const scratchWorkspaceId = await this.cleanupScratch(topic);
      if (options.deleteDatabaseRecords) {
        await options.deleteDatabaseRecords(topic, scratchWorkspaceId);
      } else {
        await options.beforeDelete?.(topic);
        await this.deps.topicModel.delete(topic.id);
        if (scratchWorkspaceId) {
          await this.deps.projectWorkspaceModel.deleteScratch(scratchWorkspaceId);
        }
      }
      deleted += 1;
    }

    return { deleted };
  };

  private cleanupScratch = async (topic: TopicDeletionCandidate): Promise<string | undefined> => {
    const metadata = topic.metadata as TransitionalTopicMetadata | null | undefined;
    const snapshot = metadata?.executionSnapshot;
    const workspaceId = snapshot?.workspaceId ?? metadata?.workspaceId;
    const declaredKind = snapshot?.workspaceKind ?? metadata?.workspaceKind;
    const workspace = workspaceId
      ? await this.deps.projectWorkspaceModel.findById(workspaceId)
      : undefined;

    if (declaredKind !== 'scratch' && workspace?.kind !== 'scratch') return undefined;

    const deviceId = workspace?.deviceId ?? snapshot?.boundDeviceId ?? metadata?.boundDeviceId;
    if (!workspaceId || !workspace || workspace.kind !== 'scratch' || !deviceId) {
      throw new ScratchWorkspaceCleanupError('Scratch workspace evidence is incomplete');
    }

    const cleaned = await this.deps.deviceGateway.cleanupScratchWorkspace({
      deviceId,
      expectedRoot: workspace.rootPath,
      topicId: topic.id,
      userId: this.deps.userId,
    });
    if (!cleaned || normalizeRootPath(cleaned.root) !== normalizeRootPath(workspace.rootPath)) {
      throw new ScratchWorkspaceCleanupError(
        'Scratch workspace could not be safely cleaned on its owning device',
      );
    }

    return workspaceId;
  };
}
