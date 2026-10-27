import { readBoundedSkillBody, SKILL_SOURCE_MAX_BYTES } from '@lobechat/skill-package';
import debug from 'debug';

const log = debug('lobe-chat:module:github');

export interface GitHubRepoInfo {
  branch: string;
  owner: string;
  /**
   * Subdirectory path within the repository (e.g., 'skills/skill-creator')
   * Extracted from URLs like: https://github.com/owner/repo/tree/branch/path/to/dir
   */
  path?: string;
  repo: string;
}

export interface GitHubRawFileInfo extends GitHubRepoInfo {
  filePath: string;
}

export class GitHub {
  private readonly token?: string;
  private readonly userAgent: string;

  constructor(options?: { token?: string; userAgent?: string }) {
    this.token = options?.token;
    this.userAgent = options?.userAgent || 'Masterino';
  }

  private get headers() {
    return {
      'Accept': 'application/vnd.github+json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'User-Agent': this.userAgent,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /**
   * Parse GitHub URL to extract owner, repo, branch, and optional path
   * Supports multiple formats:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/branch
   * - https://github.com/owner/repo/tree/branch/path/to/dir
   * - https://github.com/owner/repo/blob/branch/path/to/file.md
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   * - https://github.com/owner/repo.git
   *
   * When a /blob/ URL pointing to a file is provided, the file name is stripped
   * and the parent directory is used as the path.
   */
  parseRepoUrl(url: string, defaultBranch = 'main'): GitHubRepoInfo {
    log('parseRepoUrl: input url=%s, defaultBranch=%s', url, defaultBranch);

    // Handle shorthand format: owner/repo
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
      const [owner, repo] = url.split('/');
      const result = { branch: defaultBranch, owner, repo };
      log('parseRepoUrl: matched shorthand format, result=%o', result);
      return result;
    }

    // Handle full URL formats
    // Capture: owner, repo, type (tree/blob), branch, and optional path after branch
    const match = url.match(
      /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/,
    );

    if (!match) {
      log('parseRepoUrl: failed to parse url=%s', url);
      throw new GitHubParseError(`Invalid GitHub URL format: ${url}`);
    }

    const [, owner, repo, urlType, branch, rawPath] = match;
    const result: GitHubRepoInfo = {
      branch: branch || defaultBranch,
      owner,
      repo: repo.replace(/\.git$/, ''),
    };

    // Process path: for /blob/ URLs pointing to a file, strip the file name to get the directory
    if (rawPath) {
      let path = rawPath;
      if (urlType === 'blob') {
        // Strip trailing file name (e.g. "skills/json-canvas/SKILL.md" -> "skills/json-canvas")
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) {
          path = path.slice(0, lastSlash);
        } else {
          // The path is just a file at the repo root, no subdirectory
          path = '';
        }
      }
      if (path) {
        result.path = path;
      }
    }

    log('parseRepoUrl: matched full URL format, result=%o', result);
    return result;
  }

  /**
   * Generate skill identifier from repo info
   *
   * Format: {owner}-{repo}-{skillName}
   * The skill name is the last segment of the path (directory name).
   * All parts are lowercased and joined with hyphens.
   *
   * @param info - Repository information
   * @returns Skill identifier string
   */
  generateIdentifier(info: GitHubRepoInfo): string {
    const parts = [
      this.normalizeIdentifierPart(info.owner),
      this.normalizeIdentifierPart(info.repo),
    ];

    if (info.path) {
      const lastSegment = info.path.split('/').findLast(Boolean);
      if (lastSegment) {
        parts.push(this.normalizeIdentifierPart(lastSegment));
      }
    }

    return parts.join('-').toLowerCase();
  }

  /**
   * Normalize a string for use as part of a skill identifier.
   * Replaces non-alphanumeric characters (except hyphens) with hyphens,
   * collapses consecutive hyphens, and trims leading/trailing hyphens.
   */
  private normalizeIdentifierPart(part: string): string {
    return part
      .replaceAll(/[^\w-]/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-|-$/g, '');
  }

  /**
   * Build the ZIP download URL for a GitHub repository
   */
  buildRepoZipUrl(info: GitHubRepoInfo): string {
    if (/^[a-f\d]{40}$/i.test(info.branch)) {
      return `https://github.com/${info.owner}/${info.repo}/archive/${info.branch}.zip`;
    }
    return `https://github.com/${info.owner}/${info.repo}/archive/refs/heads/${info.branch}.zip`;
  }

  /** Resolve a mutable branch or tag to an immutable commit SHA. */
  async resolveCommit(info: GitHubRepoInfo): Promise<GitHubRepoInfo> {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/commits/${encodeURIComponent(info.branch)}`,
      { headers: this.headers },
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Repository ref not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to resolve repository ref: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as { sha?: string };
    if (!data.sha || !/^[a-f\d]{40}$/i.test(data.sha)) {
      throw new GitHubDownloadError('GitHub returned an invalid commit SHA');
    }
    return { ...info, branch: data.sha };
  }

  /**
   * Build the raw file URL for a GitHub repository
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${info.filePath}`;
  }

  /**
   * Download repository as ZIP buffer
   */
  async downloadRepoZip(info: GitHubRepoInfo): Promise<Buffer> {
    const zipUrl = this.buildRepoZipUrl(info);
    log('downloadRepoZip: fetching url=%s', zipUrl);

    const response = await fetch(zipUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(120_000),
    });

    log('downloadRepoZip: response status=%d, ok=%s', response.status, response.ok);

    if (!response.ok) {
      if (response.status === 404) {
        log('downloadRepoZip: repository not found');
        throw new GitHubNotFoundError(
          `Repository not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      log('downloadRepoZip: download failed with status=%d', response.status);
      throw new GitHubDownloadError(
        `Failed to download repository: ${response.status} ${response.statusText}`,
      );
    }

    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > SKILL_SOURCE_MAX_BYTES) {
      throw new GitHubDownloadError('Repository archive exceeds the 64 MiB limit');
    }
    const buffer = Buffer.from(await readBoundedSkillBody(response.body, SKILL_SOURCE_MAX_BYTES));
    if (buffer.length > SKILL_SOURCE_MAX_BYTES) {
      throw new GitHubDownloadError('Repository archive exceeds the 64 MiB limit');
    }
    log('downloadRepoZip: downloaded %d bytes', buffer.length);
    return buffer;
  }

  /**
   * Download a single raw file from GitHub
   */
  async downloadRawFile(info: GitHubRawFileInfo): Promise<string> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: this.headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    return response.text();
  }

  /**
   * Download a single raw file as buffer from GitHub
   */
  async downloadRawFileBuffer(info: GitHubRawFileInfo): Promise<Buffer> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: this.headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubParseError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubParseError';
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubDownloadError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubDownloadError';
  }
}

export const github = new GitHub();
