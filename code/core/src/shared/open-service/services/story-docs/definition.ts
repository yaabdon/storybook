import * as v from 'valibot';

import { type SnippetTemplate, isSnippetTemplate } from '../../../../docs-tools/snippetTemplate.ts';

import { defineService } from 'storybook/open-service';
import type { ServiceInstanceOf } from '../../types.ts';
import { readComponent } from '../component-state-key.ts';
import type { StoryDocsById, StoryDocsPayload } from './types.ts';
import { storyDocsQueryStaticPath } from './paths.ts';

/**
 * Which stories a `storyDocs` read returns: `all` for the Storybook UI, which shows every story, and
 * `manifest` for the docs tools, the MCP and the components manifest, which show only the stories
 * tagged `manifest`. Required, so that a new reader cannot leak stories by leaving it out.
 */
const storyDocsScopeSchema = v.picklist(['all', 'manifest']);
export type StoryDocsScope = v.InferOutput<typeof storyDocsScopeSchema>;

const storyDocsQueryInputSchema = v.object({ id: v.string(), scope: storyDocsScopeSchema });
const storyDocsCommandInputSchema = v.object({ id: v.string() });

const storyDocsErrorSchema = v.object({
  name: v.string(),
  message: v.string(),
});

// A `SnippetTemplate`: code, and holes whose place only its renderer reads.
const snippetTemplateSchema = v.custom<SnippetTemplate>(
  isSnippetTemplate,
  'Expected a snippet template: code and holes'
);

// The query output is parsed with these schemas, which drop every key they don't list; the type
// test next to this file keeps them equal to the hand-written types in `types.ts`.
const storyDocSchema = v.object({
  id: v.string(),
  name: v.string(),
  snippet: v.optional(v.string()),
  description: v.optional(v.string()),
  summary: v.optional(v.string()),
  warning: v.optional(v.string()),
  error: v.optional(storyDocsErrorSchema),
  template: v.optional(snippetTemplateSchema),
});

const storyDocsPayloadSchema = v.object({
  id: v.string(),
  name: v.string(),
  path: v.string(),
  import: v.optional(v.string()),
  stories: v.record(v.string(), storyDocSchema),
  error: v.optional(storyDocsErrorSchema),
});

const storyDocsOutputSchema = v.optional(storyDocsPayloadSchema);

export type StoryDocsServiceState = {
  /**
   * Extracted story docs keyed by component id, with only the stories tagged `manifest`. The
   * components manifest points here. Read every story through the `storyDocs` query with
   * `scope: 'all'`, not from this state.
   */
  components: Record<string, StoryDocsPayload>;
  /** The stories each component leaves out of the manifests, keyed by component id, then story id. */
  nonManifestStories: Record<string, StoryDocsById>;
};

/** Joins a component's stories that are not in the manifests back into its payload. */
function withNonManifestStories(
  payload: StoryDocsPayload | undefined,
  nonManifestStories: StoryDocsById | undefined
): StoryDocsPayload | undefined {
  return payload && nonManifestStories
    ? { ...payload, stories: { ...payload.stories, ...nonManifestStories } }
    : payload;
}

/**
 * Definition for the `core/story-docs` open service.
 *
 * Carries per-story snippets, descriptions, and file-level import statements keyed by component
 * id. Component prop docgen lives in `core/docgen`.
 */
export const storyDocsServiceDef = defineService({
  id: 'core/story-docs',
  internal: true,
  description: 'Story documentation (snippets, descriptions, imports) keyed by component id.',
  initialState: { components: {}, nonManifestStories: {} } as StoryDocsServiceState,
  queries: {
    storyDocs: {
      description:
        'Returns the story-docs payload for one component id, or undefined when not loaded. `scope` picks every story or only those in the manifests.',
      input: storyDocsQueryInputSchema,
      output: storyDocsOutputSchema,
      handler: ({ id, scope }, ctx) => {
        const payload = readComponent(ctx.self.state.components, id);
        switch (scope) {
          case 'manifest':
            return payload;
          case 'all':
            return withNonManifestStories(
              payload,
              readComponent(ctx.self.state.nonManifestStories, id)
            );
          default:
            return scope satisfies never;
        }
      },
      load: async ({ id }, ctx) => {
        await ctx.self.commands.extractStoryDocs({ id });
      },
      // Both scopes read the same state, so they share one file.
      staticPath: (input) => storyDocsQueryStaticPath(input.id),
    },
    storyDocsForAllComponents: {
      description:
        'Returns story-docs payloads for every component in the story index, with only the stories in the manifests.',
      input: v.void(),
      output: v.record(v.string(), storyDocsPayloadSchema),
      handler: (_input, ctx) => ctx.self.state.components,
      load: async (_input, ctx) => {
        await ctx.self.commands.extractAllStoryDocs(undefined);
      },
    },
  },
  commands: {
    extractStoryDocs: {
      description:
        'Resolves the story entry for a component id, runs the registered provider chain, writes the result into state, and returns it (or undefined when no provider produced story docs).',
      input: storyDocsCommandInputSchema,
      output: storyDocsOutputSchema,
    },
    extractAllStoryDocs: {
      description:
        'Extracts story docs for every component id in the story index by invoking `extractStoryDocs` for each.',
      input: v.undefined(),
      output: v.void(),
    },
  },
});

export type StoryDocsService = ServiceInstanceOf<typeof storyDocsServiceDef>;
