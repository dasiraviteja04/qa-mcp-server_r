/**
 * GenerationService — Phase 3 of the capability-based orchestration.
 *
 * Thin adapter that maps QAContext inputs and selected artifact types
 * to the existing generateTests() tool function.
 *
 * Design decisions:
 *   - Does NOT re-fetch schema, steps, or page elements.
 *     The orchestrator calls DiscoveryService first; GenerationService
 *     delegates context assembly to the existing generateTests() logic.
 *   - Accepts ArtifactType[] and collapses to full_suite automatically
 *     when all four individual types are present.
 *   - Returns GeneratedArtifacts with the context text, artifact types,
 *     and reasoning — keeping the orchestrator report fully typed.
 *   - Checks MemoryService.wasArtifactRecentlyGenerated() to prevent
 *     duplicate generation for the same area + type within 24 hours.
 *
 * Rule: GenerationService → generateTests (tool function) → Services
 *       This is Service → function → Services, NOT tool → service → tool.
 *       There is no MCP transport involved; generateTests() is called
 *       as a plain async function.
 */

import { generateTests } from '../tools/generateTests.js';
import { MemoryService } from './memory.service.js';
import { getEnvironmentConfig } from '../config/environments.js';
import type { ArtifactType, GeneratedArtifacts, QAContext } from '../types/qa-context.types.js';

export class GenerationService {
  /**
   * Generates test artifacts for the given context and artifact type list.
   *
   * When multiple individual artifact types are selected:
   *   - If all four individual types are present → collapses to full_suite
   *   - Otherwise → uses the first type in the list
   *     (caller may invoke again for remaining types if needed)
   *
   * @param context        Slice of QAContext: featureArea, pageUrl, tables, tags
   * @param artifactTypes  Artifact types selected by selectArtifacts()
   * @param reasoning      Human-readable reason string from buildArtifactReason()
   * @returns              GeneratedArtifacts with context text, types, and reasoning
   */
  async generateArtifacts(
    context:       Pick<QAContext, 'featureArea' | 'pageUrl' | 'tables' | 'tags'>,
    artifactTypes: ArtifactType[],
    reasoning:     string,
  ): Promise<GeneratedArtifacts> {
    const config        = getEnvironmentConfig();
    const memoryService = new MemoryService(config.reportOutputDir);

    // Collapse to full_suite if all four individual types are present
    const ALL_INDIVIDUAL: ArtifactType[] = ['feature', 'steps', 'page_object', 'db_methods'];
    const isFullSuite =
      artifactTypes.includes('full_suite') ||
      ALL_INDIVIDUAL.every(a => artifactTypes.includes(a));

    const artifact: ArtifactType = isFullSuite
      ? 'full_suite'
      : (artifactTypes[0] ?? 'feature');

    // Duplicate prevention: skip generation if same artifact was generated
    // for this area within the last 24 hours
    if (
      context.featureArea &&
      memoryService.wasArtifactRecentlyGenerated(context.featureArea, artifact)
    ) {
      console.error(
        `[GenerationService] Skipping generation — "${artifact}" was already generated ` +
        `for "${context.featureArea}" within the last 24 hours`,
      );
      return {
        artifactTypes: isFullSuite ? ['full_suite'] : artifactTypes,
        context:       `[Skipped] Artifact "${artifact}" was recently generated for "${context.featureArea}". No duplicate generated.`,
        reasoning:     `${reasoning} (skipped: recent duplicate)`,
      };
    }

    const generateInput: Parameters<typeof generateTests>[0] = { artifact, featureArea: context.featureArea };
    if (context.pageUrl !== undefined) generateInput.pageUrl = context.pageUrl;
    if (context.tables  !== undefined) generateInput.tables  = context.tables;
    if (context.tags    !== undefined) generateInput.tags    = context.tags;

    const result = await generateTests(generateInput);

    const contextText = result.content?.[0]?.text ?? '';

    // Fire-and-forget: record this generation in memory
    const artifactEntry: Parameters<typeof memoryService.saveGeneratedArtifact>[0] = {
      artifactType: artifact,
      reason:       reasoning,
    };
    if (context.featureArea) artifactEntry.featureArea = context.featureArea;
    memoryService.saveGeneratedArtifact(artifactEntry);

    return {
      artifactTypes: isFullSuite ? ['full_suite'] : artifactTypes,
      context:       contextText,
      reasoning,
    };
  }
}
