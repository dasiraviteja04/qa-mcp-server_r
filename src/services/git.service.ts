/**
 * GitService — runs git commands against the C# project repository.
 *
 * Used by ResearchService to correlate test failures with recent commits.
 * All commands are read-only — no writes to the repo.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { GitCommit } from '../types/research.types.js';

export class GitService {
  constructor(private repoRoot: string) {}

  /**
   * Get commits from the last N days with the files they touched.
   * Returns empty array if git is not available or repo has no history.
   */
  async getRecentCommits(days: number = 7): Promise<GitCommit[]> {
    try {
      // Get commit hashes + metadata
      const logOutput = this.git(
        `log --since="${days}.days.ago" --pretty=format:"%H|%an|%ai|%s" --no-merges`
      );
      if (!logOutput.trim()) return [];

      const commits: GitCommit[] = [];

      for (const line of logOutput.trim().split('\n')) {
        const parts = line.split('|');
        if (parts.length < 4) continue;
        const [hash, author, date, ...messageParts] = parts;
        if (!hash || !author || !date) continue;
        const message = messageParts.join('|').trim();

        // Get files changed in this commit
        const filesOutput = this.git(`diff-tree --no-commit-id -r --name-only ${hash}`);
        const filesChanged = filesOutput
          .trim()
          .split('\n')
          .map(f => f.trim())
          .filter(Boolean);

        commits.push({ hash: hash.trim(), author: author.trim(), date: date.trim(), message, filesChanged });
      }

      return commits;
    } catch {
      return [];
    }
  }

  /**
   * Files changed since the previous commit (HEAD~1 vs HEAD).
   */
  async getChangedFilesSinceLastCommit(): Promise<string[]> {
    try {
      const output = this.git('diff HEAD~1 HEAD --name-only');
      return output.trim().split('\n').map(f => f.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Files changed since the last git tag (approximates "since last release").
   */
  async getChangedFilesSinceRelease(): Promise<string[]> {
    try {
      const tag = this.getLastReleaseTag();
      if (!tag) return this.getChangedFilesSinceLastCommit();
      const output = this.git(`diff ${tag}..HEAD --name-only`);
      return output.trim().split('\n').map(f => f.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Most recent version tag (e.g. v1.2.3 or release/1.2.3).
   */
  getLastReleaseTag(): string | null {
    try {
      const output = this.git('tag --sort=-version:refname');
      const tags = output.trim().split('\n').filter(t =>
        /^v?\d/.test(t.trim()) || t.toLowerCase().includes('release')
      );
      return tags[0]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Last commit that touched a specific file.
   */
  async getLastCommitForFile(relativePath: string): Promise<GitCommit | null> {
    try {
      const output = this.git(
        `log -1 --pretty=format:"%H|%an|%ai|%s" -- "${relativePath}"`
      );
      if (!output.trim()) return null;
      const parts = output.trim().split('|');
      if (parts.length < 4) return null;
      const [hash, author, date, ...messageParts] = parts;
      if (!hash || !author || !date) return null;
      return {
        hash: hash.trim(),
        author: author.trim(),
        date: date.trim(),
        message: messageParts.join('|').trim(),
        filesChanged: [relativePath]
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if git is available and the repoRoot is a valid git repository.
   */
  isGitAvailable(): boolean {
    try {
      if (!fs.existsSync(path.join(this.repoRoot, '.git')) &&
          !fs.existsSync(path.join(this.repoRoot, '..', '.git')) &&
          !fs.existsSync(path.join(this.repoRoot, '..', '..', '.git')) &&
          !fs.existsSync(path.join(this.repoRoot, '..', '..', '..', '..', '..', '.git'))) {
        // Try running git rev-parse anyway — might be in a worktree
      }
      this.git('rev-parse --is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  private git(command: string): string {
    return execSync(`git ${command}`, {
      cwd: this.repoRoot,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
}
